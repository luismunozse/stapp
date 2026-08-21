import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { SWRConfig } from "swr"
import { InventarioAnalytics } from "@/components/inventario/inventario-analytics"

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({
    formatPrice: (n: number) => `$${n}`,
    formatDate: (d: string) => d,
  }),
}))

function stubFetch(body: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ ok: true, json: async () => body } as Response)),
  )
}

// Provider nuevo por test: la key de SWR es fija, sin esto el segundo test
// renderiza primero el payload cacheado del primero.
function renderAnalytics() {
  return render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <InventarioAnalytics open onOpenChange={vi.fn()} />
    </SWRConfig>,
  )
}

/**
 * /api/reportes/inventario-analytics devuelve sinMovimiento[].precioCompra y
 * .capitalInmovilizado en null para los roles sin acceso a costos de compra —
 * un VENDEDOR sin el opt-in de inventario llega acá (la ruta es
 * requireAdminOrVendedor). Sumar esos null los coerce a 0, así que el badge
 * pintaba "$0 inmovilizado" sobre una tabla de stock muerto NO vacía: un número
 * real en vez de un permiso faltante.
 */
describe("InventarioAnalytics — costo por item nulo en stock muerto", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function payload(precioCompra: number | null, capitalInmovilizado: number | null) {
    return {
      scope: "organization",
      valorizacion: {
        valorCosto: 7777,
        valorVenta: 8888,
        margenPotencial: 1111,
        totalItems: 1,
        totalUnidades: 10,
      },
      rotacion: [],
      sinMovimiento: [
        {
          id: "inv-1",
          nombre: "Pantalla muerta",
          codigo: "A1",
          stock: 13,
          precioCompra,
          precioVenta: 200,
          capitalInmovilizado,
        },
      ],
      alertasReorden: [],
      porCategoria: [],
      tendenciaVentas: [],
    }
  }

  async function openStockMuerto() {
    await waitFor(() => expect(screen.getByText("Stock Muerto")).toBeInTheDocument())
    screen.getByText("Stock Muerto").click()
    await waitFor(() => expect(screen.getByText("Pantalla muerta")).toBeInTheDocument())
  }

  it("oculta el capital inmovilizado y el costo por item cuando vienen en null", async () => {
    stubFetch(payload(null, null))

    renderAnalytics()
    await openStockMuerto()

    expect(screen.queryByText(/inmovilizado/)).not.toBeInTheDocument()
    expect(screen.queryByText("P. Costo")).not.toBeInTheDocument()
    expect(screen.queryByText("Capital Inmovilizado")).not.toBeInTheDocument()
    expect(screen.queryByText("$0")).not.toBeInTheDocument()
    // Lo que no es costo sigue disponible.
    expect(screen.getByText("13")).toBeInTheDocument()
  })

  it("muestra el capital inmovilizado y el costo por item cuando el rol puede verlos", async () => {
    stubFetch(payload(150, 1950))

    renderAnalytics()
    await openStockMuerto()

    expect(screen.getByText("$1950 inmovilizado")).toBeInTheDocument()
    expect(screen.getByText("P. Costo")).toBeInTheDocument()
    expect(screen.getByText("Capital Inmovilizado")).toBeInTheDocument()
    expect(screen.getByText("$150")).toBeInTheDocument()
  })
})

/**
 * La misma ruta devuelve ahora en null porCategoria[].valorCosto: una categoría
 * puede tener un único SKU, así que el total por categoría se reduce al costo de
 * un item. El total de organización valorizacion.valorCosto sigue visible (una
 * sola cifra sobre todo el inventario no se reduce a un item) y
 * valorizacion.margenPotencial también: es valorVenta - valorCosto, las dos
 * cifras que viajan al lado, así que ocultarlo no protegería nada.
 */
describe("InventarioAnalytics — agregados de costo por categoría nulos", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function payload(valorCosto: number | null) {
    return {
      scope: "organization",
      valorizacion: {
        valorCosto: 7777,
        valorVenta: 8888,
        margenPotencial: 1111,
        totalItems: 3,
        totalUnidades: 42,
      },
      rotacion: [],
      sinMovimiento: [],
      alertasReorden: [],
      porCategoria: [
        { categoria: "Repuestos", items: 3, stock: 42, valorCosto, valorVenta: 9999 },
      ],
      tendenciaVentas: [],
    }
  }

  async function openCategorias() {
    await waitFor(() => expect(screen.getByText("Por Categoría")).toBeInTheDocument())
    screen.getByText("Por Categoría").click()
    await waitFor(() => expect(screen.getByText("Repuestos")).toBeInTheDocument())
  }

  it("oculta la columna de valor costo cuando viene en null", async () => {
    stubFetch(payload(null))

    renderAnalytics()
    await openCategorias()

    expect(screen.queryByText("Valor Costo")).not.toBeInTheDocument()
    expect(screen.queryByText("$0")).not.toBeInTheDocument()
    // Lo que no es costo por categoría sigue disponible.
    expect(screen.getAllByText("$9999").length).toBeGreaterThan(0)
    expect(screen.getAllByText("42").length).toBeGreaterThan(0)
  })

  // El tier de reportes financieros sigue mostrando las cifras de organización:
  // el margen no se oculta porque las dos cifras de las que sale están ahí.
  it("mantiene el total de organización y el margen aunque el costo por categoría esté oculto", async () => {
    stubFetch(payload(null))

    renderAnalytics()
    await openCategorias()

    expect(screen.getByText("Capital Invertido")).toBeInTheDocument()
    expect(screen.getByText("$7777")).toBeInTheDocument()
    expect(screen.getByText("Margen Potencial")).toBeInTheDocument()
    expect(screen.getByText("$1111")).toBeInTheDocument()
  })

  it("muestra la columna de valor costo cuando el rol puede verla", async () => {
    stubFetch(payload(5555))

    renderAnalytics()
    await openCategorias()

    expect(screen.getByText("Valor Costo")).toBeInTheDocument()
    expect(screen.getAllByText("$5555").length).toBeGreaterThan(0)
    expect(screen.getByText("Margen Potencial")).toBeInTheDocument()
  })
})
