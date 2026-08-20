/**
 * Cubre el wiring de useFormDraft (hooks/use-form-draft.ts) dentro de
 * OrdenForm: un borrador valido en localStorage se restaura al montar, se
 * avisa con un banner dismissible, y "Descartar" borra el borrador y vuelve
 * el formulario a su estado en blanco.
 *
 * Mismos mocks base que orden-form-dispositivo-error.test.tsx, pero con una
 * sesion real (useFormDraft necesita userId/organizationId para resolver la
 * key de storage).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { ModalProvider } from "@/contexts/modal-context"

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "user-1", organizationId: "org-1" } } }),
}))

vi.mock("@/hooks/use-tipos-dispositivo", () => ({
  useTiposDispositivo: () => ({ tipos: [], loading: false, error: null, refetch: vi.fn() }),
}))

const DRAFT_KEY = "draft:v1:orden-form:org-1:user-1:new"

function draftEnvelope(overrides: Partial<Record<string, unknown>> = {}) {
  return JSON.stringify({
    version: 1,
    savedAt: Date.now(),
    data: {
      form: {
        clienteId: "",
        dispositivo: "iPhone 13 Restaurado",
        tipoDispositivo: "",
        marca: "",
        color: "",
        imei: "",
        problemaReportado: "Pantalla rota",
        accesorios: "",
        codigoAccesoDispositivo: "",
        telefonoContacto: "",
        fechaPrometida: "",
        observaciones: "",
        notasInternas: "",
      },
      accesoriosSeleccionados: [],
      otroAccesorio: "",
      camposExtraValues: {},
      presupuestoAceptado: false,
      sena: "",
      metodoPagoSena: "EFECTIVO",
      selectedSectorId: "",
      selectedTecnicoId: "",
      selectedRecibidoPorId: "",
      checklistValores: {},
      checklistNotas: "",
      currentStep: 1,
      ...overrides,
    },
  })
}

async function renderForm() {
  const { OrdenForm } = await import("@/components/ordenes/orden-form")
  return render(
    <ModalProvider>
      <OrdenForm onClose={vi.fn()} onSuccess={vi.fn()} />
    </ModalProvider>,
  )
}

describe("OrdenForm — borrador local", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, json: async () => [] } as Response)))
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("restaura un borrador valido y muestra el aviso dismissible", async () => {
    window.localStorage.setItem(DRAFT_KEY, draftEnvelope())

    await renderForm()

    expect(screen.getByText(/se restauró un borrador no guardado/i)).toBeInTheDocument()
    expect(screen.getByPlaceholderText("Modelo o descripcion del equipo")).toHaveValue(
      "iPhone 13 Restaurado",
    )
    expect(screen.getByPlaceholderText("Describa el problema del equipo...")).toHaveValue(
      "Pantalla rota",
    )
  })

  it('"Descartar" borra el borrador y limpia el formulario', async () => {
    window.localStorage.setItem(DRAFT_KEY, draftEnvelope())

    await renderForm()
    expect(screen.getByPlaceholderText("Modelo o descripcion del equipo")).toHaveValue(
      "iPhone 13 Restaurado",
    )

    fireEvent.click(screen.getByRole("button", { name: /descartar/i }))

    expect(screen.queryByText(/se restauró un borrador no guardado/i)).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText("Modelo o descripcion del equipo")).toHaveValue("")
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull()
  })

  it("no muestra el aviso cuando no hay borrador guardado", async () => {
    await renderForm()
    expect(screen.queryByText(/se restauró un borrador no guardado/i)).not.toBeInTheDocument()
  })
})
