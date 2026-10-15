import { describe, it, expect } from "vitest"
import {
  atributosDe,
  camposQueDifieren,
  construirCuerpoAgrupar,
  motivoDeBloqueo,
  seguimientoQueSeApaga,
  seguimientoQueSePrende,
  fuentePorDefecto,
  prefijoComun,
  validarAgrupacion,
  vistaPrevia,
  type ItemAgrupable,
  type OpcionAgrupar,
} from "@/lib/variantes-agrupar"
import { guardarGrupoSchema } from "@/lib/variantes-schema"
import { nombreVariante } from "@/lib/variantes"
import { NAME_VECTORS } from "../../__tests__/helpers/variantes-vectores"

const item = (id: string, nombre: string, extra: Partial<ItemAgrupable> = {}): ItemAgrupable => ({
  id,
  nombre,
  categoria: "Fundas",
  ...extra,
})

const COLOR: OpcionAgrupar = { id: "o1", nombre: "Color", valores: ["Rojo", "Azul"] }

describe("prefijoComun", () => {
  it.each([
    [["Funda X Rojo", "Funda X Azul"], "Funda X"],
    [["Funda silicona roja", "Funda silicona azul", "Funda silicona verde"], "Funda silicona"],
    [["Funda X - Rojo", "Funda X - Azul"], "Funda X"],
    [["funda x rojo", "Funda x azul"], "funda x"],
    [["Funda Roja", "Fundación azul"], ""],
    [["Cargador", "Funda"], ""],
    [["Funda"], "Funda"],
    [[], ""],
  ])("%j -> %j (whole words only)", (nombres, esperado) => {
    expect(prefijoComun(nombres)).toBe(esperado)
  })

  it("keeps the casing of the first name", () => {
    expect(prefijoComun(["Funda X Rojo", "funda x azul"])).toBe("Funda X")
  })
})

describe("motivoDeBloqueo", () => {
  it("is null for a plain standalone active item", () => {
    expect(motivoDeBloqueo(item("a", "A"))).toBeNull()
  })
  it.each([
    [{ esKit: true }, "kit"],
    [{ deletedAt: "2026-01-01" }, "archivado"],
    [{ grupoId: "g-1" }, "agrupado"],
    [{ esKit: true, grupoId: "g-1" }, "kit"],
    [{ deletedAt: "2026-01-01", grupoId: "g-1" }, "archivado"],
  ] as const)("%j -> %s", (extra, motivo) => {
    expect(motivoDeBloqueo(item("a", "A", extra))).toBe(motivo)
  })
})

describe("camposQueDifieren (VB-3)", () => {
  it("is empty when nothing differs, whatever the photos are", () => {
    const items = [item("a", "A", { imagenUrl: "https://x/a.jpg" }), item("b", "B", { imagenUrl: "https://x/b.jpg" })]
    expect(camposQueDifieren(items)).toEqual([])
  })

  it("lists a differing field with every item's value", () => {
    const campos = camposQueDifieren([item("a", "A", { categoria: "Fundas" }), item("b", "B", { categoria: "Accesorios" }), item("c", "C", { categoria: "Fundas" })])
    expect(campos).toEqual([
      {
        clave: "categoria",
        etiqueta: "Categoría",
        valores: [
          { itemId: "a", texto: "Fundas" },
          { itemId: "b", texto: "Accesorios" },
          { itemId: "c", texto: "Fundas" },
        ],
      },
    ])
  })

  it("never lists the photo, whatever differs", () => {
    const campos = camposQueDifieren([
      item("a", "A", { categoria: "x", imagenUrl: "https://x/a.jpg", imagenRespaldo: { url: "https://x/z.jpg", etiqueta: "Z" } }),
      item("b", "B", { categoria: "y", imagenUrl: null }),
    ])
    expect(JSON.stringify(campos)).not.toMatch(/imagen|jpg|foto/i)
  })

  it("treats null, undefined and blank text as the same value", () => {
    const items = [item("a", "A", { descripcion: null }), item("b", "B", { descripcion: "" }), item("c", "C", { descripcion: "  " }), item("d", "D")]
    expect(camposQueDifieren(items)).toEqual([])
  })

  it("covers every shared field with a readable text", () => {
    const a = item("a", "A", {
      descripcion: "Una",
      tipoDispositivo: "CELULAR",
      proveedor: "Sur",
      proveedorId: "p1",
      diasGarantiaDefault: 30,
      trackeaLotes: true,
      trackeaSeries: true,
      diasAlertaVencimiento: 10,
    })
    const b = item("b", "B", {
      categoria: "Otra",
      descripcion: null,
      tipoDispositivo: "TABLET",
      proveedor: "Norte",
      proveedorId: "p2",
      diasGarantiaDefault: null,
      trackeaLotes: false,
      trackeaSeries: false,
      diasAlertaVencimiento: null,
    })
    const campos = camposQueDifieren([a, b])
    expect(campos.map((c) => c.clave)).toEqual([
      "categoria",
      "descripcion",
      "tipoDispositivo",
      "proveedor",
      "diasGarantiaDefault",
      "trackeaLotes",
      "trackeaSeries",
      "diasAlertaVencimiento",
    ])
    const texto = (clave: string) => campos.find((c) => c.clave === clave)!.valores.map((v) => v.texto)
    expect(texto("proveedor")).toEqual(["Sur", "Norte"])
    expect(texto("trackeaLotes")).toEqual(["Sí", "No"])
    expect(texto("diasGarantiaDefault")).toEqual(["30 días", "Sin dato"])
    expect(texto("descripcion")).toEqual(["Una", "Sin dato"])
  })

  it("two providers with the same id but a missing name are the same provider", () => {
    expect(camposQueDifieren([item("a", "A", { proveedorId: "p1", proveedor: "Sur" }), item("b", "B", { proveedorId: "p1", proveedor: null })])).toEqual([])
  })
})

describe("seguimientoQueSeApaga (VB-3 S2)", () => {
  const con = (id: string, extra: Partial<ItemAgrupable>) => item(id, id, extra)

  it("lists the items whose series or lots tracking the source would turn off", () => {
    const items = [
      con("a", { trackeaSeries: true, trackeaLotes: true }),
      con("b", { trackeaSeries: false, trackeaLotes: false }),
      con("c", { trackeaSeries: true, trackeaLotes: false }),
    ]
    expect(seguimientoQueSeApaga(items, "b")).toEqual([
      { itemId: "a", tipo: "series" },
      { itemId: "a", tipo: "lotes" },
      { itemId: "c", tipo: "series" },
    ])
  })

  it("nothing when the source tracks at least as much as the item", () => {
    const items = [con("a", { trackeaSeries: false }), con("b", { trackeaSeries: true, trackeaLotes: true })]
    expect(seguimientoQueSeApaga(items, "b")).toEqual([])
  })

  it("nothing without a source, or with a source that is not in the list", () => {
    const items = [con("a", { trackeaSeries: true }), con("b", {})]
    expect(seguimientoQueSeApaga(items, null)).toEqual([])
    expect(seguimientoQueSeApaga(items, "zzz")).toEqual([])
  })

  it("never lists the source itself", () => {
    expect(seguimientoQueSeApaga([con("a", { trackeaSeries: true }), con("b", { trackeaSeries: false })], "a")).toEqual([])
  })
})

describe("seguimientoQueSePrende (tracking turned ON by grouping)", () => {
  const con = (id: string, extra: Partial<ItemAgrupable>) => item(id, id, extra)

  it("lists the items that do not track series or lots while the source does", () => {
    const items = [
      con("a", { trackeaSeries: false, trackeaLotes: false }),
      con("b", { trackeaSeries: true, trackeaLotes: true }),
      con("c", { trackeaSeries: true, trackeaLotes: false }),
    ]
    expect(seguimientoQueSePrende(items, "b")).toEqual([
      { itemId: "a", tipo: "series" },
      { itemId: "a", tipo: "lotes" },
      { itemId: "c", tipo: "lotes" },
    ])
  })

  it("nothing when the source tracks less, equal, or there is no source", () => {
    const items = [con("a", { trackeaSeries: true }), con("b", { trackeaSeries: false })]
    expect(seguimientoQueSePrende(items, "b")).toEqual([])
    expect(seguimientoQueSePrende(items, null)).toEqual([])
  })

  it("is the mirror of seguimientoQueSeApaga", () => {
    const items = [con("a", { trackeaSeries: true }), con("b", { trackeaSeries: false })]
    expect(seguimientoQueSePrende(items, "a")).toEqual([{ itemId: "b", tipo: "series" }])
    expect(seguimientoQueSeApaga(items, "a")).toEqual([])
  })
})

describe("fuentePorDefecto", () => {
  const con = (id: string, extra: Partial<ItemAgrupable>) => item(id, id, extra)

  it("is null when tracking is the same everywhere: the choice does not matter for stock control, the user picks", () => {
    expect(fuentePorDefecto([con("a", {}), con("b", {})])).toBeNull()
    expect(fuentePorDefecto([con("a", { trackeaSeries: true }), con("b", { trackeaSeries: true })])).toBeNull()
  })

  it("picks the source that flips the fewest others (the majority's tracking)", () => {
    const items = [con("a", { trackeaSeries: true }), con("b", { trackeaSeries: true }), con("c", { trackeaSeries: false })]
    expect(fuentePorDefecto(items)).toBe("a")
  })

  it("counts series and lots together", () => {
    const items = [
      con("a", { trackeaSeries: true, trackeaLotes: false }),
      con("b", { trackeaSeries: false, trackeaLotes: true }),
      con("c", { trackeaSeries: false, trackeaLotes: true }),
    ]
    expect(fuentePorDefecto(items)).toBe("b")
  })

  it("is null on a tie: nobody is the obvious choice", () => {
    expect(fuentePorDefecto([con("a", { trackeaSeries: true }), con("b", { trackeaSeries: false })])).toBeNull()
  })

  it("ignores items that cannot join (kits, archived, grouped)", () => {
    const items = [con("a", { trackeaSeries: true }), con("b", { trackeaSeries: false }), con("k", { trackeaSeries: false, esKit: true })]
    expect(fuentePorDefecto(items)).toBeNull()
  })
})

describe("atributosDe", () => {
  it("returns the pairs in option order, trimmed", () => {
    const opciones: OpcionAgrupar[] = [COLOR, { id: "o2", nombre: "Talle", valores: ["M"] }]
    expect(atributosDe(opciones, { o2: " M ", o1: "Rojo" })).toEqual([
      { opcion: "Color", valor: "Rojo" },
      { opcion: "Talle", valor: "M" },
    ])
  })
  it("returns null while an option is not assigned", () => {
    expect(atributosDe([COLOR], {})).toBeNull()
    expect(atributosDe([COLOR], { o1: "  " })).toBeNull()
  })
})

describe("validarAgrupacion", () => {
  const dos = [item("a", "Funda X Rojo"), item("b", "Funda X Azul")]
  const asignacion = { a: { o1: "Rojo" }, b: { o1: "Azul" } }
  const claves = (p: ReturnType<typeof validarAgrupacion>) => p.map((x) => x.clave)

  it("accepts a complete, unique assignment", () => {
    expect(validarAgrupacion({ base: "Funda X", opciones: [COLOR], items: dos, asignacion })).toEqual([])
  })

  it("blocks an empty base name", () => {
    expect(claves(validarAgrupacion({ base: "  ", opciones: [COLOR], items: dos, asignacion }))).toContain("base_vacia")
  })

  it("blocks fewer than two items", () => {
    expect(claves(validarAgrupacion({ base: "F", opciones: [COLOR], items: [dos[0]], asignacion }))).toContain("pocos")
  })

  it("blocks more than 100 items", () => {
    const muchos = Array.from({ length: 101 }, (_, i) => item(`i${i}`, `Item ${i}`))
    expect(claves(validarAgrupacion({ base: "F", opciones: [COLOR], items: muchos, asignacion: {} }))).toContain("demasiados")
  })

  it("blocks an item with a missing value, and names it", () => {
    const problemas = validarAgrupacion({ base: "F", opciones: [COLOR], items: dos, asignacion: { a: { o1: "Rojo" } } })
    expect(problemas.find((p) => p.clave === "sin_asignar")).toMatchObject({ itemIds: ["b"] })
  })

  it("blocks the same combination twice, ignoring case and accents, and names both items", () => {
    const problemas = validarAgrupacion({ base: "F", opciones: [COLOR], items: dos, asignacion: { a: { o1: "Rojo" }, b: { o1: " rojó " } } })
    expect(problemas.find((p) => p.clave === "combinacion_repetida")).toMatchObject({ itemIds: ["a", "b"] })
  })

  it.each([
    ["kit", { esKit: true }],
    ["archived", { deletedAt: "2026-01-01" }],
    ["already grouped", { grupoId: "g-9" }],
  ])("blocks a %s item", (_t, extra) => {
    const problemas = validarAgrupacion({ base: "F", opciones: [COLOR], items: [dos[0], { ...dos[1], ...extra }], asignacion })
    expect(problemas.find((p) => p.clave === "bloqueado")).toMatchObject({ itemIds: ["b"] })
  })

  it("blocks an option without a name, without values, or repeated", () => {
    const sinNombre = validarAgrupacion({ base: "F", opciones: [{ ...COLOR, nombre: " " }], items: dos, asignacion })
    expect(claves(sinNombre)).toContain("opcion_sin_nombre")
    const sinValores = validarAgrupacion({ base: "F", opciones: [{ ...COLOR, valores: [] }], items: dos, asignacion })
    expect(claves(sinValores)).toContain("opcion_sin_valores")
    const repetida = validarAgrupacion({ base: "F", opciones: [COLOR, { ...COLOR, id: "o2", nombre: "color" }], items: dos, asignacion: { a: { o1: "Rojo", o2: "Rojo" }, b: { o1: "Azul", o2: "Azul" } } })
    expect(claves(repetida)).toContain("opciones_repetidas")
  })

  it("blocks no options at all and more than 3", () => {
    expect(claves(validarAgrupacion({ base: "F", opciones: [], items: dos, asignacion }))).toContain("sin_opciones")
    const cuatro = ["A", "B", "C", "D"].map((n, i) => ({ id: `x${i}`, nombre: n, valores: ["v"] }))
    expect(claves(validarAgrupacion({ base: "F", opciones: cuatro, items: dos, asignacion: {} }))).toContain("demasiadas_opciones")
  })

  it("blocks a base name over 200 characters", () => {
    expect(claves(validarAgrupacion({ base: "a".repeat(201), opciones: [COLOR], items: dos, asignacion }))).toContain("base_larga")
  })
})

describe("vistaPrevia (VB-2)", () => {
  const items = [item("a", "Funda X Rojo"), item("b", "Funda X Azul")]
  const asignacion = { a: { o1: "Rojo" }, b: { o1: "Azul" } }

  it("builds before and after for EVERY item with nombreVariante when renaming", () => {
    expect(vistaPrevia({ base: "Funda X", opciones: [COLOR], items, asignacion, renombrar: true })).toEqual([
      { id: "a", antes: "Funda X Rojo", despues: "Funda X - Rojo" },
      { id: "b", antes: "Funda X Azul", despues: "Funda X - Azul" },
    ])
  })

  it("matches the shared name vectors", () => {
    for (const v of NAME_VECTORS.filter((n) => n.values.length === 1)) {
      const opciones = [{ id: "o1", nombre: "Opcion", valores: v.values }]
      const [fila] = vistaPrevia({ base: v.base, opciones, items: [item("a", "Antes")], asignacion: { a: { o1: v.values[0] } }, renombrar: true })
      expect(fila.despues).toBe(v.expected)
      expect(fila.despues).toBe(nombreVariante(v.base, [{ opcion: "Opcion", valor: v.values[0] }]))
    }
  })

  it("shows no change at all when not renaming", () => {
    expect(vistaPrevia({ base: "Funda X", opciones: [COLOR], items, asignacion, renombrar: false })).toEqual([
      { id: "a", antes: "Funda X Rojo", despues: null },
      { id: "b", antes: "Funda X Azul", despues: null },
    ])
  })

  it("an item still without a combination previews as the base alone is NOT shown: despues is null", () => {
    const [fila] = vistaPrevia({ base: "Funda X", opciones: [COLOR], items: [item("a", "A")], asignacion: {}, renombrar: true })
    expect(fila.despues).toBeNull()
  })
})

describe("construirCuerpoAgrupar", () => {
  const items = [item("a", "Funda X Rojo"), item("b", "Funda X Azul")]
  const asignacion = { a: { o1: "Rojo" }, b: { o1: "Azul" } }
  const ID = "c" + "0".repeat(24)

  it("builds the PUT body: group, {id, atributos} per item, renombrar, and the source", () => {
    const cuerpo = construirCuerpoAgrupar({ base: " Funda X ", opciones: [COLOR], items, asignacion, renombrar: false, fuenteId: "b" })
    expect(cuerpo).toStrictEqual({
      grupo: { nombre: "Funda X", opciones: [{ nombre: "Color", valores: ["Rojo", "Azul"] }], renombrar: false },
      fuenteCompartidosId: "b",
      variantes: [
        { id: "a", atributos: [{ opcion: "Color", valor: "Rojo" }] },
        { id: "b", atributos: [{ opcion: "Color", valor: "Azul" }] },
      ],
    })
  })

  it("has no source key when nothing differs", () => {
    const cuerpo = construirCuerpoAgrupar({ base: "Funda X", opciones: [COLOR], items, asignacion, renombrar: true, fuenteId: null })
    expect(cuerpo).not.toHaveProperty("fuenteCompartidosId")
    expect(cuerpo.grupo.renombrar).toBe(true)
  })

  it("carries nothing but ids and combinations for the items: no stock, code, price or photo", () => {
    const cuerpo = construirCuerpoAgrupar({
      base: "Funda X",
      opciones: [COLOR],
      items: items.map((i) => ({ ...i, stock: 9, codigo: "X", precioVenta: 1, imagenUrl: "https://x/y.jpg" })) as ItemAgrupable[],
      asignacion,
      renombrar: true,
      fuenteId: "a",
    })
    for (const v of cuerpo.variantes) expect(Object.keys(v).sort()).toEqual(["atributos", "id"])
    expect(JSON.stringify(cuerpo)).not.toMatch(/imagen|jpg|stock|precio/i)
  })

  it("passes the strict schema the route validates with", () => {
    const cuerpo = construirCuerpoAgrupar({
      base: "Funda X",
      opciones: [COLOR],
      items: [item(ID, "A"), item("c" + "1".repeat(24), "B")],
      asignacion: { [ID]: { o1: "Rojo" }, ["c" + "1".repeat(24)]: { o1: "Azul" } },
      renombrar: true,
      fuenteId: ID,
    })
    expect(guardarGrupoSchema.safeParse(cuerpo).success).toBe(true)
  })

  it("trims values and option names, and drops duplicates in a value list", () => {
    const cuerpo = construirCuerpoAgrupar({
      base: "F",
      opciones: [{ id: "o1", nombre: " Color ", valores: [" Rojo ", "rojo", "Azul"] }],
      items,
      asignacion: { a: { o1: " Rojo " }, b: { o1: "Azul" } },
      renombrar: true,
      fuenteId: null,
    })
    expect(cuerpo.grupo.opciones).toEqual([{ nombre: "Color", valores: ["Rojo", "Azul"] }])
    expect(cuerpo.variantes[0].atributos).toEqual([{ opcion: "Color", valor: "Rojo" }])
  })
})
