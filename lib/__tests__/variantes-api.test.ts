// @vitest-environment node
import { describe, it, expect, vi } from "vitest"
import { collapse, readBySuffix } from "@/__tests__/helpers/sql-text"
import {
  guardarGrupoSchema,
  argumentosGuardarGrupo,
  redondearPrecio,
  LIMITES,
  mapearErrorRpc,
  esReintentable,
  conReintento,
  migracionPendiente,
  respuestaDeError,
  respuestaDeValidacion,
} from "@/lib/variantes-api"

// Strict request schema + camel->snake mapper for PUT /api/inventario/grupos/[id].
// The save RPC (migration 361) is the authority for every cap; this schema rejects the
// same inputs earlier, with a Spanish message and a 400.

type Payload = Record<string, any>

const ID = (n: number) => `cdead${String(n).padStart(20, "0")}`
const NBSP = String.fromCharCode(0xa0)
const SEP = String.fromCharCode(31)
const EMOJI = String.fromCodePoint(0x1f600)
const NOMBRES = ["Color", "Talle", "Modelo", "Extra"]

const fila = (n: number, valores: string[], extra: Payload = {}): Payload => ({
  id: ID(n),
  atributos: valores.map((valor, i) => ({ opcion: NOMBRES[i], valor })),
  codigo: `FX-${n}`,
  ...extra,
})

/** A group with one option per entry of `valoresPorOpcion` and the full cross product of rows. */
function conOpciones(valoresPorOpcion: string[][]): Payload {
  const combos = valoresPorOpcion.reduce<string[][]>(
    (acc, valores) => acc.flatMap((previo) => valores.map((v) => [...previo, v])),
    [[]]
  )
  return {
    grupo: { nombre: "Funda X", opciones: valoresPorOpcion.map((valores, i) => ({ nombre: NOMBRES[i], valores })) },
    variantes: combos.map((c, i) => fila(i + 1, c)),
  }
}

const base = (): Payload => conOpciones([["Rojo", "Azul"]])
const conFila = (i: number, extra: Payload): Payload => {
  const p = base()
  p.variantes[i] = { ...p.variantes[i], ...extra }
  return p
}
const conGrupo = (extra: Payload): Payload => ({ ...base(), grupo: { ...base().grupo, ...extra } })
const rango = (n: number, prefijo = "V") => Array.from({ length: n }, (_, i) => `${prefijo}${i + 1}`)

const aceptado = (p: Payload) => {
  const r = guardarGrupoSchema.safeParse(p)
  if (!r.success) throw new Error(JSON.stringify(r.error.issues))
  return r.data
}
const rechazado = (p: Payload) => {
  const r = guardarGrupoSchema.safeParse(p)
  expect(r.success).toBe(false)
  return r.success ? [] : r.error.issues
}

describe("guardarGrupoSchema: strict keys", () => {
  it("accepts the minimal payload", () => {
    expect(aceptado(base()).variantes).toHaveLength(2)
  })

  it.each([
    ["root imagenUrl", { ...base(), imagenUrl: "x" }, [], "imagenUrl"],
    ["root organizationId (the org comes from the session)", { ...base(), organizationId: "org-2" }, [], "organizationId"],
    ["grupo id (the id is the URL's)", conGrupo({ id: ID(9) }), ["grupo"], "id"],
    ["grupo imagenUrl", conGrupo({ imagenUrl: "x" }), ["grupo"], "imagenUrl"],
    ["compartidos imagenUrl", { ...base(), compartidos: { categoria: "Fundas", imagenUrl: "x" } }, ["compartidos"], "imagenUrl"],
    ["compartidos imagenPath", { ...base(), compartidos: { imagenPath: "x" } }, ["compartidos"], "imagenPath"],
    ["variante imagenUrl", conFila(1, { imagenUrl: "x" }), ["variantes", 1], "imagenUrl"],
    ["variante imagen_url", conFila(0, { imagen_url: "x" }), ["variantes", 0], "imagen_url"],
    ["variante nombre (it is derived)", conFila(0, { nombre: "Otro" }), ["variantes", 0], "nombre"],
    ["variante stock (stock is never written here)", conFila(0, { stock: 3 }), ["variantes", 0], "stock"],
  ])("%s -> unrecognized key", (_t, payload, path, key) => {
    const issues = rechazado(payload as Payload)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ code: "unrecognized_keys", keys: [key], path })
  })

  it("an option and an atributos entry reject unknown keys too", () => {
    const opcion = base()
    opcion.grupo.opciones[0].extra = 1
    expect(rechazado(opcion)[0]).toMatchObject({ code: "unrecognized_keys", path: ["grupo", "opciones", 0] })

    const atributo = base()
    atributo.variantes[0].atributos[0].imagenUrl = "x"
    expect(rechazado(atributo)[0]).toMatchObject({ code: "unrecognized_keys", path: ["variantes", 0, "atributos", 0] })
  })

  it("requires grupo and variantes", () => {
    expect(rechazado({ variantes: [] })[0]).toMatchObject({ path: ["grupo"] })
    expect(rechazado({ grupo: base().grupo })[0]).toMatchObject({ path: ["variantes"] })
  })
})

describe("guardarGrupoSchema: limits", () => {
  it("accepts 3 options and rejects 4", () => {
    expect(aceptado(conOpciones([["a"], ["b"], ["c"]])).grupo.opciones).toHaveLength(3)
    const issues = rechazado(conOpciones([["a"], ["b"], ["c"], ["d"]]))
    expect(issues[0]).toMatchObject({ code: "too_big", path: ["grupo", "opciones"] })
  })

  it("rejects a group without options and an option without values", () => {
    expect(rechazado({ ...base(), grupo: { nombre: "X", opciones: [] } })[0]).toMatchObject({ code: "too_small", path: ["grupo", "opciones"] })
    const p = base()
    p.grupo.opciones[0].valores = []
    expect(rechazado(p)[0]).toMatchObject({ code: "too_small", path: ["grupo", "opciones", 0, "valores"] })
  })

  it("accepts a product of 100 combinations and rejects 5x5x5 (125)", () => {
    expect(aceptado(conOpciones([rango(10, "A"), rango(10, "B")])).variantes).toHaveLength(100)
    // Two rows only: the rejection comes from the options, not from the row count.
    const cincoPorCinco = conOpciones([rango(5, "A"), rango(5, "B"), rango(5, "C")])
    cincoPorCinco.variantes = cincoPorCinco.variantes.slice(0, 2)
    const issues = rechazado(cincoPorCinco)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ path: ["grupo", "opciones"] })
    expect(issues[0].message).toMatch(/100/)
    // 5x5x4 = 100 passes with the same two rows.
    const cien = conOpciones([rango(5, "A"), rango(5, "B"), rango(4, "C")])
    cien.variantes = cien.variantes.slice(0, 2)
    expect(aceptado(cien).variantes).toHaveLength(2)
  })

  it("rejects 125 rows", () => {
    expect(rechazado(conOpciones([rango(5, "A"), rango(5, "B"), rango(5, "C")]))[0]).toMatchObject({
      code: "too_big",
      path: ["variantes"],
    })
  })

  it("accepts 100 values in one option and rejects 101", () => {
    expect(aceptado(conOpciones([rango(100)])).variantes).toHaveLength(100)
    expect(rechazado(conOpciones([rango(101)]))[0]).toMatchObject({ code: "too_big", path: ["grupo", "opciones", 0, "valores"] })
  })

  it("accepts 100 rows and 100 archive ids and rejects 101 of each", () => {
    const cien = conOpciones([rango(100)])
    expect(aceptado({ ...cien, archivar: rango(100, "z") }).archivar).toHaveLength(100)
    expect(rechazado({ ...cien, archivar: rango(101, "z") })[0]).toMatchObject({ code: "too_big", path: ["archivar"] })
    const exceso = { ...cien, variantes: [...cien.variantes, fila(101, ["V101"])] }
    expect(rechazado(exceso)[0]).toMatchObject({ code: "too_big", path: ["variantes"] })
  })

  // [label, builder of a payload whose field has `n` characters, max]
  const TEXTOS: [string, (n: number) => Payload, number][] = [
    ["grupo.nombre", (n) => conGrupo({ nombre: "a".repeat(n) }), 200],
    ["option nombre", (n) => {
      const p = conOpciones([["Rojo"]])
      p.grupo.opciones[0].nombre = "a".repeat(n)
      p.variantes[0].atributos[0].opcion = "a".repeat(n)
      return p
    }, 100],
    ["option valor", (n) => {
      const p = base()
      p.grupo.opciones[0].valores[0] = "a".repeat(n)
      p.variantes[0].atributos[0].valor = "a".repeat(n)
      return p
    }, 100],
    ["atributos valor", (n) => conFila(0, { atributos: [{ opcion: "Color", valor: "a".repeat(n) }] }), 100],
    ["codigo", (n) => conFila(0, { codigo: "a".repeat(n) }), 100],
    ["barcode", (n) => conFila(0, { barcode: "1".repeat(n) }), 100],
    ["ubicacion", (n) => conFila(0, { ubicacion: "a".repeat(n) }), 100],
    ["compartidos.descripcion", (n) => ({ ...base(), compartidos: { descripcion: "a".repeat(n) } }), 2000],
    ["compartidos.categoria", (n) => ({ ...base(), compartidos: { categoria: "a".repeat(n) } }), 200],
    ["compartidos.tipoDispositivo", (n) => ({ ...base(), compartidos: { tipoDispositivo: "a".repeat(n) } }), 200],
    ["compartidos.proveedor", (n) => ({ ...base(), compartidos: { proveedor: "a".repeat(n) } }), 200],
    ["compartidos.proveedorId", (n) => ({ ...base(), compartidos: { proveedorId: "a".repeat(n) } }), 200],
  ]

  it.each(TEXTOS)("%s: max characters accepted, one more rejected", (_t, construir, max) => {
    expect(guardarGrupoSchema.safeParse(construir(max)).success).toBe(true)
    expect(guardarGrupoSchema.safeParse(construir(max + 1)).success).toBe(false)
  })

  it("counts characters like Postgres char_length (a code point is one)", () => {
    // 100 emoji = 200 UTF-16 units: a .length cap would reject what the RPC accepts.
    const cien = EMOJI.repeat(100)
    expect(guardarGrupoSchema.safeParse(conFila(0, { codigo: cien })).success).toBe(true)
    expect(guardarGrupoSchema.safeParse(conFila(0, { codigo: cien + EMOJI })).success).toBe(false)
  })

  it("exposes the caps it enforces", () => {
    expect(LIMITES).toMatchObject({ opciones: 3, combinaciones: 100, valor: 100, descripcion: 2000, precioMax: 99999999.99, enteroMax: 999999999 })
  })
})

describe("guardarGrupoSchema: values", () => {
  it.each([
    ["case", ["Rojo", "rojo"]],
    ["surrounding spaces", ["Rojo", " rojo "]],
    ["an accent", ["Rojo", "Rojó"]],
    ["tab and newline", ["Rojo", "\tROJO\n"]],
    ["a non-breaking space", ["Rojo", NBSP + "rojo" + NBSP]],
  ])("rejects a repeated value in one option (%s)", (_t, valores) => {
    const p = base()
    p.grupo.opciones[0].valores = valores
    const issues = rechazado(p)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ path: ["grupo", "opciones", 0, "valores", 1] })
  })

  it("keeps n-tilde distinct and allows the same value in different options", () => {
    const p = conOpciones([["Año", "Ano"], ["M"]])
    p.grupo.opciones.push({ nombre: "Modelo", valores: ["M", "L"] })
    p.variantes = p.variantes.map((v: Payload) => ({ ...v, atributos: [...v.atributos, { opcion: "Modelo", valor: "M" }] }))
    expect(aceptado(p).grupo.opciones[0].valores).toEqual(["Año", "Ano"])
  })

  it.each([
    ["empty", ""],
    ["spaces", "   "],
    ["a non-breaking space", NBSP],
    ["tabs", "\t\n"],
    ["chr(31)", `Ro${SEP}jo`],
  ])("rejects a blank or control value in the options (%s)", (_t, valor) => {
    const p = base()
    p.grupo.opciones[0].valores[1] = valor
    expect(rechazado(p)[0]).toMatchObject({ path: ["grupo", "opciones", 0, "valores", 1] })
  })

  it("rejects a blank value in atributos", () => {
    expect(rechazado(conFila(0, { atributos: [{ opcion: "Color", valor: " " }] }))[0]).toMatchObject({
      path: ["variantes", 0, "atributos", 0, "valor"],
    })
  })

  it("rejects repeated or blank option names", () => {
    const repetidas = conOpciones([["a"], ["b"]])
    repetidas.grupo.opciones[1].nombre = " color "
    repetidas.variantes.forEach((v: Payload) => (v.atributos[1].opcion = " color "))
    expect(rechazado(repetidas)[0]).toMatchObject({ path: ["grupo", "opciones", 1, "nombre"] })

    const vacia = base()
    vacia.grupo.opciones[0].nombre = "  "
    expect(rechazado(vacia)[0]).toMatchObject({ path: ["grupo", "opciones", 0, "nombre"] })
  })

  it("rejects a blank group name and a blank codigo", () => {
    expect(rechazado(conGrupo({ nombre: "  " }))[0]).toMatchObject({ path: ["grupo", "nombre"] })
    expect(rechazado(conFila(0, { codigo: " " }))[0]).toMatchObject({ path: ["variantes", 0, "codigo"] })
  })

  it("an existing row may omit codigo (the RPC demands it only for new rows)", () => {
    const p = base()
    delete p.variantes[0].codigo
    expect(aceptado(p).variantes[0]).not.toHaveProperty("codigo")
  })
})

describe("guardarGrupoSchema: numbers", () => {
  it("accepts precioVenta 0 and rejects a negative price", () => {
    expect(aceptado(conFila(0, { precioVenta: 0 })).variantes[0].precioVenta).toBe(0)
    expect(rechazado(conFila(0, { precioVenta: -1 }))[0]).toMatchObject({ path: ["variantes", 0, "precioVenta"] })
    expect(rechazado(conFila(0, { precioVenta: -0.001 }))[0]).toMatchObject({ path: ["variantes", 0, "precioVenta"] })
    expect(rechazado(conFila(0, { precioCompra: -5 }))[0]).toMatchObject({ path: ["variantes", 0, "precioCompra"] })
  })

  it.each([
    [12.345, 12.35],
    [1.005, 1.01],
    [2.675, 2.68],
    [0.1 + 0.2, 0.3],
    [114.99999999999999, 115],
    [10, 10],
    [0.004, 0],
    [0.005, 0.01],
    [1e-7, 0],
  ])("rounds the price %s to 2 decimals (%s)", (typed, sent) => {
    const v = aceptado(conFila(0, { precioVenta: typed, precioCompra: typed })).variantes[0]
    expect(v.precioVenta).toBe(sent)
    expect(v.precioCompra).toBe(sent)
  })

  it("redondearPrecio never leaves more than 2 decimals in the JSON text", () => {
    for (const n of [0.1 + 0.2, 1.005, 33.333333, 1234567.891, 99999999.994]) {
      expect(JSON.stringify(redondearPrecio(n))).toMatch(/^\d+(\.\d{1,2})?$/)
    }
  })

  it("caps the price at 99999999.99 judged AFTER rounding", () => {
    expect(aceptado(conFila(0, { precioVenta: 99999999.99 })).variantes[0].precioVenta).toBe(99999999.99)
    expect(aceptado(conFila(0, { precioVenta: 99999999.994 })).variantes[0].precioVenta).toBe(99999999.99)
    expect(rechazado(conFila(0, { precioVenta: 99999999.995 }))[0]).toMatchObject({ path: ["variantes", 0, "precioVenta"] })
    expect(rechazado(conFila(0, { precioCompra: 100000000 }))[0]).toMatchObject({ path: ["variantes", 0, "precioCompra"] })
  })

  it.each(["stockInicial", "stockMinimo", "stockMaximo", "puntoReorden"])("%s is a whole number from 0 to 999999999", (campo) => {
    expect(aceptado(conFila(0, { [campo]: 0 })).variantes[0]).toMatchObject({ [campo]: 0 })
    expect(aceptado(conFila(0, { [campo]: 999999999 })).variantes[0]).toMatchObject({ [campo]: 999999999 })
    for (const malo of [-1, 1.5, 1000000000]) {
      expect(rechazado(conFila(0, { [campo]: malo }))[0]).toMatchObject({ path: ["variantes", 0, campo] })
    }
  })

  it("only the thresholds accept null, never stockInicial", () => {
    for (const campo of ["stockMinimo", "stockMaximo", "puntoReorden"]) {
      expect(aceptado(conFila(0, { [campo]: null })).variantes[0]).toMatchObject({ [campo]: null })
    }
    expect(rechazado(conFila(0, { stockInicial: null }))[0]).toMatchObject({ path: ["variantes", 0, "stockInicial"] })
  })

  it("stockMinimo cannot exceed stockMaximo when both are sent", () => {
    expect(rechazado(conFila(0, { stockMinimo: 5, stockMaximo: 4 }))[0]).toMatchObject({ path: ["variantes", 0, "stockMinimo"] })
    expect(aceptado(conFila(0, { stockMinimo: 4, stockMaximo: 4 })).variantes).toHaveLength(2)
    expect(aceptado(conFila(0, { stockMinimo: 9, stockMaximo: null })).variantes).toHaveLength(2)
    // A zero is a value, not an absence: 5 above a maximum of 0 is still wrong.
    expect(rechazado(conFila(0, { stockMinimo: 5, stockMaximo: 0 }))[0]).toMatchObject({ path: ["variantes", 0, "stockMinimo"] })
    expect(aceptado(conFila(0, { stockMinimo: 0, stockMaximo: 0 })).variantes).toHaveLength(2)
  })

  it("the shared day counts are whole numbers or null; the flags are booleans", () => {
    const ok = { ...base(), compartidos: { diasGarantiaDefault: 30, diasAlertaVencimiento: null, trackeaLotes: true, trackeaSeries: false } }
    expect(aceptado(ok).compartidos).toEqual({ diasGarantiaDefault: 30, diasAlertaVencimiento: null, trackeaLotes: true, trackeaSeries: false })
    expect(aceptado({ ...base(), compartidos: { diasGarantiaDefault: null, diasAlertaVencimiento: 7 } }).compartidos).toEqual({
      diasGarantiaDefault: null,
      diasAlertaVencimiento: 7,
    })
    for (const mal of [{ diasGarantiaDefault: 1.5 }, { diasAlertaVencimiento: -1 }, { diasAlertaVencimiento: 1000000000 }, { trackeaLotes: null }, { trackeaSeries: "si" }]) {
      expect(guardarGrupoSchema.safeParse({ ...base(), compartidos: mal }).success).toBe(false)
    }
  })

  it("categoria cannot be blank or null, the other shared texts may be null", () => {
    expect(guardarGrupoSchema.safeParse({ ...base(), compartidos: { categoria: " " } }).success).toBe(false)
    expect(guardarGrupoSchema.safeParse({ ...base(), compartidos: { categoria: null } }).success).toBe(false)
    const nulos = { descripcion: null, tipoDispositivo: null, proveedor: null, proveedorId: null }
    expect(aceptado({ ...base(), compartidos: nulos }).compartidos).toEqual(nulos)
  })
})

describe("guardarGrupoSchema: rows against options", () => {
  it("every row needs one atributo per option, with the option names in order", () => {
    const corto = base()
    corto.variantes[0].atributos = []
    expect(rechazado(corto)[0]).toMatchObject({ path: ["variantes", 0, "atributos"] })

    const dos = conOpciones([["Rojo"], ["M"]])
    dos.variantes[0].atributos = [dos.variantes[0].atributos[0]]
    expect(rechazado(dos)[0]).toMatchObject({ path: ["variantes", 0, "atributos"] })

    const orden = conOpciones([["Rojo"], ["M"]])
    orden.variantes[0].atributos.reverse()
    expect(rechazado(orden)[0]).toMatchObject({ path: ["variantes", 0, "atributos", 0, "opcion"] })

    const otro = base()
    otro.variantes[1].atributos[0].opcion = "Colour"
    expect(rechazado(otro)[0]).toMatchObject({ path: ["variantes", 1, "atributos", 0, "opcion"] })

    // The RPC compares the option names exactly: a case-only difference is a mismatch too.
    const mayuscula = base()
    mayuscula.variantes[0].atributos[0].opcion = "color"
    expect(rechazado(mayuscula)[0]).toMatchObject({ path: ["variantes", 0, "atributos", 0, "opcion"] })
  })

  it("rejects a blank row id and a blank archive id", () => {
    expect(rechazado(conFila(0, { id: "  " }))[0]).toMatchObject({ path: ["variantes", 0, "id"] })
    expect(rechazado(conFila(0, { id: "" }))[0]).toMatchObject({ path: ["variantes", 0, "id"] })
    expect(rechazado({ ...base(), archivar: [ID(3), " "] })[0]).toMatchObject({ path: ["archivar", 1] })
  })

  it("rejects a repeated row id and an id that is both saved and archived", () => {
    const repetido = base()
    repetido.variantes[1].id = repetido.variantes[0].id
    expect(rechazado(repetido)[0]).toMatchObject({ path: ["variantes", 1, "id"] })

    expect(rechazado({ ...base(), archivar: [ID(2)] })[0]).toMatchObject({ path: ["archivar", 0] })
    expect(aceptado({ ...base(), archivar: [ID(3), ID(4)] }).archivar).toEqual([ID(3), ID(4)])
  })

  it("rejects the same barcode on two rows but not repeated blanks or nulls", () => {
    const dup = base()
    dup.variantes[0].barcode = "7790001"
    dup.variantes[1].barcode = " 7790001 "
    expect(rechazado(dup)[0]).toMatchObject({ path: ["variantes", 1, "barcode"] })

    const vacios = base()
    vacios.variantes[0].barcode = null
    vacios.variantes[1].barcode = "  "
    expect(aceptado(vacios).variantes).toHaveLength(2)
    const distintos = base()
    distintos.variantes[0].barcode = "7790001"
    distintos.variantes[1].barcode = "7790002"
    expect(aceptado(distintos).variantes).toHaveLength(2)
  })

  it("trims only spaces for the barcode comparison, like btrim in the RPC", () => {
    const p = base()
    p.variantes[0].barcode = "7790001"
    p.variantes[1].barcode = "\t7790001"
    expect(aceptado(p).variantes).toHaveLength(2)
  })

  it("leaves a repeated combination and a repeated code to the RPC (409), not to the schema", () => {
    const combo = base()
    combo.variantes[1].atributos[0].valor = "Rojo"
    expect(aceptado(combo).variantes).toHaveLength(2)
    const codigo = base()
    codigo.variantes[1].codigo = codigo.variantes[0].codigo
    expect(aceptado(codigo).variantes).toHaveLength(2)
  })

  it("allows an empty variantes list (a save that only archives)", () => {
    const p = aceptado({ ...base(), variantes: [], archivar: [ID(1), ID(2)] })
    expect(p.variantes).toEqual([])
  })
})

describe("guardarGrupoSchema: absence is preserved", () => {
  it("a key that was not sent is not in the parsed row; null stays null", () => {
    const v = aceptado(conFila(0, { barcode: null, stockMinimo: null })).variantes
    expect(Object.keys(v[0]).sort()).toEqual(["atributos", "barcode", "codigo", "id", "stockMinimo"])
    expect("precioCompra" in v[0]).toBe(false)
    expect(Object.keys(v[1]).sort()).toEqual(["atributos", "codigo", "id"])
  })

  it("compartidos, archivar, depositoId and renombrar stay absent unless sent", () => {
    const p = aceptado(base())
    expect("compartidos" in p).toBe(false)
    expect("archivar" in p).toBe(false)
    expect("depositoId" in p).toBe(false)
    expect("renombrar" in p.grupo).toBe(false)
    expect(aceptado(conGrupo({ renombrar: false })).grupo.renombrar).toBe(false)
  })

  it("renombrar must be a boolean", () => {
    for (const mal of ["false", 0, null, ""]) {
      expect(rechazado(conGrupo({ renombrar: mal }))[0]).toMatchObject({ path: ["grupo", "renombrar"] })
    }
  })
})

interface Contexto {
  organizationId: string
  userId: string | null
  grupoId: string
  depositoInicial: string | null
  canViewCost: boolean
}
const contexto: Contexto = { organizationId: "org-1", userId: "user-1", grupoId: ID(900), depositoInicial: null, canViewCost: true }
const args = (p: Payload, extra: Partial<Contexto> = {}) =>
  argumentosGuardarGrupo({ ...contexto, ...extra, datos: aceptado(p) })

describe("argumentosGuardarGrupo (camel -> snake, absence preserved)", () => {
  it("builds the exact RPC arguments for a minimal payload", () => {
    expect(args(base())).toStrictEqual({
      p_org: "org-1",
      p_user: "user-1",
      p_grupo: { id: ID(900), nombre: "Funda X", opciones: [{ nombre: "Color", valores: ["Rojo", "Azul"] }] },
      p_compartidos: {},
      p_variantes: [
        { id: ID(1), atributos: [{ opcion: "Color", valor: "Rojo" }], codigo: "FX-1" },
        { id: ID(2), atributos: [{ opcion: "Color", valor: "Azul" }], codigo: "FX-2" },
      ],
      p_archivar: [],
      p_deposito_inicial: null,
    })
  })

  it("takes the organization, user and group id from the context, never from the body", () => {
    const a = args(base(), { organizationId: "org-9", userId: "user-9", grupoId: ID(901) })
    expect(a.p_org).toBe("org-9")
    expect(a.p_user).toBe("user-9")
    expect(a.p_grupo.id).toBe(ID(901))
  })

  it("maps every row key to snake_case and keeps only the keys that were sent", () => {
    const completa = {
      barcode: "7790001", precioVenta: 1500.5, precioCompra: 900, stockInicial: 5, stockMinimo: 1,
      stockMaximo: 10, puntoReorden: 2, ubicacion: "A1",
    }
    const a = args(conFila(0, completa))
    expect(a.p_variantes[0]).toStrictEqual({
      id: ID(1), atributos: [{ opcion: "Color", valor: "Rojo" }], codigo: "FX-1",
      barcode: "7790001", precio_venta: 1500.5, precio_compra: 900, stock_inicial: 5, stock_minimo: 1,
      stock_maximo: 10, punto_reorden: 2, ubicacion: "A1",
    })
    expect(Object.keys(a.p_variantes[1])).toEqual(["id", "atributos", "codigo"])
  })

  it("a row without codigo has no codigo key (an existing row keeps its code)", () => {
    const p = base()
    delete p.variantes[0].codigo
    const fila0 = args(p).p_variantes[0]
    expect(Object.keys(fila0)).toEqual(["id", "atributos"])
    expect("codigo" in fila0).toBe(false)
  })

  it("keeps the option order of the options and of every row", () => {
    const p = conOpciones([["Rojo", "Azul"], ["M", "L"]])
    const a = args(p)
    expect(a.p_grupo.opciones).toEqual([
      { nombre: "Color", valores: ["Rojo", "Azul"] },
      { nombre: "Talle", valores: ["M", "L"] },
    ])
    expect(a.p_variantes.map((v) => v.atributos)).toEqual([
      [{ opcion: "Color", valor: "Rojo" }, { opcion: "Talle", valor: "M" }],
      [{ opcion: "Color", valor: "Rojo" }, { opcion: "Talle", valor: "L" }],
      [{ opcion: "Color", valor: "Azul" }, { opcion: "Talle", valor: "M" }],
      [{ opcion: "Color", valor: "Azul" }, { opcion: "Talle", valor: "L" }],
    ])
  })

  it("sends the option values exactly as typed (the RPC names the variant from them)", () => {
    const p = conOpciones([[" Rojo ", "Azul"]])
    const a = args(p)
    expect(a.p_grupo.opciones[0].valores).toEqual([" Rojo ", "Azul"])
    expect(a.p_variantes[0].atributos).toEqual([{ opcion: "Color", valor: " Rojo " }])
  })

  it("keeps null (clear) different from absent (unchanged)", () => {
    const a = args(conFila(0, { barcode: null, ubicacion: null, stockMinimo: null, stockMaximo: null, puntoReorden: null }))
    expect(a.p_variantes[0]).toStrictEqual({
      id: ID(1), atributos: [{ opcion: "Color", valor: "Rojo" }], codigo: "FX-1",
      barcode: null, ubicacion: null, stock_minimo: null, stock_maximo: null, punto_reorden: null,
    })
    expect("barcode" in a.p_variantes[1]).toBe(false)
  })

  it("sends the rounded prices", () => {
    const a = args(conFila(0, { precioVenta: 12.345, precioCompra: 0.1 + 0.2 }))
    expect(a.p_variantes[0].precio_venta).toBe(12.35)
    expect(a.p_variantes[0].precio_compra).toBe(0.3)
  })

  it("a role without cost access never sends precio_compra, even when the body has it", () => {
    const a = args(conFila(0, { precioCompra: 900, precioVenta: 1500 }), { canViewCost: false })
    expect(a.p_variantes[0]).toStrictEqual({
      id: ID(1), atributos: [{ opcion: "Color", valor: "Rojo" }], codigo: "FX-1", precio_venta: 1500,
    })
    expect(JSON.stringify(a)).not.toMatch(/precio_compra/)
    // The same payload with cost access does send it: the drop is the gate, not the mapper.
    expect(args(conFila(0, { precioCompra: 900 })).p_variantes[0]).toHaveProperty("precio_compra", 900)
  })

  it("renombrar travels only when it was sent, and false stays false", () => {
    expect("renombrar" in args(base()).p_grupo).toBe(false)
    expect(args(conGrupo({ renombrar: false })).p_grupo.renombrar).toBe(false)
    expect(args(conGrupo({ renombrar: true })).p_grupo.renombrar).toBe(true)
  })

  it("maps the 9 shared fields to their columns and keeps null", () => {
    const compartidos = {
      descripcion: "Funda", categoria: "Fundas", tipoDispositivo: "CELULAR", proveedor: "Acme", proveedorId: "p1",
      diasGarantiaDefault: 30, trackeaLotes: true, trackeaSeries: false, diasAlertaVencimiento: null,
    }
    expect(args({ ...base(), compartidos }).p_compartidos).toStrictEqual({
      descripcion: "Funda", categoria: "Fundas", tipo_dispositivo: "CELULAR", proveedor: "Acme", proveedor_id: "p1",
      dias_garantia_default: 30, trackea_lotes: true, trackea_series: false, dias_alerta_vencimiento: null,
    })
    expect(args({ ...base(), compartidos: { categoria: "Fundas" } }).p_compartidos).toStrictEqual({ categoria: "Fundas" })
  })

  it("passes the archive list and the initial depot through", () => {
    const a = args({ ...base(), archivar: [ID(7), ID(8)] }, { depositoInicial: "dep-norte" })
    expect(a.p_archivar).toEqual([ID(7), ID(8)])
    expect(a.p_deposito_inicial).toBe("dep-norte")
  })

  it("a user-less session sends p_user null", () => {
    expect(args(base(), { userId: null }).p_user).toBeNull()
  })
})

// ---- error map -------------------------------------------------------------------------
// PostgREST hands back { code: SQLSTATE, message: RAISE text, details, hint }. Messages below
// are the real ones (verify/361_probes.sql, Postgres and PostgREST), not bare codes (G1).
const err = (code: string, message: string) => ({ code, message, details: null, hint: null })
const RESERVADO = `STOCK_RESERVADO:${ID(5)}:3`

describe("mapearErrorRpc: the RPC codes", () => {
  it.each([
    ["22023 invalid payload", err("22023", "PAYLOAD_INVALIDO: a barcode is repeated inside the save"), 400, "PAYLOAD_INVALIDO"],
    ["P0002 not found", err("P0002", "NO_ENCONTRADO: item " + ID(1)), 404, "NO_ENCONTRADO"],
    ["P0030 duplicate combination", err("P0030", "COMBINACION_DUPLICADA"), 409, "COMBINACION_DUPLICADA"],
    ["P0031 item in another group", err("P0031", "ITEM_EN_OTRO_GRUPO: " + ID(2)), 409, "ITEM_EN_OTRO_GRUPO"],
    ["P0032 kit", err("P0032", "KIT_NO_PERMITIDO: " + ID(3)), 422, "KIT_NO_PERMITIDO"],
    ["P0033 reserved stock", err("P0033", RESERVADO), 409, "STOCK_RESERVADO"],
    ["P0034 over the limits", err("P0034", "LIMITE_EXCEDIDO: at most 100 combinations"), 422, "LIMITE_EXCEDIDO"],
    ["P0035 duplicate code", err("P0035", "CODIGO_DUPLICADO:FX-1,FX-2"), 409, "CODIGO_DUPLICADO"],
    ["23505 swap or chain on a unique index", err("23505", 'duplicate key value violates unique constraint "inventario_grupo_combinacion_activa_uniq"'), 409, "CONFLICTO"],
    ["23514 a check constraint", err("23514", 'new row for relation "inventario" violates check constraint "inventario_grupo_atributos"'), 400, "DATOS_INVALIDOS"],
    ["23503 a foreign key", err("23503", 'insert or update on table "inventario" violates foreign key constraint "inventario_grupo_id_fkey"'), 404, "NO_ENCONTRADO"],
    ["P0010 stock", err("P0010", "Stock insuficiente"), 400, "STOCK_INVALIDO"],
    ["P0011 depot", err("P0011", "La organizacion no tiene deposito principal"), 400, "DEPOSITO_INVALIDO"],
  ])("%s", (_t, error, status, code) => {
    const r = mapearErrorRpc(error)
    expect(r).not.toBeNull()
    expect(r!.status).toBe(status)
    expect(r!.body.code).toBe(code)
    expect(typeof r!.body.error).toBe("string")
    expect(r!.body.error.length).toBeGreaterThan(10)
  })

  it("never echoes the raw database message, a constraint or a token", () => {
    for (const e of [
      err("23505", 'duplicate key value violates unique constraint "inventario_org_codigo_active_uniq"'),
      err("22023", "PAYLOAD_INVALIDO: p_user is not a known user"),
      err("P0002", "NO_ENCONTRADO: group c1"),
      err("23514", 'violates check constraint "inventario_grupo_atributos"'),
    ]) {
      const texto = JSON.stringify(mapearErrorRpc(e)!.body)
      expect(texto).not.toMatch(/inventario_|PAYLOAD_INVALIDO:|p_user|NO_ENCONTRADO:|violates/)
    }
  })

  it("P0035 carries the offending codes as a list", () => {
    expect(mapearErrorRpc(err("P0035", "CODIGO_DUPLICADO:FX-1,FX-2"))!.body.codigos).toEqual(["FX-1", "FX-2"])
    expect(mapearErrorRpc(err("P0035", "CODIGO_DUPLICADO:PB7-RO"))!.body.codigos).toEqual(["PB7-RO"])
    expect(mapearErrorRpc(err("P0035", "CODIGO_DUPLICADO:PB8-S,PB8-X1,PB8-X2"))!.body.codigos).toEqual(["PB8-S", "PB8-X1", "PB8-X2"])
    expect(mapearErrorRpc(err("P0035", "CODIGO_DUPLICADO:FX-1,FX-2"))!.body.error).toMatch(/FX-1, FX-2/)
  })

  it("P0033 carries the item and the reserved units", () => {
    const r = mapearErrorRpc(err("P0033", RESERVADO))!
    expect(r.body).toMatchObject({ code: "STOCK_RESERVADO", variante: ID(5), unidades: 3 })
    expect(r.body.error).toMatch(/3/)
  })

  it("a stock-reserved message without the parts still answers 409", () => {
    const r = mapearErrorRpc(err("P0033", "STOCK_RESERVADO"))!
    expect(r.status).toBe(409)
    expect(r.body).not.toHaveProperty("variante")
    expect(r.body).not.toHaveProperty("unidades")
  })

  it("22023 miembros_faltantes is a 409 with the missing ids, so the form reloads", () => {
    const r = mapearErrorRpc(err("22023", `PAYLOAD_INVALIDO:miembros_faltantes:${ID(2)},${ID(3)}`))!
    expect(r.status).toBe(409)
    expect(r.body).toMatchObject({ code: "MIEMBROS_FALTANTES", faltantes: [ID(2), ID(3)], recargar: true })
    expect(mapearErrorRpc(err("22023", `PAYLOAD_INVALIDO:miembros_faltantes:${ID(9)}`))!.body.faltantes).toEqual([ID(9)])
  })

  it("only the exact miembros_faltantes prefix is a 409; any other 22023 stays a 400", () => {
    for (const mensaje of [
      "PAYLOAD_INVALIDO: miembros_faltantes (not the token)",
      "PAYLOAD_INVALIDO: variantes with miembros_faltantes:x",
      "PAYLOAD_INVALIDO:miembros_faltantes:",
    ]) {
      const r = mapearErrorRpc(err("22023", mensaje))!
      expect(r.status).toBe(400)
      expect(r.body.code).toBe("PAYLOAD_INVALIDO")
    }
  })

  it("deadlock and serialization failures map to a retryable 409", () => {
    for (const e of [err("40P01", "deadlock detected"), err("40001", "could not serialize access due to concurrent update")]) {
      const r = mapearErrorRpc(e)!
      expect(r.status).toBe(409)
      expect(r.body).toMatchObject({ code: "REINTENTAR", reintentable: true })
    }
  })
})

describe("mapearErrorRpc: a missing migration is a 503, known codes come first", () => {
  it.each([
    ["42883 the function", err("42883", "function guardar_grupo_variantes(text, text, jsonb, jsonb, jsonb, jsonb, text) does not exist")],
    ["42P01 the table", err("42P01", 'relation "inventario_grupos" does not exist')],
    ["42703 a column", err("42703", "column inventario.grupo_id does not exist")],
    ["PGRST202 the function", err("PGRST202", "Could not find the function public.guardar_grupo_variantes(p_archivar, p_compartidos, p_deposito_inicial, p_grupo, p_org, p_user, p_variantes) in the schema cache")],
    ["PGRST200 a relationship", err("PGRST200", "Could not find a relationship between 'inventario' and 'inventario_grupos' in the schema cache")],
    ["PGRST204 a column in a write", err("PGRST204", "Could not find the 'atributos' column of 'inventario' in the schema cache")],
  ])("%s", (_t, error) => {
    const r = mapearErrorRpc(error)!
    expect(r.status).toBe(503)
    expect(r.body).toEqual({ error: "Variantes todavía no está disponible", code: "MIGRACION_PENDIENTE" })
  })

  it.each(["42883", "42P01", "42703", "PGRST202", "PGRST200", "PGRST204", "PGRST205"])(
    "the bare code %s is a 503 even when the message says nothing",
    (code) => {
      expect(mapearErrorRpc({ code })!.status).toBe(503)
      expect(mapearErrorRpc(err(code, ""))!.body.code).toBe("MIGRACION_PENDIENTE")
    }
  )

  it("a message-only schema cache error is a 503", () => {
    expect(mapearErrorRpc({ message: "relation does not exist" })!.status).toBe(503)
    expect(mapearErrorRpc(new Error("Could not find the table 'public.x' in the schema cache"))!.status).toBe(503)
  })

  it("ORDER: P0002 whose message says 'does not exist' is a 404, not a 503", () => {
    const r = mapearErrorRpc(err("P0002", "NO_ENCONTRADO: item cdead does not exist"))!
    expect(r.status).toBe(404)
    expect(r.body.code).toBe("NO_ENCONTRADO")
  })

  it.each([
    ["22023", 400],
    ["P0030", 409],
    ["P0031", 409],
    ["P0032", 422],
    ["P0033", 409],
    ["P0034", 422],
    ["P0035", 409],
    ["23505", 409],
    ["23514", 400],
    ["23503", 404],
    ["40P01", 409],
    ["P0010", 400],
    ["P0011", 400],
  ])("ORDER: %s with a 'does not exist' message keeps its own status %s", (code, status) => {
    expect(mapearErrorRpc(err(code, "relation x does not exist in the schema cache"))!.status).toBe(status)
  })

  it("answers null for everything else, so the route can answer 500", () => {
    expect(mapearErrorRpc(err("57014", "canceling statement due to statement timeout"))).toBeNull()
    expect(mapearErrorRpc(err("54000", "index row size exceeds btree maximum"))).toBeNull()
    expect(mapearErrorRpc(err("XX000", "internal error"))).toBeNull()
    expect(mapearErrorRpc(new Error("boom"))).toBeNull()
    expect(mapearErrorRpc(null)).toBeNull()
    expect(mapearErrorRpc(undefined)).toBeNull()
    expect(mapearErrorRpc("texto")).toBeNull()
  })
})

describe("esReintentable and conReintento", () => {
  it("only deadlock and serialization failure are retryable", () => {
    expect(esReintentable(err("40P01", "deadlock detected"))).toBe(true)
    expect(esReintentable(err("40001", "could not serialize"))).toBe(true)
    for (const code of ["23505", "P0030", "22023", "57014", "42883"]) expect(esReintentable(err(code, "x"))).toBe(false)
    expect(esReintentable(null)).toBe(false)
    expect(esReintentable(undefined)).toBe(false)
  })

  const resultado = (error: unknown, data: unknown = null) => ({ data, error })

  it("a success is returned after one call", async () => {
    const llamar = vi.fn().mockResolvedValue(resultado(null, { grupoId: "g" }))
    expect(await conReintento(llamar)).toEqual({ data: { grupoId: "g" }, error: null })
    expect(llamar).toHaveBeenCalledTimes(1)
  })

  it.each(["40P01", "40001"])("%s is retried exactly once and the second answer wins", async (code) => {
    const llamar = vi
      .fn()
      .mockResolvedValueOnce(resultado(err(code, "deadlock detected")))
      .mockResolvedValueOnce(resultado(null, { grupoId: "g" }))
    expect(await conReintento(llamar)).toEqual({ data: { grupoId: "g" }, error: null })
    expect(llamar).toHaveBeenCalledTimes(2)
  })

  it("two deadlocks in a row stop at two calls and return the error", async () => {
    const llamar = vi.fn().mockResolvedValue(resultado(err("40P01", "deadlock detected")))
    const r = await conReintento(llamar)
    expect(llamar).toHaveBeenCalledTimes(2)
    expect(r.error).toMatchObject({ code: "40P01" })
  })

  it("a retry that meets another error returns that error without a third call", async () => {
    const llamar = vi
      .fn()
      .mockResolvedValueOnce(resultado(err("40P01", "deadlock detected")))
      .mockResolvedValueOnce(resultado(err("P0030", "COMBINACION_DUPLICADA")))
    const r = await conReintento(llamar)
    expect(llamar).toHaveBeenCalledTimes(2)
    expect(r.error).toMatchObject({ code: "P0030" })
  })

  it.each(["P0030", "23505", "22023", "57014"])("%s is not retried", async (code) => {
    const llamar = vi.fn().mockResolvedValue(resultado(err(code, "x")))
    await conReintento(llamar)
    expect(llamar).toHaveBeenCalledTimes(1)
  })
})

describe("migracionPendiente and respuestaDeError", () => {
  it("migracionPendiente is the controlled 503 the group routes share", async () => {
    const res = migracionPendiente()
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: "Variantes todavía no está disponible", code: "MIGRACION_PENDIENTE" })
  })

  it("respuestaDeError turns a mapped error into a response and an unknown one into null", async () => {
    const res = respuestaDeError(err("P0035", "CODIGO_DUPLICADO:FX-1"))!
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: "CODIGO_DUPLICADO", codigos: ["FX-1"] })
    expect(respuestaDeError(err("57014", "timeout"))).toBeNull()
  })
})

describe("respuestaDeValidacion", () => {
  const issuesDe = (p: Payload) => {
    const r = guardarGrupoSchema.safeParse(p)
    if (r.success) throw new Error("expected a rejection")
    return r.error
  }

  it("is a 400 with the first message in Spanish, a machine code and the field", async () => {
    const res = respuestaDeValidacion(issuesDe(conFila(1, { precioVenta: -1 })))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "El precio no puede ser negativo", code: "PAYLOAD_INVALIDO", campo: "variantes.1.precioVenta" })
  })

  it("names the offending key of an unrecognized-keys issue in the field", async () => {
    const res = respuestaDeValidacion(issuesDe(conFila(0, { imagenUrl: "x" })))
    const body = await res.json()
    expect(body.campo).toBe("variantes.0.imagenUrl")
    expect(body.error).toBe("Hay datos que no se pueden guardar con las variantes")
    expect(JSON.stringify(body)).not.toMatch(/Unrecognized|zod/i)
  })

  it("lists every key when several are unknown, and a root-level key has no prefix", async () => {
    expect((await respuestaDeValidacion(issuesDe({ ...base(), imagenUrl: "x", organizationId: "o" })).json()).campo).toBe("imagenUrl,organizationId")
  })

  it("uses the first issue only", async () => {
    const p = conFila(0, { precioVenta: -1, stockInicial: 1.5 })
    expect((await respuestaDeValidacion(issuesDe(p)).json()).campo).toBe("variantes.0.precioVenta")
  })
})

describe("the schema and the mapper follow the RPC (migration text)", () => {
  const sql = () => collapse(readBySuffix("_variantes_rpc.sql"))
  const lista = (nombre: string) => {
    const m = sql().match(new RegExp(`${nombre} CONSTANT TEXT\\[\\] := ARRAY\\[([^\\]]+)\\]`))
    expect(m).not.toBeNull()
    return [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1])
  }

  it("the 9 shared columns are the RPC's c_shared whitelist", () => {
    const a = args({ ...base(), compartidos: {
      descripcion: "x", categoria: "x", tipoDispositivo: "x", proveedor: "x", proveedorId: "x",
      diasGarantiaDefault: 1, trackeaLotes: true, trackeaSeries: true, diasAlertaVencimiento: 1,
    } })
    expect(Object.keys(a.p_compartidos).sort()).toEqual(lista("c_shared").sort())
  })

  it("the row keys are the RPC's c_vkeys whitelist", () => {
    const todas = {
      barcode: "1", precioVenta: 1, precioCompra: 1, stockInicial: 1, stockMinimo: 1, stockMaximo: 1, puntoReorden: 1, ubicacion: "x",
    }
    const a = args(conFila(0, todas))
    expect(Object.keys(a.p_variantes[0]).sort()).toEqual(lista("c_vkeys").sort())
  })

  it("the numeric caps are the digits of the RPC's c_num and c_int patterns", () => {
    const num = sql().match(/c_num CONSTANT TEXT := '\^\[0-9\]\{1,(\d+)\}\(\\\.\[0-9\]\{1,(\d+)\}\)\?\$'/)
    const int = sql().match(/c_int CONSTANT TEXT := '\^\[0-9\]\{1,(\d+)\}\$'/)
    expect(num).not.toBeNull()
    expect(int).not.toBeNull()
    expect(LIMITES.precioMax).toBe(Number("9".repeat(Number(num![1])) + "." + "9".repeat(Number(num![2]))))
    expect(LIMITES.enteroMax).toBe(Number("9".repeat(Number(int![1]))))
  })
})
