// GarantiaCard: botones según rol, diálogo propio en vez de prompt() y forma
// camelCase de los reclamos (docs/garantias-flujo-2026-11-11.md, Fase 0).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { GarantiaCard } from "@/components/garantias/garantia-card"

const showError = vi.fn()
vi.mock("@/contexts/modal-context", () => ({
  useModal: () => ({ confirm: vi.fn().mockResolvedValue(false), showError }),
}))
vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatDate: (d: string) => (d ? `fecha:${d.slice(0, 10)}` : "") }),
}))

function garantia(reclamos: Record<string, unknown>[] = []) {
  return {
    id: "g1",
    ordenId: "o1",
    diasValidez: 90,
    fechaInicio: "2026-10-01T12:00:00Z",
    fechaVencimiento: "2099-01-01T12:00:00Z",
    estado: reclamos.length ? "RECLAMADA" : "ACTIVA",
    notas: null,
    reclamos,
  }
}

const reclamo = (estado: string, extra: Record<string, unknown> = {}) => ({
  id: `r-${estado}`,
  garantiaId: "g1",
  descripcion: "Volvió a fallar",
  estado,
  ordenReparacionId: null,
  resolucion: null,
  fechaReclamo: "2026-11-01T10:00:00Z",
  fechaResolucion: null,
  ...extra,
})

let mockFetch: ReturnType<typeof vi.fn>
function respond(listado: unknown[]) {
  mockFetch = vi.fn((url: string, init?: RequestInit) => {
    if (!init || init.method === undefined) {
      return Promise.resolve({ ok: true, json: async () => listado } as Response)
    }
    return Promise.resolve({ ok: true, json: async () => ({}) } as Response)
  })
  vi.stubGlobal("fetch", mockFetch)
}

describe("GarantiaCard", () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.unstubAllGlobals())

  it("pide solo la garantía de su orden", async () => {
    respond([garantia()])
    render(<GarantiaCard ordenId="o1" ordenEstado="ENTREGADO" />)
    await screen.findByText("Activa")
    expect(mockFetch).toHaveBeenCalledWith("/api/garantias?ordenId=o1")
  })

  it("sin garantía: solo ADMIN ve Crear garantía", async () => {
    respond([])
    const { unmount } = render(<GarantiaCard ordenId="o1" ordenEstado="ENTREGADO" />)
    await screen.findByText("Esta orden no tiene garantía registrada")
    expect(screen.queryByRole("button", { name: /crear garantía/i })).not.toBeInTheDocument()
    unmount()

    respond([])
    render(<GarantiaCard ordenId="o1" ordenEstado="ENTREGADO" isAdmin />)
    expect(await screen.findByRole("button", { name: /crear garantía/i })).toBeInTheDocument()
  })

  it("un rol no ADMIN registra reclamos pero no edita ni decide", async () => {
    respond([{ ...garantia([reclamo("EN_REVISION"), reclamo("PENDIENTE"), reclamo("ACEPTADO")]), estado: "ACTIVA" }])
    render(<GarantiaCard ordenId="o1" ordenEstado="ENTREGADO" />)
    await screen.findByText("Historial de reclamos (3)")

    expect(screen.getByRole("button", { name: /registrar reclamo/i })).toBeInTheDocument()
    expect(screen.queryByTitle("Editar garantía")).not.toBeInTheDocument()
    for (const name of [/revisar/i, /aceptar/i, /rechazar/i, /marcar resuelto/i]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument()
    }
  })

  it("ADMIN ve editar y las decisiones", async () => {
    respond([garantia([reclamo("EN_REVISION"), reclamo("PENDIENTE"), reclamo("ACEPTADO")])])
    render(<GarantiaCard ordenId="o1" ordenEstado="ENTREGADO" isAdmin />)
    await screen.findByText("Historial de reclamos (3)")

    expect(screen.getByTitle("Editar garantía")).toBeInTheDocument()
    for (const name of [/revisar/i, /aceptar/i, /rechazar/i, /marcar resuelto/i]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument()
    }
  })

  it("muestra la fecha del reclamo y el link a la orden creada", async () => {
    respond([garantia([reclamo("ACEPTADO", { ordenReparacionId: "ord-r" })])])
    render(<GarantiaCard ordenId="o1" ordenEstado="ENTREGADO" />)
    expect(await screen.findByText("fecha:2026-11-01")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /nueva orden de reparación creada/i })).toHaveAttribute(
      "href",
      "/ordenes/ord-r"
    )
  })

  it("rechazar pide el motivo en un diálogo, no con prompt()", async () => {
    const promptSpy = vi.fn()
    vi.stubGlobal("prompt", promptSpy)
    respond([garantia([reclamo("EN_REVISION")])])
    render(<GarantiaCard ordenId="o1" ordenEstado="ENTREGADO" isAdmin />)

    fireEvent.click(await screen.findByRole("button", { name: /^rechazar$/i }))
    const motivo = await screen.findByLabelText("Motivo del rechazo")
    const confirmar = screen.getByRole("button", { name: "Rechazar reclamo" })
    expect(confirmar).toBeDisabled()

    fireEvent.change(motivo, { target: { value: "Daño por humedad" } })
    fireEvent.click(confirmar)

    await waitFor(() => {
      const put = mockFetch.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "PUT")
      expect(put).toBeDefined()
      expect(put![0]).toBe("/api/garantias/g1/reclamos?reclamoId=r-EN_REVISION")
      expect(JSON.parse((put![1] as RequestInit).body as string)).toEqual({
        estado: "RECHAZADO",
        crearOrden: false,
        resolucion: "Daño por humedad",
      })
    })
    expect(promptSpy).not.toHaveBeenCalled()
  })

  it("no usa colores crudos en los badges", async () => {
    respond([garantia([reclamo("RECHAZADO")])])
    const { container } = render(<GarantiaCard ordenId="o1" ordenEstado="ENTREGADO" />)
    await screen.findByText("Rechazado")
    expect(container.innerHTML).not.toMatch(/\b(bg|text|border)-(green|red|yellow|blue|gray)-\d{2,3}\b/)
  })
})
