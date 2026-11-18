/**
 * Paywall de /reportes: un taller Free tiene que ver la invitación a pasarse
 * de plan en las pestañas Profesionales, no un "Error al cargar datos" que
 * parece una falla del sistema.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import React from "react"

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ refresh: vi.fn() })),
  usePathname: vi.fn(() => "/reportes"),
}))

// Los gráficos reales se cargan con next/dynamic: acá se reemplazan por un
// marcador que dice qué módulo se pidió, para afirmar si se montó el gráfico o
// el bloqueo.
vi.mock("next/dynamic", () => ({
  default: (loader: () => Promise<unknown>) => {
    const src = loader.toString()
    const nombre = /reportes-avanzados\/([a-z-]+)/.exec(src)?.[1] ?? "desconocido"
    return function DynamicStub() {
      return <div data-testid={`grafico-${nombre}`} />
    }
  },
}))

vi.mock("@/components/reportes-avanzados/branch-scope-label", () => ({
  BranchScopeLabel: () => null,
}))

vi.mock("@/components/reportes-avanzados/export-button", () => ({
  ExportButton: ({ reportType }: { reportType: string }) => <button>Exportar {reportType}</button>,
}))

// recharts mide con ResizeObserver; para estos tests alcanza con que no rompa.
vi.mock("recharts", () => {
  const Passthrough = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>
  const Nothing = () => null
  return {
    BarChart: Passthrough,
    ResponsiveContainer: Passthrough,
    Bar: Nothing,
    XAxis: Nothing,
    YAxis: Nothing,
    CartesianGrid: Nothing,
    Tooltip: Nothing,
  }
})

import { ReportesAvanzadosView } from "@/components/reportes-avanzados/reportes-avanzados-view"
import { FallasComunesChart } from "@/components/reportes-avanzados/fallas-comunes-chart"

// components/ui/tabs es propio (no Radix): cambia de pestaña con click.
function abrirPestana(nombre: RegExp) {
  fireEvent.click(screen.getByRole("tab", { name: nombre }))
}

describe("ReportesAvanzadosView — pestañas Profesionales en Free", () => {
  beforeEach(() => vi.clearAllMocks())

  it("las pestañas libres montan su reporte aunque el plan sea Free", () => {
    render(<ReportesAvanzadosView reportesAvanzados={false} />)
    expect(screen.getByTestId("grafico-performance-tecnicos")).toBeInTheDocument()
    expect(screen.queryByText(/es una función Profesional/i)).toBeNull()
  })

  it("una pestaña Profesional muestra el bloqueo con CTA a planes y no monta el gráfico", () => {
    render(<ReportesAvanzadosView reportesAvanzados={false} />)
    abrirPestana(/fallas/i)

    expect(screen.getByText(/Fallas más comunes es una función Profesional/i)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /ver planes/i })).toHaveAttribute(
      "href",
      "/configuracion/billing?upgrade=reportes-avanzados&plan=profesional",
    )
    expect(screen.queryByTestId("grafico-fallas-comunes-chart")).toBeNull()
    // Exportar un reporte bloqueado solo devolvería otro 403.
    expect(screen.queryByRole("button", { name: /exportar/i })).toBeNull()
  })

  it("con el plan Profesional la misma pestaña monta el gráfico y se puede exportar", () => {
    render(<ReportesAvanzadosView reportesAvanzados />)
    abrirPestana(/fallas/i)

    expect(screen.getByTestId("grafico-fallas-comunes-chart")).toBeInTheDocument()
    expect(screen.queryByText(/es una función Profesional/i)).toBeNull()
    expect(screen.getByRole("button", { name: /exportar fallas-comunes/i })).toBeInTheDocument()
  })

  it("marca con candado solo las pestañas Profesionales", () => {
    render(<ReportesAvanzadosView reportesAvanzados={false} />)
    expect(screen.getAllByLabelText("Plan Profesional")).toHaveLength(6)
  })
})

describe("FallasComunesChart — respuesta de la API (defensa en profundidad)", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("ante un 403 FEATURE_REQUIRED muestra el bloqueo, no 'Error al cargar datos'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ error: "Este reporte requiere el plan Profesional", code: "FEATURE_REQUIRED" }),
            { status: 403 },
          ),
        ),
      ),
    )
    render(<FallasComunesChart />)

    expect(await screen.findByText(/es una función Profesional/i)).toBeInTheDocument()
    expect(screen.queryByText(/error al cargar datos/i)).toBeNull()
  })

  it("ante un 500 muestra el error y 'Reintentar' vuelve a pedir el reporte", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Error al obtener datos" }), { status: 500 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ falla: "Pantalla rota", cantidad: 4, porcentaje: 40 }] }), {
          status: 200,
        }),
      )
    vi.stubGlobal("fetch", fetchMock)
    render(<FallasComunesChart />)

    expect(await screen.findByText(/error al cargar datos/i)).toBeInTheDocument()
    expect(screen.queryByText(/es una función Profesional/i)).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: /reintentar/i }))

    await waitFor(() => expect(screen.getByText(/fallas más comunes/i)).toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
