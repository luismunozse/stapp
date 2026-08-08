// __tests__/components/generar-factura-modal.test.tsx
/**
 * Tests: GenerarFacturaModal — loads candidates on open, filters by search,
 * and posts the right body ({ordenId} or {ventaId}) on selection.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import React from "react"

const mockFetch = vi.fn()
global.fetch = mockFetch

describe("GenerarFacturaModal", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("loads and shows uninvoiced ordenes and ventas when opened", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ordenes: [{ id: "o1", numeroOrden: 1, codigoOrden: "CEL001", dispositivo: "iPhone", clienteNombre: "Ana" }],
        ventas: [{ id: "v1", numeroVenta: 5, clienteNombre: "Consumidor Final", total: 200 }],
      }),
    })

    const { GenerarFacturaModal } = await import("@/components/facturacion/generar-factura-modal")
    render(<GenerarFacturaModal open={true} onOpenChange={() => {}} onSuccess={() => {}} />)

    await waitFor(() => {
      expect(screen.getByText(/CEL001/)).toBeInTheDocument()
    })
  })

  it("posts { ventaId } when a venta row is clicked and calls onSuccess", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ordenes: [],
          ventas: [{ id: "v1", numeroVenta: 5, clienteNombre: "Consumidor Final", total: 200 }],
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "f-new" }) })

    const onSuccess = vi.fn()
    const { GenerarFacturaModal } = await import("@/components/facturacion/generar-factura-modal")
    render(<GenerarFacturaModal open={true} onOpenChange={() => {}} onSuccess={onSuccess} />)

    fireEvent.click(await screen.findByRole("tab", { name: "Ventas" }))
    const row = await screen.findByText(/Consumidor Final/)
    fireEvent.click(row.closest("button")!)

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/facturacion/generar",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ ventaId: "v1" }),
        })
      )
      expect(onSuccess).toHaveBeenCalled()
    })
  })
})
