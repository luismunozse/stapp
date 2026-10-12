import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({
    formatPrice: (n: number) => `$${n}`,
    formatDate: (d: string) => d,
    timezone: "America/Argentina/Buenos_Aires",
  }),
}))

// recharts mide el contenedor con ResizeObserver y no aporta nada a estos
// tests. Bar se pinta como un nodo con su dataKey para poder afirmar qué
// series quedaron en el gráfico.
vi.mock("recharts", () => {
  const Passthrough = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>
  const Nothing = () => null
  return {
    BarChart: Passthrough,
    ResponsiveContainer: Passthrough,
    Bar: ({ dataKey }: { dataKey: string }) => <div data-testid={`bar-${dataKey}`} />,
    XAxis: Nothing,
    YAxis: Nothing,
    CartesianGrid: Nothing,
    Tooltip: Nothing,
    Legend: Nothing,
  }
})

const mockSWR = vi.fn()
vi.mock("swr", () => ({ default: (...args: unknown[]) => mockSWR(...args) }))

import { RentabilidadTecnicos } from "@/components/reportes-avanzados/rentabilidad-tecnicos"
import { RentabilidadChart } from "@/components/reportes-avanzados/rentabilidad-chart"
import { VentasDashboard } from "@/components/ventas/ventas-dashboard"

function stubFetch(body: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ ok: true, json: async () => body } as Response)),
  )
}

/**
 * Las tres rutas hermanas devuelven null en toda cifra derivada de
 * precio_compra para los roles sin acceso a costos. La convención de esta
 * branch es ocultar la cifra, nunca pintar el null como "$0": un cero se lee
 * como una ganancia real de cero, no como un permiso faltante.
 */

describe("RentabilidadTecnicos — costo de repuestos nulo", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  // El componente formatea con su propio Intl, no con el currency-context
  // mockeado, así que las aserciones usan el mismo formateador. Intl separa
  // con U+00A0 y testing-library normaliza a espacio común: hay que normalizar
  // el esperado o nunca matchea.
  const ars = (n: number) =>
    new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: "ARS",
      minimumFractionDigits: 0,
    })
      .format(n)
      .replace(/\u00a0/g, " ")

  function payload(oculto: boolean) {
    return {
      data: [
        {
          tecnicoId: "tec-1",
          nombre: "Ana Torres",
          ordenes: 3,
          horasTrabajadas: 12,
          ingresos: 7777,
          costoRepuestos: oculto ? null : 1111,
          costoManoObra: 2222,
          comision: oculto ? null : 3333,
          ganancia: oculto ? null : 4444,
          margen: oculto ? null : 57,
          gananciaPorHora: oculto ? null : 5555,
        },
      ],
      totales: {
        tecnicos: 1,
        ingresos: 7777,
        ganancia: oculto ? null : 6666,
        horas: 12,
      },
      margenPromedio: oculto ? null : 57,
      periodo: { desde: "2026-08-01T00:00:00.000Z", hasta: "2026-08-31T23:59:59.999Z" },
    }
  }

  it("oculta el costo de repuestos y toda la clausura que lo devuelve", async () => {
    stubFetch(payload(true))

    render(<RentabilidadTecnicos />)

    await waitFor(() => expect(screen.getByText("Ana Torres")).toBeInTheDocument())

    // Columnas de costo fuera de la tabla.
    expect(screen.queryByText("Repuestos")).not.toBeInTheDocument()
    expect(screen.queryByText("Comisión")).not.toBeInTheDocument()
    expect(screen.queryByText("Ganancia")).not.toBeInTheDocument()
    expect(screen.queryByText("Margen %")).not.toBeInTheDocument()
    expect(screen.queryByText("Gan./hora")).not.toBeInTheDocument()
    // Tarjetas de costo fuera del resumen, y el gráfico entero es ganancia.
    expect(screen.queryByText("Ganancia total")).not.toBeInTheDocument()
    expect(screen.queryByText("Margen promedio")).not.toBeInTheDocument()
    expect(screen.queryByText("Ganancia por Técnico")).not.toBeInTheDocument()
    // Nada de nulls pintados como cero.
    expect(screen.queryByText(ars(0))).not.toBeInTheDocument()
    expect(screen.queryByText("0%")).not.toBeInTheDocument()
  })

  it("mantiene visible lo que no deriva de precio_compra", async () => {
    stubFetch(payload(true))

    render(<RentabilidadTecnicos />)

    await waitFor(() => expect(screen.getByText("Ana Torres")).toBeInTheDocument())

    expect(screen.getByText("Técnicos")).toBeInTheDocument()
    expect(screen.getByText("Horas totales")).toBeInTheDocument()
    expect(screen.getByText("Ingresos")).toBeInTheDocument()
    // Mano de obra es costo propio, otro tier: sigue a la vista.
    expect(screen.getByText("Mano de obra")).toBeInTheDocument()
    expect(screen.getByText(ars(7777))).toBeInTheDocument()
    expect(screen.getByText(ars(2222))).toBeInTheDocument()
  })

  it("muestra la clausura completa cuando el rol puede ver costos", async () => {
    stubFetch(payload(false))

    render(<RentabilidadTecnicos />)

    await waitFor(() => expect(screen.getByText("Ana Torres")).toBeInTheDocument())

    expect(screen.getByText("Repuestos")).toBeInTheDocument()
    expect(screen.getByText("Ganancia total")).toBeInTheDocument()
    expect(screen.getByText("Margen promedio")).toBeInTheDocument()
    expect(screen.getByText("Ganancia por Técnico")).toBeInTheDocument()
    expect(screen.getByText(ars(1111))).toBeInTheDocument()
    expect(screen.getByText(ars(6666))).toBeInTheDocument()
  })
})

describe("RentabilidadChart — costos nulos", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function payload(oculto: boolean) {
    return {
      data: [
        {
          tipoDispositivo: "CELULAR",
          ingresos: 7777,
          costos: oculto ? null : 1111,
          costoManoObra: 2222,
          ganancia: oculto ? null : 6666,
          margen: oculto ? null : 85,
          cantidad: 4,
        },
      ],
      margenPromedio: oculto ? null : 85,
    }
  }

  it("saca las series y los totales de costo cuando vienen en null", async () => {
    stubFetch(payload(true))

    render(<RentabilidadChart />)

    await waitFor(() => expect(screen.getByTestId("bar-Ingresos")).toBeInTheDocument())

    expect(screen.queryByTestId("bar-Costos")).not.toBeInTheDocument()
    expect(screen.queryByTestId("bar-Margen")).not.toBeInTheDocument()
    expect(screen.queryByText("Total Costos")).not.toBeInTheDocument()
    expect(screen.queryByText("Margen Total")).not.toBeInTheDocument()
    expect(screen.getByText("Total Ingresos")).toBeInTheDocument()
    expect(screen.queryByText("$0")).not.toBeInTheDocument()
  })

  // Un gráfico titulado "Rentabilidad" que solo tiene ingresos miente: el que
  // lo lee saca conclusiones de margen que la serie no tiene. Mismo criterio
  // que "Items Más Valiosos" cuando la lista pasó a ordenarse por stock.
  it("retitula el gráfico cuando no hay costos que mostrar", async () => {
    stubFetch(payload(true))

    render(<RentabilidadChart />)

    await waitFor(() => expect(screen.getByTestId("bar-Ingresos")).toBeInTheDocument())

    expect(screen.queryByText("Rentabilidad por Tipo de Dispositivo")).not.toBeInTheDocument()
    expect(screen.getByText("Ingresos por Tipo de Dispositivo")).toBeInTheDocument()
  })

  it("muestra costos y margen cuando el rol puede verlos", async () => {
    stubFetch(payload(false))

    render(<RentabilidadChart />)

    await waitFor(() => expect(screen.getByTestId("bar-Ingresos")).toBeInTheDocument())

    expect(screen.getByTestId("bar-Costos")).toBeInTheDocument()
    expect(screen.getByTestId("bar-Margen")).toBeInTheDocument()
    expect(screen.getByText("Total Costos")).toBeInTheDocument()
    expect(screen.getByText("Margen Total")).toBeInTheDocument()
    expect(screen.getByText("Rentabilidad por Tipo de Dispositivo")).toBeInTheDocument()
  })
})

describe("VentasDashboard — margen bruto nulo", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    mockSWR.mockReset()
  })

  function payload(oculto: boolean) {
    return {
      ventasHoy: { count: 1, total: 100 },
      ventasSemana: { count: 2, total: 200 },
      ventasMes: { count: 3, total: 300 },
      ticketPromedio: 100,
      topProductos: [],
      topVendedores: [],
      ventasPorMetodoPago: [],
      ventasPorDia: [],
      margenBruto: {
        totalVentas: 7777,
        totalCosto: oculto ? null : 1111,
        margen: oculto ? null : 6666,
        porcentaje: oculto ? null : 85.7,
      },
      descuentosOtorgados: { totalDescuentos: 0, cantidadConDescuento: 0, promedioDescuento: 0 },
      tasaAnulacion: { total: 3, anuladas: 0, porcentaje: 0 },
    }
  }

  it("oculta la tarjeta de margen bruto cuando el costo viene en null", () => {
    mockSWR.mockReturnValue({ data: payload(true), isLoading: false })

    render(<VentasDashboard />)

    expect(screen.queryByText("Margen Bruto")).not.toBeInTheDocument()
    // Las cifras de facturación no cambian de tier.
    expect(screen.getByText("Ventas Hoy")).toBeInTheDocument()
    expect(screen.getByText("Ticket Promedio")).toBeInTheDocument()
  })

  it("muestra el margen bruto cuando el rol puede verlo", () => {
    mockSWR.mockReturnValue({ data: payload(false), isLoading: false })

    render(<VentasDashboard />)

    expect(screen.getByText("Margen Bruto")).toBeInTheDocument()
    expect(screen.getByText("85.7%")).toBeInTheDocument()
    expect(screen.getByText("$6666")).toBeInTheDocument()
  })
})
