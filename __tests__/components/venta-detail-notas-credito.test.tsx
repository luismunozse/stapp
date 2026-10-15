// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import React from "react"

let rol = "VENDEDOR"
vi.mock("next/navigation", () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn() }) }))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "u1", role: rol } } }) }))
vi.mock("@/contexts/modal-context", () => ({
  useModal: () => ({ confirm: vi.fn(), showError: vi.fn(), showSuccess: vi.fn() }),
}))

const venta = {
  id: "v1", numeroVenta: 9, clienteId: "c1", clienteNombre: "Ana", clienteTelefono: null, vendedor: null,
  items: [], garantias: [], subtotal: 300, descuento: 0, total: 300, montoAbonado: 300, saldoPendiente: 0,
  estadoPago: "PAGADO", metodoPago: "EFECTIVO", estado: "COMPLETADA", observaciones: null,
  createdAt: "2026-01-01T00:00:00Z", pagos: [], facturaId: null,
  devoluciones: [
    {
      id: "dev-1", ventaId: "v1", numeroDevolucion: "DEV-0007", motivo: "Producto con falla", tipo: "PARCIAL",
      montoDevolucion: 100, montoAplicadoDeuda: 0, montoReembolso: 100, estado: "COMPLETADA",
      observaciones: null, createdAt: "2026-01-02T00:00:00Z", items: [],
    },
  ],
}

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/ventas/v1") return { ok: true, json: async () => venta }
      return { ok: true, json: async () => ({ organization: { id: "org-1", slug: "demo", nombre: "Demo" } }) }
    })
  )
  vi.stubGlobal("open", vi.fn())
}

describe("VentaDetail — bloque de notas de crédito", () => {
  beforeEach(() => vi.clearAllMocks())

  // Spec, tabla de permisos: el bloque y la impresión los ve quien ve la venta.
  it.each(["VENDEDOR", "ADMIN"])("%s ve el bloque como notas de crédito e imprime con el documento nuevo", async (r) => {
    rol = r
    stubFetch()
    const { VentaDetail } = await import("@/components/ventas/venta-detail")
    render(<VentaDetail ventaId="v1" />)
    expect(await screen.findByText("Notas de crédito (1)")).toBeInTheDocument()
    expect(screen.getByText("DEV-0007")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "PDF" }))
    expect(window.open).toHaveBeenCalledWith("/api/notas-credito/dev-1/pdf", "_blank")
  })
})
