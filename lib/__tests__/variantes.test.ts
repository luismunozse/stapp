// @vitest-environment node
import { describe, it, expect, vi } from "vitest"
import { KEY_VECTORS, NAME_VECTORS } from "@/__tests__/helpers/variantes-vectores"
import { collapse, readBySuffix } from "@/__tests__/helpers/sql-text"
import type { AtributoVariante } from "@/types"
import {
  claveCombinacion,
  fotoDeRespaldo,
  imagenRespaldoDe,
  nombreVariante,
  etiquetaVariante,
  generarIdCliente,
  selectConFallback,
} from "@/lib/variantes"

const attrs = (valores: string[]): AtributoVariante[] =>
  valores.map((valor, i) => ({ opcion: `Opcion ${i + 1}`, valor }))
const SEP = String.fromCharCode(31)
const key = (...valores: string[]) => claveCombinacion(attrs(valores))

describe("claveCombinacion (JS twin of inventario_combinacion_clave)", () => {
  it.each(KEY_VECTORS)("$a vs $b -> same: $same", ({ a, b, same }) => {
    const [ka, kb] = [key(...a), key(...b)]
    expect(ka.length).toBeGreaterThan(0)
    if (same) expect(ka).toBe(kb)
    else expect(ka).not.toBe(kb)
  })

  it("joins the folded values with chr(31) in option order", () => {
    expect(key("Rojo", "M")).toBe(`rojo${SEP}m`)
    expect(key("M", "Rojo")).toBe(`m${SEP}rojo`)
  })

  it("keeps n-tilde distinct while folding case and accents", () => {
    expect(key(" \tÑANDÚ\n")).toBe("ñandu")
  })

  // The translate() literal of the frozen SQL key function: [accented letters, plain letters].
  const mapaSql = () => {
    const sql = collapse(readBySuffix("_variantes_grupos.sql"))
    const m = sql.match(/'\)\),\s*'([^']+)',\s*'([^']+)'\),\s*chr\(31\)/)
    expect(m).not.toBeNull()
    return [[...m![1]], [...m![2]]] as const
  }

  it("folds exactly the accents the SQL translate() folds", () => {
    const [from, to] = mapaSql()
    expect(from).toHaveLength(20)
    expect(to).toHaveLength(20)
    from.forEach((accented, i) => {
      expect(key(accented)).toBe(to[i])
      expect(key(accented.toUpperCase())).toBe(to[i])
    })
  })

  it("changes nothing outside that map: every other Latin-1 letter only lowercases", () => {
    const [from] = mapaSql()
    let checked = 0
    for (let cp = 0xc0; cp <= 0xff; cp++) {
      if (cp === 0xd7 || cp === 0xf7) continue // multiplication and division signs
      const ch = String.fromCharCode(cp)
      if (from.includes(ch.toLowerCase())) continue
      expect(key(ch)).toBe(ch.toLowerCase())
      checked++
    }
    // 62 letters minus the 40 (20 lower + 20 upper) the map folds; includes c-cedilla, a-tilde, o-slash, sharp s.
    expect(checked).toBe(22)
  })

  // The SQL key trims the 25 characters String.prototype.trim() removes.
  const TRIMMED = [0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff]
    .concat(Array.from({ length: 11 }, (_, i) => 0x2000 + i))
    .map((cp) => [cp.toString(16).toUpperCase().padStart(4, "0"), cp] as const)
  it.each(TRIMMED)("trims the whitespace code point U+%s", (_hex, cp) => {
    const ch = String.fromCharCode(cp)
    expect(key(`${ch}Rojo${ch}`)).toBe("rojo")
  })

  it("does not trim what SQL does not trim (zero-width space, NEL)", () => {
    for (const cp of [0x200b, 0x85]) {
      const ch = String.fromCharCode(cp)
      expect(key(`${ch}Rojo`)).toBe(`${ch}rojo`)
    }
  })

  it("skips entries without a string valor, like string_agg skips NULL", () => {
    expect(claveCombinacion([{ opcion: "Color", valor: "Rojo" }, { opcion: "X" } as never])).toBe("rojo")
    expect(claveCombinacion([])).toBe("")
  })
})

describe("nombreVariante (JS twin of inventario_nombre_variante)", () => {
  it.each(NAME_VECTORS)("$base + $values -> $expected", ({ base, values, expected }) => {
    expect(nombreVariante(base, attrs(values))).toBe(expected)
  })

  it("uses the stored valor as typed: no trim, no case folding", () => {
    expect(nombreVariante("Funda", attrs([" AZUL ", "m"]))).toBe("Funda -  AZUL  / m")
  })

  it("returns the base for a standalone row (no atributos)", () => {
    expect(nombreVariante("Funda X", null)).toBe("Funda X")
    expect(nombreVariante("Funda X", undefined)).toBe("Funda X")
  })
})

describe("etiquetaVariante", () => {
  it("joins the values with ' / ' in option order", () => {
    expect(etiquetaVariante(attrs(["Azul", "M"]))).toBe("Azul / M")
    expect(etiquetaVariante(attrs(["Azul"]))).toBe("Azul")
  })

  it("is the suffix of the derived name", () => {
    const a = attrs(["Rojó", "L", "2"])
    expect(nombreVariante("Funda X", a)).toBe(`Funda X - ${etiquetaVariante(a)}`)
  })

  it.each([null, undefined, []])("is null when there is nothing to show (%j)", (v) => {
    expect(etiquetaVariante(v)).toBeNull()
  })
})

describe("generarIdCliente", () => {
  it("returns a cuid-shaped id the RPC accepts: c + 24 lowercase hex", () => {
    expect(generarIdCliente()).toMatch(/^c[0-9a-f]{24}$/)
  })

  it("does not repeat", () => {
    const ids = new Set(Array.from({ length: 200 }, () => generarIdCliente()))
    expect(ids.size).toBe(200)
  })

  it("prints 12 bytes drawn from crypto.getRandomValues as zero-padded hex", () => {
    const bytes = [0, 5, 15, 16, 255, 171, 1, 2, 3, 4, 250, 128]
    const spy = vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(((buffer: Uint8Array) => {
      buffer.set(bytes)
      return buffer
    }) as never)
    try {
      expect(generarIdCliente()).toBe("c00050f10ffab01020304fa80")
      expect(spy).toHaveBeenCalledTimes(1)
      const buffer = spy.mock.calls[0][0] as Uint8Array
      expect(buffer).toBeInstanceOf(Uint8Array)
      expect(buffer).toHaveLength(12)
    } finally {
      spy.mockRestore()
    }
  })
})

describe("selectConFallback", () => {
  const CON = "id, grupo_id, atributos"
  const BASE = "id"
  const ok = (select: string) => ({ data: [{ select }], error: null })
  const fail = (code: string, message: string) => ({ data: null, error: { code, message } })

  // Realistic shapes: isMissingColumnError matches 42703/PGRST204 by code and the
  // rest by message text, so a bare code would lie about the others (G1).
  const FALTANTES: [string, string][] = [
    ["42703", "column inventario.grupo_id does not exist"],
    ["42P01", 'relation "inventario_grupos" does not exist'],
    ["42883", "function guardar_grupo_variantes(text) does not exist"],
    ["PGRST200", "Could not find a relationship between 'inventario' and 'inventario_grupos' in the schema cache"],
    ["PGRST202", "Could not find the function public.guardar_grupo_variantes(p_org) in the schema cache"],
    ["PGRST204", "Could not find the 'grupo_id' column of 'inventario' in the schema cache"],
  ]

  it("runs only the first step when it succeeds and stops there", async () => {
    const run = vi.fn(async (select: string) => ok(select))
    const result = await selectConFallback(run, [CON, BASE, "never"])()
    expect(run.mock.calls.map((c) => c[0])).toEqual([CON])
    expect(result.data).toEqual([{ select: CON }])
  })

  it.each(FALTANTES)("downgrades on %s", async (code, message) => {
    const run = vi.fn(async (select: string) => (select === CON ? fail(code, message) : ok(select)))
    const result = await selectConFallback(run, [CON, BASE])()
    expect(run.mock.calls.map((c) => c[0])).toEqual([CON, BASE])
    expect(result.error).toBeNull()
    expect(result.data).toEqual([{ select: BASE }])
  })

  it("keeps the downgrade for later passes and forwards the arguments", async () => {
    const run = vi.fn(async (select: string, _modo: string) =>
      select === CON ? fail(...FALTANTES[0]) : ok(select)
    )
    const listar = selectConFallback(run, [CON, BASE])
    await listar("fts")
    await listar("ilike")
    expect(run.mock.calls).toEqual([[CON, "fts"], [BASE, "fts"], [BASE, "ilike"]])
  })

  it("concurrent calls that both fail at the first step never run past the last step", async () => {
    type Respuesta = { data: unknown; error: unknown }
    const enVuelo: ((r: Respuesta) => void)[] = []
    const run = vi.fn((select: string): Promise<Respuesta> =>
      select === CON ? new Promise((resolve) => enVuelo.push(resolve)) : Promise.resolve(ok(select))
    )
    const listar = selectConFallback(run, [CON, BASE])

    const [a, b] = [listar(), listar()]
    expect(run.mock.calls.map((c) => c[0])).toEqual([CON, CON])
    enVuelo.forEach((resolve) => resolve(fail(...FALTANTES[0])))
    const [ra, rb] = await Promise.all([a, b])

    // Both retry the plain select; neither goes looking for a step that does not exist.
    expect(run.mock.calls.map((c) => c[0])).toEqual([CON, CON, BASE, BASE])
    expect(ra.data).toEqual([{ select: BASE }])
    expect(rb.data).toEqual([{ select: BASE }])
    // The downgrade still sticks.
    await listar()
    expect(run.mock.calls.map((c) => c[0])).toEqual([CON, CON, BASE, BASE, BASE])
  })

  it("keeps a working first step for later passes too", async () => {
    const run = vi.fn(async (select: string) => ok(select))
    const listar = selectConFallback(run, [CON, BASE])
    await listar()
    await listar()
    expect(run.mock.calls.map((c) => c[0])).toEqual([CON, CON])
  })

  it("walks every step and returns the last failure when none works", async () => {
    const run = vi.fn(async () => fail(...FALTANTES[0]))
    const result = await selectConFallback(run, [CON, "id, grupo_id", BASE])()
    expect(run).toHaveBeenCalledTimes(3)
    expect(result.error).toEqual({ code: "42703", message: FALTANTES[0][1] })
  })

  it("never swallows an error that is not a missing column", async () => {
    const timeout = { code: "57014", message: "canceling statement due to statement timeout" }
    const run = vi.fn(async () => ({ data: null, error: timeout }))
    const result = await selectConFallback(run, [CON, BASE])()
    expect(run).toHaveBeenCalledTimes(1)
    expect(result.error).toBe(timeout)
  })

  it("downgrades on a thrown missing-column error and rethrows anything else", async () => {
    const [code, message] = FALTANTES[0]
    const run = vi.fn(async (select: string) => {
      if (select === CON) throw { code, message }
      return ok(select)
    })
    expect((await selectConFallback(run, [CON, BASE])()).data).toEqual([{ select: BASE }])

    const boom = new Error("connection reset")
    const broken = vi.fn(async () => {
      throw boom
    })
    await expect(selectConFallback(broken, [CON, BASE])()).rejects.toBe(boom)
    expect(broken).toHaveBeenCalledTimes(1)
  })
})

describe("fotoDeRespaldo (display-only fallback photo of a variant without its own)", () => {
  const COLOR = { nombre: "Color", valores: ["Rojo", "Azul", "Verde"] }
  const TALLE = { nombre: "Talle", valores: ["S", "M"] }
  const color = (valor: string): AtributoVariante[] => [{ opcion: "Color", valor }]
  const colorTalle = (c: string, t: string): AtributoVariante[] => [
    { opcion: "Color", valor: c },
    { opcion: "Talle", valor: t },
  ]
  const hermano = (id: string, atributos: AtributoVariante[], foto: string | null) => ({ id, atributos, foto })

  it("takes the first sibling in OPTION order, not the first one listed", () => {
    // Listed reversed: Verde, Azul, Rojo. Rojo comes first in the option, so it lends.
    const hermanos = [
      hermano("verde", color("Verde"), "https://f/verde.jpg"),
      hermano("azul", color("Azul"), "https://f/azul.jpg"),
      hermano("rojo", color("Rojo"), "https://f/rojo.jpg"),
    ]
    expect(fotoDeRespaldo([COLOR], hermanos, "otro")).toEqual({ url: "https://f/rojo.jpg", deId: "rojo" })
  })

  it("lets option order beat id order (an id that sorts first loses to an earlier value)", () => {
    const hermanos = [
      hermano("a-id", color("Verde"), "https://f/verde.jpg"),
      hermano("z-id", color("Rojo"), "https://f/rojo.jpg"),
    ]
    expect(fotoDeRespaldo([COLOR], hermanos, "otro")?.deId).toBe("z-id")
  })

  it("never lends a row its own photo and skips siblings without a photo", () => {
    const hermanos = [
      hermano("rojo", color("Rojo"), "https://f/rojo.jpg"),
      hermano("azul", color("Azul"), null),
      hermano("verde", color("Verde"), "https://f/verde.jpg"),
    ]
    // Rojo asks: itself is excluded, Azul has no photo, so Verde lends.
    expect(fotoDeRespaldo([COLOR], hermanos, "rojo")).toEqual({ url: "https://f/verde.jpg", deId: "verde" })
    // Azul asks: Rojo is first.
    expect(fotoDeRespaldo([COLOR], hermanos, "azul")?.deId).toBe("rojo")
  })

  it("photos only on Azul and Verde: Rojo borrows Azul's, not Verde's", () => {
    const hermanos = [
      hermano("verde", color("Verde"), "https://f/verde.jpg"),
      hermano("azul", color("Azul"), "https://f/azul.jpg"),
    ]
    expect(fotoDeRespaldo([COLOR], hermanos, "rojo")?.deId).toBe("azul")
  })

  it("returns null when no sibling has a photo, when the only owner is the row itself, and for an empty list", () => {
    expect(fotoDeRespaldo([COLOR], [hermano("rojo", color("Rojo"), null)], "azul")).toBeNull()
    expect(fotoDeRespaldo([COLOR], [hermano("azul", color("Azul"), "https://f/azul.jpg")], "azul")).toBeNull()
    expect(fotoDeRespaldo([COLOR], [], "azul")).toBeNull()
  })

  it("orders by the first option, then the second (Color then Talle)", () => {
    const hermanos = [
      hermano("azul-s", colorTalle("Azul", "S"), "https://f/azul-s.jpg"),
      hermano("rojo-m", colorTalle("Rojo", "M"), "https://f/rojo-m.jpg"),
      hermano("rojo-s", colorTalle("Rojo", "S"), "https://f/rojo-s.jpg"),
    ]
    expect(fotoDeRespaldo([COLOR, TALLE], hermanos, "otro")?.deId).toBe("rojo-s")
    // Without Rojo/S, Rojo/M still beats Azul/S: the first option decides first.
    expect(fotoDeRespaldo([COLOR, TALLE], hermanos.filter((h) => h.id !== "rojo-s"), "otro")?.deId).toBe("rojo-m")
  })

  it("sorts unknown values last and breaks ties by id", () => {
    const hermanos = [
      hermano("desconocido", color("Violeta"), "https://f/violeta.jpg"),
      hermano("verde", color("Verde"), "https://f/verde.jpg"),
    ]
    expect(fotoDeRespaldo([COLOR], hermanos, "otro")?.deId).toBe("verde")

    const empate = [
      hermano("b", color("Violeta"), "https://f/b.jpg"),
      hermano("a", color("Naranja"), "https://f/a.jpg"),
    ]
    // Both values are unknown to the group: the id decides.
    expect(fotoDeRespaldo([COLOR], empate, "otro")?.deId).toBe("a")
    expect(fotoDeRespaldo([COLOR], [...empate].reverse(), "otro")?.deId).toBe("a")
  })

  it("matches values like the combination key does (case, accents, spaces)", () => {
    const opciones = [{ nombre: "Color", valores: ["Rojo", "Azul"] }]
    const hermanos = [
      hermano("azul", color("Azul"), "https://f/azul.jpg"),
      hermano("rojo", color(" ROJÓ "), "https://f/rojo.jpg"),
    ]
    expect(fotoDeRespaldo(opciones, hermanos, "otro")?.deId).toBe("rojo")
  })

  it("matches the option by name, not by position, and ranks an unknown option last", () => {
    const opciones = [COLOR, TALLE]
    // atributos arrive in the opposite order to the options: Talle first.
    const hermanos = [
      hermano("m-rojo", [{ opcion: "Talle", valor: "M" }, { opcion: "Color", valor: "Rojo" }], "https://f/m-rojo.jpg"),
      hermano("s-azul", [{ opcion: "Talle", valor: "S" }, { opcion: "Color", valor: "Azul" }], "https://f/s-azul.jpg"),
    ]
    // Color decides first: Rojo (index 0) beats Azul (index 1) whatever the array order.
    expect(fotoDeRespaldo(opciones, hermanos, "otro")?.deId).toBe("m-rojo")

    const sinOpcion = [
      hermano("raro", [{ opcion: "Material", valor: "Rojo" }], "https://f/raro.jpg"),
      hermano("verde", color("Verde"), "https://f/verde.jpg"),
    ]
    expect(fotoDeRespaldo([COLOR], sinOpcion, "otro")?.deId).toBe("verde")
  })

  it("tolerates missing atributos and a missing options list", () => {
    const hermanos = [
      hermano("sin", null as unknown as AtributoVariante[], "https://f/sin.jpg"),
      hermano("verde", color("Verde"), "https://f/verde.jpg"),
    ]
    expect(fotoDeRespaldo([COLOR], hermanos, "otro")?.deId).toBe("verde")
    expect(fotoDeRespaldo(null, [hermano("b", color("Rojo"), "https://f/b.jpg"), hermano("a", color("Azul"), "https://f/a.jpg")], "otro")?.deId).toBe("a")
  })
})

describe("imagenRespaldoDe (the {url, etiqueta} payload of the fallback)", () => {
  const OPCIONES = [
    { nombre: "Color", valores: ["Rojo", "Azul"] },
    { nombre: "Talle", valores: ["S", "M"] },
  ]
  const hermano = (id: string, c: string, t: string, foto: string | null) => ({
    id,
    atributos: [
      { opcion: "Color", valor: c },
      { opcion: "Talle", valor: t },
    ],
    foto,
  })

  it("labels the fallback with the lending sibling's full combination", () => {
    const hermanos = [hermano("azul-s", "Azul", "S", "https://f/a.jpg"), hermano("rojo-m", "Rojo", "M", "https://f/r.jpg")]
    expect(imagenRespaldoDe(OPCIONES, hermanos, "otro")).toEqual({ url: "https://f/r.jpg", etiqueta: "Rojo / M" })
    expect(imagenRespaldoDe(OPCIONES, hermanos, "rojo-m")).toEqual({ url: "https://f/a.jpg", etiqueta: "Azul / S" })
  })

  it("is null when nobody can lend", () => {
    expect(imagenRespaldoDe(OPCIONES, [hermano("rojo-m", "Rojo", "M", null)], "otro")).toBeNull()
    expect(imagenRespaldoDe(OPCIONES, [hermano("rojo-m", "Rojo", "M", "https://f/r.jpg")], "rojo-m")).toBeNull()
  })
})
