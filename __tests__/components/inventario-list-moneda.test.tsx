import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { SWRConfig } from "swr"
import { InventarioList } from "@/components/inventario/inventario-list"
import { formatCurrencyValue } from "@/lib/currency"

// Radix Select needs these in jsdom; a keyboard open is what it honours without PointerEvent.
Element.prototype.hasPointerCapture = () => false
Element.prototype.scrollIntoView = () => {}
const abrir = (selector: HTMLElement) => fireEvent.keyDown(selector, { key: "ArrowDown" })

const useMonedaMock = vi.hoisted(() => vi.fn())
vi.mock("@/hooks/use-moneda", () => ({ useMoneda: useMonedaMock }))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}))
vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({
    formatPrice: (n: number) => `ARS ${n.toLocaleString("es-AR", { maximumFractionDigits: 2 })}`,
    formatDate: (d: string) => d,
    timezone: "America/Argentina/Buenos_Aires",
  }),
}))
vi.mock("@/contexts/modal-context", () => ({
  useModal: () => ({ confirm: vi.fn(), showError: vi.fn(), alert: vi.fn() }),
}))
vi.mock("@/hooks/use-tipos-dispositivo", () => ({
  useTiposDispositivo: () => ({ tipos: [], loading: false }),
}))
vi.mock("@/components/inventario/inventario-stats", () => ({ InventarioStats: () => null }))
vi.mock("@/components/inventario/inventario-proveedor-stats", () => ({ InventarioProveedorStats: () => null }))

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

function setMoneda(config: object = {}) {
  // itemsEnDivisa is ADMIN-only: the list must not depend on it.
  useMonedaMock.mockReturnValue({ config: { ...CONFIG, ...config }, tipoCambio: VIVO, itemsEnDivisa: null, isLoading: false, mutate: vi.fn() })
}

const item = (over: Record<string, unknown> = {}) => ({
  id: "inv-1",
  codigo: "A1",
  nombre: "Pantalla",
  descripcion: null,
  categoria: "Pantallas",
  tipoDispositivo: "CELULAR",
  stock: 7,
  stockReservado: 0,
  stockMinimo: 2,
  precioCompra: 30,
  precioVenta: 50,
  imagenUrl: null,
  deletedAt: null,
  proveedor: null,
  ubicacion: null,
  moneda: null,
  ...over,
})

describe("InventarioList: moneda del precio", () => {
  let urls: string[]
  let items: unknown[]

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    setMoneda()
    urls = []
    items = [item()]
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        const href = String(url)
        urls.push(href)
        if (href.startsWith("/api/inventario?")) {
          return Promise.resolve({ ok: true, json: async () => ({ data: items, total: items.length }) } as Response)
        }
        if (href.startsWith("/api/proveedores")) return Promise.resolve({ ok: true, json: async () => [] } as Response)
        return Promise.resolve({ ok: true, json: async () => ({}) } as Response)
      })
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  function renderList() {
    return render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <InventarioList allowImport={false} />
      </SWRConfig>
    )
  }

  for (const vista of ["list", "grid"] as const) {
    it(`un ítem en USD muestra el precio en USD y el equivalente local (${vista})`, async () => {
      localStorage.setItem("inventario-view-mode", vista)
      items = [item({ moneda: "USD" })]
      renderList()
      await waitFor(() => expect(screen.getAllByText("Pantalla").length).toBeGreaterThan(0))
      expect(screen.getAllByText(formatCurrencyValue(50, "USD")).length).toBeGreaterThan(0)
      expect(screen.getAllByText(/≈ ARS 60\.000 hoy/).length).toBeGreaterThan(0)
      expect(screen.queryByText("ARS 50")).not.toBeInTheDocument()
    })
  }

  it("un ítem local no muestra equivalente", async () => {
    localStorage.setItem("inventario-view-mode", "list")
    renderList()
    await waitFor(() => expect(screen.getAllByText("Pantalla").length).toBeGreaterThan(0))
    expect(screen.getAllByText("ARS 50").length).toBeGreaterThan(0)
    expect(screen.queryByText(/≈/)).not.toBeInTheDocument()
  })

  it("con la función activa aparece el filtro Moneda y Divisa agrega moneda=divisa", async () => {
    renderList()
    const filtro = await screen.findByRole("combobox", { name: "Moneda" })
    abrir(filtro)
    const opciones = (await screen.findAllByRole("option")).map((o) => o.textContent)
    expect(opciones).toEqual(["Todas las monedas", "Moneda local", "USD"])
    fireEvent.click(screen.getByRole("option", { name: "USD" }))
    await waitFor(() => expect(urls.some((u) => u.startsWith("/api/inventario?") && u.includes("moneda=divisa"))).toBe(true))
  })

  it("con la función apagada y sin ítems en divisa no hay filtro", async () => {
    setMoneda({ habilitada: false })
    renderList()
    await waitFor(() => expect(screen.getAllByText("Pantalla").length).toBeGreaterThan(0))
    expect(screen.queryByRole("combobox", { name: "Moneda" })).not.toBeInTheDocument()
  })

  it("con la función apagada, si hay ítems en divisa el filtro aparece", async () => {
    setMoneda({ habilitada: false })
    items = [item({ moneda: "USD" })]
    renderList()
    expect(await screen.findByRole("combobox", { name: "Moneda" })).toBeInTheDocument()
  })
})
