/**
 * El tooltip default de recharts es blanco fijo (ilegible en modo oscuro).
 * ChartTooltipContent usa los tokens del tema y respeta formatter/labelFormatter.
 */
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { ChartTooltipContent } from "@/components/ui/chart-tooltip"

describe("ChartTooltipContent", () => {
  it("no renderiza nada si no está activo", () => {
    const { container } = render(<ChartTooltipContent active={false} payload={[{ name: "x", value: 1 }]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("usa fondo y texto del tema", () => {
    const { container } = render(
      <ChartTooltipContent active label="Ene" payload={[{ name: "ingresos", value: 10, color: "red" }]} />
    )
    const caja = container.firstElementChild!
    expect(caja.className).toContain("bg-popover")
    expect(caja.className).toContain("text-popover-foreground")
    expect(caja.className).toContain("border-border")
    expect(screen.getByText("Ene")).toBeInTheDocument()
  })

  it("aplica formatter ([valor, nombre]) y labelFormatter como el tooltip de recharts", () => {
    render(
      <ChartTooltipContent
        active
        label="2026-01"
        labelFormatter={(l: string) => `Mes ${l}`}
        formatter={(v: number) => [`$ ${v}`, "Ingresos"]}
        payload={[{ name: "ingresos", dataKey: "ingresos", value: 1500, color: "red" }]}
      />
    )
    expect(screen.getByText("Mes 2026-01")).toBeInTheDocument()
    expect(screen.getByText("Ingresos")).toBeInTheDocument()
    expect(screen.getByText("$ 1500")).toBeInTheDocument()
  })

  it("si formatter devuelve solo el valor, conserva el nombre de la serie; hideLabel oculta el título", () => {
    render(
      <ChartTooltipContent
        active
        hideLabel
        label="oculto"
        formatter={(v: number) => `${v} órdenes`}
        payload={[{ name: "En reparación", value: 3, payload: { fill: "#f97316" } }]}
      />
    )
    expect(screen.queryByText("oculto")).not.toBeInTheDocument()
    expect(screen.getByText("En reparación")).toBeInTheDocument()
    expect(screen.getByText("3 órdenes")).toBeInTheDocument()
  })
})
