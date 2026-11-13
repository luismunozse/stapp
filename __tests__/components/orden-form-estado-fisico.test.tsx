/**
 * Seccion "Estado fisico" de la recepcion dentro de OrdenForm: el diagrama de
 * danos, el boton "Sin daños visibles", la validacion cuando el taller lo
 * exige, el cambio de tipo de equipo con pins marcados, el borrador y el envio.
 *
 * Los datos obligatorios del paso 1 (cliente, equipo, problema) llegan por un
 * borrador: es la unica forma de cargarlos sin manejar el buscador de clientes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, act, within } from "@testing-library/react"
import { ModalProvider } from "@/contexts/modal-context"

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "user-1", organizationId: "org-1" } } }),
}))

const config = vi.hoisted(() => ({ danosRecepcionObligatorio: false }))

// El flag sale del CurrencyProvider (que lee /api/configuracion/operativa); el
// formulario se monta sin provider, asi que se pisa solo ese campo.
vi.mock("@/contexts/currency-context", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/contexts/currency-context")>()
  return {
    ...mod,
    useCurrency: () => ({ ...mod.useCurrency(), danosRecepcionObligatorio: config.danosRecepcionObligatorio }),
  }
})

const toastSpy = vi.hoisted(() => ({ warning: vi.fn(), error: vi.fn() }))
vi.mock("sonner", async (importOriginal) => {
  const mod = await importOriginal<typeof import("sonner")>()
  return {
    ...mod,
    toast: Object.assign((...args: unknown[]) => (mod.toast as (...a: unknown[]) => unknown)(...args), mod.toast, {
      warning: toastSpy.warning,
      error: toastSpy.error,
    }),
  }
})

vi.mock("@/hooks/use-tipos-dispositivo", () => ({
  useTiposDispositivo: () => ({
    tipos: [
      {
        id: "tipo-1",
        codigo: "CELULAR",
        nombre: "Celular",
        config: { accesorios: [], problemasComunes: [], marcas: [], camposExtra: [] },
      },
      {
        id: "tipo-2",
        codigo: "TABLET",
        nombre: "Tablet",
        config: { accesorios: [], problemasComunes: [], marcas: [], camposExtra: [] },
      },
    ],
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}))

const DRAFT_KEY = "draft:v3:orden-form:org-1:user-1:new"
const MSG_OBLIGATORIO = "Marcá el estado físico del equipo o indicá «Sin daños visibles»"

function draftEnvelope(extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: 3,
    savedAt: Date.now(),
    data: {
      form: {
        clienteId: "cli-1",
        dispositivo: "iPhone 13",
        tipoDispositivo: "CELULAR",
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
      selectedClienteObj: { id: "cli-1", nombre: "Ana", telefono: "1122334455" },
      accesoriosSeleccionados: [],
      otroAccesorio: "",
      camposExtraValues: {},
      metodoPagoSena: "EFECTIVO",
      selectedSectorId: "",
      selectedTecnicoId: "",
      selectedRecibidoPorId: "",
      checklistValores: {},
      checklistNotas: "",
      ...extra,
    },
  })
}

function stubFetch(respuestaOrden: Record<string, unknown> = { id: "ord-1", numeroOrden: 1 }) {
  const fetchSpy = vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes("/api/checklist-templates/by-device-type")) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ template: null }) } as Response)
    }
    if (url === "/api/ordenes") {
      return Promise.resolve({ ok: true, status: 201, json: async () => respuestaOrden } as Response)
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => [] } as Response)
  })
  vi.stubGlobal("fetch", fetchSpy)
  return fetchSpy
}

const llamadasOrden = (spy: ReturnType<typeof vi.fn>) =>
  spy.mock.calls.filter((call) => String(call[0]) === "/api/ordenes")

async function settle(ms = 2000) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
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

async function irAlPaso3() {
  fireEvent.click(screen.getByRole("button", { name: "Agregar detalles" }))
  await settle()
  fireEvent.click(screen.getByRole("button", { name: "Siguiente" }))
  await settle()
  expect(screen.getByText(/Paso 3\/3/)).toBeInTheDocument()
}

async function agregarGolpe() {
  fireEvent.click(screen.getByRole("button", { name: "Agregar daño" }))
  await settle(0)
  fireEvent.click(screen.getByRole("button", { name: /Golpe/ }))
  await settle(0)
}

const seccion = () => screen.getByRole("region", { name: "Estado físico" })

describe("OrdenForm — estado físico de la recepción", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    window.localStorage.clear()
    config.danosRecepcionObligatorio = false
    toastSpy.warning.mockReset()
    toastSpy.error.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("con un pin marcado, 'Sin daños visibles' queda deshabilitado", async () => {
    stubFetch()
    window.localStorage.setItem(DRAFT_KEY, draftEnvelope())
    await renderForm()
    await settle()
    await irAlPaso3()

    expect(within(seccion()).getByRole("button", { name: "Sin daños visibles" })).toBeEnabled()
    await agregarGolpe()
    expect(within(seccion()).getByLabelText("Daño 1: golpe, frente")).toBeInTheDocument()
    expect(within(seccion()).getByRole("button", { name: "Sin daños visibles" })).toBeDisabled()
  })

  it("con 'Sin daños visibles' activo, el diagrama no acepta clics", async () => {
    stubFetch()
    window.localStorage.setItem(DRAFT_KEY, draftEnvelope())
    await renderForm()
    await settle()
    await irAlPaso3()

    fireEvent.click(within(seccion()).getByRole("button", { name: "Sin daños visibles" }))
    await settle(0)
    expect(within(seccion()).getByText("Sin daños visibles al ingreso")).toBeInTheDocument()
    expect(within(seccion()).queryByRole("button", { name: "Agregar daño" })).toBeNull()

    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, width: 200, height: 400, right: 200, bottom: 400, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect)
    fireEvent.click(within(seccion()).getByTestId("diagrama-svg"), { clientX: 100, clientY: 100 })
    await settle(0)
    expect(screen.queryByRole("button", { name: /Golpe/ })).toBeNull()
  })

  it("con el estado físico obligatorio y nada marcado, no envía y lo pide", async () => {
    config.danosRecepcionObligatorio = true
    const fetchSpy = stubFetch()
    window.localStorage.setItem(DRAFT_KEY, draftEnvelope())
    await renderForm()
    await settle()

    // Desde el paso 1: "Crear orden" lleva hasta la sección.
    fireEvent.click(screen.getByRole("button", { name: "Crear orden" }))
    await settle()

    expect(screen.getByText(/Paso 3\/3/)).toBeInTheDocument()
    expect(within(seccion()).getByText(MSG_OBLIGATORIO)).toBeInTheDocument()
    expect(llamadasOrden(fetchSpy)).toHaveLength(0)

    // Marcar "Sin daños visibles" alcanza para crear.
    fireEvent.click(within(seccion()).getByRole("button", { name: "Sin daños visibles" }))
    await settle(0)
    expect(within(seccion()).queryByText(MSG_OBLIGATORIO)).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Crear orden" }))
    await settle()
    expect(llamadasOrden(fetchSpy)).toHaveLength(1)
  })

  it("cambiar el tipo con pins marcados pide confirmación: cancelar no cambia nada", async () => {
    stubFetch()
    window.localStorage.setItem(DRAFT_KEY, draftEnvelope())
    await renderForm()
    await settle()
    await irAlPaso3()
    await agregarGolpe()

    fireEvent.click(screen.getByRole("button", { name: "Anterior" }))
    fireEvent.click(screen.getByRole("button", { name: "Anterior" }))
    await settle(0)

    fireEvent.click(screen.getByRole("button", { name: "Tablet" }))
    await settle(0)
    expect(screen.getByText("Cambiar el tipo de equipo borra los daños marcados")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }))
    await settle()

    expect(screen.getByRole("button", { name: "Celular" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "Tablet" })).toHaveAttribute("aria-pressed", "false")
    await irAlPaso3()
    expect(within(seccion()).getByLabelText("Daño 1: golpe, frente")).toBeInTheDocument()
  })

  it("cambiar el tipo con pins marcados y confirmar borra los pins", async () => {
    stubFetch()
    window.localStorage.setItem(DRAFT_KEY, draftEnvelope())
    await renderForm()
    await settle()
    await irAlPaso3()
    await agregarGolpe()

    fireEvent.click(screen.getByRole("button", { name: "Anterior" }))
    fireEvent.click(screen.getByRole("button", { name: "Anterior" }))
    await settle(0)

    fireEvent.click(screen.getByRole("button", { name: "Tablet" }))
    await settle(0)
    fireEvent.click(screen.getByRole("button", { name: "Cambiar tipo" }))
    await settle()

    expect(screen.getByRole("button", { name: "Tablet" })).toHaveAttribute("aria-pressed", "true")
    // Tablet no tiene campos que reemplacen al nombre del equipo: el paso 1 sigue valido.
    await irAlPaso3()
    expect(within(seccion()).queryByLabelText(/^Daño \d/)).toBeNull()
    expect(within(seccion()).getByRole("button", { name: "Sin daños visibles" })).toBeEnabled()
  })

  it("un borrador con daños de forma inválida se restaura sin pins y sin error", async () => {
    stubFetch()
    window.localStorage.setItem(
      DRAFT_KEY,
      draftEnvelope({ estadoFisico: { danos: [{ foo: 1 }, "basura", null], sinDanos: false } }),
    )
    await renderForm()
    await settle()
    // Se restauro el resto del borrador.
    expect(screen.getByDisplayValue("iPhone 13")).toBeInTheDocument()
    await irAlPaso3()
    expect(within(seccion()).queryByLabelText(/^Daño \d/)).toBeNull()
  })

  it("un borrador con un diagrama que no corresponde al tipo se restaura sin pins", async () => {
    stubFetch()
    window.localStorage.setItem(
      DRAFT_KEY,
      draftEnvelope({
        estadoFisico: {
          danos: [{ diagrama: "tablet@1", vista: "frente", x: 0.5, y: 0.5, tipo: "golpe", nota: null }],
          sinDanos: false,
        },
      }),
    )
    await renderForm()
    await settle()
    expect(screen.getByDisplayValue("iPhone 13")).toBeInTheDocument()
    await irAlPaso3()
    expect(within(seccion()).queryByLabelText(/^Daño \d/)).toBeNull()
  })

  it("un borrador válido restaura los pins", async () => {
    stubFetch()
    window.localStorage.setItem(
      DRAFT_KEY,
      draftEnvelope({
        estadoFisico: {
          danos: [{ diagrama: "celular@1", vista: "frente", x: 0.5, y: 0.5, tipo: "rayon", nota: "esquina" }],
          sinDanos: false,
        },
      }),
    )
    await renderForm()
    await settle()
    await irAlPaso3()
    expect(within(seccion()).getByLabelText("Daño 1: rayón, frente")).toBeInTheDocument()
  })

  it("el envío incluye danos (sin numero) y recepcionSinDanos", async () => {
    const fetchSpy = stubFetch({ id: "ord-1", numeroOrden: 1, estadoFisicoGuardado: true })
    window.localStorage.setItem(DRAFT_KEY, draftEnvelope())
    await renderForm()
    await settle()
    await irAlPaso3()
    await agregarGolpe()

    fireEvent.click(screen.getByRole("button", { name: "Crear orden" }))
    await settle()

    const [call] = llamadasOrden(fetchSpy)
    const body = JSON.parse(String((call[1] as RequestInit).body))
    expect(body.recepcionSinDanos).toBe(false)
    expect(body.danos).toEqual([{ diagrama: "celular@1", vista: "frente", x: 0.5, y: 0.5, tipo: "golpe", nota: null }])
    expect(body.danos[0]).not.toHaveProperty("numero")
    expect(toastSpy.warning).not.toHaveBeenCalled()
  })

  it("con 'Sin daños visibles' el envío manda recepcionSinDanos y ningún daño", async () => {
    const fetchSpy = stubFetch({ id: "ord-1", numeroOrden: 1, estadoFisicoGuardado: true })
    window.localStorage.setItem(DRAFT_KEY, draftEnvelope())
    await renderForm()
    await settle()
    await irAlPaso3()
    fireEvent.click(within(seccion()).getByRole("button", { name: "Sin daños visibles" }))
    await settle(0)

    fireEvent.click(screen.getByRole("button", { name: "Crear orden" }))
    await settle()

    const body = JSON.parse(String((llamadasOrden(fetchSpy)[0][1] as RequestInit).body))
    expect(body.recepcionSinDanos).toBe(true)
    expect(body.danos).toBeUndefined()
  })

  it("si la API avisa estadoFisicoGuardado:false, se muestra un toast", async () => {
    stubFetch({ id: "ord-1", numeroOrden: 1, estadoFisicoGuardado: false })
    window.localStorage.setItem(DRAFT_KEY, draftEnvelope())
    await renderForm()
    await settle()
    await irAlPaso3()
    await agregarGolpe()

    fireEvent.click(screen.getByRole("button", { name: "Crear orden" }))
    await settle()

    expect(toastSpy.warning).toHaveBeenCalledWith("La orden se creó, pero el estado físico no se pudo guardar")
  })

  it("sin nada marcado, estadoFisicoGuardado:false no dispara el toast", async () => {
    stubFetch({ id: "ord-1", numeroOrden: 1, estadoFisicoGuardado: false })
    window.localStorage.setItem(DRAFT_KEY, draftEnvelope())
    await renderForm()
    await settle()
    fireEvent.click(screen.getByRole("button", { name: "Crear orden" }))
    await settle()
    expect(toastSpy.warning).not.toHaveBeenCalled()
  })
})
