// __tests__/components/venta-detail-generar-factura.test.tsx
/**
 * Tests: VentaDetail shows "Generar remito" for ADMIN on an uninvoiced
 * COMPLETADA venta, hides it once facturaId is set, and posts { ventaId }.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import React from "react"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}))
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { role: "ADMIN" } } }),
}))
// VentaDetail reads useModal() unconditionally; useContext throws without a
// ModalProvider ancestor, so mock it the same way devolucion-form-preview
// already does for this component tree.
vi.mock("@/contexts/modal-context", () => ({
  useModal: () => ({ confirm: vi.fn(), showError: vi.fn(), showSuccess: vi.fn() }),
}))

const mockFetch = vi.fn()
global.fetch = mockFetch

function ventaResponse(over: Partial<any> = {}) {
  return {
    id: "v1",
    numeroVenta: 5,
    clienteId: null,
    clienteNombre: "Consumidor Final",
    clienteTelefono: null,
    vendedor: null,
    items: [],
    garantias: [],
    subtotal: 200,
    descuento: 0,
    total: 200,
    montoAbonado: 200,
    estadoPago: "PAGADO",
    metodoPago: "EFECTIVO",
    estado: "COMPLETADA",
    observaciones: null,
    createdAt: "2026-01-01T00:00:00Z",
    pagos: [],
    facturaId: null,
    ...over,
  }
}

describe("VentaDetail — Generar remito button", () => {
  beforeEach(() => vi.clearAllMocks())

  it("shows the button for an uninvoiced COMPLETADA venta and posts { ventaId }", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ventaResponse() })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ organization: { id: "org-1", slug: "demo", nombre: "Demo" } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "f-new" }) })

    const { VentaDetail } = await import("@/components/ventas/venta-detail")
    render(<VentaDetail ventaId="v1" />)

    const boton = await screen.findByRole("button", { name: /Generar remito/i })
    fireEvent.click(boton)

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/facturacion/generar",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ ventaId: "v1" }) })
      )
    })
  })

  it("hides the button once the venta already has a factura", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ventaResponse({ facturaId: "f-existing" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ organization: { id: "org-1", slug: "demo", nombre: "Demo" } }) })

    const { VentaDetail } = await import("@/components/ventas/venta-detail")
    render(<VentaDetail ventaId="v1" />)

    await waitFor(() => {
      expect(screen.getByText("Venta V0005")).toBeInTheDocument()
    })
    expect(screen.queryByRole("button", { name: /Generar remito/i })).not.toBeInTheDocument()
  })

  it("hides the button for an ANULADA venta even without a factura", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ventaResponse({ estado: "ANULADA", facturaId: null }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ organization: { id: "org-1", slug: "demo", nombre: "Demo" } }) })

    const { VentaDetail } = await import("@/components/ventas/venta-detail")
    render(<VentaDetail ventaId="v1" />)

    await waitFor(() => {
      expect(screen.getByText("Venta V0005")).toBeInTheDocument()
    })
    expect(screen.queryByRole("button", { name: /Generar remito/i })).not.toBeInTheDocument()
  })
})
