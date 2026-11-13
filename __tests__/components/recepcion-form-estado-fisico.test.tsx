/**
 * Estado físico por equipo en RecepcionForm: con la organización en
 * "estado físico obligatorio", el equipo que no lo tiene muestra el aviso en
 * SU card y recibe el foco (id único por equipo), y no se llama a la API. Con
 * todo completo, cada equipo manda sus pins o "sin daños" en el payload.
 *
 * El estado se carga desde un borrador (mismo camino que recepcion-form-draft
 * .test.tsx), que además ejercita el saneado del estado físico restaurado.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, act } from "@testing-library/react"
import { ModalProvider } from "@/contexts/modal-context"
import { estadoFisicoFocoIdEquipo } from "@/components/ordenes/recepcion-equipo-card"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "user-1", organizationId: "org-1" } } }),
}))

vi.mock("@/contexts/currency-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/contexts/currency-context")>()
  return {
    ...actual,
    useCurrency: () => ({ ...actual.useCurrency(), danosRecepcionObligatorio: true }),
  }
})

vi.mock("@/hooks/use-tipos-dispositivo", () => ({
  useTiposDispositivo: () => ({
    tipos: [
      {
        codigo: "CELULAR",
        nombre: "Celular",
        config: { accesorios: [], problemasComunes: [], marcas: [], camposExtra: [] },
      },
      {
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

vi.mock("@/components/cotizaciones/cliente-selector", () => ({
  ClienteSelector: () => <div data-testid="cliente-selector-stub" />,
}))

vi.mock("@/components/firma/signature-pad", () => ({
  SignaturePad: () => <div data-testid="signature-pad-stub" />,
}))

const DRAFT_KEY = "draft:v3:recepcion-form:org-1:user-1:new"

const pinCelular = { diagrama: "celular@1", vista: "frente", x: 0.25, y: 0.5, tipo: "golpe", nota: "esquina" }

const equipo = (dispositivo: string) => ({
  dispositivo,
  tipoDispositivo: "CELULAR",
  marca: "",
  color: "",
  imei: "",
  problemaReportado: "No enciende",
  codigoAccesoDispositivo: "",
})

const side = (estadoFisico?: unknown) => ({
  accesoriosSeleccionados: [],
  otroAccesorio: "",
  camposExtraValues: {},
  ...(estadoFisico === undefined ? {} : { estadoFisico }),
})

function guardarBorrador(sideState: unknown[]) {
  window.localStorage.setItem(
    DRAFT_KEY,
    JSON.stringify({
      version: 3,
      savedAt: Date.now(),
      data: {
        form: {
          clienteId: "cli-1",
          telefonoContacto: "",
          observaciones: "",
          equipos: [equipo("iPhone 13"), equipo("Moto G")],
        },
        sideState,
        selectedCliente: { nombre: "Acme SA", telefono: "1155667788" },
      },
    }),
  )
}

async function renderYEnviar() {
  const { RecepcionForm } = await import("@/components/ordenes/recepcion-form")
  render(
    <ModalProvider>
      <RecepcionForm />
    </ModalProvider>,
  )
  expect(screen.getAllByPlaceholderText("Ej: iPhone 13")[1]).toHaveValue("Moto G")
  fireEvent.click(screen.getByLabelText(/El cliente acepta los términos/i))
  fireEvent.click(screen.getByRole("button", { name: /Crear recepción/i }))
  await act(async () => {})
}

const llamadasRecepcion = () =>
  vi.mocked(fetch).mock.calls.filter(([input]) => String(input) === "/api/recepciones")

describe("RecepcionForm — estado físico por equipo", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        if (String(input) === "/api/recepciones") {
          return Promise.resolve({
            ok: true,
            status: 201,
            json: async () => ({
              recepcion: { id: "rec-1", numero: 1, codigo: "REC001" },
              ordenes: [
                { id: "o1", numeroOrden: 1, codigoOrden: "CEL001", dispositivo: "iPhone 13", publicToken: "a" },
                { id: "o2", numeroOrden: 2, codigoOrden: "CEL002", dispositivo: "Moto G", publicToken: "b" },
              ],
              organizationName: "Taller",
              organizationTelefono: null,
              organizationDireccion: null,
              organizationComprobanteTerminos: null,
            }),
          } as unknown as Response)
        }
        return Promise.resolve({ ok: true, json: async () => [] } as Response)
      }),
    )
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("obligatorio: el equipo 2 sin estado físico muestra el aviso en su card, toma el foco y no se envía", async () => {
    guardarBorrador([side({ danos: [], sinDanos: true }), side()])

    await renderYEnviar()

    const alerta = screen.getByRole("alert")
    expect(alerta).toHaveTextContent("Equipo 2: marcá los daños o «Sin daños visibles»")
    expect(screen.queryByText(/Equipo 1: marcá los daños/)).not.toBeInTheDocument()
    expect(document.activeElement?.id).toBe(estadoFisicoFocoIdEquipo(1))
    expect(llamadasRecepcion()).toHaveLength(0)
  })

  it("los botones 'Sin daños visibles' tienen un id distinto por equipo", async () => {
    guardarBorrador([side(), side()])
    const { RecepcionForm } = await import("@/components/ordenes/recepcion-form")
    render(
      <ModalProvider>
        <RecepcionForm />
      </ModalProvider>,
    )
    const botones = screen.getAllByRole("button", { name: "Sin daños visibles" })
    expect(botones.map((b) => b.id)).toEqual([estadoFisicoFocoIdEquipo(0), estadoFisicoFocoIdEquipo(1)])
  })

  it("con todo completo manda los pins y el 'sin daños' de cada equipo", async () => {
    guardarBorrador([side({ danos: [pinCelular], sinDanos: false }), side({ danos: [], sinDanos: true })])

    await renderYEnviar()

    expect(llamadasRecepcion()).toHaveLength(1)
    const body = JSON.parse(String(llamadasRecepcion()[0][1]?.body))
    expect(body.equipos[0].danos).toEqual([pinCelular])
    expect(body.equipos[0].recepcionSinDanos).toBe(false)
    expect(body.equipos[1].danos).toBeUndefined()
    expect(body.equipos[1].recepcionSinDanos).toBe(true)
  })

  it("al restaurar, descarta los pins que no son del dibujo del tipo del equipo", async () => {
    // Pins de computadora sobre un celular: se tiran y el equipo queda sin estado físico.
    guardarBorrador([
      side({ danos: [{ ...pinCelular, diagrama: "computadora@1" }], sinDanos: false }),
      side({ danos: [], sinDanos: true }),
    ])

    await renderYEnviar()

    expect(screen.getByRole("alert")).toHaveTextContent("Equipo 1: marcá los daños")
    expect(llamadasRecepcion()).toHaveLength(0)
  })

  describe("cambiar el tipo de un equipo con pins", () => {
    async function renderConPins() {
      guardarBorrador([
        side({ danos: [pinCelular], sinDanos: false }),
        side({ danos: [pinCelular], sinDanos: false }),
      ])
      const { RecepcionForm } = await import("@/components/ordenes/recepcion-form")
      render(
        <ModalProvider>
          <RecepcionForm />
        </ModalProvider>,
      )
      expect(screen.getAllByLabelText("Daño 1: golpe, frente")).toHaveLength(2)
      fireEvent.click(screen.getAllByRole("button", { name: "Tablet" })[0])
      await act(async () => {})
      expect(screen.getByText("Cambiar el tipo de equipo borra los daños marcados")).toBeInTheDocument()
    }

    it("cancelar deja el tipo y los pins como estaban", async () => {
      await renderConPins()
      fireEvent.click(screen.getByRole("button", { name: "Cancelar" }))
      await act(async () => {})

      expect(screen.getAllByRole("button", { name: "Celular" })[0]).toHaveAttribute("aria-pressed", "true")
      expect(screen.getAllByLabelText("Daño 1: golpe, frente")).toHaveLength(2)
    })

    it("confirmar cambia el tipo y borra solo los pins de ese equipo", async () => {
      await renderConPins()
      fireEvent.click(screen.getByRole("button", { name: "Cambiar tipo" }))
      await act(async () => {})

      expect(screen.getAllByRole("button", { name: "Tablet" })[0]).toHaveAttribute("aria-pressed", "true")
      expect(screen.getAllByLabelText("Daño 1: golpe, frente")).toHaveLength(1)
    })
  })
})
