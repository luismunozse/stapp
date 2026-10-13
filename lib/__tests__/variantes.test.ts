// @vitest-environment node
import { describe, it, expect, vi } from "vitest"
import { KEY_VECTORS, NAME_VECTORS } from "@/__tests__/helpers/variantes-vectores"
import { collapse, readBySuffix } from "@/__tests__/helpers/sql-text"
import type { AtributoVariante } from "@/types"
import {
  claveCombinacion,
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

  it("folds exactly the accents the SQL translate() folds", () => {
    const sql = collapse(readBySuffix("_variantes_grupos.sql"))
    const m = sql.match(/'\)\),\s*'([^']+)',\s*'([^']+)'\),\s*chr\(31\)/)
    expect(m).not.toBeNull()
    const [from, to] = [[...m![1]], [...m![2]]]
    expect(from).toHaveLength(20)
    expect(to).toHaveLength(20)
    from.forEach((accented, i) => {
      expect(key(accented)).toBe(to[i])
      expect(key(accented.toUpperCase())).toBe(to[i])
    })
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
