import { describe, it, expect } from "vitest"
import { agruparResultados } from "@/lib/pos-agrupar"
import type { InventarioResult } from "@/components/pos/pos-types"

const prod = (id: string, extra: Partial<InventarioResult> = {}): InventarioResult => ({
  id,
  codigo: `C-${id}`,
  nombre: id,
  stock: 3,
  precioVenta: 1000,
  ...extra,
})
const variante = (id: string, precioVenta: number, extra: Partial<InventarioResult> = {}) =>
  prod(id, { nombre: `Funda ${id}`, precioVenta, grupoId: "g-1", grupoNombre: "Funda X", etiqueta: id, ...extra })

describe("agruparResultados", () => {
  it("collapses the variants of one group into a single card with the group name, count and lowest price", () => {
    const rojo = variante("Rojo", 10000)
    const azul = variante("Azul", 12000)

    const tarjetas = agruparResultados([rojo, azul], { agrupar: true })

    expect(tarjetas).toEqual([
      { tipo: "grupo", grupoId: "g-1", nombre: "Funda X", cantidad: 2, desde: 10000, miembros: [rojo, azul] },
    ])
  })

  it("titles the card with the group name even when the children have custom names", () => {
    const [tarjeta] = agruparResultados(
      [variante("a", 5, { nombre: "Funda roja" }), variante("b", 7, { nombre: "Funda azul" })],
      { agrupar: true }
    )
    expect(tarjeta).toMatchObject({ tipo: "grupo", nombre: "Funda X", cantidad: 2 })
  })

  it("takes the minimum over mixed prices wherever the cheapest sits", () => {
    const [tarjeta] = agruparResultados([variante("a", 12000), variante("b", 9000), variante("c", 15000)], { agrupar: true })
    expect(tarjeta).toMatchObject({ desde: 9000, cantidad: 3 })
  })

  it("keeps a lone member as a normal card with its full name", () => {
    const solo = variante("Rojo", 10000, { nombre: "Funda X - Rojo" })
    expect(agruparResultados([solo], { agrupar: true })).toEqual([{ tipo: "producto", producto: solo }])
  })

  it("leaves standalone products untouched and the group at the position of its first member", () => {
    const a = prod("a")
    const rojo = variante("Rojo", 10000)
    const b = prod("b")
    const azul = variante("Azul", 12000)
    const c = prod("c")

    const tarjetas = agruparResultados([a, rojo, b, azul, c], { agrupar: true })

    expect(tarjetas.map((t) => (t.tipo === "grupo" ? `grupo:${t.grupoId}` : t.producto.id))).toEqual(["a", "grupo:g-1", "b", "c"])
    expect(tarjetas[0]).toEqual({ tipo: "producto", producto: a })
  })

  it("builds one card per group when several groups are mixed", () => {
    const tarjetas = agruparResultados(
      [variante("a", 1), variante("x", 2, { grupoId: "g-2", grupoNombre: "Funda Y" }), variante("b", 3), variante("y", 4, { grupoId: "g-2", grupoNombre: "Funda Y" })],
      { agrupar: true }
    )
    expect(tarjetas.map((t) => (t.tipo === "grupo" ? [t.nombre, t.cantidad, t.desde] : null))).toEqual([
      ["Funda X", 2, 1],
      ["Funda Y", 2, 2],
    ])
  })

  it("is the identity (one product card each) when grouping is off", () => {
    const lista = [variante("Rojo", 10000), variante("Azul", 12000), prod("a")]
    expect(agruparResultados(lista, { agrupar: false })).toEqual(lista.map((producto) => ({ tipo: "producto", producto })))
  })

  it("falls back to the first child's name when the group name is missing", () => {
    const [tarjeta] = agruparResultados(
      [variante("a", 1, { grupoNombre: null, nombre: "Funda roja" }), variante("b", 2, { grupoNombre: null })],
      { agrupar: true }
    )
    expect(tarjeta).toMatchObject({ tipo: "grupo", nombre: "Funda roja" })
  })
})
