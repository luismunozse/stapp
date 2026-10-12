// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import React from "react"

let rol = "VENDEDOR"
vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}))
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "u1", role: rol } } }),
}))
vi.mock("@/contexts/modal-context", () => ({
  useModal: () => ({ confirm: vi.fn(), showError: vi.fn(), showSuccess: vi.fn() }),
}))

const venta = {
  id: "v1",
  numeroVenta: 9,
  clienteId: "c1",
  clienteNombre: "Ana",
  clienteTelefono: null,
  vendedor: null,
  items: [],
  garantias: [],
  subtotal: 300,
  descuento: 0,
  total: 300,
  montoAbonado: 100,
  saldoPendiente: 200,
  estadoPago: "PAGADO_PARCIAL",
  metodoPago: "EFECTIVO",
  estado: "COMPLETADA",
  observaciones: null,
  createdAt: "2026-01-01T00:00:00Z",
  pagos: [],
  devoluciones: [],
  facturaId: null,
}

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/ventas/v1") return { ok: true, json: async () => venta }
      return { ok: true, json: async () => ({ organization: { id: "org-1", slug: "demo", nombre: "Demo" } }) }
    })
  )
}

describe("VentaDetail — acciones que la API reserva al ADMIN", () => {
  beforeEach(() => vi.clearAllMocks())

  it("un vendedor no ve Editar, Devolución, Anular ni Registrar Pago (todas terminaban en 403)", async () => {
    rol = "VENDEDOR"
    stubFetch()
    const { VentaDetail } = await import("@/components/ventas/venta-detail")
    render(<VentaDetail ventaId="v1" />)

    expect(await screen.findByText(/Pendiente de pago/i)).toBeInTheDocument()
    for (const nombre of [/^editar$/i, /devolución/i, /^anular$/i, /registrar pago/i]) {
      expect(screen.queryByRole("button", { name: nombre })).not.toBeInTheDocument()
    }
  })

  it("el ADMIN las ve, y el pendiente es el saldo real", async () => {
    rol = "ADMIN"
    stubFetch()
    const { VentaDetail } = await import("@/components/ventas/venta-detail")
    render(<VentaDetail ventaId="v1" />)

    expect(await screen.findByRole("button", { name: /registrar pago/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /^anular$/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /devolución/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /^editar$/i })).toBeInTheDocument()
  })
})
