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
