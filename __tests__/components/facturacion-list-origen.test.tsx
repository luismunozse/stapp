// __tests__/components/facturacion-list-origen.test.tsx
/**
 * Tests: FacturacionList renders an origin badge per row and hides the
 * "Registrar pago" / "Historial de pagos" actions for venta-sourced
 * invoices, in both the default card view and the table (list) view.
 *
 * Assertions are scoped per row via `within()` so a regression that removes
 * the `factura.origen !== "venta"` guard fails the test. Each row also
 * carries pagos entries and a non-PAGADO estadoPago so the guard is proven
 * to be origin-based, not merely a side effect of empty/paid data (the
 * venta row would still show the actions under the old, ungated code even
 * though it's PENDIENTE with pagos present).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react"
import React from "react"

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { role: "ADMIN" } } }),
}))

const mockFetch = vi.fn()
global.fetch = mockFetch

const FACTURAS = [
  {
    id: "f1",
    origen: "orden",
    numeroFactura: "0001-00000001",
    fecha: "2026-01-01",
    total: 100,
    montoAbonado: 0,
    estadoPago: "PENDIENTE",
    orden: { id: "o1", numeroOrden: 1, codigoOrden: "CEL001", cliente: { nombre: "Ana" } },
    pagos: [{ id: "p1", monto: 50, metodoPago: "EFECTIVO", fecha: "2026-01-01" }],
  },
  {
    id: "f2",
    origen: "venta",
    numeroFactura: "0001-00000002",
    fecha: "2026-01-02",
    total: 200,
    montoAbonado: 0,
    estadoPago: "PENDIENTE",
    venta: { id: "v1", numeroVenta: 5, clienteNombre: "Consumidor Final" },
    pagos: [{ id: "p2", monto: 20, metodoPago: "EFECTIVO", fecha: "2026-01-02" }],
  },
]

describe("FacturacionList — origen badge", () => {
  beforeEach(() => vi.clearAllMocks())

  it("shows Orden/Venta badges and hides payment actions only for the venta row (card view)", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => FACTURAS })

    const { FacturacionList } = await import("@/components/facturacion/facturacion-list")
    render(<FacturacionList />)

    await waitFor(() => {
      expect(screen.getByText("Orden")).toBeInTheDocument()
      expect(screen.getByText("Venta")).toBeInTheDocument()
    })

    const ordenCard = screen
      .getByRole("heading", { name: "Factura 0001-00000001" })
      .closest("div.rounded-lg.border.bg-card") as HTMLElement
    const ventaCard = screen
      .getByRole("heading", { name: "Factura 0001-00000002" })
      .closest("div.rounded-lg.border.bg-card") as HTMLElement
    expect(ordenCard).toBeTruthy()
    expect(ventaCard).toBeTruthy()

    // Positive control: the orden row (PENDIENTE, with pagos) offers both
    // actions — proves the assertions below would fail if the actions
    // disappeared for orden rows too.
    expect(within(ordenCard).getByText("Registrar Pago")).toBeInTheDocument()
    expect(within(ordenCard).getByText(/Historial de pagos/)).toBeInTheDocument()

    // The venta row must never offer payment actions, even though it's
    // also PENDIENTE and has pagos entries.
    expect(within(ventaCard).queryByText("Registrar Pago")).toBeNull()
    expect(within(ventaCard).queryByText(/Historial de pagos/)).toBeNull()
  })

  it("hides payment actions only for the venta row (list/table view)", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => FACTURAS })

    const { FacturacionList } = await import("@/components/facturacion/facturacion-list")
    const { container } = render(<FacturacionList />)

    await waitFor(() => {
      expect(screen.getByText("Orden")).toBeInTheDocument()
    })

    // Toggle from the default card view to the table view.
    const viewToggleButtons = container.querySelectorAll(".ml-auto button")
    fireEvent.click(viewToggleButtons[1])

    const ordenRow = screen.getByText("0001-00000001").closest("tr") as HTMLElement
    const ventaRow = screen.getByText("0001-00000002").closest("tr") as HTMLElement
    expect(ordenRow).toBeTruthy()
    expect(ventaRow).toBeTruthy()

    // Positive control (desktop inline buttons carry the action as a
    // `title` attribute, not visible text).
    expect(within(ordenRow).getByTitle("Registrar pago")).toBeInTheDocument()
    expect(within(ordenRow).getByTitle("Historial de pagos")).toBeInTheDocument()

    expect(within(ventaRow).queryByTitle("Registrar pago")).toBeNull()
    expect(within(ventaRow).queryByTitle("Historial de pagos")).toBeNull()
  })
})
