import { describe, it, expect } from "vitest"
import { aBorrador, esVariantesDeBorrador, restaurarVariantes, type FilaDeBorrador } from "@/lib/variantes-borrador"
import { estadoInicial, type Fila, type VariantesState } from "@/lib/variantes-filas"

const fila = (id: string, extra: Partial<Fila> = {}): Fila => ({
  id,
  valorIds: ["v-" + id],
  existente: false,
  archivar: false,
  codigo: "FX-" + id,
  codigoTocado: false,
  barcode: null,
  precioVenta: 1000,
  precioTocado: false,
  precioCompra: 400,
  stockInicial: 2,
  imagenUrl: null,
  extra: { stockMinimo: null, stockMaximo: null, puntoReorden: null, ubicacion: null },
  ...extra,
})

function estado(over: Partial<VariantesState> = {}): VariantesState {
  return {
    ...estadoInicial({ grupoId: "g-1", semilla: "semilla-de-prueba", codigoBase: "FX", precioBase: 1000, costoBase: 400, costoCargado: true }),
    activo: true,
    opciones: [{ id: "o1", nombre: "Color", valores: [{ id: "v-r1", texto: "Rojo" }, { id: "v-a1", texto: "Azul" }] }],
    filas: { r1: fila("r1", { existente: true, stock: 3, stockReservado: 0, precioCompra: 1000, imagenUrl: "https://s.test/r.jpg" }), a1: fila("a1", { precioCompra: 555 }) },
    orden: ["r1", "a1"],
    ...over,
  }
}

describe("aBorrador: what may reach localStorage", () => {
  it("drops the cost of every row and the base cost", () => {
    const guardado = aBorrador(estado())
    const texto = JSON.stringify(guardado)
    expect(texto).not.toContain("precioCompra")
    expect(texto).not.toContain("costoBase")
    expect(guardado).not.toHaveProperty("costoBase")
    for (const f of Object.values(guardado.filas)) expect(f).not.toHaveProperty("precioCompra")
  })

  it("keeps what the user typed: options, rows, codes, prices, stock to load, order", () => {
    const guardado = aBorrador(estado())
    expect(guardado.opciones[0].valores.map((v) => v.texto)).toEqual(["Rojo", "Azul"])
    expect(guardado.orden).toEqual(["r1", "a1"])
    expect(guardado.filas.a1).toMatchObject({ codigo: "FX-a1", precioVenta: 1000, stockInicial: 2 })
    expect(guardado.grupoId).toBe("g-1")
  })

  it("does not touch the state it is given", () => {
    const original = estado()
    const copia = structuredClone(original)
    aBorrador(original)
    expect(original).toEqual(copia)
  })

  it("holds no photo data: no blob:, no data:image, no File", () => {
    const texto = JSON.stringify(aBorrador(estado()))
    expect(texto).not.toContain("blob:")
    expect(texto).not.toContain("data:image")
  })

  it("the stored row type has no precioCompra (tsc enforces it)", () => {
    const sinCosto: FilaDeBorrador = { ...fila("x"), precioCompra: undefined } as FilaDeBorrador
    // @ts-expect-error a stored draft row cannot carry the purchase price
    const conCosto: FilaDeBorrador = { ...sinCosto, precioCompra: 1 }
    expect(conCosto).toBeDefined()
  })
})

describe("esVariantesDeBorrador", () => {
  it("accepts what aBorrador writes", () => {
    expect(esVariantesDeBorrador(JSON.parse(JSON.stringify(aBorrador(estado()))))).toBe(true)
  })
  it.each([null, undefined, 3, "x", [], {}, { activo: true }, { ...aBorrador(estado()), filas: null }, { ...aBorrador(estado()), orden: ["zzz"] }, { ...aBorrador(estado()), opciones: "x" }])(
    "rejects %j",
    (valor) => {
      expect(esVariantesDeBorrador(valor)).toBe(false)
    }
  )
})

describe("restaurarVariantes: over what the server holds", () => {
  const fresco = () => estado({ filas: { r1: fila("r1", { existente: true, stock: 7, stockReservado: 1, precioCompra: 1000, imagenUrl: "https://s.test/r.jpg" }), a1: fila("a1", { existente: true, stock: 2, precioCompra: 1000 }) } })

  it("a saved row keeps the cost, stock and photo the server holds (cost 1000 stays 1000)", () => {
    const borrador = aBorrador(estado({ filas: { r1: fila("r1", { existente: true, stock: 3, precioVenta: 1500, imagenUrl: "https://viejo.test/x.jpg" }), a1: fila("a1", { existente: true }) } }))
    const restaurado = restaurarVariantes(borrador, fresco(), { guardado: true })!
    expect(restaurado.filas.r1.precioCompra).toBe(1000)
    expect(restaurado.filas.r1.stock).toBe(7)
    expect(restaurado.filas.r1.stockReservado).toBe(1)
    expect(restaurado.filas.r1.imagenUrl).toBe("https://s.test/r.jpg")
    // ...and what the user typed comes back.
    expect(restaurado.filas.r1.precioVenta).toBe(1500)
  })

  it("the base cost is the server's, never the draft's", () => {
    const actual = { ...fresco(), costoBase: 1234 }
    expect(restaurarVariantes(aBorrador(estado()), actual, { guardado: true })!.costoBase).toBe(1234)
  })

  it("a new row gets the current base cost, or none for a role without cost access", () => {
    const borrador = aBorrador(estado({ filas: { a1: fila("a1"), n1: fila("n1") }, orden: ["a1", "n1"] }))
    const conCosto = restaurarVariantes(borrador, { ...estado({ filas: {}, orden: [], activo: false }), costoBase: 400 }, { guardado: false })!
    expect(conCosto.filas.n1.precioCompra).toBe(400)
    const sinCosto = restaurarVariantes(borrador, { ...estado({ filas: {}, orden: [], activo: false }), costoCargado: false }, { guardado: false })!
    expect(sinCosto.filas.n1).not.toHaveProperty("precioCompra")
  })

  it("drops a saved row that no longer exists, and brings back one the draft did not know", () => {
    const actual = estado({ filas: { a1: fila("a1", { existente: true }), z9: fila("z9", { existente: true, precioCompra: 9 }) }, orden: ["a1", "z9"] })
    const borrador = aBorrador(estado({ filas: { r1: fila("r1", { existente: true }), a1: fila("a1", { existente: true }) }, orden: ["r1", "a1"] }))
    const restaurado = restaurarVariantes(borrador, actual, { guardado: true })!
    expect(Object.keys(restaurado.filas).sort()).toEqual(["a1", "z9"])
    expect([...restaurado.orden].sort()).toEqual(["a1", "z9"])
  })

  it("refuses a draft of another group when the product is saved", () => {
    expect(restaurarVariantes(aBorrador(estado({ grupoId: "g-otro" })), fresco(), { guardado: true })).toBeNull()
  })

  it("a new product takes the group id of the draft (so a retry converges on the same id)", () => {
    const nuevo = estado({ grupoId: "g-nuevo-actual", activo: false, filas: {}, orden: [] })
    expect(restaurarVariantes(aBorrador(estado({ grupoId: "g-del-borrador" })), nuevo, { guardado: false })!.grupoId).toBe("g-del-borrador")
  })

  it("the notice of the last action does not come back", () => {
    const actual = { ...fresco(), aviso: "algo" }
    expect(restaurarVariantes(aBorrador({ ...estado(), aviso: "viejo" }), actual, { guardado: true })!.aviso).toBeNull()
  })

  it("the restored state has no cost key anywhere for a role without cost access", () => {
    const sinCosto = estado({ costoCargado: false, filas: { r1: fila("r1", { existente: true, precioCompra: undefined }) }, orden: ["r1"] })
    const restaurado = restaurarVariantes(aBorrador(sinCosto), sinCosto, { guardado: true })!
    expect(JSON.stringify(restaurado.filas)).not.toContain("precioCompra")
  })
})
