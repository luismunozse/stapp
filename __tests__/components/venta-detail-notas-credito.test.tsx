// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
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

function stubFetch(v: object = venta) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/ventas/v1") return { ok: true, json: async () => v }
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

const ventaConMonto = {
  ...venta,
  devoluciones: [
    {
      id: "dev-2", ventaId: "v1", numeroDevolucion: "NC-000012", motivo: "Le cobramos el cable dos veces",
      motivoNc: "ERROR_FACTURACION", modo: "MONTO", tipo: "PARCIAL", montoDevolucion: 50,
      montoAplicadoDeuda: 0, montoReembolso: 50, estado: "COMPLETADA", anulada: false,
      observaciones: null, createdAt: "2026-01-03T00:00:00Z", items: [],
    },
  ],
}

describe("VentaDetail — nota de crédito por monto y botón de emitir", () => {
  beforeEach(() => vi.clearAllMocks())

  it("una NC por monto se muestra 'Por monto', con el motivo del catálogo y el detalle", async () => {
    rol = "VENDEDOR"
    stubFetch(ventaConMonto)
    const { VentaDetail } = await import("@/components/ventas/venta-detail")
    render(<VentaDetail ventaId="v1" />)

    expect(await screen.findByText("NC-000012")).toBeInTheDocument()
    expect(screen.getByText(/Por monto/)).toBeInTheDocument()
    expect(screen.getByText(/Error de cobro/)).toBeInTheDocument()
    expect(screen.getByText("Le cobramos el cable dos veces")).toBeInTheDocument()
    expect(screen.queryByText(/item\(s\) devueltos/)).not.toBeInTheDocument()
  })

  it("el ADMIN emite desde 'Nota de crédito' (ya no dice 'Devolución')", async () => {
    rol = "ADMIN"
    stubFetch()
    const { VentaDetail } = await import("@/components/ventas/venta-detail")
    render(<VentaDetail ventaId="v1" />)

    fireEvent.click(await screen.findByRole("button", { name: "Nota de crédito" }))
    expect(screen.getByRole("dialog", { name: /Nota de crédito · Venta V0009/ })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Devolución" })).not.toBeInTheDocument()
  })

  it("al cerrar el diálogo recarga la venta: reabierto no trabaja con datos viejos", async () => {
    rol = "ADMIN"
    // La NC de $50 se emitió pero su respuesta se perdió: la base ya la tiene y
    // el detalle no. Hasta recargar, el diálogo seguiría ofreciendo esos $50.
    const conLaPerdida = { ...venta, devoluciones: [...venta.devoluciones, ...ventaConMonto.devoluciones] }
    let lecturas = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/ventas/v1") {
          lecturas++
          const v = lecturas === 1 ? venta : conLaPerdida
          return { ok: true, json: async () => v }
        }
        return { ok: true, json: async () => ({ organization: { id: "org-1", slug: "demo", nombre: "Demo" } }) }
      })
    )
    const { VentaDetail } = await import("@/components/ventas/venta-detail")
    render(<VentaDetail ventaId="v1" />)

    fireEvent.click(await screen.findByRole("button", { name: "Nota de crédito" }))
    expect(screen.getByText(/Disponible para acreditar: \D*200\b/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }))

    await waitFor(() => expect(lecturas).toBe(2))
    expect(await screen.findByText("NC-000012")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Nota de crédito" }))
    expect(screen.getByText(/Disponible para acreditar: \D*150\b/)).toBeInTheDocument()
  })

  it("el VENDEDOR no ve el botón de emitir (lo habilita el PR7)", async () => {
    rol = "VENDEDOR"
    stubFetch()
    const { VentaDetail } = await import("@/components/ventas/venta-detail")
    render(<VentaDetail ventaId="v1" />)

    expect(await screen.findByText("DEV-0007")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Nota de crédito" })).not.toBeInTheDocument()
  })
})
