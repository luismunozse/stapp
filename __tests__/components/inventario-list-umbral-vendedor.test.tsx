import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { SWRConfig } from "swr"
import { InventarioList } from "@/components/inventario/inventario-list"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}))

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({
    formatPrice: (n: number) => `$${n}`,
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

vi.mock("@/components/inventario/inventario-stats", () => ({
  InventarioStats: () => null,
}))
vi.mock("@/components/inventario/inventario-proveedor-stats", () => ({
  InventarioProveedorStats: () => null,
}))

// El umbral de stock bajo se leía de /api/configuracion, que es solo ADMIN:
// para un vendedor respondía 403 y el listado marcaba con el umbral por
// defecto (5) aunque la org tuviera otro.
describe("InventarioList — umbral de stock bajo de la org para un vendedor", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    localStorage.clear()
    localStorage.setItem("inventario-view-mode", "list")
  })

  afterEach(() => {
    localStorage.clear()
  })

  const item = (stock: number) => ({
    id: "inv-1",
    codigo: "A1",
    nombre: "Pantalla",
    descripcion: null,
    categoria: "Pantallas",
    tipoDispositivo: "CELULAR",
    stock,
    stockReservado: 0,
    // Sin mínimo propio: manda el umbral de la org.
    stockMinimo: null,
    precioCompra: 1000,
    precioVenta: 3000,
    imagenUrl: null,
    deletedAt: null,
    proveedor: null,
    ubicacion: null,
  })

  function stubFetchVendedor(umbralStockBajo: number, stock: number) {
    const fetchMock = vi.fn((url: string) => {
      const href = String(url)
      if (href.startsWith("/api/inventario?")) {
        return Promise.resolve({ ok: true, json: async () => ({ data: [item(stock)], total: 1 }) } as Response)
      }
      if (href.startsWith("/api/proveedores")) {
        return Promise.resolve({ ok: true, json: async () => [] } as Response)
      }
      if (href.startsWith("/api/configuracion/operativa")) {
        return Promise.resolve({ ok: true, json: async () => ({ umbralStockBajo }) } as Response)
      }
      if (href.startsWith("/api/configuracion")) {
        return Promise.resolve({ ok: false, status: 403, json: async () => ({ error: "No autorizado" }) } as Response)
      }
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response)
    })
    vi.stubGlobal("fetch", fetchMock)
    return fetchMock
  }

  function renderList() {
    return render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <InventarioList allowImport={false} />
      </SWRConfig>,
    )
  }

  it("marca stock bajo con el umbral de la org: 7 unidades con umbral 10", async () => {
    const fetchMock = stubFetchVendedor(10, 7)

    renderList()

    await waitFor(() => {
      const botones = screen.getAllByTitle("Ajustar stock")
      expect(botones.some((b) => b.className.includes("text-amber-600"))).toBe(true)
    })
    expect(fetchMock.mock.calls.some(([u]) => String(u) === "/api/configuracion")).toBe(false)
  })

  it("no marca 4 unidades si el umbral de la org es 3 (con el de defecto, 5, sí)", async () => {
    stubFetchVendedor(3, 4)

    renderList()

    await waitFor(() => expect(screen.getAllByText("Pantalla").length).toBeGreaterThan(0))
    // Esperar a que llegue la config antes de mirar el color.
    await waitFor(() => {
      const botones = screen.getAllByTitle("Ajustar stock")
      expect(botones.every((b) => !b.className.includes("text-amber-600"))).toBe(true)
    })
  })
})
