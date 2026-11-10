/**
 * La firma de recepcion vive en la seccion del checklist. El alta solo
 * guardaba el checklist si habia algun item contestado: un cliente que
 * firmaba sin que se marcara ningun item perdia la firma y el PDF de la
 * orden salia con la linea en blanco.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, act } from "@testing-library/react"
import { ModalProvider } from "@/contexts/modal-context"
import { RUBROS } from "@/lib/rubros"

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "user-1", organizationId: "org-1", role: "ADMIN" } } }),
}))
vi.mock("@/components/firma/signature-pad", () => ({
  SignaturePad: ({ onSignatureChange }: { onSignatureChange: (d: string | null, m: string | null) => void }) => (
    <button type="button" onClick={() => onSignatureChange("iVBORw0KGgoFIRMA", "image/png")}>
      firmar
    </button>
  ),
}))

const estado = vi.hoisted(() => ({ tipos: [] as unknown[] }))
vi.mock("@/hooks/use-tipos-dispositivo", () => ({
  useTiposDispositivo: () => ({ tipos: estado.tipos, loading: false, error: null, refetch: vi.fn() }),
}))

const DRAFT_KEY = "draft:v3:orden-form:org-1:user-1:new"
const TEMPLATE = {
  id: "tpl-1",
  nombre: "Ingreso",
  items: [{ id: "it-1", label: "Pantalla rota", tipo: "boolean" }],
}

function draft(tipo: string) {
  return JSON.stringify({
    version: 3,
    savedAt: Date.now(),
    data: {
      form: {
        clienteId: "cli-1", dispositivo: "Equipo X", tipoDispositivo: tipo, marca: "", color: "", imei: "",
        problemaReportado: "No enciende", accesorios: "", codigoAccesoDispositivo: "", telefonoContacto: "",
        fechaPrometida: "", observaciones: "", notasInternas: "",
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

describe("OrdenForm: firma de recepción sin items del checklist", () => {
  beforeEach(() => { vi.useFakeTimers(); window.localStorage.clear() })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it("guarda el checklist con la firma aunque no se haya marcado ningún item", async () => {
    const tipo = RUBROS[0].tipos[0]
    estado.tipos = [{ id: "tipo-x", ...tipo }]
    const fetchSpy = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/ordenes") {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ id: "ord-1", numeroOrden: 1 }) } as Response)
      }
      if (url.startsWith("/api/checklist-templates/by-device-type")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ template: TEMPLATE }) } as Response)
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response)
    })
    vi.stubGlobal("fetch", fetchSpy)
    window.localStorage.setItem(DRAFT_KEY, draft(tipo.codigo))

    const { OrdenForm } = await import("@/components/ordenes/orden-form")
    render(<ModalProvider><OrdenForm onClose={vi.fn()} onSuccess={vi.fn()} /></ModalProvider>)
    await settle()
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" })); await settle()
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" })); await settle()
    fireEvent.click(screen.getByRole("button", { name: "firmar" })); await settle(100)
    fireEvent.click(screen.getByRole("button", { name: "Crear Orden" })); await settle()

    const llamada = fetchSpy.mock.calls.find((c) => String(c[0]) === "/api/ordenes/ord-1/checklist")
    expect(llamada).toBeDefined()
    const body = JSON.parse(String(llamada![1]!.body))
    expect(body.firmaCliente).toBe("iVBORw0KGgoFIRMA")
    expect(body.firmaMime).toBe("image/png")
  })
})
