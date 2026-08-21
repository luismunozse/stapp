/**
 * Cubre el wiring de useFormDraft (hooks/use-form-draft.ts) dentro de
 * RecepcionForm: un borrador valido en localStorage se restaura al montar,
 * se avisa con un banner dismissible, y "Descartar" borra el borrador y
 * vuelve el formulario a su estado en blanco.
 *
 * Mismos mocks que recepcion-form-equipo-sync.test.tsx (ClienteSelector y
 * SignaturePad no son relevantes aca) mas next-auth/react con una sesion
 * real: useFormDraft necesita userId/organizationId para resolver la key.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react"
import { ModalProvider } from "@/contexts/modal-context"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

/** Sesion mutable: el unico disparador que tiene esta pantalla para que el hook
 *  vuelva a resolver su key es que la sesion se caiga y vuelva (no tiene props
 *  de origen ni modo edicion). */
const sesion = vi.hoisted(() => ({
  actual: { user: { id: "user-1", organizationId: "org-1" } } as unknown,
}))
const SESION_ACTIVA = { user: { id: "user-1", organizationId: "org-1" } }

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: sesion.actual }),
}))

vi.mock("@/hooks/use-tipos-dispositivo", () => ({
  useTiposDispositivo: () => ({
    tipos: [
      {
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

/** Cliente completo tal como lo entrega el buscador real: el stub dispara
 *  onChange con TODO el objeto para poder verificar que solo una proyeccion
 *  minima llega a localStorage. */
const CLIENTE_COMPLETO = {
  id: "cli-1",
  nombre: "Acme SA",
  telefono: "1155667788",
  email: "contacto@acme.test",
  dni: "30111222",
  cuit: "30-71111111-9",
  direccion: "Av. Siempreviva 742",
  tipoCliente: "EMPRESA",
  razonSocial: "Acme SA",
}

vi.mock("@/components/cotizaciones/cliente-selector", () => ({
  ClienteSelector: ({
    onChange,
  }: {
    onChange: (id: string | null, cliente: unknown) => void
  }) => (
    <button type="button" onClick={() => onChange(CLIENTE_COMPLETO.id, CLIENTE_COMPLETO)}>
      Elegir cliente
    </button>
  ),
}))

vi.mock("@/components/firma/signature-pad", () => ({
  SignaturePad: ({
    onSignatureChange,
  }: {
    onSignatureChange: (data: string | null, mime: string | null) => void
  }) => (
    <button type="button" onClick={() => onSignatureChange("FIRMA_BASE64", "image/png")}>
      Firmar
    </button>
  ),
}))

const DRAFT_KEY = "draft:v2:recepcion-form:org-1:user-1:new"

async function renderForm() {
  const { RecepcionForm } = await import("@/components/ordenes/recepcion-form")
  return render(
    <ModalProvider>
      <RecepcionForm />
    </ModalProvider>,
  )
}

describe("RecepcionForm — borrador local", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, json: async () => [] } as Response)))
    window.localStorage.clear()
    sesion.actual = SESION_ACTIVA
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("restaura un borrador valido y muestra el aviso dismissible", async () => {
    window.localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        version: 2,
        savedAt: Date.now(),
        data: {
          form: {
            clienteId: "",
            telefonoContacto: "1122334455",
            observaciones: "Trajo cargador",
            equipos: [
              {
                dispositivo: "iPhone 13",
                tipoDispositivo: "CELULAR",
                marca: "",
                color: "",
                imei: "",
                problemaReportado: "No enciende",
                codigoAccesoDispositivo: "",
              },
              {
                dispositivo: "",
                tipoDispositivo: "",
                marca: "",
                color: "",
                imei: "",
                problemaReportado: "",
                codigoAccesoDispositivo: "",
              },
            ],
          },
          sideState: [
            { accesoriosSeleccionados: [], otroAccesorio: "", camposExtraValues: {} },
            { accesoriosSeleccionados: [], otroAccesorio: "", camposExtraValues: {} },
          ],
          terminosAceptados: false,
        },
      }),
    )

    await renderForm()

    expect(screen.getByText(/se restauró un borrador no guardado/i)).toBeInTheDocument()
    expect(screen.getByPlaceholderText("Numero alternativo")).toHaveValue("1122334455")
    expect(screen.getAllByPlaceholderText("Ej: iPhone 13")[0]).toHaveValue("iPhone 13")
  })

  it('"Descartar" borra el borrador y limpia el formulario', async () => {
    window.localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        version: 2,
        savedAt: Date.now(),
        data: {
          form: {
            clienteId: "",
            telefonoContacto: "1122334455",
            observaciones: "",
            equipos: [
              {
                dispositivo: "iPhone 13",
                tipoDispositivo: "",
                marca: "",
                color: "",
                imei: "",
                problemaReportado: "",
                codigoAccesoDispositivo: "",
              },
              {
                dispositivo: "",
                tipoDispositivo: "",
                marca: "",
                color: "",
                imei: "",
                problemaReportado: "",
                codigoAccesoDispositivo: "",
              },
            ],
          },
          sideState: [
            { accesoriosSeleccionados: [], otroAccesorio: "", camposExtraValues: {} },
            { accesoriosSeleccionados: [], otroAccesorio: "", camposExtraValues: {} },
          ],
          terminosAceptados: false,
        },
      }),
    )

    await renderForm()
    expect(screen.getByPlaceholderText("Numero alternativo")).toHaveValue("1122334455")

    fireEvent.click(screen.getByRole("button", { name: /descartar/i }))

    expect(screen.queryByText(/se restauró un borrador no guardado/i)).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText("Numero alternativo")).toHaveValue("")
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull()
  })

  it("no muestra el aviso cuando no hay borrador guardado", async () => {
    await renderForm()
    expect(screen.queryByText(/se restauró un borrador no guardado/i)).not.toBeInTheDocument()
  })

  it("aplica un borrador que aparece despues de que la sesion se recupera", async () => {
    // El mismo agujero que ya se arreglo en cliente-form.tsx: marcar el
    // borrador como "aplicado" ANTES de saber si habia uno deja el latch puesto
    // sin haber aplicado nada. Al recuperarse la sesion el hook vuelve a
    // resolver la key y encuentra el borrador que otra pestana dejo en el
    // hueco; esta pantalla no lo aplica nunca, pero el hook si lo cuenta como
    // restaurado, asi que el flush siguiente lo pisa con el formulario en
    // blanco que hay en pantalla.
    const { RecepcionForm } = await import("@/components/ordenes/recepcion-form")
    const { rerender } = render(
      <ModalProvider>
        <RecepcionForm />
      </ModalProvider>,
    )
    expect(screen.getByPlaceholderText("Numero alternativo")).toHaveValue("")

    sesion.actual = null
    rerender(
      <ModalProvider>
        <RecepcionForm />
      </ModalProvider>,
    )

    window.localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        version: 2,
        savedAt: Date.now(),
        data: {
          form: {
            clienteId: "",
            telefonoContacto: "1199887766",
            observaciones: "",
            equipos: [
              {
                dispositivo: "Escrito en la otra pestana",
                tipoDispositivo: "",
                marca: "",
                color: "",
                imei: "",
                problemaReportado: "",
                codigoAccesoDispositivo: "",
              },
              {
                dispositivo: "",
                tipoDispositivo: "",
                marca: "",
                color: "",
                imei: "",
                problemaReportado: "",
                codigoAccesoDispositivo: "",
              },
            ],
          },
          sideState: [
            { accesoriosSeleccionados: [], otroAccesorio: "", camposExtraValues: {} },
            { accesoriosSeleccionados: [], otroAccesorio: "", camposExtraValues: {} },
          ],
        },
      }),
    )

    sesion.actual = SESION_ACTIVA
    rerender(
      <ModalProvider>
        <RecepcionForm />
      </ModalProvider>,
    )

    await screen.findByText(/se restauró un borrador no guardado/i)
    expect(screen.getAllByPlaceholderText("Ej: iPhone 13")[0]).toHaveValue(
      "Escrito en la otra pestana",
    )
  })

  it("un borrador con forma invalida no rompe la pantalla", async () => {
    // DRAFT_SCHEMA_VERSION se mantiene a mano: un cambio en RecepcionFormData
    // sin bumpearla deja borradores de hasta 7 dias con otra forma. Recorrerlos
    // tira un TypeError adentro de un efecto y eso deja la pantalla de
    // recepcion en blanco, sin forma de salir que no sea la consola.
    window.localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        version: 2,
        savedAt: Date.now(),
        data: { form: { clienteId: "cli-1", telefonoContacto: "" }, sideState: null },
      }),
    )

    await renderForm()

    expect(screen.getAllByPlaceholderText("Ej: iPhone 13")).toHaveLength(2)
    expect(screen.queryByText(/se restauró un borrador no guardado/i)).not.toBeInTheDocument()
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull()
  })

  it("no da por aceptados los terminos al restaurar: la firma que los respalda no se guarda", async () => {
    window.localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        version: 2,
        savedAt: Date.now(),
        data: {
          form: {
            clienteId: "cli-1",
            telefonoContacto: "",
            observaciones: "",
            equipos: [
              {
                dispositivo: "iPhone 13",
                tipoDispositivo: "CELULAR",
                marca: "",
                color: "",
                imei: "",
                problemaReportado: "No enciende",
              },
              {
                dispositivo: "Moto G",
                tipoDispositivo: "CELULAR",
                marca: "",
                color: "",
                imei: "",
                problemaReportado: "Bateria",
              },
            ],
          },
          sideState: [
            { accesoriosSeleccionados: [], otroAccesorio: "", camposExtraValues: {} },
            { accesoriosSeleccionados: [], otroAccesorio: "", camposExtraValues: {} },
          ],
          terminosAceptados: true,
          selectedCliente: null,
        },
      }),
    )

    await renderForm()

    // El POST manda terminosAceptados junto a firmaCliente: sin la firma (que
    // el borrador no persiste) la conformidad no tiene con que respaldarse.
    expect(screen.getByRole("checkbox")).not.toBeChecked()
  })

  it("restaura el cliente elegido, no solo su id", async () => {
    // ClienteSelector re-hidrata su propio display a partir del id pero nunca
    // llama a onChange, asi que sin el objeto en el borrador el comprobante de
    // la recepcion creada sale con el nombre del cliente en blanco. El
    // placeholder del telefono de contacto es la unica parte del formulario
    // que refleja ese objeto sin llegar a enviar la recepcion.
    window.localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        version: 2,
        savedAt: Date.now(),
        data: {
          form: {
            clienteId: "cli-1",
            telefonoContacto: "",
            observaciones: "",
            equipos: [
              {
                dispositivo: "iPhone 13",
                tipoDispositivo: "",
                marca: "",
                color: "",
                imei: "",
                problemaReportado: "",
                codigoAccesoDispositivo: "",
              },
              {
                dispositivo: "",
                tipoDispositivo: "",
                marca: "",
                color: "",
                imei: "",
                problemaReportado: "",
                codigoAccesoDispositivo: "",
              },
            ],
          },
          sideState: [
            { accesoriosSeleccionados: [], otroAccesorio: "", camposExtraValues: {} },
            { accesoriosSeleccionados: [], otroAccesorio: "", camposExtraValues: {} },
          ],
          terminosAceptados: false,
          selectedCliente: { id: "cli-1", nombre: "Acme SA", telefono: "1155667788" },
        },
      }),
    )

    await renderForm()

    expect(screen.getByPlaceholderText("1155667788")).toBeInTheDocument()
  })

  it("mantiene fields y sideState alineados al quitar un equipo de un borrador restaurado", async () => {
    // recepcion-form-equipo-sync.test.tsx cubre el mismo riesgo sobre un
    // formulario en blanco. El restore es el otro camino que puede desalinear
    // los dos arrays: rehidrata react-hook-form con reset() y sideState con un
    // setState aparte, y de ahi en mas agregar/quitar tiene que seguir tocando
    // los dos en el mismo indice.
    const equipo = (dispositivo: string) => ({
      dispositivo,
      tipoDispositivo: "",
      marca: "",
      color: "",
      imei: "",
      problemaReportado: "",
      codigoAccesoDispositivo: "",
    })
    window.localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        version: 2,
        savedAt: Date.now(),
        data: {
          form: {
            clienteId: "",
            telefonoContacto: "",
            observaciones: "",
            equipos: [equipo("Equipo A"), equipo("Equipo B"), equipo("Equipo C")],
          },
          sideState: [
            { accesoriosSeleccionados: [], otroAccesorio: "Acc A", camposExtraValues: {} },
            { accesoriosSeleccionados: [], otroAccesorio: "Acc B", camposExtraValues: {} },
            { accesoriosSeleccionados: [], otroAccesorio: "Acc C", camposExtraValues: {} },
          ],
          terminosAceptados: false,
          selectedCliente: null,
        },
      }),
    )

    await renderForm()

    const dispositivos = () => screen.getAllByPlaceholderText("Ej: iPhone 13")
    // El input de "otro accesorio" es el que refleja sideState directamente:
    // useFieldArray ya reindexa sus propios campos por si solo.
    const accesorios = () => screen.getAllByPlaceholderText("Otro accesorio...")

    expect(dispositivos()).toHaveLength(3)
    expect(accesorios()[2]).toHaveValue("Acc C")

    fireEvent.click(screen.getByRole("button", { name: /Agregar otro equipo/i }))
    expect(dispositivos()).toHaveLength(4)
    fireEvent.change(dispositivos()[3], { target: { value: "Equipo D" } })
    fireEvent.change(accesorios()[3], { target: { value: "Acc D" } })

    fireEvent.click(screen.getByRole("button", { name: "Quitar equipo 1" }))

    expect(dispositivos().map((i) => (i as HTMLInputElement).value)).toEqual([
      "Equipo B",
      "Equipo C",
      "Equipo D",
    ])
    expect(accesorios().map((i) => (i as HTMLInputElement).value)).toEqual([
      "Acc B",
      "Acc C",
      "Acc D",
    ])
  })
})

/**
 * "Descartar" tiene que dejar el formulario como recien abierto. Lo que no se
 * limpia sobrevive al descarte y termina viajando con la recepcion del
 * siguiente cliente, que es un dato de otra persona en un comprobante ajeno.
 */
describe("RecepcionForm — descartar un borrador", () => {
  let requests: Array<{ url: string; body: any }>

  beforeEach(() => {
    requests = []
    window.localStorage.clear()
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.includes("/api/recepciones")) {
          requests.push({ url, body: JSON.parse(String(init?.body ?? "{}")) })
          // 202 = encolada offline: el formulario corta ahi, sin modal de
          // exito que montar. El payload ya se armo, que es lo que se verifica.
          return Promise.resolve({ ok: true, status: 202, json: async () => ({ _offline: true }) } as Response)
        }
        return Promise.resolve({ ok: true, json: async () => [] } as Response)
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("no arrastra la firma del cliente anterior a la recepcion siguiente", async () => {
    const equipo = (dispositivo: string) => ({
      dispositivo,
      tipoDispositivo: "CELULAR",
      marca: "",
      color: "",
      imei: "",
      problemaReportado: "No enciende",
    })
    window.localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        version: 2,
        savedAt: Date.now(),
        data: {
          form: {
            clienteId: "cli-0",
            telefonoContacto: "",
            observaciones: "",
            equipos: [equipo("Equipo del cliente X"), equipo("Otro del cliente X")],
          },
          sideState: [
            { accesoriosSeleccionados: [], otroAccesorio: "", camposExtraValues: {} },
            { accesoriosSeleccionados: [], otroAccesorio: "", camposExtraValues: {} },
          ],
          selectedCliente: { nombre: "Cliente X", telefono: "1100000000" },
        },
      }),
    )

    const { container } = await renderForm()

    // El cliente X firma la conformidad y despues se descarta todo.
    fireEvent.click(screen.getByRole("button", { name: "Firmar" }))
    fireEvent.click(screen.getByRole("button", { name: /descartar/i }))

    // Recepcion nueva, cliente distinto: nadie volvio a firmar.
    fireEvent.click(screen.getByRole("button", { name: "Elegir cliente" }))
    for (const i of [0, 1]) {
      fireEvent.click(screen.getAllByRole("button", { name: "Celular" })[i])
      fireEvent.change(screen.getAllByPlaceholderText("Ej: iPhone 13")[i], {
        target: { value: `Equipo ${i + 1} del cliente Y` },
      })
      fireEvent.change(container.querySelector(`[name="equipos.${i}.problemaReportado"]`)!, {
        target: { value: "Pantalla rota" },
      })
    }
    fireEvent.click(screen.getByRole("checkbox"))
    fireEvent.click(screen.getByRole("button", { name: /Crear recepci/i }))

    await waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0].body.firmaCliente).toBeUndefined()
    expect(requests[0].body.firmaMime).toBeUndefined()
  })
})

/**
 * Estas pantallas viven en terminales compartidas de mostrador y el borrador
 * dura 7 dias sin borrarse al cerrar sesion: lo que se escribe en
 * localStorage lo lee cualquiera que use el equipo despues. El limite de
 * persistencia (getValue en recepcion-form.tsx) tiene que dejar afuera el
 * codigo de acceso del dispositivo y todo dato del cliente que el formulario
 * restaurado no necesite.
 */
describe("RecepcionForm — borrador local (datos sensibles)", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, json: async () => [] } as Response)))
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  async function settle(ms = 2000) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })
  }

  function storedDraft() {
    const raw = window.localStorage.getItem(DRAFT_KEY)
    return raw ? JSON.parse(raw) : null
  }

  it("nunca escribe el codigo de acceso del dispositivo en el borrador", async () => {
    await renderForm()
    await settle(100)

    fireEvent.click(screen.getAllByRole("button", { name: /Agregar código de acceso/i })[0])
    fireEvent.change(screen.getByPlaceholderText("Ej: 1234"), {
      target: { value: "998877" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }))
    fireEvent.change(screen.getAllByPlaceholderText("Ej: iPhone 13")[0], {
      target: { value: "iPhone 13" },
    })
    await settle()

    const raw = window.localStorage.getItem(DRAFT_KEY)
    expect(raw).not.toBeNull()
    expect(raw).not.toContain("998877")
    expect(storedDraft().data.form.equipos[0]).not.toHaveProperty("codigoAccesoDispositivo")
  })

  it("no restaura el codigo de acceso guardado por un borrador viejo", async () => {
    const equipo = (dispositivo: string) => ({
      dispositivo,
      tipoDispositivo: "",
      marca: "",
      color: "",
      imei: "",
      problemaReportado: "",
      codigoAccesoDispositivo: "998877",
    })
    window.localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        version: 2,
        savedAt: Date.now(),
        data: {
          form: {
            clienteId: "",
            telefonoContacto: "",
            observaciones: "",
            equipos: [equipo("Equipo A"), equipo("Equipo B")],
          },
          sideState: [
            { accesoriosSeleccionados: [], otroAccesorio: "", camposExtraValues: {} },
            { accesoriosSeleccionados: [], otroAccesorio: "", camposExtraValues: {} },
          ],
          selectedCliente: null,
        },
      }),
    )

    await renderForm()
    await settle(100)

    expect(screen.getAllByPlaceholderText("Ej: iPhone 13")[0]).toHaveValue("Equipo A")
    expect(screen.queryAllByLabelText(/Editar código de acceso/i)).toHaveLength(0)
  })

  it("guarda solo el nombre y el telefono del cliente elegido", async () => {
    await renderForm()
    await settle(100)

    fireEvent.click(screen.getByRole("button", { name: "Elegir cliente" }))
    await settle()

    const raw = window.localStorage.getItem(DRAFT_KEY)
    expect(raw).not.toBeNull()
    expect(storedDraft().data.selectedCliente).toEqual({
      nombre: "Acme SA",
      telefono: "1155667788",
    })
    for (const dato of ["contacto@acme.test", "30111222", "30-71111111-9", "Siempreviva"]) {
      expect(raw).not.toContain(dato)
    }
  })
})
