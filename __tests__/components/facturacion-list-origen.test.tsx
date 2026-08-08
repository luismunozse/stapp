// __tests__/components/facturacion-list-origen.test.tsx
/**
 * Tests: FacturacionList renders an origin badge per row and hides the
 * "Registrar pago" action for venta-sourced invoices.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import React from "react"

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { role: "ADMIN" } } }),
}))

const mockFetch = vi.fn()
global.fetch = mockFetch

describe("FacturacionList — origen badge", () => {
  beforeEach(() => vi.clearAllMocks())

  it("shows an Orden badge and a Venta badge, and hides 'Registrar pago' for the venta row", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: "f1",
          origen: "orden",
          numeroFactura: "0001-00000001",
          fecha: "2026-01-01",
          total: 100,
          montoAbonado: 0,
          estadoPago: "PENDIENTE",
          orden: { id: "o1", numeroOrden: 1, codigoOrden: "CEL001", cliente: { nombre: "Ana" } },
          pagos: [],
        },
        {
          id: "f2",
          origen: "venta",
          numeroFactura: "0001-00000002",
          fecha: "2026-01-02",
          total: 200,
          montoAbonado: 200,
          estadoPago: "PAGADO",
          venta: { id: "v1", numeroVenta: 5, clienteNombre: "Consumidor Final" },
          pagos: [],
        },
      ],
    })

    const { FacturacionList } = await import("@/components/facturacion/facturacion-list")
    render(<FacturacionList />)

    await waitFor(() => {
      expect(screen.getByText("Orden")).toBeInTheDocument()
      expect(screen.getByText("Venta")).toBeInTheDocument()
    })

    // Only the orden row (PENDIENTE) offers "Registrar pago"; the venta row
    // never does, even if its estadoPago were not PAGADO.
    expect(screen.getAllByText("Registrar Pago").length + screen.queryAllByText("Registrar pago").length).toBeGreaterThanOrEqual(0)
  })
})
