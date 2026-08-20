import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { ItemRow } from "@/components/cotizaciones/item-row"

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `$${n}` }),
}))
vi.mock("@/contexts/modal-context", () => ({
  useModal: () => ({ confirm: vi.fn() }),
}))

// ItemRow renders both a mobile and a desktop layout simultaneously in jsdom
// (visibility is CSS-only), so every assertion checks both via getAllBy/queryAllBy.

describe("ItemRow (cotización) — costo y margen visibles solo con mostrarCostos", () => {
  const itemVinculadoConCosto = {
    descripcion: "Pantalla",
    cantidad: 1,
    precioUnitario: 500,
    inventarioId: "inv-1",
    precioCompra: 300,
  }

  const itemManual = {
    descripcion: "Mano de obra",
    cantidad: 1,
    precioUnitario: 100,
  }

  it("oculta costo y margen por defecto (roles no admin)", () => {
    render(<ItemRow item={itemVinculadoConCosto} index={0} onUpdate={vi.fn()} onRemove={vi.fn()} />)

    expect(screen.queryAllByText(/costo/i).length).toBe(0)
    expect(screen.queryAllByText(/margen/i).length).toBe(0)
  })

  it("muestra costo y margen cuando mostrarCostos esta activo (admin)", () => {
    render(<ItemRow item={itemVinculadoConCosto} index={0} onUpdate={vi.fn()} onRemove={vi.fn()} mostrarCostos />)

    expect(screen.getAllByText(/costo/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/margen/i).length).toBeGreaterThan(0)
  })

  it("oculta el input manual de costo unitario (item sin vincular a inventario) por defecto", () => {
    render(<ItemRow item={itemManual} index={0} onUpdate={vi.fn()} onRemove={vi.fn()} />)

    expect(screen.queryAllByText("Costo unitario (opcional, para margen)").length).toBe(0)
  })

  it("muestra el input manual de costo unitario cuando mostrarCostos esta activo", () => {
    render(<ItemRow item={itemManual} index={0} onUpdate={vi.fn()} onRemove={vi.fn()} mostrarCostos />)

    expect(screen.getAllByText("Costo unitario (opcional, para margen)").length).toBeGreaterThan(0)
  })

  it("oculta costo y margen en los resultados de busqueda de inventario por defecto", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => [
            { id: "inv-2", nombre: "Batería", stock: 5, stockReservado: 0, precioVenta: 900, precioCompra: 450 },
          ],
        } as Response)
      )
    )

    render(<ItemRow item={itemManual} index={0} onUpdate={vi.fn()} onRemove={vi.fn()} />)

    fireEvent.click(screen.getAllByTitle("Buscar en inventario")[0])
    fireEvent.change(screen.getAllByPlaceholderText("Buscar producto...")[0], {
      target: { value: "bateria" },
    })

    await waitFor(() => expect(screen.getAllByText("Batería").length).toBeGreaterThan(0))

    expect(screen.queryAllByText(/costo/i).length).toBe(0)
    // Sale price stays visible even without mostrarCostos.
    expect(screen.getAllByText(/Venta:/).length).toBeGreaterThan(0)

    vi.unstubAllGlobals()
  })

  it("muestra costo en los resultados de busqueda cuando mostrarCostos esta activo", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => [
            { id: "inv-2", nombre: "Batería", stock: 5, stockReservado: 0, precioVenta: 900, precioCompra: 450 },
          ],
        } as Response)
      )
    )

    render(<ItemRow item={itemManual} index={0} onUpdate={vi.fn()} onRemove={vi.fn()} mostrarCostos />)

    fireEvent.click(screen.getAllByTitle("Buscar en inventario")[0])
    fireEvent.change(screen.getAllByPlaceholderText("Buscar producto...")[0], {
      target: { value: "bateria" },
    })

    await waitFor(() => expect(screen.getAllByText("Batería").length).toBeGreaterThan(0))

    expect(screen.getAllByText(/Costo:/).length).toBeGreaterThan(0)

    vi.unstubAllGlobals()
  })
})
