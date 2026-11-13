/**
 * Currency of the price on the services screen: selector, convert/keep dialog over `precio`,
 * list with the price in its own currency plus the local equivalent, and the currency filter.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { ServiciosClient } from "@/components/servicios/servicios-client"
import { formatCurrencyValue } from "@/lib/currency"

// Radix Select needs these in jsdom; a keyboard open is what it honours without PointerEvent.
Element.prototype.hasPointerCapture = () => false
Element.prototype.scrollIntoView = () => {}
const abrir = (selector: HTMLElement) => fireEvent.keyDown(selector, { key: "ArrowDown" })

const useMonedaMock = vi.hoisted(() => vi.fn())
vi.mock("@/hooks/use-moneda", () => ({ useMoneda: useMonedaMock }))
vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `ARS ${n.toLocaleString("es-AR", { maximumFractionDigits: 2 })}` }),
}))
vi.mock("@/contexts/modal-context", () => ({
  useModal: () => ({ confirm: vi.fn(), alert: vi.fn().mockResolvedValue(undefined) }),
}))

const CONFIG = {
  monedaLocal: "ARS",
  monedaExtranjera: "USD",
  habilitada: true,
  fuentesDisponibles: ["MANUAL", "OFICIAL", "BLUE", "MEP"],
  fuente: "BLUE",
  tipoCambioManual: null,
  tipoCambioReferencia: null,
  referenciaEn: null,
  redondeoConversion: 10,
  aceptaUsdEfectivo: false,
  vueltoMonedaDefault: "LOCAL",
}
const VIVO = { disponible: true, valor: 1200, fuente: "BLUE", moneda: "USD", en: new Date().toISOString(), estado: "vivo" }

function setMoneda(config: object = {}, tipoCambio: object = VIVO) {
  useMonedaMock.mockReturnValue({ config: { ...CONFIG, ...config }, tipoCambio, itemsEnDivisa: null, isLoading: false, mutate: vi.fn() })
}

const servicio = (over: Record<string, unknown> = {}) => ({
  id: "s1",
  codigo: "SRV-001",
  nombre: "Instalación",
  descripcion: null,
  categoria: null,
  precio: 60000,
  duracionEstimadaMin: null,
  activo: true,
  moneda: null,
  ...over,
})

describe("ServiciosClient: moneda del precio", () => {
  let urls: string[]
  let servicios: unknown[]
  let enviados: { url: string; method: string; body: any }[]

  beforeEach(() => {
    vi.clearAllMocks()
    setMoneda()
    urls = []
    enviados = []
    servicios = [servicio()]
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        const href = String(url)
        if (init?.method === "POST" || init?.method === "PUT") {
          enviados.push({ url: href, method: init.method, body: JSON.parse(String(init.body)) })
          return Promise.resolve({ ok: true, json: async () => ({}) } as Response)
        }
        urls.push(href)
        return Promise.resolve({ ok: true, json: async () => ({ servicios }) } as Response)
      })
    )
  })

  afterEach(() => vi.unstubAllGlobals())

  it("un servicio en USD muestra el precio en USD y el equivalente local", async () => {
    servicios = [servicio({ precio: 50, moneda: "USD" })]
    render(<ServiciosClient />)
    expect(await screen.findByText(formatCurrencyValue(50, "USD"))).toBeInTheDocument()
    expect(screen.getByText(/≈ ARS 60\.000 hoy/)).toBeInTheDocument()
  })

  it("un servicio local no muestra equivalente", async () => {
    render(<ServiciosClient />)
    expect(await screen.findByText("ARS 60.000")).toBeInTheDocument()
    expect(screen.queryByText(/≈/)).not.toBeInTheDocument()
  })

  it("el alta con USD envía la moneda", async () => {
    servicios = []
    render(<ServiciosClient />)
    fireEvent.click(await screen.findByRole("button", { name: /Nuevo servicio/ }))
    fireEvent.change(screen.getByPlaceholderText("Ej: SRV-001"), { target: { value: "S-9" } })
    fireEvent.change(screen.getByPlaceholderText("Ej: Instalación de Windows"), { target: { value: "Diagnóstico" } })
    fireEvent.change(screen.getByLabelText("Moneda del precio"), { target: { value: "USD" } })
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "20" } })
    fireEvent.click(screen.getByRole("button", { name: "Crear" }))
    await waitFor(() => expect(enviados).toHaveLength(1))
    expect(enviados[0].method).toBe("POST")
    expect(enviados[0].body).toMatchObject({ precio: 20, moneda: "USD" })
  })

  it("el alta sin elegir moneda envía null", async () => {
    servicios = []
    render(<ServiciosClient />)
    fireEvent.click(await screen.findByRole("button", { name: /Nuevo servicio/ }))
    fireEvent.change(screen.getByPlaceholderText("Ej: SRV-001"), { target: { value: "S-9" } })
    fireEvent.change(screen.getByPlaceholderText("Ej: Instalación de Windows"), { target: { value: "Diagnóstico" } })
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "20" } })
    fireEvent.click(screen.getByRole("button", { name: "Crear" }))
    await waitFor(() => expect(enviados).toHaveLength(1))
    expect(enviados[0].body.moneda).toBeNull()
  })

  async function editarYPedirUsd() {
    render(<ServiciosClient />)
    fireEvent.click(await screen.findByRole("button", { name: "Editar servicio" }))
    fireEvent.change(screen.getByLabelText("Moneda del precio"), { target: { value: "USD" } })
  }

  it("cambiar la moneda con precio abre el diálogo y Convertir convierte el precio", async () => {
    await editarYPedirUsd()
    fireEvent.click(await screen.findByRole("button", { name: /Convertir con la cotización de hoy/ }))
    await waitFor(() => expect(screen.getByDisplayValue("50")).toBeInTheDocument())
    expect((screen.getByLabelText("Moneda del precio") as HTMLSelectElement).value).toBe("USD")
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }))
    await waitFor(() => expect(enviados).toHaveLength(1))
    expect(enviados[0].method).toBe("PUT")
    expect(enviados[0].body).toMatchObject({ precio: 50, moneda: "USD" })
  })

  it("Mantener el número deja el precio y cambia la moneda", async () => {
    await editarYPedirUsd()
    fireEvent.click(await screen.findByRole("button", { name: "Mantener el número" }))
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }))
    await waitFor(() => expect(enviados).toHaveLength(1))
    expect(enviados[0].body).toMatchObject({ precio: 60000, moneda: "USD" })
  })

  it("Cancelar deja todo como estaba", async () => {
    await editarYPedirUsd()
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar", hidden: false }))
    expect((screen.getByLabelText("Moneda del precio") as HTMLSelectElement).value).toBe("")
  })

  it("sin cotización no se puede convertir", async () => {
    setMoneda({}, { disponible: false })
    await editarYPedirUsd()
    expect(await screen.findByRole("button", { name: /Convertir con la cotización de hoy/ })).toBeDisabled()
  })

  it("editar sin tocar la moneda no la envía", async () => {
    render(<ServiciosClient />)
    fireEvent.click(await screen.findByRole("button", { name: "Editar servicio" }))
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "70000" } })
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }))
    await waitFor(() => expect(enviados).toHaveLength(1))
    expect(enviados[0].body).not.toHaveProperty("moneda")
  })

  it("con la función activa aparece el filtro Moneda y Divisa pide moneda=divisa", async () => {
    render(<ServiciosClient />)
    const filtro = await screen.findByRole("combobox", { name: "Moneda" })
    abrir(filtro)
    const opciones = (await screen.findAllByRole("option")).map((o) => o.textContent)
    expect(opciones).toEqual(["Todas las monedas", "Moneda local", "USD"])
    fireEvent.click(screen.getByRole("option", { name: "USD" }))
    await waitFor(() => expect(urls.some((u) => u.includes("moneda=divisa"))).toBe(true))
  })

  it("con la función apagada y sin servicios en divisa no hay filtro ni selector", async () => {
    setMoneda({ habilitada: false })
    render(<ServiciosClient />)
    await screen.findByText("Instalación")
    expect(screen.queryByRole("combobox", { name: "Moneda" })).not.toBeInTheDocument()
  })

  it("con la función apagada, si hay servicios en divisa el filtro aparece", async () => {
    setMoneda({ habilitada: false })
    servicios = [servicio({ precio: 50, moneda: "USD" })]
    render(<ServiciosClient />)
    expect(await screen.findByRole("combobox", { name: "Moneda" })).toBeInTheDocument()
  })
})
