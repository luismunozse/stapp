import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, act } from "@testing-library/react"
import { ModalProvider } from "@/contexts/modal-context"
import { RUBROS } from "@/lib/rubros"

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "user-1", organizationId: "org-1", role: "ADMIN" } } }),
}))
vi.mock("@/components/firma/signature-pad", () => ({
  SignaturePad: () => <div data-testid="signature-pad" />,
}))

const estado = vi.hoisted(() => ({ tipos: [] as unknown[] }))
vi.mock("@/hooks/use-tipos-dispositivo", () => ({
  useTiposDispositivo: () => ({ tipos: estado.tipos, loading: false, error: null, refetch: vi.fn() }),
}))

const DRAFT_KEY = "draft:v3:orden-form:org-1:user-1:new"
function draft(tipo: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: 3,
    savedAt: Date.now(),
    data: {
      form: {
        clienteId: "cli-1", dispositivo: "Equipo X", tipoDispositivo: tipo, marca: "", color: "", imei: "",
        problemaReportado: "No enciende", accesorios: "", codigoAccesoDispositivo: "", telefonoContacto: "",
        fechaPrometida: "", observaciones: "", notasInternas: "", ...extra,
      },
      selectedClienteObj: { id: "cli-1", nombre: "Juan", telefono: "1122334455", tipoCliente: "PARTICULAR" },
      accesoriosSeleccionados: [], otroAccesorio: "", camposExtraValues: {}, metodoPagoSena: "EFECTIVO",
      selectedSectorId: "", selectedTecnicoId: "", selectedRecibidoPorId: "",
      checklistValores: {}, checklistTemplateId: null, checklistNotas: "",
    },
  })
}

async function settle(ms = 2000) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

async function abrirConBorrador(extra: Record<string, unknown>) {
  const tipo = RUBROS[0].tipos[0]
  estado.tipos = [{ id: "tipo-x", ...tipo }]
  const fetchSpy = vi.fn((input: RequestInfo | URL) =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: async () => (String(input) === "/api/ordenes" ? { id: "ord-1", numeroOrden: 1 } : []),
    } as Response),
  )
  vi.stubGlobal("fetch", fetchSpy)
  window.localStorage.setItem(DRAFT_KEY, draft(tipo.codigo, extra))
  const { OrdenForm } = await import("@/components/ordenes/orden-form")
  render(<ModalProvider><OrdenForm onClose={vi.fn()} onSuccess={vi.fn()} /></ModalProvider>)
  await settle()
  return fetchSpy
}

const llamadas = (spy: ReturnType<typeof vi.fn>) => spy.mock.calls.map((c) => String(c[0]))

describe("OrdenForm: presupuesto", () => {
  beforeEach(() => { vi.useFakeTimers(); window.localStorage.clear() })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it("con presupuesto 0 la orden se crea (antes el botón no reaccionaba)", async () => {
    const fetchSpy = await abrirConBorrador({ presupuesto: 0 })
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" })); await settle()
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" })); await settle()
    fireEvent.click(screen.getByRole("button", { name: "Crear Orden" })); await settle()
    expect(llamadas(fetchSpy)).toContain("/api/ordenes")
  })

  it("un presupuesto negativo muestra el error en vez de quedar en silencio", async () => {
    const fetchSpy = await abrirConBorrador({ presupuesto: -5 })
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" })); await settle()
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" })); await settle()
    expect(screen.getByText("El presupuesto no puede ser negativo")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Crear Orden" })).toBeNull()
    expect(llamadas(fetchSpy)).not.toContain("/api/ordenes")
  })
})
