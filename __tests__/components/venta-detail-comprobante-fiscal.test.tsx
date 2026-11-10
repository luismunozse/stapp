// __tests__/components/venta-detail-comprobante-fiscal.test.tsx
/**
 * VentaDetail monta el bloque de factura electronica solo para ADMIN y le pasa
 * el estado de la venta y si tiene devoluciones.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import React from "react"

let rol = "ADMIN"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}))
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { role: rol } } }),
}))
vi.mock("@/contexts/modal-context", () => ({
  useModal: () => ({ confirm: vi.fn(), showError: vi.fn(), showSuccess: vi.fn() }),
}))

const mockFetch = vi.fn()
global.fetch = mockFetch as unknown as typeof fetch

function ventaResponse(over: Record<string, unknown> = {}) {
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

function montar(venta: unknown, puedeEmitir = true) {
  mockFetch.mockImplementation(async (url: string) => {
    if (url.startsWith("/api/facturacion-electronica/comprobantes")) {
      return {
        status: 200,
        ok: true,
        json: async () => ({ items: [], total: 0, page: 1, limit: 20, totalPages: 0, puedeEmitir }),
      }
    }
    if (url.startsWith("/api/auth/user-organization")) {
      return { ok: true, json: async () => ({ organization: { id: "org-1", slug: "demo", nombre: "Demo" } }) }
    }
    return { ok: true, json: async () => venta }
  })
}

async function renderDetail() {
  const { VentaDetail } = await import("@/components/ventas/venta-detail")
  render(<VentaDetail ventaId="v1" />)
  await waitFor(() => expect(screen.getByText("Venta V0005")).toBeInTheDocument())
}

describe("VentaDetail — factura electrónica", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rol = "ADMIN"
  })

  it("ADMIN con venta elegible ve 'Emitir factura electrónica'", async () => {
    montar(ventaResponse())
    await renderDetail()
    expect(await screen.findByRole("button", { name: /Emitir factura electrónica/i })).toBeInTheDocument()
    expect(mockFetch).toHaveBeenCalledWith("/api/facturacion-electronica/comprobantes?ventaId=v1&limit=20")
  })

  it("una venta anulada no ofrece emitir", async () => {
    montar(ventaResponse({ estado: "ANULADA" }))
    await renderDetail()
    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith("/api/facturacion-electronica/comprobantes?ventaId=v1&limit=20")
    )
    expect(screen.queryByRole("button", { name: /Emitir factura electrónica/i })).not.toBeInTheDocument()
  })

  it("una venta con devoluciones no ofrece emitir", async () => {
    montar(
      ventaResponse({
        devoluciones: [
          { id: "d1", numero: 1, motivo: "x", monto: 10, estado: "COMPLETADA", items: [], createdAt: "2026-01-02T00:00:00Z" },
        ],
      })
    )
    await renderDetail()
    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith("/api/facturacion-electronica/comprobantes?ventaId=v1&limit=20")
    )
    expect(screen.queryByRole("button", { name: /Emitir factura electrónica/i })).not.toBeInTheDocument()
  })

  it("un vendedor no dispara ni ve el bloque fiscal", async () => {
    rol = "VENDEDOR"
    montar(ventaResponse())
    await renderDetail()
    expect(screen.queryByRole("button", { name: /Emitir factura electrónica/i })).not.toBeInTheDocument()
    expect(mockFetch).not.toHaveBeenCalledWith(expect.stringContaining("/api/facturacion-electronica/comprobantes"))
  })
})
