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

const ncMonto = (id: string, numero: string, createdAt: string, extra: Record<string, unknown> = {}) => ({
  id, ventaId: "v1", numeroDevolucion: numero, motivo: "Ajuste", motivoNc: "AJUSTE_PRECIO", modo: "MONTO",
  tipo: "PARCIAL", montoDevolucion: 10, montoAplicadoDeuda: 0, montoReembolso: 10, estado: "COMPLETADA",
  anulada: false, metodoReembolso: "TRANSFERENCIA", observaciones: null, createdAt, items: [], ...extra,
})
const ventaConAnulada = {
  ...venta,
  devoluciones: [
    ncMonto("dev-3", "NC-000020", "2026-10-04T00:00:00Z", {
      anulada: true, anuladaAt: "2026-10-05T12:00:00Z", anuladaMotivo: "Se cargó en la venta equivocada",
    }),
  ],
}
const ventaConDos = {
  ...venta,
  devoluciones: [ncMonto("dev-4", "NC-000021", "2026-10-04T00:00:00Z"), ncMonto("dev-5", "NC-000022", "2026-10-05T00:00:00Z")],
}

describe("VentaDetail — anular notas de crédito", () => {
  beforeEach(() => vi.clearAllMocks())

  it("una NC anulada se ve anulada, con su motivo, sin WhatsApp ni Anular", async () => {
    rol = "ADMIN"
    stubFetch(ventaConAnulada)
    const { VentaDetail } = await import("@/components/ventas/venta-detail")
    render(<VentaDetail ventaId="v1" />)
    expect(await screen.findByText("NC-000020")).toBeInTheDocument()
    expect(screen.getByText("Anulada")).toBeInTheDocument()
    expect(screen.getByText(/Se cargó en la venta equivocada/)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "WhatsApp" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Anular la nota de crédito/ })).not.toBeInTheDocument()
  })

  it("el ADMIN anula solo la más reciente; la anterior dice por qué no", async () => {
    rol = "ADMIN"
    stubFetch(ventaConDos)
    const { VentaDetail } = await import("@/components/ventas/venta-detail")
    render(<VentaDetail ventaId="v1" />)
    const ultima = await screen.findByRole("button", { name: "Anular la nota de crédito NC-000022" })
    const anterior = screen.getByRole("button", { name: "Anular la nota de crédito NC-000021" })
    expect(ultima).toBeEnabled()
    expect(anterior).toBeDisabled()
    expect(anterior.closest("span")).toHaveAttribute(
      "title", "Se anulan de la más reciente a la primera: primero anulá la NC-000022."
    )
  })

  it("anular desde el bloque pega a la ruta de esa NC y relee la venta", async () => {
    rol = "ADMIN"
    let lecturas = 0
    const posts: string[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/ventas/v1") {
          lecturas++
          return { ok: true, json: async () => ventaConDos }
        }
        if (init?.method === "POST") {
          posts.push(url)
          return { ok: true, status: 200, json: async () => ({ efectivoSinEgreso: false, replayed: false }) }
        }
        return { ok: true, json: async () => ({ organization: { id: "org-1", slug: "demo", nombre: "Demo" } }) }
      })
    )
    vi.stubGlobal("open", vi.fn())
    const { VentaDetail } = await import("@/components/ventas/venta-detail")
    render(<VentaDetail ventaId="v1" />)

    fireEvent.click(await screen.findByRole("button", { name: "Anular la nota de crédito NC-000022" }))
    fireEvent.change(screen.getByLabelText("Motivo de la anulación"), { target: { value: "Error de carga" } })
    fireEvent.click(screen.getByRole("button", { name: "Anular nota de crédito" }))

    await waitFor(() => expect(lecturas).toBe(2))
    expect(posts).toEqual(["/api/ventas/v1/devolucion/dev-5/anular"])
  })

  it("al cerrar el diálogo de anular, aun después de un error, relee la venta", async () => {
    rol = "ADMIN"
    let lecturas = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/ventas/v1") {
          lecturas++
          return { ok: true, json: async () => ventaConDos }
        }
        if (init?.method === "POST") return { ok: false, status: 409, json: async () => ({ error: "La venta está anulada" }) }
        return { ok: true, json: async () => ({ organization: { id: "org-1", slug: "demo", nombre: "Demo" } }) }
      })
    )
    vi.stubGlobal("open", vi.fn())
    const { VentaDetail } = await import("@/components/ventas/venta-detail")
    render(<VentaDetail ventaId="v1" />)

    fireEvent.click(await screen.findByRole("button", { name: "Anular la nota de crédito NC-000022" }))
    fireEvent.change(screen.getByLabelText("Motivo de la anulación"), { target: { value: "Error de carga" } })
    fireEvent.click(screen.getByRole("button", { name: "Anular nota de crédito" }))
    expect(await screen.findByText("La venta está anulada")).toBeInTheDocument()
    expect(lecturas).toBe(1)

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }))
    await waitFor(() => expect(lecturas).toBe(2))
  })

  it("el VENDEDOR no ve Anular", async () => {
    rol = "VENDEDOR"
    stubFetch(ventaConDos)
    const { VentaDetail } = await import("@/components/ventas/venta-detail")
    render(<VentaDetail ventaId="v1" />)
    expect(await screen.findByText("NC-000022")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Anular la nota de crédito/ })).not.toBeInTheDocument()
  })
})
