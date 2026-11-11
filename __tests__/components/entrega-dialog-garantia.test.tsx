// EntregaDialog: la garantía se precarga del presupuesto y un fallo al
// registrarla se avisa (docs/garantias-flujo-2026-11-11.md, Fase 0).
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { toast } from "sonner"
import { EntregaDialog } from "@/components/ordenes/entrega-dialog"

vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null }) }))
vi.mock("sonner", () => ({ toast: { warning: vi.fn(), success: vi.fn(), error: vi.fn() } }))
vi.mock("@/components/firma/signature-pad", () => ({ SignaturePad: () => null }))

const orden = {
  id: "o1",
  numeroOrden: 7,
  dispositivo: "iPhone 12",
  estado: "REPARADO",
  cliente: { nombre: "Juan", telefono: "123" },
  costoFinal: null,
  repuestos: [],
}

function renderDialog(garantiaPresupuesto?: { dias: number | null; alcance: string | null }) {
  render(
    <EntregaDialog
      open
      onClose={vi.fn()}
      onSuccess={vi.fn()}
      orden={orden as any}
      encargadoNombre="Encargado"
      garantiaDiasDefault={30}
      garantiaPresupuesto={garantiaPresupuesto}
    />
  )
}

let mockFetch: ReturnType<typeof vi.fn>
function entregarBody() {
  const call = mockFetch.mock.calls.find(([url]) => typeof url === "string" && url.includes("/entregar"))
  return call ? JSON.parse((call[1] as RequestInit).body as string) : null
}

describe("EntregaDialog — garantía", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch = vi.fn(() => Promise.resolve({ ok: true, json: async () => ({ estado: "ENTREGADO" }) } as Response))
    vi.stubGlobal("fetch", mockFetch)
  })

  it("sin presupuesto usa los días por defecto de la org", () => {
    renderDialog()
    expect(screen.getByLabelText("Días de garantía")).toHaveValue(30)
  })

  it("precarga los días del presupuesto y muestra el alcance", async () => {
    renderDialog({ dias: 90, alcance: "MANO_OBRA" })
    expect(screen.getByLabelText("Días de garantía")).toHaveValue(90)
    expect(screen.getByText(/Del presupuesto: 90 días · solo mano de obra/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /confirmar entrega/i }))
    await waitFor(() => expect(entregarBody()).toMatchObject({ diasGarantia: 90 }))
  })

  it("si el presupuesto no incluía garantía arranca destildada", () => {
    renderDialog({ dias: 0, alcance: "NINGUNA" })
    expect(screen.getByRole("checkbox", { name: /incluir garantía/i })).not.toBeChecked()
    expect(screen.getByText("El presupuesto no incluía garantía.")).toBeInTheDocument()
  })

  it("avisa cuando la entrega salió pero la garantía no", async () => {
    mockFetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({ estado: "ENTREGADO", garantiaWarning: "La orden se entregó pero no se pudo registrar la garantía." }),
      } as Response)
    )
    vi.stubGlobal("fetch", mockFetch)
    renderDialog()

    fireEvent.click(screen.getByRole("button", { name: /confirmar entrega/i }))
    await waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith(
        "La orden se entregó pero no se pudo registrar la garantía.",
        expect.anything()
      )
    )
  })
})
