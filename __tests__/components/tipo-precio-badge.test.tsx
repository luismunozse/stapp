import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { TipoPrecioBadge } from "@/components/clientes/tipo-precio-badge"

describe("TipoPrecioBadge", () => {
  it("no renderiza nada para MINORISTA", () => {
    const { container } = render(<TipoPrecioBadge tipoPrecio="MINORISTA" />)
    expect(container).toBeEmptyDOMElement()
  })

  it("no renderiza nada cuando tipoPrecio es null/undefined", () => {
    const { container: c1 } = render(<TipoPrecioBadge tipoPrecio={null} />)
    expect(c1).toBeEmptyDOMElement()
    const { container: c2 } = render(<TipoPrecioBadge />)
    expect(c2).toBeEmptyDOMElement()
  })

  it("muestra 'Mayorista' para MAYORISTA sin magnitud (identidad, no depende del %)", () => {
    render(<TipoPrecioBadge tipoPrecio="MAYORISTA" />)
    expect(screen.getByText("Mayorista")).toBeInTheDocument()
  })

  it("muestra 'Mayorista' con magnitud incluso cuando descuentoPct es 0 (REQ-17.5)", () => {
    render(<TipoPrecioBadge tipoPrecio="MAYORISTA" descuentoPct={0} />)
    expect(screen.getByText("Mayorista")).toBeInTheDocument()
  })

  it("muestra la magnitud cuando se pasa descuentoPct > 0", () => {
    render(<TipoPrecioBadge tipoPrecio="MAYORISTA" descuentoPct={15} />)
    expect(screen.getByText("Mayorista −15%")).toBeInTheDocument()
  })
})
