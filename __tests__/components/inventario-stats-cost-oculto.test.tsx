import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { InventarioStats } from "@/components/inventario/inventario-stats"
import { InventarioProveedorStats } from "@/components/inventario/inventario-proveedor-stats"

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `$${n}` }),
}))

// Las agregaciones derivadas de precio_compra vuelven en null para los roles sin
// acceso a inventario. La card no puede mostrar "$0": eso se lee como
// "inventario sin valor", no como "no tenés permiso para verlo".

function stubFetch(payload: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ ok: true, json: async () => payload } as Response)),
  )
}

describe("InventarioStats — cards de costo con valor nulo", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  const base = {
    totalSkus: 12,
    valorVenta: 5000,
    sinStock: 2,
    bajoStock: 3,
  }

  it("oculta 'Valor a costo' y 'Valor en riesgo' cuando el rol no puede verlos", async () => {
    stubFetch({ ...base, valorCosto: null, valorEnRiesgo: null })

    render(<InventarioStats />)

    await waitFor(() => expect(screen.getByText("Valor a venta")).toBeInTheDocument())

    expect(screen.queryByText("Valor a costo")).not.toBeInTheDocument()
    expect(screen.queryByText("Valor en riesgo")).not.toBeInTheDocument()
    // Los conteos, que no son costo, siguen visibles.
    expect(screen.getByText("SKUs activos")).toBeInTheDocument()
    expect(screen.getByText("Sin stock")).toBeInTheDocument()
  })

  // refreshKey distinto por test: SWR cachea por URL a nivel modulo y, sin
  // esto, el segundo render reusa la respuesta del primero.
  it("muestra las cards de costo cuando el rol sí puede verlas", async () => {
    stubFetch({ ...base, valorCosto: 1000, valorEnRiesgo: 200 })

    render(<InventarioStats refreshKey={1} />)

    await waitFor(() => expect(screen.getByText("Valor a costo")).toBeInTheDocument())
    expect(screen.getByText("Valor en riesgo")).toBeInTheDocument()
  })
})

describe("InventarioProveedorStats — valor a costo con valor nulo", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  const base = {
    totalArticulos: 4,
    totalStock: 20,
    valorVenta: 8000,
    itemsBajoStock: 0,
    itemsSinStock: 0,
    truncated: false,
  }

  it("oculta 'Valor a costo' cuando el rol no puede verlo", async () => {
    stubFetch({ ...base, valorCosto: null, margenEstimado: null })

    render(<InventarioProveedorStats proveedorNombre="ACME" proveedorId="prov-1" />)

    await waitFor(() => expect(screen.getByText("Valor a venta")).toBeInTheDocument())

    expect(screen.queryByText("Valor a costo")).not.toBeInTheDocument()
    expect(screen.getByText("Artículos")).toBeInTheDocument()
  })

  it("muestra 'Valor a costo' cuando el rol sí puede verlo", async () => {
    stubFetch({ ...base, valorCosto: 3000, margenEstimado: 5000 })

    // proveedorId distinto: la key de SWR es la URL y se cachea entre tests.
    render(<InventarioProveedorStats proveedorNombre="ACME" proveedorId="prov-2" />)

    await waitFor(() => expect(screen.getByText("Valor a costo")).toBeInTheDocument())
  })
})
