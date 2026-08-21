/**
 * Cubre el wiring de useFormDraft (hooks/use-form-draft.ts) dentro de
 * OrdenForm: un borrador valido en localStorage se restaura al montar, se
 * avisa con un banner dismissible, y "Descartar" borra el borrador y vuelve
 * el formulario a su estado en blanco.
 *
 * Ademas cubre lo que el borrador tiene que sobrevivir DESPUES de
 * restaurarse: los efectos de montaje del formulario (template del checklist,
 * sectores del cliente) corren despues del restore y borraban parte de lo
 * restaurado sin ningun aviso.
 *
 * Mismos mocks base que orden-form-dispositivo-error.test.tsx, pero con una
 * sesion real (useFormDraft necesita userId/organizationId para resolver la
 * key de storage).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, act } from "@testing-library/react"
import { ModalProvider } from "@/contexts/modal-context"

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "user-1", organizationId: "org-1" } } }),
}))

vi.mock("@/hooks/use-tipos-dispositivo", () => ({
  useTiposDispositivo: () => ({
    tipos: [
      {
        id: "tipo-1",
        codigo: "CELULAR",
        nombre: "Celular",
        config: { accesorios: [], problemasComunes: [], marcas: [], camposExtra: [] },
      },
    ],
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}))

const DRAFT_KEY = "draft:v2:orden-form:org-1:user-1:new"

/** Cliente completo tal como lo devuelve GET /api/clientes/:id — el deep-link
 *  (?clienteId=) es la unica forma de cargar el objeto entero sin tocar el
 *  buscador, asi que es el camino que usan los tests de proyeccion. */
const CLIENTE_COMPLETO = {
  id: "cli-1",
  nombre: "Acme SA",
  telefono: "1122334455",
  email: "contacto@acme.test",
  dni: "30111222",
  cuit: "30-71111111-9",
  direccion: "Av. Siempreviva 742",
  tipoCliente: "EMPRESA",
  razonSocial: "Acme SA",
}

/** fetch por URL: el template del checklist y los sectores del cliente son
 *  los dos que pisaban el borrador restaurado, asi que tienen que responder
 *  de verdad para que esos efectos lleguen a su rama de exito. */
function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/api/checklist-templates/by-device-type")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            template: {
              id: "tpl-1",
              nombre: "Ingreso",
              items: [{ key: "pantalla", label: "Pantalla", tipo: "BOOLEAN" }],
            },
          }),
        } as Response)
      }
      if (url.includes("/sectores")) {
        return Promise.resolve({
          ok: true,
          json: async () => [{ id: "sec-1", nombre: "Contaduria" }],
        } as Response)
      }
      if (url.includes("/api/clientes/cli-1")) {
        return Promise.resolve({ ok: true, json: async () => CLIENTE_COMPLETO } as Response)
      }
      return Promise.resolve({ ok: true, json: async () => [] } as Response)
    }),
  )
}

function draftData(overrides: Record<string, unknown> = {}) {
  return {
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
    selectedClienteObj: null,
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
  }
}

function draftEnvelope(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({ version: 2, savedAt: Date.now(), data: draftData(overrides) })
}

async function renderForm(props: { initialClienteId?: string } = {}) {
  const { OrdenForm } = await import("@/components/ordenes/orden-form")
  return render(
    <ModalProvider>
      <OrdenForm onClose={vi.fn()} onSuccess={vi.fn()} {...props} />
    </ModalProvider>,
  )
}

/** Deja correr los efectos asincronicos de montaje (fetches del template y de
 *  los sectores) y luego la ventana de debounce del borrador. */
async function settle(ms = 2000) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

function storedDraft() {
  const raw = window.localStorage.getItem(DRAFT_KEY)
  return raw ? JSON.parse(raw) : null
}

describe("OrdenForm — borrador local", () => {
  beforeEach(() => {
    stubFetch()
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

  it("vuelve siempre al primer paso, aunque el borrador se haya guardado en otro", async () => {
    // El paso 2 es donde viven la sena y "presupuesto aceptado": restaurar el
    // paso guardado dejaba esos campos fuera de pantalla y el submit
    // registraba un movimiento de caja por plata que el cliente nunca pago.
    // Arrancar siempre en el paso 1 obliga a pasar por delante de ellos.
    window.localStorage.setItem(
      DRAFT_KEY,
      draftEnvelope({
        currentStep: 3,
        presupuestoAceptado: true,
        sena: "5000",
      }),
    )

    await renderForm()

    expect(screen.getByText(/Paso 1\/3/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/Seña \/ Adelanto/i)).not.toBeInTheDocument()
  })

  it("muestra el selector de Sector/Area de una empresa restaurada desde el borrador", async () => {
    // ClienteSelector re-hidrata su propio display por id pero nunca llama a
    // onChange, asi que el objeto Cliente tiene que venir del borrador: sin el
    // no hay forma de saber que el cliente es una empresa.
    window.localStorage.setItem(
      DRAFT_KEY,
      draftEnvelope({
        form: { ...draftData().form, clienteId: "cli-1" },
        selectedClienteObj: {
          id: "cli-1",
          nombre: "Acme SA",
          telefono: "1122334455",
          tipoCliente: "EMPRESA",
          razonSocial: "Acme SA",
        },
      }),
    )

    await renderForm()

    expect(screen.getByText("Sector / Area")).toBeInTheDocument()
  })
})

describe("OrdenForm — borrador local (ventana de debounce)", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    stubFetch()
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("no guarda nada mientras nadie toque el formulario", async () => {
    await renderForm()
    await settle(5000)

    // Un borrador de valores por defecto hace que la proxima alta arranque con
    // el aviso "se restauró un borrador" sin que haya nada que restaurar.
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull()
  })

  it("guarda el borrador despues de que el usuario escribe", async () => {
    await renderForm()
    await settle(100)

    fireEvent.change(screen.getByPlaceholderText("Modelo o descripcion del equipo"), {
      target: { value: "Moto G restaurable" },
    })
    await settle()

    expect(storedDraft()?.data.form.dispositivo).toBe("Moto G restaurable")
  })

  it("no pierde el checklist ni el sector restaurados cuando cargan los efectos de montaje", async () => {
    window.localStorage.setItem(
      DRAFT_KEY,
      draftEnvelope({
        form: {
          ...draftData().form,
          clienteId: "cli-1",
          tipoDispositivo: "CELULAR",
        },
        selectedClienteObj: {
          id: "cli-1",
          nombre: "Acme SA",
          telefono: "1122334455",
          tipoCliente: "EMPRESA",
          razonSocial: "Acme SA",
        },
        selectedSectorId: "sec-1",
        checklistValores: { pantalla: true },
        checklistNotas: "Rayada",
      }),
    )

    await renderForm()
    await settle()

    // El submit solo manda el checklist si tiene valores, asi que perderlos
    // aca es silencioso: el aviso dice que se restauro y el checklist no se
    // guarda. Se verifica sobre el borrador reescrito porque es el unico lugar
    // donde ese estado (fuera de react-hook-form) es observable.
    fireEvent.change(screen.getByPlaceholderText("Modelo o descripcion del equipo"), {
      target: { value: "iPhone 13 editado" },
    })
    await settle()

    const stored = storedDraft()
    expect(stored?.data.checklistValores).toEqual({ pantalla: true })
    expect(stored?.data.checklistNotas).toBe("Rayada")
    expect(stored?.data.selectedSectorId).toBe("sec-1")
  })

  it("no borra el borrador restaurado cuando se toca el formulario sin cambiar nada", async () => {
    // "Siguiente" esta adentro del <form>, asi que cuenta como interaccion, y
    // el paso NO se persiste: el borrador queda identico al que se acaba de
    // restaurar. Eso se leia como "el usuario deshizo todo" y borraba la
    // entrada mientras el aviso seguia diciendo que se habia restaurado; un
    // cierre de sesion despues de eso se llevaba todo lo cargado.
    window.localStorage.setItem(DRAFT_KEY, draftEnvelope())

    await renderForm()
    await settle(2000)

    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }))
    await settle(2000)

    expect(storedDraft()?.data.form.dispositivo).toBe("iPhone 13 Restaurado")
  })

  it('"Descartar" limpia tambien los campos del paso 2 (no solo los del paso 1)', async () => {
    window.localStorage.setItem(
      DRAFT_KEY,
      draftEnvelope({
        form: {
          ...draftData().form,
          telefonoContacto: "1199999999",
          observaciones: "Observacion descartada",
          notasInternas: "Nota interna descartada",
        },
        currentStep: 2,
      }),
    )

    await renderForm()
    await settle(100)
    fireEvent.click(screen.getByRole("button", { name: /descartar/i }))

    fireEvent.change(screen.getByPlaceholderText("Modelo o descripcion del equipo"), {
      target: { value: "Equipo nuevo" },
    })
    await settle()

    const form = storedDraft()?.data.form
    expect(form.dispositivo).toBe("Equipo nuevo")
    expect(form.telefonoContacto).toBe("")
    expect(form.observaciones).toBe("")
    expect(form.notasInternas).toBe("")
  })
})

/**
 * El alta corre en terminales compartidas de mostrador y el borrador dura 7
 * dias sin borrarse al cerrar sesion: lo que se escribe en localStorage lo lee
 * cualquiera que use el equipo despues. El limite de persistencia (getValue en
 * orden-form.tsx) deja afuera el codigo de acceso del dispositivo y todo dato
 * del cliente que el formulario restaurado no consuma.
 */
describe("OrdenForm — borrador local (datos sensibles)", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    stubFetch()
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("no guarda el paso en el que quedo el formulario", async () => {
    await renderForm()
    await settle(100)

    fireEvent.change(screen.getByPlaceholderText("Modelo o descripcion del equipo"), {
      target: { value: "Moto G" },
    })
    await settle()

    expect(storedDraft()?.data).not.toHaveProperty("currentStep")
  })

  it("nunca escribe el codigo de acceso del dispositivo en el borrador", async () => {
    await renderForm()
    await settle(100)

    fireEvent.change(screen.getByPlaceholderText("Modelo o descripcion del equipo"), {
      target: { value: "Moto G" },
    })
    await settle()

    expect(storedDraft()?.data.form).not.toHaveProperty("codigoAccesoDispositivo")
  })

  it("guarda solo la proyeccion minima del cliente, no la ficha entera", async () => {
    const deepLinkKey = "draft:v2:orden-form:org-1:user-1:new:cliente:cli-1"
    await renderForm({ initialClienteId: "cli-1" })
    await settle()

    fireEvent.change(screen.getByPlaceholderText("Modelo o descripcion del equipo"), {
      target: { value: "Moto G" },
    })
    await settle()

    const raw = window.localStorage.getItem(deepLinkKey)
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw!).data.selectedClienteObj).toEqual({
      id: "cli-1",
      nombre: "Acme SA",
      telefono: "1122334455",
      tipoCliente: "EMPRESA",
      razonSocial: "Acme SA",
    })
    for (const dato of ["contacto@acme.test", "30111222", "30-71111111-9", "Siempreviva"]) {
      expect(raw).not.toContain(dato)
    }
  })
})
