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
import { render, screen, fireEvent } from "@testing-library/react"
import { ModalProvider } from "@/contexts/modal-context"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "user-1", organizationId: "org-1" } } }),
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

vi.mock("@/components/cotizaciones/cliente-selector", () => ({
  ClienteSelector: () => <div data-testid="cliente-selector-stub" />,
}))

vi.mock("@/components/firma/signature-pad", () => ({
  SignaturePad: () => <div data-testid="signature-pad-stub" />,
}))

const DRAFT_KEY = "draft:v1:recepcion-form:org-1:user-1:new"

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
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("restaura un borrador valido y muestra el aviso dismissible", async () => {
    window.localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        version: 1,
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
        version: 1,
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

  it("restaura el cliente elegido, no solo su id", async () => {
    // ClienteSelector re-hidrata su propio display a partir del id pero nunca
    // llama a onChange, asi que sin el objeto en el borrador el comprobante de
    // la recepcion creada sale con el nombre del cliente en blanco. El
    // placeholder del telefono de contacto es la unica parte del formulario
    // que refleja ese objeto sin llegar a enviar la recepcion.
    window.localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        version: 1,
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
        version: 1,
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
