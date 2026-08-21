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
    return {
      scope: "organization",
      // Cifras de organización distintas del valor por item, para que las
      // aserciones de abajo no choquen con las tarjetas del resumen.
      resumen: {
        totalItems: 1,
        totalUnidades: 10,
        valorCompra: 7777,
        valorVenta: 8888,
        margenPotencial: 1111,
        itemsSinStock: 0,
        itemsStockCritico: 0,
        categorias: 1,
      },
      stockCritico: [],
      sinStock: [],
      porCategoria: [{ categoria: "Repuestos", cantidad: 1, stockTotal: 42, valorTotal: 5555 }],
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
})

/**
 * La misma ruta devuelve ahora en null los agregados de costo que se pueden
 * reducir a un solo item: porCategoria[].valorTotal (una categoría puede tener
 * un único SKU) y resumen.margenPotencial (derivado del costo). El total de
 * organización resumen.valorCompra sigue visible.
 */
describe("AnalisisInventario — agregados de costo por categoría nulos", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function payload(valorTotal: number | null, margenPotencial: number | null) {
    return {
      scope: "organization",
      resumen: {
        totalItems: 1,
        totalUnidades: 42,
        valorCompra: 7777,
        valorVenta: 8888,
        margenPotencial,
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

  it("oculta el valor por categoría y el margen cuando vienen en null", async () => {
    stubFetch(payload(null, null))

    render(<AnalisisInventario />)

    await waitFor(() => expect(screen.getByText("Repuestos")).toBeInTheDocument())

    expect(screen.getByText("1 items · 42 uds")).toBeInTheDocument()
    expect(screen.queryByText("Margen Pot.")).not.toBeInTheDocument()
    expect(screen.queryByText("Valor por Categoría")).not.toBeInTheDocument()
    expect(screen.queryByText("$0")).not.toBeInTheDocument()
    // El total de organización sigue disponible.
    expect(screen.getByText("Valor Inventario")).toBeInTheDocument()
    expect(screen.getByText("$7777")).toBeInTheDocument()
  })

  it("muestra el valor por categoría y el margen cuando el rol puede verlos", async () => {
    stubFetch(payload(5555, 1111))

    render(<AnalisisInventario />)

    await waitFor(() => expect(screen.getByText("Repuestos")).toBeInTheDocument())

    expect(screen.getByText("1 items · 42 uds · $5555")).toBeInTheDocument()
    expect(screen.getByText("Margen Pot.")).toBeInTheDocument()
    expect(screen.getByText("$1111")).toBeInTheDocument()
    expect(screen.getByText("Valor por Categoría")).toBeInTheDocument()
  })
})
