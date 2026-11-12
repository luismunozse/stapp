// __tests__/components/moneda-config.test.tsx
/** Configuración > Moneda extranjera: ADMIN edits, everyone else reads. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"
import { SWRConfig } from "swr"

const { toastSuccess, toastError } = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }))
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }))

const mockFetch = vi.fn()
global.fetch = mockFetch as unknown as typeof fetch

const NOW = new Date("2026-11-12T12:00:00.000Z")
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
const VIVO = {
  disponible: true,
  valor: 1200,
  fuente: "BLUE",
  moneda: "USD",
  en: new Date(NOW.getTime() - 3 * 60_000).toISOString(),
  estado: "vivo",
}

let state: { config: object; items: object | null; tc: object }
const respond = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body })

function setup(config: object = {}, items: object | null = { inventario: 0, servicios: 0 }, tc: object = VIVO) {
  state = { config: { ...CONFIG, ...config }, items, tc }
  mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/moneda/tipo-cambio") return respond(state.tc)
    if (init?.method === "PUT") return respond({ config: state.config, itemsEnDivisa: state.items })
    return respond({ config: state.config, itemsEnDivisa: state.items })
  })
}

async function renderScreen(allowEdit = true) {
  const { MonedaConfig } = await import("@/components/configuracion/moneda-config")
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MonedaConfig allowEdit={allowEdit} />
    </SWRConfig>,
  )
}

const puts = () => mockFetch.mock.calls.filter((c) => c[1]?.method === "PUT")

describe("MonedaConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ["Date"], now: NOW })
  })
  afterEach(() => vi.useRealTimers())

  it("shows only the switch while the feature is off", async () => {
    setup({ habilitada: false })
    await renderScreen()

    expect(await screen.findByRole("switch", { name: /Habilitar moneda extranjera/ })).not.toBeChecked()
    expect(screen.queryByLabelText("Moneda extranjera")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("Fuente de la cotización")).not.toBeInTheDocument()
  })

  it("offers exactly Manual and Oficial for AR with EUR", async () => {
    setup({ monedaExtranjera: "EUR", fuentesDisponibles: ["MANUAL", "OFICIAL"], fuente: "OFICIAL" }, null, {
      ...VIVO,
      fuente: "OFICIAL",
      moneda: "EUR",
    })
    await renderScreen()

    const select = await screen.findByLabelText("Fuente de la cotización")
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Manual", "Oficial"])
  })

  it("disables the foreign currency equal to the local one", async () => {
    setup({ monedaLocal: "USD", monedaExtranjera: "EUR", fuentesDisponibles: ["MANUAL"], fuente: "MANUAL", tipoCambioManual: 1 })
    await renderScreen()

    const select = await screen.findByLabelText("Moneda extranjera")
    expect(screen.getByRole("option", { name: "US$ Dólar (USD)" })).toBeDisabled()
    expect(screen.getByRole("option", { name: "€ Euro (EUR)" })).toBeEnabled()
    expect(select).toHaveValue("EUR")
  })

  it("shows the manual rate field and the server message under it on a 400", async () => {
    setup()
    await renderScreen()
    fireEvent.change(await screen.findByLabelText("Fuente de la cotización"), { target: { value: "MANUAL" } })

    const input = screen.getByLabelText("Cotización manual")
    fireEvent.change(input, { target: { value: "0" } })
    mockFetch.mockImplementationOnce(async () => respond({ error: "La cotización debe ser mayor que cero" }, false, 400))
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }))

    expect(await screen.findByText("La cotización debe ser mayor que cero")).toBeInTheDocument()
    expect(input).toHaveAttribute("aria-invalid", "true")
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it("saves the whole form with PUT and confirms", async () => {
    setup()
    await renderScreen()
    fireEvent.change(await screen.findByLabelText("Fuente de la cotización"), { target: { value: "MANUAL" } })
    fireEvent.change(screen.getByLabelText("Cotización manual"), { target: { value: "1300,5" } })
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }))

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
    expect(JSON.parse(puts()[0][1].body)).toEqual({
      habilitada: true,
      monedaExtranjera: "USD",
      fuente: "MANUAL",
      tipoCambioManual: "1300.5",
      redondeoConversion: 10,
    })
  })

  it("re-saves an untouched manual rate in the format the server accepts", async () => {
    setup({ fuente: "MANUAL", tipoCambioManual: 1250.5 }, null, { ...VIVO, fuente: "MANUAL" })
    await renderScreen()
    expect(await screen.findByLabelText("Cotización manual")).toHaveValue("1250,5")
    fireEvent.change(screen.getByLabelText("Redondeo de la conversión"), { target: { value: "100" } })
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }))

    await waitFor(() => expect(puts()).toHaveLength(1))
    const body = JSON.parse(puts()[0][1].body)
    expect(body.tipoCambioManual).toBe("1250.5")
    expect(body.redondeoConversion).toBe(100)
  })

  it("shows the current rate as a chip", async () => {
    setup()
    await renderScreen()
    expect(await screen.findByText(/^Blue · .*1\.200,00 · hace 3 min$/)).toBeInTheDocument()
  })

  it("says how old a reference rate is", async () => {
    setup({}, null, { ...VIVO, estado: "referencia", en: new Date(NOW.getTime() - 5 * 3600_000).toISOString() })
    await renderScreen()
    expect(await screen.findByText("Cotización de hace 5 h")).toBeInTheDocument()
  })

  it("warns when there is no rate", async () => {
    setup({ fuente: "MANUAL" }, null, { disponible: false, motivo: "SIN_COTIZACION" })
    await renderScreen()
    expect(await screen.findByText("No hay cotización disponible: cargá una manual.")).toBeInTheDocument()
  })

  it("asks for confirmation before turning off with items priced in the foreign currency", async () => {
    setup({}, { inventario: 4, servicios: 2 })
    await renderScreen()
    fireEvent.click(await screen.findByRole("switch", { name: /Habilitar moneda extranjera/ }))
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }))

    expect(await screen.findByText(/4 productos y 2 servicios tienen precio en USD/)).toBeInTheDocument()
    expect(puts()).toHaveLength(0)

    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }))
    await waitFor(() => expect(puts()).toHaveLength(1))
    expect(JSON.parse(puts()[0][1].body).habilitada).toBe(false)
  })

  it("turns off without asking when nothing is priced in the foreign currency", async () => {
    setup({}, { inventario: 0, servicios: 0 })
    await renderScreen()
    fireEvent.click(await screen.findByRole("switch", { name: /Habilitar moneda extranjera/ }))
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }))

    await waitFor(() => expect(puts()).toHaveLength(1))
  })

  it("is read-only when the user cannot edit", async () => {
    setup()
    await renderScreen(false)

    expect(await screen.findByRole("switch", { name: /Habilitar moneda extranjera/ })).toBeDisabled()
    expect(screen.getByLabelText("Fuente de la cotización")).toBeDisabled()
    expect(screen.getByLabelText("Moneda extranjera")).toBeDisabled()
    expect(screen.queryByRole("button", { name: "Guardar" })).not.toBeInTheDocument()
  })
})
