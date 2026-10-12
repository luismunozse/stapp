import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { AnalisisInventario } from "@/components/reportes-avanzados/analisis-inventario"

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({
    formatPrice: (n: number) => `$${n}`,
    formatDate: (d: string) => d,
  }),
}))

// recharts mide el contenedor con ResizeObserver y no aporta nada a este test.
vi.mock("recharts", () => {
  const Passthrough = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>
  const Nothing = () => null
  return {
    PieChart: Passthrough,
    ResponsiveContainer: Passthrough,
    Pie: Nothing,
    Cell: Nothing,
    Legend: Nothing,
    Tooltip: Nothing,
  }
})

// /api/reportes/analisis-inventario ahora devuelve null en el costo por item
// para los roles sin acceso a inventario. Pintarlo sin condición mostraba "$0",
// un precio real en vez de un permiso faltante.
describe("AnalisisInventario — costo por item nulo", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function payload(precioCompra: number | null, valorEnStock: number | null) {
    // Un único gate manda sobre todas las cifras de costo, así que el costo por
    // item nulo implica las de organización y la de categoría también nulas: un
    // payload con precioCompra en null y valorCompra con número no lo puede
    // producir la ruta. Las cifras visibles son distintas entre sí para que las
    // aserciones no choquen con las tarjetas del resumen.
    const oculto = precioCompra === null
    return {
      scope: "organization",
      resumen: {
        totalItems: 1,
        totalUnidades: 10,
        valorCompra: oculto ? null : 7777,
        valorVenta: 8888,
        margenPotencial: oculto ? null : 1111,
        itemsSinStock: 0,
        itemsStockCritico: 0,
        categorias: 1,
      },
      stockCritico: [],
      sinStock: [],
      porCategoria: [
        { categoria: "Repuestos", cantidad: 1, stockTotal: 42, valorTotal: oculto ? null : 5555 },
      ],
      masValiosos: [
        {
          id: "inv-1",
          codigo: "A1",
          nombre: "Pantalla",
          categoria: "Repuestos",
          stock: 13,
          precioCompra,
          precioVenta: 200,
          valorEnStock,
        },
      ],
      masVendidos: [],
    }
  }

  function stubFetch(body: Record<string, unknown>) {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: async () => body } as Response)),
    )
  }

  it("oculta el costo unitario y el valor en stock cuando vienen en null", async () => {
    stubFetch(payload(null, null))

    render(<AnalisisInventario />)

    await waitFor(() => expect(screen.getByText("Pantalla")).toBeInTheDocument())

    expect(screen.queryByText(/uds x \$/)).not.toBeInTheDocument()
    expect(screen.queryByText("$0")).not.toBeInTheDocument()
    // Lo que no es costo sigue disponible.
    expect(screen.getByText("13 uds")).toBeInTheDocument()
  })

  it("muestra el costo unitario y el valor en stock cuando el rol puede verlos", async () => {
    stubFetch(payload(100, 1000))

    render(<AnalisisInventario />)

    await waitFor(() => expect(screen.getByText("Pantalla")).toBeInTheDocument())

    expect(screen.getByText("13 uds x $100")).toBeInTheDocument()
    expect(screen.getByText("$1000")).toBeInTheDocument()
  })

  // El endpoint dejó de rankear masValiosos por valor cuando el rol no puede
  // ver costo: el orden por sí solo devolvía el ranking de costo. Ahora la
  // lista viene ordenada por stock, así que el título tiene que decir eso —
  // una card titulada "Más Valiosos" sobre una lista ordenada por unidades
  // miente, y el que la lee saca conclusiones de plata que la lista no tiene.
  it("titula la card por stock cuando el valor está oculto", async () => {
    stubFetch(payload(null, null))

    render(<AnalisisInventario />)

    await waitFor(() => expect(screen.getByText("Pantalla")).toBeInTheDocument())

    expect(screen.queryByText("Items Más Valiosos")).not.toBeInTheDocument()
    expect(screen.queryByText("Mayor valor en stock")).not.toBeInTheDocument()
    expect(screen.getByText("Items con más stock")).toBeInTheDocument()
    expect(screen.getByText("Mayor cantidad de unidades")).toBeInTheDocument()
  })

  it("mantiene el título por valor cuando el rol puede verlo", async () => {
    stubFetch(payload(100, 1000))

    render(<AnalisisInventario />)

    await waitFor(() => expect(screen.getByText("Pantalla")).toBeInTheDocument())

    expect(screen.getByText("Items Más Valiosos")).toBeInTheDocument()
    expect(screen.getByText("Mayor valor en stock")).toBeInTheDocument()
  })
})

/**
 * La ruta nullea TODA cifra derivada de precio_compra para los roles sin acceso
 * a costos: el costo por item, el total por categoría (una categoría puede
 * tener un único SKU) y también los totales de organización.
 *
 * El total de organización estaba exento con el argumento de que una sola cifra
 * sobre todo el inventario no se reduce a un item. Es falso: con totalItems ===
 * 1 —una org nueva, o de un solo SKU— valorCompra / totalUnidades ES el costo
 * unitario exacto, y las dos cifras viajaban juntas. Se ocultan las celdas en
 * vez de pintar el null como "$0", que es la convención de esta branch.
 */
describe("AnalisisInventario — agregados de costo nulos", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function payload(valorTotal: number | null) {
    const oculto = valorTotal === null
    return {
      scope: "organization",
      resumen: {
        totalItems: 1,
        totalUnidades: 42,
        valorCompra: oculto ? null : 7777,
        valorVenta: 8888,
        margenPotencial: oculto ? null : 1111,
        itemsSinStock: 0,
        itemsStockCritico: 0,
        categorias: 1,
      },
      stockCritico: [],
      sinStock: [],
      porCategoria: [{ categoria: "Repuestos", cantidad: 1, stockTotal: 42, valorTotal }],
      masValiosos: [],
      masVendidos: [],
    }
  }

  function stubFetch(body: Record<string, unknown>) {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: async () => body } as Response)),
    )
  }

  it("oculta el valor por categoría y su gráfico cuando viene en null", async () => {
    stubFetch(payload(null))

    render(<AnalisisInventario />)

    await waitFor(() => expect(screen.getByText("Repuestos")).toBeInTheDocument())

    expect(screen.getByText("1 items · 42 uds")).toBeInTheDocument()
    expect(screen.queryByText("Valor por Categoría")).not.toBeInTheDocument()
    expect(screen.queryByText("$0")).not.toBeInTheDocument()
  })

  it("oculta el total de organización y el margen cuando vienen en null", async () => {
    stubFetch(payload(null))

    render(<AnalisisInventario />)

    await waitFor(() => expect(screen.getByText("Repuestos")).toBeInTheDocument())

    expect(screen.queryByText("Valor Inventario")).not.toBeInTheDocument()
    expect(screen.queryByText("Margen Pot.")).not.toBeInTheDocument()
    expect(screen.queryByText("$0")).not.toBeInTheDocument()
  })

  // Lo que no es costo no cambia de tier: sigue a la vista.
  it("mantiene las cifras que no son de costo cuando el costo está oculto", async () => {
    stubFetch(payload(null))

    render(<AnalisisInventario />)

    await waitFor(() => expect(screen.getByText("Repuestos")).toBeInTheDocument())

    expect(screen.getByText("Total Items")).toBeInTheDocument()
    expect(screen.getByText("42 uds")).toBeInTheDocument()
    // "Stock Crítico" titula la tarjeta del resumen y también la card de abajo.
    expect(screen.getAllByText("Stock Crítico").length).toBeGreaterThan(0)
  })

  it("muestra el valor por categoría y las cifras de organización cuando el rol puede verlas", async () => {
    stubFetch(payload(5555))

    render(<AnalisisInventario />)

    await waitFor(() => expect(screen.getByText("Repuestos")).toBeInTheDocument())

    expect(screen.getByText("1 items · 42 uds · $5555")).toBeInTheDocument()
    expect(screen.getByText("Valor por Categoría")).toBeInTheDocument()
    expect(screen.getByText("Valor Inventario")).toBeInTheDocument()
    expect(screen.getByText("$7777")).toBeInTheDocument()
    expect(screen.getByText("Margen Pot.")).toBeInTheDocument()
    expect(screen.getByText("$1111")).toBeInTheDocument()
  })
})
