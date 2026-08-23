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

// Los hijos pesados no aportan nada a las celdas de costo/margen.
vi.mock("@/components/inventario/inventario-stats", () => ({
  InventarioStats: () => null,
}))
vi.mock("@/components/inventario/inventario-proveedor-stats", () => ({
  InventarioProveedorStats: () => null,
}))

// /api/inventario devuelve precioCompra: null para los roles sin acceso a
// inventario. La página solo redirige a VENDEDOR, así que un TECNICO que entra
// por URL llegaba acá: formatPrice(null) pintaba "$0" en Costo y el margen
// coercionaba null a 0, publicando el precio de venta entero como ganancia.
describe("InventarioList — costo por item nulo", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  function item(precioCompra: number | null) {
    return {
      id: "inv-1",
      codigo: "A1",
      nombre: "Pantalla",
      descripcion: null,
      categoria: "Pantallas",
      tipoDispositivo: "CELULAR",
      stock: 7,
      stockReservado: 0,
      stockMinimo: 2,
      precioCompra,
      precioVenta: 3000,
      imagenUrl: null,
      deletedAt: null,
      proveedor: null,
      ubicacion: null,
    }
  }

  // La caché de SWR es global: sin un provider propio por test, el segundo
  // render devuelve el payload del primero y las aserciones mienten.
  function renderList() {
    return render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <InventarioList allowImport={false} />
      </SWRConfig>,
    )
  }

  // La DataTable pinta la fila de escritorio y la tarjeta mobile a la vez
  // (las esconde por CSS), así que los textos aparecen duplicados.
  function shown(text: string) {
    return screen.getAllByText(text)
  }

  function absent(text: string) {
    return screen.queryAllByText(text)
  }

  function stubFetch(precioCompra: number | null) {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        const href = String(url)
        if (href.startsWith("/api/inventario?")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ data: [item(precioCompra)], total: 1 }),
          } as Response)
        }
        if (href.startsWith("/api/proveedores")) {
          return Promise.resolve({ ok: true, json: async () => [] } as Response)
        }
        return Promise.resolve({ ok: true, json: async () => ({}) } as Response)
      }),
    )
  }

  describe("vista de lista (tabla)", () => {
    beforeEach(() => localStorage.setItem("inventario-view-mode", "list"))

    it("oculta el costo y el margen cuando precioCompra viene en null", async () => {
      stubFetch(null)

      renderList()

      await waitFor(() => expect(shown("Pantalla").length).toBeGreaterThan(0))

      // El precio de venta se sigue viendo; el costo y el margen no.
      expect(shown("$3000").length).toBeGreaterThan(0)
      expect(absent("$0")).toHaveLength(0)
      expect(absent("+$3000")).toHaveLength(0)
    })

    it("muestra el costo y el margen cuando el rol puede verlos", async () => {
      stubFetch(1000)

      renderList()

      await waitFor(() => expect(shown("Pantalla").length).toBeGreaterThan(0))

      expect(shown("$1000").length).toBeGreaterThan(0)
      expect(shown("+$2000").length).toBeGreaterThan(0)
    })

    it("sigue avisando cuando el costo es 0 de verdad", async () => {
      stubFetch(0)

      renderList()

      await waitFor(() => expect(shown("Pantalla").length).toBeGreaterThan(0))

      expect(shown("$0").length).toBeGreaterThan(0)
      expect(shown("~$3000").length).toBeGreaterThan(0)
    })
  })

  describe("vista de tarjetas (grid)", () => {
    beforeEach(() => localStorage.setItem("inventario-view-mode", "grid"))

    it("oculta el costo y el margen cuando precioCompra viene en null", async () => {
      stubFetch(null)

      renderList()

      await waitFor(() => expect(shown("Pantalla").length).toBeGreaterThan(0))

      expect(shown("$3000").length).toBeGreaterThan(0)
      expect(absent("Costo")).toHaveLength(0)
      expect(absent("$0")).toHaveLength(0)
      expect(absent("+$3000")).toHaveLength(0)
    })

    it("muestra el costo y el margen cuando el rol puede verlos", async () => {
      stubFetch(1000)

      renderList()

      await waitFor(() => expect(shown("Pantalla").length).toBeGreaterThan(0))

      expect(shown("Costo").length).toBeGreaterThan(0)
      expect(shown("$1000").length).toBeGreaterThan(0)
      expect(shown("+$2000").length).toBeGreaterThan(0)
    })
  })
})
