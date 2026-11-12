import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { Wallet } from "lucide-react"
import { SectionHeader } from "@/components/ui/section-header"
import { Card, CardContent } from "@/components/ui/card"
import { PageShell } from "@/components/ui/page-shell"

describe("SectionHeader", () => {
  it("dibuja un h2 con la escala de sección, descripción y acciones", () => {
    const { container } = render(
      <SectionHeader
        id="comisiones"
        title="Comisiones"
        description="Porcentaje sobre la ganancia"
        icon={Wallet}
        actions={<button type="button">Pagar</button>}
      />
    )
    const heading = screen.getByRole("heading", { level: 2, name: "Comisiones" })
    expect(heading).toHaveAttribute("id", "comisiones")
    expect(heading.className).toContain("text-title")
    expect(screen.getByText("Porcentaje sobre la ganancia")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Pagar" })).toBeInTheDocument()
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true")
  })

  it("permite bajar a h3 y omite descripción y acciones si no vienen", () => {
    const { container } = render(<SectionHeader as="h3" title="Historial" />)
    expect(screen.getByRole("heading", { level: 3, name: "Historial" })).toBeInTheDocument()
    expect(container.querySelector("p")).toBeNull()
    expect(screen.queryByRole("button")).toBeNull()
  })
})

describe("Card variants", () => {
  it("el default sigue siendo la tarjeta con borde y sombra", () => {
    render(<Card data-testid="card">x</Card>)
    const card = screen.getByTestId("card")
    expect(card).toHaveAttribute("data-variant", "default")
    expect(card.className).toContain("border")
    expect(card.className).toContain("shadow-sm")
    expect(card.className).toContain("bg-card")
  })

  it("flat no tiene borde, sombra ni fondo y alinea el contenido sin padding lateral", () => {
    render(
      <Card variant="flat" data-testid="card">
        <CardContent>x</CardContent>
      </Card>
    )
    const card = screen.getByTestId("card")
    expect(card).toHaveAttribute("data-variant", "flat")
    expect(card.className).not.toMatch(/(^|\s)border(\s|$)/)
    expect(card.className).not.toContain("shadow")
    expect(card.className).toContain("bg-transparent")
    expect(card.className).toContain("[&>div]:px-0")
  })

  it("section agrupa con fondo sutil y sin sombra", () => {
    render(<Card variant="section" data-testid="card">x</Card>)
    const card = screen.getByTestId("card")
    expect(card).toHaveAttribute("data-variant", "section")
    expect(card.className).toContain("bg-muted/30")
    expect(card.className).not.toContain("shadow")
  })

  it("respeta el className del llamador", () => {
    render(<Card variant="flat" className="mt-4" data-testid="card">x</Card>)
    expect(screen.getByTestId("card").className).toContain("mt-4")
  })
})

describe("PageShell", () => {
  it("muestra título, addon junto al título y meta bajo la descripción", () => {
    render(
      <PageShell
        title="Conteo de mayo"
        description="Detalle del conteo"
        titleAddon={<span>En progreso</span>}
        meta={<span>Última actualización: hoy</span>}
        backHref="/inventario/conteos"
        backLabel="Volver a conteos"
      >
        <div>contenido</div>
      </PageShell>
    )
    expect(screen.getByRole("heading", { level: 1, name: "Conteo de mayo" })).toBeInTheDocument()
    expect(screen.getByText("En progreso")).toBeInTheDocument()
    expect(screen.getByText("Última actualización: hoy")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Volver a conteos" })).toHaveAttribute(
      "href",
      "/inventario/conteos"
    )
  })
})
