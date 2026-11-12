// GarantiaCard: estado derivado, reclamos como línea de tiempo y el flujo
// único de reclamos con diálogos propios (docs/garantias-flujo-2026-11-11.md,
// fases 0 y 2).
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

const base = {
  id: "g1",
  ordenId: "o1",
  diasValidez: 90,
  fechaInicio: "2026-10-01T12:00:00Z",
  fechaVencimiento: "2099-01-01T12:00:00Z",
  estado: "ACTIVA",
  notas: null,
}

const reclamo = (fase: string, extra: Record<string, unknown> = {}) => ({
  id: `r-${fase}`,
  origen: "REPARACION",
  garantiaId: "g1",
  descripcion: "Volvió a fallar",
  estado: fase === "ABIERTO" ? "PENDIENTE" : fase,
  fase,
  ordenReparacionId: null,
  ordenReingreso: null,
  resolucion: null,
  motivoRechazo: null,
  vigenciaForzadaMotivo: null,
  registradoPor: "Vendedora",
  decididoPor: null,
  fechaReclamo: "2026-11-01T10:00:00Z",
  fechaDecision: null,
  fechaResolucion: null,
  ...extra,
})

function detalle(over: Record<string, unknown> = {}, reclamos: unknown[] = []) {
  return {
    id: "g1",
    origen: "REPARACION",
    estado: "VIGENTE",
    diasRestantes: 40,
    acciones: { registrarReclamo: "vigente", decidirReclamo: false, verHref: null, certificadoUrl: null, whatsappUrl: null },
    reclamos,
    ...over,
  }
}

let mockFetch: ReturnType<typeof vi.fn>
function respond(listado: unknown[], garantias: unknown[] = []) {
  mockFetch = vi.fn((url: string, init?: RequestInit) => {
    if (!init || init.method === undefined) {
      const body = url.startsWith("/api/garantias/reclamos") ? { garantias } : listado
      return Promise.resolve({ ok: true, json: async () => body } as Response)
    }
    return Promise.resolve({ ok: true, json: async () => ({}) } as Response)
  })
  vi.stubGlobal("fetch", mockFetch)
}

describe("GarantiaCard", () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.unstubAllGlobals())

  it("pide la garantía y los reclamos de su orden, y muestra el estado derivado (no el enum)", async () => {
    respond([{ ...base, estado: "ACTIVA" }], [detalle({ estado: "VENCIDA", diasRestantes: -2, acciones: { registrarReclamo: null } })])
    render(<GarantiaCard ordenId="o1" ordenEstado="ENTREGADO" />)
    expect(await screen.findByText("Vencida")).toBeInTheDocument()
    expect(screen.queryByText("Activa")).not.toBeInTheDocument()
    expect(screen.getByText("Venció hace 2 días")).toBeInTheDocument()
    expect(mockFetch).toHaveBeenCalledWith("/api/garantias?ordenId=o1")
    expect(mockFetch).toHaveBeenCalledWith("/api/garantias/reclamos?ordenId=o1")
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
    respond([base], [detalle({}, [reclamo("ABIERTO")])])
    render(<GarantiaCard ordenId="o1" ordenEstado="ENTREGADO" />)
    await screen.findByText("Reclamos (1)")
    expect(screen.getByRole("button", { name: /registrar reclamo/i })).toBeInTheDocument()
    expect(screen.queryByTitle("Editar garantía")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^aceptar$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^rechazar$/i })).not.toBeInTheDocument()
  })

  it("ADMIN ve editar y Aceptar / Rechazar solo en el reclamo por decidir", async () => {
    respond([base], [detalle({ estado: "RECLAMADA", acciones: { registrarReclamo: null } }, [reclamo("ABIERTO"), reclamo("RECHAZADO", { motivoRechazo: "No cubre" })])])
    render(<GarantiaCard ordenId="o1" ordenEstado="ENTREGADO" isAdmin />)
    await screen.findByText("Reclamos (2)")
    expect(screen.getByTitle("Editar garantía")).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: /^aceptar$/i })).toHaveLength(1)
    expect(screen.getAllByRole("button", { name: /^rechazar$/i })).toHaveLength(1)
    expect(screen.getByText("No cubre")).toBeInTheDocument()
    // Con un reclamo abierto no se registra otro.
    expect(screen.queryByRole("button", { name: /registrar reclamo/i })).not.toBeInTheDocument()
  })

  it("línea de tiempo: fecha, quién lo registró y link al re-ingreso", async () => {
    respond(
      [base],
      [detalle({ estado: "RECLAMADA" }, [reclamo("ACEPTADO", { ordenReingreso: { id: "ord-r", numero: "CEL099" } })])]
    )
    render(<GarantiaCard ordenId="o1" ordenEstado="ENTREGADO" />)
    expect(await screen.findByText(/fecha:2026-11-01/)).toHaveTextContent("Vendedora")
    expect(screen.getByRole("link", { name: "Orden de re-ingreso CEL099" })).toHaveAttribute("href", "/ordenes/ord-r")
    expect(screen.getByRole("list", { name: "Historial de reclamos" })).toBeInTheDocument()
  })

  it("rechazar pide el motivo en un diálogo, no con prompt()", async () => {
    const promptSpy = vi.fn()
    vi.stubGlobal("prompt", promptSpy)
    respond([base], [detalle({}, [reclamo("ABIERTO")])])
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
      expect(put![0]).toBe("/api/garantias/reclamos/r-ABIERTO")
      expect(JSON.parse((put![1] as RequestInit).body as string)).toEqual({ accion: "rechazar", motivo: "Daño por humedad" })
    })
    expect(promptSpy).not.toHaveBeenCalled()
  })

  it("registrar abre un diálogo y manda el reclamo de reparación", async () => {
    respond([base], [detalle()])
    render(<GarantiaCard ordenId="o1" ordenEstado="ENTREGADO" />)
    fireEvent.click(await screen.findByRole("button", { name: /registrar reclamo/i }))
    fireEvent.change(await screen.findByLabelText("¿Qué problema tiene?"), { target: { value: "No carga" } })
    fireEvent.click(screen.getByRole("button", { name: "Registrar reclamo" }))
    await waitFor(() => {
      const post = mockFetch.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST")
      expect(post![0]).toBe("/api/garantias/reclamos")
      expect(JSON.parse((post![1] as RequestInit).body as string)).toEqual({
        origen: "REPARACION",
        garantiaId: "g1",
        descripcion: "No carga",
      })
    })
  })

  it("no usa colores crudos sin su par de modo oscuro", async () => {
    respond([base], [detalle({}, [reclamo("RECHAZADO"), reclamo("RESUELTO"), reclamo("ACEPTADO")])])
    const { container } = render(<GarantiaCard ordenId="o1" ordenEstado="ENTREGADO" isAdmin />)
    await screen.findByText("Rechazado")
    // Un color crudo solo se acepta con su variante `dark:` en el mismo
    // elemento (p. ej. el tono `danger` de StatusPill: text-red-700 dark:text-red-300).
    const crudo = /(^|\s)(bg|text|border)-(green|red|yellow|blue|gray)-\d{2,3}(\s|$)/
    for (const el of Array.from(container.querySelectorAll("[class]"))) {
      const cls = el.getAttribute("class") ?? ""
      if (crudo.test(cls)) expect(cls, cls).toMatch(/\bdark:(bg|text|border)-(green|red|yellow|blue|gray)-/)
    }
  })
})
