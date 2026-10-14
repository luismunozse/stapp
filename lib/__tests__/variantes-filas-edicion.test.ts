// @vitest-environment node
import { describe, it, expect } from "vitest"
import { crearReductor, estadoInicial, filasEnOrden, stockTotal } from "@/lib/variantes-filas"
import {
  aplicar,
  contador,
  etiquetas,
  filaDe,
  grupoColor,
  grupoColorTalle,
  hidratar,
  leida,
  opcionId,
  reductor,
  valorId,
} from "@/__tests__/helpers/variantes-filas"

const nuevo = (over: Partial<Parameters<typeof estadoInicial>[0]> = {}) =>
  estadoInicial({ grupoId: "cg1", codigoBase: "FX", precioBase: 1000, ...over })

/** A new product with Color {Rojo, Azul, Verde}. */
function nuevoConColor(over: Partial<Parameters<typeof estadoInicial>[0]> = {}, reducir = reductor()) {
  return aplicar(reducir, nuevo(over), { tipo: "activar" }, { tipo: "agregarOpcion", nombre: "Color", valores: ["Rojo", "Azul", "Verde"] })
}

const rojoAzul = (id: string, valor: string, over = {}) => leida(id, [{ opcion: "Color", valor }], over)

describe("cambiarCodigoBase", () => {
  it("re-derives the codes of the new rows still on their generated code", () => {
    const reducir = reductor()
    const e = aplicar(reducir, nuevoConColor({}, reducir), { tipo: "cambiarCodigoBase", codigo: "FUNDA" })
    expect(e.codigoBase).toBe("FUNDA")
    expect(filasEnOrden(e).map((f) => f.codigo)).toEqual(["FUNDA-ROJ", "FUNDA-AZU", "FUNDA-VER"])
    const vacio = aplicar(reducir, e, { tipo: "cambiarCodigoBase", codigo: "" })
    expect(filasEnOrden(vacio).map((f) => f.codigo)).toEqual(["ROJ", "AZU", "VER"])
  })

  it("leaves saved rows and hand-edited codes alone", () => {
    const reducir = reductor()
    let e = nuevoConColor({}, reducir)
    const rojo = filaDe(e, "Rojo").id
    e = aplicar(reducir, e, { tipo: "editarFila", filaId: rojo, cambios: { codigo: "MIO-1" } }, { tipo: "cambiarCodigoBase", codigo: "ZZ" })
    expect(filaDe(e, "Rojo").codigo).toBe("MIO-1")
    expect(filaDe(e, "Azul").codigo).toBe("ZZ-AZU")
    const saved = hidratar(grupoColor())
    const guardado = aplicar(reducir, saved, { tipo: "cambiarCodigoBase", codigo: "ZZ" })
    expect(filaDe(guardado, "Rojo").codigo).toBe("FX-R1")
  })

  it("a hand-edited code stays through a value rename too", () => {
    const reducir = reductor()
    let e = nuevoConColor({}, reducir)
    e = aplicar(reducir, e, { tipo: "editarFila", filaId: filaDe(e, "Rojo").id, cambios: { codigo: "MIO-1" } })
    e = aplicar(reducir, e, { tipo: "renombrarValor", valorId: valorId(e, "Color", "Rojo"), texto: "Rosado" })
    expect(filaDe(e, "Rosado").codigo).toBe("MIO-1")
  })
})

describe("cambiarPrecioBase", () => {
  it("moves only the rows nobody has priced by hand", () => {
    const reducir = reductor()
    let e = nuevoConColor({}, reducir)
    e = aplicar(reducir, e, { tipo: "editarFila", filaId: filaDe(e, "Rojo").id, cambios: { precioVenta: 1500 } })
    expect(filaDe(e, "Rojo")).toMatchObject({ precioVenta: 1500, precioTocado: true })
    e = aplicar(reducir, e, { tipo: "cambiarPrecioBase", precio: 2000 })
    expect(e.precioBase).toBe(2000)
    expect(filaDe(e, "Rojo").precioVenta).toBe(1500)
    expect(filaDe(e, "Azul")).toMatchObject({ precioVenta: 2000, precioTocado: false })
    expect(filaDe(e, "Verde").precioVenta).toBe(2000)
  })

  it("never reaches a saved row, a restored one or a row pending archive", () => {
    const reducir = reductor()
    const saved = hidratar(grupoColor({ variantes: [rojoAzul("r1", "Rojo", { precioVenta: 1234 }), rojoAzul("a1", "Azul", { precioVenta: 999 })] }))
    let e = aplicar(reducir, saved, { tipo: "agregarValor", opcionId: opcionId(saved, "Color"), texto: "Verde" })
    e = aplicar(reducir, e, { tipo: "quitarValor", valorId: valorId(e, "Color", "Azul") })
    e = aplicar(reducir, e, { tipo: "cambiarPrecioBase", precio: 5000 })
    expect(filaDe(e, "Rojo").precioVenta).toBe(1234)
    expect(filaDe(e, "Verde")).toMatchObject({ restaurada: true, precioVenta: 1000 })
    expect(e.filas["a1"].precioVenta).toBe(999)
    const nueva = aplicar(reducir, e, { tipo: "agregarValor", opcionId: opcionId(e, "Color"), texto: "Negro" })
    expect(filaDe(nueva, "Negro").precioVenta).toBe(5000)
  })

  it("rounds the way a person would and refuses a bad price", () => {
    const reducir = reductor()
    const e = nuevoConColor({}, reducir)
    expect(aplicar(reducir, e, { tipo: "cambiarPrecioBase", precio: 1.005 }).precioBase).toBe(1.01)
    expect(filaDe(aplicar(reducir, e, { tipo: "cambiarPrecioBase", precio: 99.999 }), "Rojo").precioVenta).toBe(100)
    for (const malo of [-1, Number.NaN, Number.POSITIVE_INFINITY, 100_000_000]) {
      const r = aplicar(reducir, e, { tipo: "cambiarPrecioBase", precio: malo })
      expect(r.aviso).not.toBeNull()
      expect(r.precioBase).toBe(1000)
      expect(filaDe(r, "Rojo").precioVenta).toBe(1000)
    }
    expect(aplicar(reducir, e, { tipo: "cambiarPrecioBase", precio: -1 }).aviso).toBe("El precio no puede ser negativo")
    expect(aplicar(reducir, e, { tipo: "cambiarPrecioBase", precio: 100_000_000 }).aviso).toBe("El precio es demasiado grande")
    expect(aplicar(reducir, e, { tipo: "cambiarPrecioBase", precio: 0 }).aviso).toBeNull()
  })
})

describe("aplicarPrecioATodas", () => {
  it("sets the base price on every active row and resets the touched flags", () => {
    const reducir = reductor()
    let e = nuevoConColor({ precioBase: 1000 }, reducir)
    e = aplicar(reducir, e, { tipo: "editarFila", filaId: filaDe(e, "Rojo").id, cambios: { precioVenta: 1500 } }, { tipo: "cambiarPrecioBase", precio: 2000 })
    e = aplicar(reducir, e, { tipo: "aplicarPrecioATodas" })
    expect(filasEnOrden(e).map((f) => [f.precioVenta, f.precioTocado])).toEqual([
      [2000, false],
      [2000, false],
      [2000, false],
    ])
    // Untouched again: the next base change reaches the row that used to be hand-priced.
    e = aplicar(reducir, e, { tipo: "cambiarPrecioBase", precio: 2500 })
    expect(filaDe(e, "Rojo").precioVenta).toBe(2500)
  })

  it("prices saved rows too, skips rows pending archive, and keeps a restored row marked so its price is sent", () => {
    const reducir = reductor()
    const saved = hidratar(grupoColor({ variantes: [rojoAzul("r1", "Rojo", { precioVenta: 1234 }), rojoAzul("a1", "Azul", { precioVenta: 999 })] }), { precioBase: 3000 })
    let e = aplicar(reducir, saved, { tipo: "agregarValor", opcionId: opcionId(saved, "Color"), texto: "Verde" })
    e = aplicar(reducir, e, { tipo: "quitarValor", valorId: valorId(e, "Color", "Azul") })
    e = aplicar(reducir, e, { tipo: "aplicarPrecioATodas" })
    expect(filaDe(e, "Rojo")).toMatchObject({ precioVenta: 3000, precioTocado: false })
    expect(filaDe(e, "Verde")).toMatchObject({ precioVenta: 3000, precioTocado: true })
    expect(e.filas["a1"]).toMatchObject({ precioVenta: 999, archivar: true })
  })
})

describe("cambiarCostoBase", () => {
  it("moves the new rows whose cost is still the base, not the ones edited or saved", () => {
    const reducir = reductor()
    let e = nuevoConColor({ costoCargado: true, costoBase: 100 }, reducir)
    e = aplicar(reducir, e, { tipo: "editarFila", filaId: filaDe(e, "Rojo").id, cambios: { precioCompra: 150 } })
    e = aplicar(reducir, e, { tipo: "cambiarCostoBase", costo: 300 })
    expect(e.costoBase).toBe(300)
    expect(filasEnOrden(e).map((f) => f.precioCompra)).toEqual([150, 300, 300])

    const saved = hidratar(grupoColor({ variantes: [rojoAzul("r1", "Rojo", { precioCompra: 100 }), rojoAzul("a1", "Azul", { precioCompra: 100 })] }), { costoCargado: true })
    const guardado = aplicar(reducir, { ...saved, costoBase: 100 }, { tipo: "cambiarCostoBase", costo: 300 })
    expect(filasEnOrden(guardado).map((f) => f.precioCompra)).toEqual([100, 100])
  })

  it("keeps the cost out of the rows without cost access, and refuses a bad cost", () => {
    const reducir = reductor()
    const sinAcceso = aplicar(reducir, nuevoConColor({}, reducir), { tipo: "cambiarCostoBase", costo: 300 })
    expect(sinAcceso.costoBase).toBe(300)
    expect(filasEnOrden(sinAcceso).every((f) => !("precioCompra" in f))).toBe(true)
    const e = nuevoConColor({ costoCargado: true, costoBase: 100 }, reducir)
    const malo = aplicar(reducir, e, { tipo: "cambiarCostoBase", costo: -5 })
    expect(malo.aviso).toBe("El costo no puede ser negativo")
    expect(malo.costoBase).toBe(100)
  })
})

describe("editarFila", () => {
  it("marks the code as hand-edited and keeps it as typed", () => {
    const reducir = reductor()
    const e0 = nuevoConColor({}, reducir)
    const e = aplicar(reducir, e0, { tipo: "editarFila", filaId: filaDe(e0, "Azul").id, cambios: { codigo: "  Mi codigo " } })
    expect(filaDe(e, "Azul")).toMatchObject({ codigo: "  Mi codigo ", codigoTocado: true })
    expect(filaDe(e, "Rojo").codigoTocado).toBe(false)
  })

  it("prices a row by hand and marks it touched; the base then leaves it alone", () => {
    const reducir = reductor()
    const e0 = nuevoConColor({}, reducir)
    const e = aplicar(reducir, e0, { tipo: "editarFila", filaId: filaDe(e0, "Rojo").id, cambios: { precioVenta: 12.345 } })
    expect(filaDe(e, "Rojo")).toMatchObject({ precioVenta: 12.35, precioTocado: true })
  })

  it("sets the cost only with cost access and never adds the key without it", () => {
    const reducir = reductor()
    const con = nuevoConColor({ costoCargado: true }, reducir)
    expect(filaDe(aplicar(reducir, con, { tipo: "editarFila", filaId: filaDe(con, "Rojo").id, cambios: { precioCompra: 80 } }), "Rojo").precioCompra).toBe(80)
    const sin = nuevoConColor({}, reducir)
    const e = aplicar(reducir, sin, { tipo: "editarFila", filaId: filaDe(sin, "Rojo").id, cambios: { precioCompra: 80 } })
    expect("precioCompra" in filaDe(e, "Rojo")).toBe(false)
    expect(e.aviso).toBeNull()
  })

  it("sets the initial stock of a new row and ignores it on a saved one", () => {
    const reducir = reductor()
    const e0 = nuevoConColor({}, reducir)
    const e = aplicar(reducir, e0, { tipo: "editarFila", filaId: filaDe(e0, "Rojo").id, cambios: { stockInicial: 6 } })
    expect(filaDe(e, "Rojo").stockInicial).toBe(6)
    expect(stockTotal(e)).toBe(6)

    const saved = hidratar(grupoColor())
    const igual = aplicar(reducir, saved, { tipo: "editarFila", filaId: "r1", cambios: { stockInicial: 99 } })
    expect(igual).toBe(saved)
    expect(stockTotal(igual)).toBe(5 + 3)
  })

  it("edits the barcode and the extra fields of a row", () => {
    const reducir = reductor()
    const e0 = nuevoConColor({}, reducir)
    const id = filaDe(e0, "Rojo").id
    const e = aplicar(reducir, e0, {
      tipo: "editarFila",
      filaId: id,
      cambios: { barcode: " 779123 ", ubicacion: "Estante 2", stockMinimo: 2, stockMaximo: 10, puntoReorden: 3 },
    })
    expect(filaDe(e, "Rojo")).toMatchObject({
      barcode: "779123",
      extra: { stockMinimo: 2, stockMaximo: 10, puntoReorden: 3, ubicacion: "Estante 2" },
    })
    const limpio = aplicar(reducir, e, { tipo: "editarFila", filaId: id, cambios: { barcode: "   ", ubicacion: null, stockMinimo: null } })
    expect(filaDe(limpio, "Rojo")).toMatchObject({ barcode: null, extra: { stockMinimo: null, stockMaximo: 10, puntoReorden: 3, ubicacion: null } })
  })

  it("edits a saved row (price, barcode, extra) but never its stock or photo", () => {
    const reducir = reductor()
    const saved = hidratar(grupoColor({ variantes: [rojoAzul("r1", "Rojo", { stock: 5, imagenUrl: "https://cdn.example/rojo.jpg" })] }))
    const e = aplicar(reducir, saved, {
      tipo: "editarFila",
      filaId: "r1",
      cambios: { precioVenta: 1800, ubicacion: "A1", imagenUrl: "blob:http://x/1", stock: 99, existente: false, archivar: true } as never,
    })
    expect(filaDe(e, "Rojo")).toMatchObject({
      precioVenta: 1800,
      precioTocado: true,
      stock: 5,
      existente: true,
      archivar: false,
      imagenUrl: "https://cdn.example/rojo.jpg",
      extra: { ubicacion: "A1" },
    })
  })

  it("refuses what the save would refuse, with a reason, and changes nothing", () => {
    const e = nuevoConColor()
    // A fresh id range per call: a refusal must not hide behind ids already in `e`.
    const crear = () => crearReductor(contador("r"))
    const id = filaDe(e, "Rojo").id
    const casos: [Record<string, unknown>, string][] = [
      [{ precioVenta: -1 }, "El precio no puede ser negativo"],
      [{ precioVenta: Number.NaN }, "Tiene que ser un número"],
      [{ stockInicial: -1 }, "No puede ser negativo"],
      [{ stockInicial: 1.5 }, "Tiene que ser un número entero"],
      [{ stockInicial: 1_000_000_000 }, "El número es demasiado grande"],
      [{ barcode: "x".repeat(101) }, "El código de barras puede tener hasta 100 caracteres"],
      [{ ubicacion: "u".repeat(101) }, "La ubicación puede tener hasta 100 caracteres"],
      [{ codigo: "c".repeat(101) }, "El código puede tener hasta 100 caracteres"],
      [{ stockMinimo: 1.5 }, "Tiene que ser un número entero"],
      [{ puntoReorden: -2 }, "No puede ser negativo"],
      [{ stockMinimo: 9, stockMaximo: 3 }, "El stock mínimo no puede superar al máximo"],
      [{ codigo: `a${String.fromCharCode(0)}b` }, "Hay un texto con un carácter que no se admite"],
      [{ barcode: `a${String.fromCharCode(0)}b` }, "Hay un texto con un carácter que no se admite"],
      [{ ubicacion: `a${String.fromCharCode(0)}b` }, "Hay un texto con un carácter que no se admite"],
    ]
    for (const [cambios, aviso] of casos) {
      const r = aplicar(crear(), e, { tipo: "editarFila", filaId: id, cambios })
      expect(r.aviso).toBe(aviso)
      expect({ ...r, aviso: null }).toEqual({ ...e, aviso: null })
    }
  })

  it("accepts the edge of every limit", () => {
    const reducir = reductor()
    const e0 = nuevoConColor({ costoCargado: true }, reducir)
    const id = filaDe(e0, "Rojo").id
    const e = aplicar(reducir, e0, {
      tipo: "editarFila",
      filaId: id,
      cambios: {
        codigo: "c".repeat(100),
        barcode: "b".repeat(100),
        ubicacion: "u".repeat(100),
        precioVenta: 99_999_999.99,
        precioCompra: 0,
        stockInicial: 0,
        stockMinimo: 0,
        stockMaximo: 999_999_999,
      },
    })
    expect(e.aviso).toBeNull()
    expect(filaDe(e, "Rojo")).toMatchObject({ precioVenta: 99_999_999.99, precioCompra: 0, stockInicial: 0, extra: { stockMinimo: 0, stockMaximo: 999_999_999 } })
    expect(filaDe(e, "Rojo").codigo).toHaveLength(100)
    expect(aplicar(reducir, e0, { tipo: "editarFila", filaId: id, cambios: { stockInicial: 999_999_999 } }).aviso).toBeNull()
    expect(aplicar(reducir, e0, { tipo: "cambiarPrecioBase", precio: 99_999_999.99 }).aviso).toBeNull()
  })

  it("turns a blank location into null and keeps a spaced one as typed", () => {
    const reducir = reductor()
    const e0 = nuevoConColor({}, reducir)
    const id = filaDe(e0, "Rojo").id
    const e = aplicar(reducir, e0, { tipo: "editarFila", filaId: id, cambios: { ubicacion: "Estante  2 " } })
    expect(filaDe(e, "Rojo").extra.ubicacion).toBe("Estante  2 ")
    expect(filaDe(aplicar(reducir, e, { tipo: "editarFila", filaId: id, cambios: { ubicacion: "   " } }), "Rojo").extra.ubicacion).toBeNull()
  })

  it("checks the stock range against the value the row already has", () => {
    const reducir = reductor()
    const e0 = nuevoConColor({}, reducir)
    const id = filaDe(e0, "Rojo").id
    const e = aplicar(reducir, e0, { tipo: "editarFila", filaId: id, cambios: { stockMaximo: 5 } })
    expect(aplicar(reducir, e, { tipo: "editarFila", filaId: id, cambios: { stockMinimo: 6 } }).aviso).toBe("El stock mínimo no puede superar al máximo")
    expect(aplicar(reducir, e, { tipo: "editarFila", filaId: id, cambios: { stockMinimo: 5 } }).aviso).toBeNull()
  })

  it("ignores a row pending archive and an unknown row", () => {
    const reducir = reductor()
    const saved = hidratar(grupoColor())
    const archivando = aplicar(reducir, saved, { tipo: "quitarValor", valorId: valorId(saved, "Color", "Azul") })
    expect(aplicar(reducir, archivando, { tipo: "editarFila", filaId: "a1", cambios: { precioVenta: 1 } })).toBe(archivando)
    expect(aplicar(reducir, saved, { tipo: "editarFila", filaId: "nada", cambios: { precioVenta: 1 } })).toBe(saved)
  })
})

describe("promover", () => {
  const item = { id: "p1", codigo: "FX-ROJ", barcode: "779", precioVenta: 7000, precioCompra: 3000, stock: 7, stockReservado: 2, stockMinimo: 1, ubicacion: "A1", imagenUrl: "https://cdn.example/p1.jpg" }

  it("turns the first new row into the promoted item, keeping its id, code, price, stock and photo", () => {
    const reducir = reductor()
    const e0 = nuevoConColor({ costoCargado: true }, reducir)
    const primera = filasEnOrden(e0)[0]
    const e = aplicar(reducir, e0, { tipo: "promover", item })
    expect(e.promocionId).toBe("p1")
    expect(e.filas[primera.id]).toBeUndefined()
    expect(e.orden).toHaveLength(3)
    expect(filaDe(e, "Rojo")).toMatchObject({
      id: "p1",
      valorIds: primera.valorIds,
      existente: true,
      archivar: false,
      codigo: "FX-ROJ",
      codigoTocado: true,
      barcode: "779",
      precioVenta: 7000,
      precioTocado: true,
      precioCompra: 3000,
      stockInicial: 0,
      stock: 7,
      stockReservado: 2,
      imagenUrl: "https://cdn.example/p1.jpg",
      extra: { stockMinimo: 1, stockMaximo: null, puntoReorden: null, ubicacion: "A1" },
    })
    expect(stockTotal(e)).toBe(7)
  })

  it("without a target it takes the first NEW row, never a saved one", () => {
    const reducir = reductor()
    const saved = hidratar(grupoColor({ archivadas: [] }))
    const conNegro = aplicar(reducir, saved, { tipo: "agregarValor", opcionId: opcionId(saved, "Color"), texto: "Negro" })
    const e = aplicar(reducir, conNegro, { tipo: "promover", item })
    expect(e.filas["p1"].valorIds).toEqual([valorId(e, "Color", "Negro")])
    expect(e.filas["r1"]).toMatchObject({ existente: true, codigo: "FX-R1" })
    expect(Object.keys(e.filas).sort()).toEqual(["a1", "p1", "r1"])
  })

  it("promoting the same item again without a target leaves it where it is", () => {
    const reducir = reductor()
    const e0 = nuevoConColor({}, reducir)
    const e1 = aplicar(reducir, e0, { tipo: "promover", item, filaId: filaDe(e0, "Azul").id })
    const e2 = aplicar(reducir, e1, { tipo: "promover", item: { ...item, precioVenta: 9000 } })
    expect(e2.filas["p1"]).toMatchObject({ valorIds: [valorId(e2, "Color", "Azul")], precioVenta: 9000 })
    expect(Object.keys(e2.filas)).toHaveLength(3)
    expect(e2.aviso).toBeNull()
  })

  it("promoting a different item hands the first one's slot back as a new row", () => {
    const reducir = reductor()
    const e1 = aplicar(reducir, nuevoConColor({}, reducir), { tipo: "promover", item })
    const otro = { ...item, id: "p2", codigo: "OTRO-1" }
    const e2 = aplicar(reducir, e1, { tipo: "promover", item: otro, filaId: filaDe(e1, "Azul").id })
    expect(e2.promocionId).toBe("p2")
    expect(e2.filas["p1"]).toBeUndefined()
    expect(e2.filas["p2"].valorIds).toEqual([valorId(e2, "Color", "Azul")])
    expect(filaDe(e2, "Rojo")).toMatchObject({ existente: false, codigo: "FX-ROJ" })
    expect(Object.keys(e2.filas)).toHaveLength(3)
  })

  it("a different item without a target goes to the first new row, not on top of the first one", () => {
    const reducir = reductor()
    const e1 = aplicar(reducir, nuevoConColor({}, reducir), { tipo: "promover", item })
    const e2 = aplicar(reducir, e1, { tipo: "promover", item: { ...item, id: "p2", codigo: "OTRO-1" } })
    expect(e2.filas["p2"].valorIds).toEqual([valorId(e2, "Color", "Azul")])
    expect(filaDe(e2, "Rojo")).toMatchObject({ existente: false })
    expect(e2.filas["p1"]).toBeUndefined()
  })

  it("turns a blank barcode of the promoted item into null", () => {
    const reducir = reductor()
    const e = aplicar(reducir, nuevoConColor({}, reducir), { tipo: "promover", item: { ...item, barcode: "  " } })
    expect(e.filas["p1"].barcode).toBeNull()
  })

  it("lets the user pick the combination, and moving it hands the old slot back as a new row", () => {
    const reducir = reductor()
    const e0 = nuevoConColor({}, reducir)
    const e1 = aplicar(reducir, e0, { tipo: "promover", item })
    const e2 = aplicar(reducir, e1, { tipo: "promover", item, filaId: filaDe(e1, "Azul").id })
    expect(etiquetas(e2)).toEqual(["Rojo", "Azul", "Verde"])
    expect(e2.filas["p1"].valorIds).toEqual([valorId(e2, "Color", "Azul")])
    expect(filaDe(e2, "Rojo")).toMatchObject({ existente: false, codigo: "FX-ROJ-2" })
    expect(filaDe(e2, "Azul").id).toBe("p1")
    expect(e2.promocionId).toBe("p1")
    expect(Object.keys(e2.filas)).toHaveLength(3)
  })

  it("promoting to the combination it already holds changes nothing but the data", () => {
    const reducir = reductor()
    const e1 = aplicar(reducir, nuevoConColor({}, reducir), { tipo: "promover", item })
    const e2 = aplicar(reducir, e1, { tipo: "promover", item: { ...item, precioVenta: 8000 }, filaId: "p1" })
    expect(Object.keys(e2.filas)).toHaveLength(3)
    expect(e2.filas["p1"].precioVenta).toBe(8000)
  })

  it("refuses without combinations, with a reason, and never takes a saved row", () => {
    const reducir = reductor()
    const vacio = aplicar(reducir, nuevo(), { tipo: "promover", item })
    expect(vacio.aviso).toBe("Primero agregá las opciones y los valores del producto")
    expect(vacio.promocionId).toBeNull()
    const saved = hidratar(grupoColor())
    const sobreGuardada = aplicar(reducir, saved, { tipo: "promover", item, filaId: "r1" })
    expect(sobreGuardada.aviso).toBe("Elegí una combinación nueva para el producto")
    expect(sobreGuardada.promocionId).toBeNull()
    expect(sobreGuardada.filas["r1"].id).toBe("r1")
  })

  it("does not let the base code or price reach the promoted row", () => {
    const reducir = reductor()
    let e = aplicar(reducir, nuevoConColor({}, reducir), { tipo: "promover", item })
    e = aplicar(reducir, e, { tipo: "cambiarCodigoBase", codigo: "ZZ" }, { tipo: "cambiarPrecioBase", precio: 1 })
    expect(e.filas["p1"]).toMatchObject({ codigo: "FX-ROJ", precioVenta: 7000 })
    expect(filaDe(e, "Azul")).toMatchObject({ codigo: "ZZ-AZU", precioVenta: 1 })
  })

  it("drops a local photo URL and omits the cost without cost access", () => {
    const reducir = reductor()
    const e = aplicar(reducir, nuevoConColor({}, reducir), { tipo: "promover", item: { ...item, imagenUrl: "blob:http://x/1" } })
    expect(e.filas["p1"].imagenUrl).toBeNull()
    expect("precioCompra" in e.filas["p1"]).toBe(false)
  })

  it("keeps the promoted item in a combination: removing its value is refused", () => {
    const reducir = reductor()
    const e = aplicar(reducir, nuevoConColor({}, reducir), { tipo: "promover", item })
    const r = aplicar(reducir, e, { tipo: "quitarValor", valorId: valorId(e, "Color", "Rojo") })
    expect(r.aviso).toBe('El producto que estás convirtiendo tiene que quedar en una combinación: elegí otra antes de quitar "Rojo"')
    expect({ ...r, aviso: null }).toEqual({ ...e, aviso: null })
    // Another value is free to go.
    expect(aplicar(reducir, e, { tipo: "quitarValor", valorId: valorId(e, "Color", "Verde") }).aviso).toBeNull()
  })

  it("is the survivor when an option is removed, whatever its position", () => {
    const reducir = reductor()
    let e = aplicar(reducir, nuevo(), { tipo: "agregarOpcion", nombre: "Color", valores: ["Rojo", "Azul"] }, { tipo: "agregarOpcion", nombre: "Talle", valores: ["S", "M"] })
    e = aplicar(reducir, e, { tipo: "promover", item, filaId: filaDe(e, "Rojo / M").id })
    e = aplicar(reducir, e, { tipo: "quitarOpcion", opcionId: opcionId(e, "Talle") })
    expect(etiquetas(e)).toEqual(["Rojo", "Azul"])
    expect(e.filas["p1"]).toMatchObject({ archivar: false, existente: true, valorIds: [valorId(e, "Color", "Rojo")] })
    expect(Object.keys(e.filas)).toHaveLength(2)
  })

  it("also refuses to remove the only value of an option when the promoted item holds it", () => {
    const reducir = reductor()
    let e = aplicar(reducir, nuevo(), { tipo: "agregarOpcion", nombre: "Color", valores: ["Rojo"] }, { tipo: "agregarOpcion", nombre: "Talle", valores: ["S", "M"] })
    e = aplicar(reducir, e, { tipo: "promover", item, filaId: filaDe(e, "Rojo / M").id })
    const r = aplicar(reducir, e, { tipo: "quitarValor", valorId: valorId(e, "Color", "Rojo") })
    expect(r.aviso).toContain("tiene que quedar en una combinación")
    expect(r.opciones).toEqual(e.opciones)
  })
})
