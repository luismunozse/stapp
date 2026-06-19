import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { CatalogoImagePlaceholder } from "@/components/catalogo-public/catalogo-image-placeholder"

describe("CatalogoImagePlaceholder", () => {
  it("renders the first letter of the name as an uppercase monogram", () => {
    render(<CatalogoImagePlaceholder name="Funda de silicona" />)
    expect(screen.getByText("F")).toBeInTheDocument()
  })

  it("skips non-alphanumeric leading chars", () => {
    render(<CatalogoImagePlaceholder name="  -¡123 abc" />)
    expect(screen.getByText("1")).toBeInTheDocument()
  })

  it("does not crash on an empty name (falls back to an icon)", () => {
    const { container } = render(<CatalogoImagePlaceholder name="" />)
    expect(container.querySelector("svg")).not.toBeNull()
  })

  it("applies the passed className to the container", () => {
    const { container } = render(
      <CatalogoImagePlaceholder name="Cable" className="custom-cls aspect-video" />,
    )
    expect(container.firstChild).toHaveClass("custom-cls")
    expect(container.firstChild).toHaveClass("aspect-video")
  })
})
