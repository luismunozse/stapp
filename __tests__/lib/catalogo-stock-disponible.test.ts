import { describe, it, expect } from "vitest"
import { stockDisponibleCatalogo } from "@/lib/catalogo/stock-disponible"

// El catálogo público mostraba `inventario.stock` crudo, sin restar
// `stock_reservado`. Con el flujo interno reservando stock al aprobar una
// cotización (reservar_items_cotizacion, migración 206), esas unidades ya
// comprometidas se seguían ofreciendo como disponibles al comprador.
//
// `stockDisponibleCatalogo` es la única fuente de ese número para el
// storefront: listado, detalle, relacionados y bundle.

describe("stockDisponibleCatalogo", () => {
  it("subtracts stock_reservado when the item is linked to inventario", () => {
    expect(
      stockDisponibleCatalogo({
        stock: 3,
        inventario_id: "inv-1",
        inventario: { stock: 10, stock_reservado: 4 },
      })
    ).toBe(6)
  })

  it("returns full inventory stock when nothing is reserved", () => {
    expect(
      stockDisponibleCatalogo({
        stock: null,
        inventario_id: "inv-1",
        inventario: { stock: 10, stock_reservado: 0 },
      })
    ).toBe(10)
  })

  it("treats a missing stock_reservado as zero instead of NaN", () => {
    expect(
      stockDisponibleCatalogo({
        stock: null,
        inventario_id: "inv-1",
        inventario: { stock: 7 },
      })
    ).toBe(7)

    expect(
      stockDisponibleCatalogo({
        stock: null,
        inventario_id: "inv-1",
        inventario: { stock: 7, stock_reservado: null },
      })
    ).toBe(7)
  })

  it("never reports negative availability when reservations exceed stock", () => {
    expect(
      stockDisponibleCatalogo({
        stock: null,
        inventario_id: "inv-1",
        inventario: { stock: 2, stock_reservado: 5 },
      })
    ).toBe(0)
  })

  it("ignores catalogo_items.stock when the item is linked to inventario", () => {
    // Regla de fuente única (migración 239): si hay link, inventario manda y
    // la columna del catálogo queda muerta aunque tenga un valor viejo.
    expect(
      stockDisponibleCatalogo({
        stock: 99,
        inventario_id: "inv-1",
        inventario: { stock: 4, stock_reservado: 1 },
      })
    ).toBe(3)
  })

  it("falls back to catalogo_items.stock when there is no inventory link", () => {
    expect(
      stockDisponibleCatalogo({ stock: 5, inventario_id: null, inventario: null })
    ).toBe(5)
  })

  it("falls back to catalogo_items.stock when the join came back empty", () => {
    expect(
      stockDisponibleCatalogo({ stock: 5, inventario_id: "inv-1", inventario: null })
    ).toBe(5)
  })

  it("returns null (sin límite) when neither source declares a stock", () => {
    expect(
      stockDisponibleCatalogo({ stock: null, inventario_id: null, inventario: null })
    ).toBeNull()

    expect(
      stockDisponibleCatalogo({
        stock: null,
        inventario_id: "inv-1",
        inventario: { stock: null, stock_reservado: 3 },
      })
    ).toBeNull()
  })
})
