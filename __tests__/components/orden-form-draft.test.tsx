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
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react"
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

const DRAFT_KEY = "draft:v3:orden-form:org-1:user-1:new"

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

/** Respuesta de GET /api/turnos/:id/prefill-orden — los datos con los que el
 *  operador espera encontrarse cuando el alta nace de un turno agendado. */
const TURNO_PREFILL = {
  turnoId: "t-1",
  requiereCrearCliente: false,
  cliente: {
    id: "cli-1",
    nombre: "Acme SA",
    telefono: "1122334455",
    email: "contacto@acme.test",
    direccion: "Av. Siempreviva 742",
    dni: "30111222",
  },
  clienteSnapshot: null,
  orden: {
    clienteId: "cli-1",
    tecnicoId: null,
    tipoDispositivo: "CELULAR",
    dispositivo: "Samsung A54 del turno",
    marca: "Samsung",
    problemaReportado: "No carga",
    observaciones: null,
    telefonoContacto: "1122334455",
    fechaPrometida: "2026-08-25T10:00:00.000Z",
    fotosPrevias: [],
  },
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
      if (url.includes("/api/turnos/t-1/prefill-orden")) {
        return Promise.resolve({ ok: true, json: async () => TURNO_PREFILL } as Response)
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
  return JSON.stringify({ version: 3, savedAt: Date.now(), data: draftData(overrides) })
}

async function renderForm(props: { initialClienteId?: string; fromTurnoId?: string } = {}) {
  const { OrdenForm } = await import("@/components/ordenes/orden-form")
  return render(
    <ModalProvider>
      <OrdenForm onClose={vi.fn()} onSuccess={vi.fn()} {...props} />
    </ModalProvider>,
  )
}

/** "Descartar" pasa por una confirmacion (components/ui/draft-restored-notice.tsx):
 *  un click solo abre el dialogo, el borrador recien se pierde al confirmar. */
async function descartarBorrador() {
  // El dialogo abre en el mismo commit del click, asi que se busca sincronico:
  // findBy* cuelga en los bloques que corren con timers falsos.
  fireEvent.click(screen.getByRole("button", { name: "Descartar" }))
  fireEvent.click(screen.getByRole("button", { name: "Descartar borrador" }))
  // El handler descarta recien cuando resuelve la promesa del dialogo.
  await act(async () => {})
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

    await descartarBorrador()

    expect(screen.queryByText(/se restauró un borrador no guardado/i)).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText("Modelo o descripcion del equipo")).toHaveValue("")
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull()
  })

  it("no muestra el aviso cuando no hay borrador guardado", async () => {
    await renderForm()
    expect(screen.queryByText(/se restauró un borrador no guardado/i)).not.toBeInTheDocument()
  })

  it("vuelve siempre al primer paso, aunque el borrador se haya guardado en otro", async () => {
    // Restaurar el paso guardado deja fuera de pantalla todo lo que se venia
    // cargando: el operador crea la orden sin haber visto nunca los campos de
    // los pasos anteriores. Arrancar siempre en el paso 1 obliga a pasar por
    // delante de ellos.
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

  it("no restaura la seña ni el presupuesto aceptado", async () => {
    // Un borrador no puede reclamar plata. `sena` alimenta un movimiento de
    // caja en el submit y "presupuesto aceptado" es la conformidad que lo
    // habilita: restaurarlos registraba un cobro por plata que el cliente
    // nunca entrego en esta visita. Arrancar en el paso 1 no alcanzaba, dos
    // clicks en "Siguiente" y el submit los mandaba igual. Mismo criterio que
    // `terminosAceptados` en recepcion-form.tsx.
    window.localStorage.setItem(
      DRAFT_KEY,
      draftEnvelope({
        form: {
          ...draftData().form,
          clienteId: "cli-1",
          tipoDispositivo: "CELULAR",
          presupuesto: 15000,
        },
        selectedClienteObj: {
          id: "cli-1",
          nombre: "Acme SA",
          telefono: "1122334455",
          tipoCliente: "EMPRESA",
          razonSocial: "Acme SA",
        },
        presupuestoAceptado: true,
        sena: "5000",
      }),
    )

    await renderForm()
    await screen.findByText(/se restauró un borrador no guardado/i)

    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }))

    await screen.findByText("Presupuesto aceptado al momento")
    expect(screen.getByLabelText(/Presupuesto aceptado al momento/i)).not.toBeChecked()
    expect(screen.queryByLabelText(/Seña \/ Adelanto/i)).not.toBeInTheDocument()
  })

  it("aplica un borrador que aparece despues de que la key cambia de origen", async () => {
    // El mismo agujero que ya se arreglo en cliente-form.tsx: marcar el
    // borrador como "aplicado" ANTES de saber si habia uno deja el latch puesto
    // sin haber aplicado nada. Cuando el hook vuelve a resolver la key (otro
    // turno, una sesion que se cae y vuelve) y encuentra un borrador que otra
    // pestana escribio, este formulario no lo aplica nunca -- pero el hook si lo
    // cuenta como restaurado, asi que el flush siguiente lo pisa con lo que hay
    // en pantalla y el aviso no sale.
    const { OrdenForm } = await import("@/components/ordenes/orden-form")
    const { rerender } = render(
      <ModalProvider>
        <OrdenForm onClose={vi.fn()} onSuccess={vi.fn()} fromTurnoId="t-1" />
      </ModalProvider>,
    )
    await waitFor(() => {
      expect(screen.getByPlaceholderText("Modelo o descripcion del equipo")).toHaveValue(
        "Samsung A54 del turno",
      )
    })

    window.localStorage.setItem("draft:v3:orden-form:org-1:user-1:new:turno:t-2", draftEnvelope())

    rerender(
      <ModalProvider>
        <OrdenForm onClose={vi.fn()} onSuccess={vi.fn()} fromTurnoId="t-2" />
      </ModalProvider>,
    )

    await screen.findByText(/se restauró un borrador no guardado/i)
    expect(screen.getByPlaceholderText("Modelo o descripcion del equipo")).toHaveValue(
      "iPhone 13 Restaurado",
    )
  })

  it("cambia de borrador cuando el alta pasa de un turno a otro sin desmontarse", async () => {
    // `fromTurno` / `clienteId` salen de useSearchParams (ordenes-list.tsx) y
    // el overlay se queda montado, asi que abrir el alta de otro turno desde la
    // agenda cambia el `scope` del hook sin remontar este componente. Un latch
    // booleano se queda pegado en el primer borrador: el segundo no se aplica
    // nunca aunque el hook lo cuente como restaurado, y el flush siguiente lo
    // pisa con lo que quedo en pantalla del turno anterior. Por eso el latch va
    // por scope, igual que en cliente-form.tsx.
    window.localStorage.setItem(
      "draft:v3:orden-form:org-1:user-1:new:turno:t-1",
      draftEnvelope({ form: { ...draftData().form, dispositivo: "Borrador del turno 1" } }),
    )
    window.localStorage.setItem(
      "draft:v3:orden-form:org-1:user-1:new:turno:t-2",
      draftEnvelope({ form: { ...draftData().form, dispositivo: "Borrador del turno 2" } }),
    )

    const { OrdenForm } = await import("@/components/ordenes/orden-form")
    const { rerender } = render(
      <ModalProvider>
        <OrdenForm onClose={vi.fn()} onSuccess={vi.fn()} fromTurnoId="t-1" />
      </ModalProvider>,
    )
    expect(screen.getByPlaceholderText("Modelo o descripcion del equipo")).toHaveValue(
      "Borrador del turno 1",
    )

    rerender(
      <ModalProvider>
        <OrdenForm onClose={vi.fn()} onSuccess={vi.fn()} fromTurnoId="t-2" />
      </ModalProvider>,
    )

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Modelo o descripcion del equipo")).toHaveValue(
        "Borrador del turno 2",
      )
    })
  })

  it("baja el aviso cuando el alta pasa a un turno que no tiene borrador", async () => {
    // Mismo cambio de key sin desmontar que el test de arriba, pero el turno
    // nuevo no tiene nada guardado: no se restaura ningun borrador y el aviso
    // se quedaba en pantalla anunciando el del turno anterior. Con "Descartar"
    // al lado, que corre el descarte entero (reset del formulario, firma,
    // fotos, checklist) sobre un borrador que este formulario nunca aplico.
    window.localStorage.setItem(
      "draft:v3:orden-form:org-1:user-1:new:turno:t-1",
      draftEnvelope({ form: { ...draftData().form, dispositivo: "Borrador del turno 1" } }),
    )

    const { OrdenForm } = await import("@/components/ordenes/orden-form")
    const { rerender } = render(
      <ModalProvider>
        <OrdenForm onClose={vi.fn()} onSuccess={vi.fn()} fromTurnoId="t-1" />
      </ModalProvider>,
    )
    expect(screen.getByText(/se restauró un borrador no guardado/i)).toBeInTheDocument()

    rerender(
      <ModalProvider>
        <OrdenForm onClose={vi.fn()} onSuccess={vi.fn()} fromTurnoId="t-2" />
      </ModalProvider>,
    )

    await waitFor(() => {
      expect(screen.queryByText(/se restauró un borrador no guardado/i)).not.toBeInTheDocument()
    })
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

  it("no arrastra al alta de mostrador los valores del turno anterior", async () => {
    // El overlay del listado no se remonta (ordenes-list.tsx solo hace
    // setShowForm(true)) y `fromTurno` sale de useSearchParams: volver con el
    // boton Atras deja este formulario con los datos del turno en pantalla
    // mientras la key del hook ya es la del alta de mostrador. Eso no es solo
    // cosmetico -- la primera tecla persiste los valores del turno bajo el
    // borrador del mostrador, que es otra orden, de otro cliente.
    const { OrdenForm } = await import("@/components/ordenes/orden-form")
    const { rerender } = render(
      <ModalProvider>
        <OrdenForm onClose={vi.fn()} onSuccess={vi.fn()} fromTurnoId="t-1" />
      </ModalProvider>,
    )
    await settle()
    expect(screen.getByPlaceholderText("Modelo o descripcion del equipo")).toHaveValue(
      "Samsung A54 del turno",
    )

    rerender(
      <ModalProvider>
        <OrdenForm onClose={vi.fn()} onSuccess={vi.fn()} />
      </ModalProvider>,
    )
    await settle()

    expect(screen.getByPlaceholderText("Modelo o descripcion del equipo")).toHaveValue("")
    expect(screen.getByPlaceholderText("Describa el problema del equipo...")).toHaveValue("")

    fireEvent.change(screen.getByPlaceholderText("Modelo o descripcion del equipo"), {
      target: { value: "Moto G de mostrador" },
    })
    await settle()

    const stored = storedDraft()
    expect(stored?.data.form.dispositivo).toBe("Moto G de mostrador")
    expect(stored?.data.form.problemaReportado).toBe("")
    expect(stored?.data.form.marca).toBe("")
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
        // El template contra el que se escribieron: sigue siendo el que el
        // servidor devuelve para este tipo de equipo, asi que las respuestas
        // son validas y tienen que sobrevivir.
        checklistTemplateId: "tpl-1",
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

  it("descarta las respuestas del checklist cuando el template del tipo de equipo cambio", async () => {
    // Las respuestas se indexan por id de item del template, pero el template
    // no se persiste: al restaurar se vuelve a pedir por tipo de equipo. Si la
    // organizacion lo edito o lo reemplazo dentro de los 7 dias de vida del
    // borrador, las claves restauradas ya no corresponden a ningun item: el
    // checklist se dibuja vacio y el POST /api/ordenes/{id}/checklist manda
    // igual esas claves viejas bajo el templateId nuevo.
    window.localStorage.setItem(
      DRAFT_KEY,
      draftEnvelope({
        form: { ...draftData().form, tipoDispositivo: "CELULAR" },
        checklistTemplateId: "tpl-de-otra-epoca",
        checklistValores: { "item-que-ya-no-existe": true },
        checklistNotas: "Rayada",
      }),
    )

    await renderForm()
    await settle()

    fireEvent.change(screen.getByPlaceholderText("Modelo o descripcion del equipo"), {
      target: { value: "iPhone 13 editado" },
    })
    await settle()

    const stored = storedDraft()
    expect(stored?.data.checklistValores).toEqual({})
    expect(stored?.data.checklistTemplateId).toBe("tpl-1")
    // Las notas son texto libre, no estan indexadas por item: sobreviven.
    expect(stored?.data.checklistNotas).toBe("Rayada")
  })

  it("descarta las respuestas restauradas de un tipo de equipo que ya no existe", async () => {
    // El tipo con el que se respondio el checklist no esta mas en la lista de
    // la organizacion, asi que `tipoSeleccionado` no resuelve nunca: el
    // descarte vivia en el efecto del template, que con estas dependencias
    // corre una sola vez al montar. Las respuestas quedaban en el formulario y
    // el submit las mandaba bajo el template por defecto, que tiene otros
    // items.
    window.localStorage.setItem(
      DRAFT_KEY,
      draftEnvelope({
        form: { ...draftData().form, tipoDispositivo: "TABLET" },
        checklistTemplateId: "tpl-de-otra-epoca",
        checklistValores: { "item-que-ya-no-existe": true },
        checklistNotas: "Rayada",
      }),
    )

    await renderForm()
    await settle()

    fireEvent.change(screen.getByPlaceholderText("Modelo o descripcion del equipo"), {
      target: { value: "iPhone 13 editado" },
    })
    await settle()

    const stored = storedDraft()
    expect(stored?.data.checklistValores).toEqual({})
    // Las notas son texto libre, no estan indexadas por item: sobreviven.
    expect(stored?.data.checklistNotas).toBe("Rayada")
  })

  it("descarta las respuestas restauradas cuando no se pudo traer el template del tipo", async () => {
    // El descarte vivia adentro del `if (res.ok)`: con el endpoint caido, las
    // respuestas del borrador seguian en el formulario y el submit las mandaba
    // bajo el template que hubiera quedado en pantalla (el default de la
    // organizacion, que no es el que las respondio).
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes("by-device-type?tipoDispositivoId=")) {
          return Promise.resolve({ ok: false, status: 500, json: async () => ({}) } as Response)
        }
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
        return Promise.resolve({ ok: true, json: async () => [] } as Response)
      }),
    )
    window.localStorage.setItem(
      DRAFT_KEY,
      draftEnvelope({
        form: { ...draftData().form, tipoDispositivo: "CELULAR" },
        checklistTemplateId: "tpl-de-otra-epoca",
        checklistValores: { "item-que-ya-no-existe": true },
        checklistNotas: "Rayada",
      }),
    )

    await renderForm()
    await settle()

    fireEvent.change(screen.getByPlaceholderText("Modelo o descripcion del equipo"), {
      target: { value: "iPhone 13 editado" },
    })
    await settle()

    expect(storedDraft()?.data.checklistValores).toEqual({})
  })

  it("re-estampa las respuestas restauradas con SU template, no con el que hay en pantalla", async () => {
    // Entre el restore y la llegada del template del tipo de equipo hay una
    // ventana en la que las respuestas en pantalla son las que restauro el
    // borrador pero `checklistTemplate` es cualquier otra cosa: el default de
    // la organizacion cuando el tipo resuelve tarde, o directamente null como
    // aca, porque el fetch del montaje se cancela al cambiar el tipo con el
    // restore. Un flush ahi adentro -- que es justo lo que este hook existe
    // para cubrir: se cae la sesion, se cierra la pestana -- reescribia el
    // borrador estampandole ESE templateId. En la apertura siguiente las
    // respuestas figuran como de un template que no es el suyo, asi que el
    // guard de respuestas huerfanas las tira: respuestas validas perdidas, en
    // silencio, por el mecanismo puesto para protegerlas.
    let entregarTemplateDelTipo: ((res: Response) => void) | undefined
    const templateDelTipo = new Promise<Response>((resolve) => {
      entregarTemplateDelTipo = resolve
    })
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes("by-device-type?tipoDispositivoId=")) return templateDelTipo
        if (url.includes("/api/checklist-templates/by-device-type")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              template: {
                id: "tpl-default-org",
                nombre: "Ingreso generico",
                items: [{ id: "generico", label: "Generico", tipo: "BOOLEAN" }],
              },
            }),
          } as Response)
        }
        return Promise.resolve({ ok: true, json: async () => [] } as Response)
      }),
    )
    window.localStorage.setItem(
      DRAFT_KEY,
      draftEnvelope({
        form: { ...draftData().form, tipoDispositivo: "CELULAR" },
        checklistTemplateId: "tpl-celular",
        checklistValores: { espejo: true },
      }),
    )

    await renderForm()
    await settle()

    // Dentro de la ventana: el template del tipo todavia no llego.
    fireEvent.change(screen.getByPlaceholderText("Modelo o descripcion del equipo"), {
      target: { value: "iPhone 13 editado en la ventana" },
    })
    await settle()

    expect(storedDraft()?.data.checklistValores).toEqual({ espejo: true })
    expect(storedDraft()?.data.checklistTemplateId).toBe("tpl-celular")

    // Y cuando el template del tipo por fin llega y resulta ser el mismo con el
    // que se respondio, las respuestas se conservan y el estampado sigue igual.
    entregarTemplateDelTipo!({
      ok: true,
      json: async () => ({
        template: {
          id: "tpl-celular",
          nombre: "Ingreso celular",
          items: [{ id: "espejo", label: "Espejo", tipo: "BOOLEAN" }],
        },
      }),
    } as Response)
    await settle()

    fireEvent.change(screen.getByPlaceholderText("Modelo o descripcion del equipo"), {
      target: { value: "iPhone 13 editado despues" },
    })
    await settle()

    expect(storedDraft()?.data.checklistValores).toEqual({ espejo: true })
    expect(storedDraft()?.data.checklistTemplateId).toBe("tpl-celular")
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

  it('"Descartar" repone el "Recibido por" que corresponde por defecto', async () => {
    // El efecto que preselecciona al operador depende solo de la sesion, y
    // descartar no la mueve: poner "" a mano dejaba "Sin asignar" para el
    // resto de la sesion, cuando descartar tiene que dejar el alta como recien
    // abierta. Se verifica sobre el borrador reescrito porque ese estado vive
    // fuera de react-hook-form y el selector solo se renderiza cuando hay
    // operadores cargados.
    window.localStorage.setItem(DRAFT_KEY, draftEnvelope({ selectedRecibidoPorId: "" }))

    await renderForm()
    await settle(100)
    await descartarBorrador()

    fireEvent.change(screen.getByPlaceholderText("Modelo o descripcion del equipo"), {
      target: { value: "Equipo nuevo" },
    })
    await settle()

    expect(storedDraft()?.data.selectedRecibidoPorId).toBe("user-1")
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
    await descartarBorrador()

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
 * Un alta que nace de un turno agendado (o de un deep-link ?clienteId=) llega
 * con datos precargados. Si ademas hay un borrador de ESE mismo origen, el
 * borrador gana y el prefill queda solo para el aviso de "crear cliente" — pero
 * descartar el borrador tiene que devolver el formulario al estado precargado,
 * no dejarlo en blanco: el operador no tiene de donde sacar de nuevo los datos
 * del turno salvo recargando la pagina.
 */
describe("OrdenForm — borrador de una orden nacida de un turno", () => {
  const TURNO_DRAFT_KEY = "draft:v3:orden-form:org-1:user-1:new:turno:t-1"

  beforeEach(() => {
    stubFetch()
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function turnoDraftEnvelope() {
    return draftEnvelope({
      form: {
        ...draftData().form,
        dispositivo: "Lo que el operador venia cargando",
        problemaReportado: "Nota a medio escribir",
      },
    })
  }

  it("precarga los datos del turno cuando no hay borrador", async () => {
    await renderForm({ fromTurnoId: "t-1" })

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Modelo o descripcion del equipo")).toHaveValue(
        "Samsung A54 del turno",
      )
    })
    expect(screen.getByPlaceholderText("Describa el problema del equipo...")).toHaveValue(
      "No carga",
    )
  })

  it("restaura el borrador del turno en vez de pisarlo con el prefill", async () => {
    window.localStorage.setItem(TURNO_DRAFT_KEY, turnoDraftEnvelope())

    await renderForm({ fromTurnoId: "t-1" })
    await screen.findByText(/se restauró un borrador no guardado/i)

    await waitFor(() => {
      expect(screen.getByText(/Origen: turno agendado/)).toBeInTheDocument()
    })
    expect(screen.getByPlaceholderText("Modelo o descripcion del equipo")).toHaveValue(
      "Lo que el operador venia cargando",
    )
  })

  it('"Descartar" vuelve a los datos del turno, no a un formulario vacio', async () => {
    // El prefill corre en modo "solo aviso" cuando hay borrador, y los dos
    // efectos que lo aplican dependen de [fromTurnoId, draftReady]: descartar
    // no cambia ninguna de las dos, asi que nada los volvia a correr y el
    // operador se quedaba con el alta entera en blanco.
    window.localStorage.setItem(TURNO_DRAFT_KEY, turnoDraftEnvelope())

    await renderForm({ fromTurnoId: "t-1" })
    await screen.findByText(/se restauró un borrador no guardado/i)

    await descartarBorrador()

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Modelo o descripcion del equipo")).toHaveValue(
        "Samsung A54 del turno",
      )
    })
    expect(screen.getByPlaceholderText("Describa el problema del equipo...")).toHaveValue(
      "No carga",
    )
    expect(window.localStorage.getItem(TURNO_DRAFT_KEY)).toBeNull()
  })

  it('"Descartar" mantiene el cliente del deep-link (?clienteId=)', async () => {
    // Mismo agujero por el otro camino: el efecto del deep-link tampoco vuelve
    // a correr, y sin cliente el alta no puede ni empezar a cargarse.
    const deepLinkKey = "draft:v3:orden-form:org-1:user-1:new:cliente:cli-1"
    window.localStorage.setItem(deepLinkKey, turnoDraftEnvelope())

    await renderForm({ initialClienteId: "cli-1" })
    await screen.findByText(/se restauró un borrador no guardado/i)

    await descartarBorrador()

    // "Sector / Area" solo aparece cuando el formulario tiene el clienteId Y el
    // objeto del cliente (que es una empresa): es la senal de que el deep-link
    // volvio a aplicarse entero.
    await waitFor(() => {
      expect(screen.getByText("Sector / Area")).toBeInTheDocument()
    })
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

  it("nunca escribe la seña ni el presupuesto aceptado en el borrador", async () => {
    // Lo que no se guarda no se puede restaurar: es la unica garantia real de
    // que un borrador no reclame un cobro que nadie hizo.
    await renderForm()
    await settle(100)

    fireEvent.change(screen.getByPlaceholderText("Modelo o descripcion del equipo"), {
      target: { value: "Moto G" },
    })
    await settle()

    expect(storedDraft()?.data).not.toHaveProperty("sena")
    expect(storedDraft()?.data).not.toHaveProperty("presupuestoAceptado")
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
    const deepLinkKey = "draft:v3:orden-form:org-1:user-1:new:cliente:cli-1"
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
