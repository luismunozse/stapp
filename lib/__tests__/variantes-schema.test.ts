// @vitest-environment node
import { readFileSync } from "fs"
import { join } from "path"
import { describe, it, expect } from "vitest"
import { z } from "zod"
import { collapse, readBySuffix } from "@/__tests__/helpers/sql-text"
import {
  type Payload, ID, NBSP, SEP, EMOJI, fila, conOpciones, base, conFila, conGrupo, rango,
} from "@/__tests__/helpers/variantes-payload"
import {
  guardarGrupoSchema,
  argumentosGuardarGrupo,
  redondearPrecio,
  mensajeDeIssue,
  LIMITES,
} from "@/lib/variantes-schema"

// Strict request schema + camel->snake mapper for PUT /api/inventario/grupos/[id] (the pure,
// client-importable half). The save RPC (migration 361) is the authority for every cap; this
// schema rejects the same inputs earlier, with a Spanish message and a 400.

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

describe("guardarGrupoSchema: text and id guards", () => {
  const NUL = String.fromCharCode(0)

  it("rejects a blank proveedorId (the RPC would answer a misleading 404), accepts null and a real id", () => {
    for (const blank of ["", "   ", NBSP]) {
      const issues = rechazado({ ...base(), compartidos: { proveedorId: blank } })
      expect(issues[0]).toMatchObject({ path: ["compartidos", "proveedorId"] })
    }
    expect(aceptado({ ...base(), compartidos: { proveedorId: null } }).compartidos).toEqual({ proveedorId: null })
    expect(aceptado({ ...base(), compartidos: { proveedorId: "prov-1" } }).compartidos).toEqual({ proveedorId: "prov-1" })
  })

  // [label, a payload carrying NUL in that field, where the issue must point]
  const CON_NUL: [string, () => Payload, (string | number)[]][] = [
    ["grupo.nombre", () => conGrupo({ nombre: `Funda${NUL}X` }), ["grupo", "nombre"]],
    ["option nombre", () => {
      const p = base()
      p.grupo.opciones[0].nombre = `Co${NUL}lor`
      p.variantes.forEach((v: Payload) => (v.atributos[0].opcion = `Co${NUL}lor`))
      return p
    }, ["grupo", "opciones", 0, "nombre"]],
    ["option valor", () => {
      const p = base()
      p.grupo.opciones[0].valores[0] = `Ro${NUL}jo`
      return p
    }, ["grupo", "opciones", 0, "valores", 0]],
    ["atributo valor", () => conFila(0, { atributos: [{ opcion: "Color", valor: `Ro${NUL}jo` }] }), ["variantes", 0, "atributos", 0, "valor"]],
    ["codigo", () => conFila(0, { codigo: `FX${NUL}1` }), ["variantes", 0, "codigo"]],
    ["barcode", () => conFila(0, { barcode: `77${NUL}9` }), ["variantes", 0, "barcode"]],
    ["ubicacion", () => conFila(0, { ubicacion: `A${NUL}1` }), ["variantes", 0, "ubicacion"]],
    ["row id", () => conFila(0, { id: `c${NUL}1` }), ["variantes", 0, "id"]],
    ["archivar id", () => ({ ...base(), archivar: [`c${NUL}9`] }), ["archivar", 0]],
    ["descripcion", () => ({ ...base(), compartidos: { descripcion: `a${NUL}b` } }), ["compartidos", "descripcion"]],
    ["categoria", () => ({ ...base(), compartidos: { categoria: `a${NUL}b` } }), ["compartidos", "categoria"]],
    ["tipoDispositivo", () => ({ ...base(), compartidos: { tipoDispositivo: `a${NUL}b` } }), ["compartidos", "tipoDispositivo"]],
    ["proveedor", () => ({ ...base(), compartidos: { proveedor: `a${NUL}b` } }), ["compartidos", "proveedor"]],
    ["proveedorId", () => ({ ...base(), compartidos: { proveedorId: `a${NUL}b` } }), ["compartidos", "proveedorId"]],
    ["depositoId", () => ({ ...base(), depositoId: `d${NUL}1` }), ["depositoId"]],
  ]

  it.each(CON_NUL)("a NUL character in %s is rejected where it sits (PostgREST would answer a 500)", (_campo, construir, ruta) => {
    expect(rechazado(construir())[0]).toMatchObject({ path: ruta })
  })

  it("the same payloads without the NUL are accepted (the guard is the NUL, nothing else)", () => {
    for (const [, construir] of CON_NUL) {
      const limpio = JSON.parse(JSON.stringify(construir()).split("\\u0000").join(""))
      expect(guardarGrupoSchema.safeParse(limpio).success).toBe(true)
    }
  })

  it.each([
    ["row id", (n: number) => conFila(0, { id: "c".repeat(n) }), 100],
    ["archivar id", (n: number) => ({ ...base(), archivar: ["c".repeat(n)] }), 100],
    ["depositoId", (n: number) => ({ ...base(), depositoId: "d".repeat(n) }), 100],
  ] as [string, (n: number) => Payload, number][])("%s: 100 characters accepted, 101 rejected", (_campo, construir, max) => {
    expect(guardarGrupoSchema.safeParse(construir(max)).success).toBe(true)
    expect(guardarGrupoSchema.safeParse(construir(max + 1)).success).toBe(false)
  })

  it("depositoId may be null or absent (the default depot is used)", () => {
    expect(aceptado({ ...base(), depositoId: null }).depositoId).toBeNull()
    expect("depositoId" in aceptado(base())).toBe(false)
    expect(aceptado({ ...base(), depositoId: "dep-1" }).depositoId).toBe("dep-1")
  })

  it("an empty depositoId is rejected too", () => {
    expect(rechazado({ ...base(), depositoId: "" })[0]).toMatchObject({ path: ["depositoId"] })
  })
})

describe("mensajeDeIssue: Spanish copy for zod's own English messages", () => {
  const ENGLISH = /Expected|Required|received|Invalid|must |Unrecognized|Number |String |Array |finite/i
  const defecto = (issue: Record<string, unknown>) =>
    ({ ...issue, message: z.defaultErrorMap(issue as never, { defaultError: "", data: undefined }).message }) as z.ZodIssue

  it.each([
    ["a missing key", { code: "invalid_type", expected: "object", received: "undefined", path: [] }, "Falta un dato requerido"],
    ["a null where an object goes", { code: "invalid_type", expected: "object", received: "null", path: [] }, "Los datos no tienen el formato esperado"],
    ["a text where a number goes", { code: "invalid_type", expected: "number", received: "string", path: [] }, "Tiene que ser un número"],
    ["an integer expected", { code: "invalid_type", expected: "integer", received: "string", path: [] }, "Tiene que ser un número"],
    ["a number where a text goes", { code: "invalid_type", expected: "string", received: "number", path: [] }, "Tiene que ser un texto"],
    ["a text where a boolean goes", { code: "invalid_type", expected: "boolean", received: "string", path: [] }, "Tiene que ser sí o no"],
    ["a text where a list goes", { code: "invalid_type", expected: "array", received: "string", path: [] }, "Tiene que ser una lista"],
    ["any other type", { code: "invalid_type", expected: "date", received: "string", path: [] }, "Hay un dato con un formato que no corresponde"],
    ["a list too long", { code: "too_big", maximum: 3, type: "array", inclusive: true, exact: false, path: [] }, "Hay demasiados elementos en la lista"],
    ["a text too long", { code: "too_big", maximum: 3, type: "string", inclusive: true, exact: false, path: [] }, "Hay un texto demasiado largo"],
    ["a number too big", { code: "too_big", maximum: 3, type: "number", inclusive: true, exact: false, path: [] }, "Hay un número demasiado grande"],
    ["a set too big", { code: "too_big", maximum: 3, type: "set", inclusive: true, exact: false, path: [] }, "Hay demasiados elementos en la lista"],
    ["a set too small", { code: "too_small", minimum: 1, type: "set", inclusive: true, exact: false, path: [] }, "Faltan elementos en la lista"],
    ["a list too short", { code: "too_small", minimum: 1, type: "array", inclusive: true, exact: false, path: [] }, "Faltan elementos en la lista"],
    ["a text too short", { code: "too_small", minimum: 1, type: "string", inclusive: true, exact: false, path: [] }, "Hay un texto demasiado corto"],
    ["a number too small", { code: "too_small", minimum: 1, type: "number", inclusive: true, exact: false, path: [] }, "Hay un número demasiado chico"],
    ["unknown keys", { code: "unrecognized_keys", keys: ["x"], path: [] }, "Hay datos que no se pueden guardar con las variantes"],
    ["a number that is not finite", { code: "not_finite", path: [] }, "Los datos de las variantes no son válidos"],
  ])("%s", (_t, issue, esperado) => {
    const texto = mensajeDeIssue(defecto(issue))
    expect(texto).toBe(esperado)
    expect(texto).not.toMatch(ENGLISH)
  })

  it("keeps the message the schema itself sets (already Spanish and more specific)", () => {
    const propio = { code: "too_big", maximum: 3, type: "array", inclusive: true, exact: false, path: [], message: "Un producto puede tener hasta 3 opciones" }
    expect(mensajeDeIssue(propio as z.ZodIssue)).toBe("Un producto puede tener hasta 3 opciones")
    expect(mensajeDeIssue({ code: "custom", path: [], message: "Cualquier cosa" })).toBe("Cualquier cosa")
  })

  it("no real parse of a wrong-typed body leaves an English message", () => {
    const cuerpos: unknown[] = [
      null, 5, "x", [], {},
      { ...base(), grupo: null },
      { ...base(), variantes: "x" },
      { ...base(), archivar: "x" },
      { ...base(), compartidos: 5 },
      { ...base(), depositoId: 5 },
      conGrupo({ renombrar: "si" }),
      conGrupo({ nombre: 5 }),
      conFila(0, { precioVenta: "10" }),
      conFila(0, { stockMinimo: "a" }),
      conFila(0, { id: 5 }),
      conFila(0, { codigo: 5 }),
      conFila(0, { atributos: "x" }),
      conFila(0, { atributos: [null] }),
      { ...base(), compartidos: { trackeaLotes: "x" } },
      { ...base(), compartidos: { diasGarantiaDefault: "7" } },
    ]
    for (const cuerpo of cuerpos) {
      const r = guardarGrupoSchema.safeParse(cuerpo)
      expect(r.success).toBe(false)
      if (r.success) continue
      for (const issue of r.error.issues) expect(mensajeDeIssue(issue)).not.toMatch(ENGLISH)
    }
  })
})

describe("lib/variantes-schema.ts is pure and client-importable", () => {
  const fuente = () => readFileSync(join(process.cwd(), "lib/variantes-schema.ts"), "utf8")
  const importaciones = () => [...fuente().matchAll(/^import\s[^"']*["']([^"']+)["']/gm)].map((m) => m[1])

  it("imports only zod and lib/variantes (no next/server, no server-only, no lib/variantes-api)", () => {
    expect(importaciones().sort()).toEqual(["@/lib/variantes", "zod"])
  })

  it("does not reach the server through lib/variantes either", () => {
    const variantes = readFileSync(join(process.cwd(), "lib/variantes.ts"), "utf8")
    const imports = [...variantes.matchAll(/^import\s[^"']*["']([^"']+)["']/gm)].map((m) => m[1])
    expect(imports.sort()).toEqual(["@/lib/db-errors", "@/types"])
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
