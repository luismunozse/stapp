import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { Button } from "@/components/ui/button"

describe("Button", () => {
  it("renders a <button> by default with variant classes", () => {
    render(<Button variant="outline">Guardar</Button>)
    const btn = screen.getByRole("button", { name: "Guardar" })
    expect(btn.tagName).toBe("BUTTON")
    expect(btn).toHaveClass("border") // outline variant
  })

  it("asChild renders the child element (anchor), not a wrapping button", () => {
    render(
      <Button asChild variant="outline">
        <a href="/destino">Ir</a>
      </Button>,
    )
    const link = screen.getByRole("link", { name: "Ir" })
    expect(link.tagName).toBe("A")
    expect(link).toHaveAttribute("href", "/destino")
    // The button styles are applied to the anchor itself
    expect(link).toHaveClass("border")
    // No nested <button> wrapper
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("does not leak the asChild prop to the DOM", () => {
    const { container } = render(
      <Button asChild>
        <a href="/x">x</a>
      </Button>,
    )
    const link = container.querySelector("a")
    expect(link).not.toBeNull()
    expect(link?.hasAttribute("aschild")).toBe(false)
    expect(link?.hasAttribute("asChild")).toBe(false)
  })

  it("forwards type and disabled on a real button", () => {
    render(
      <Button type="submit" disabled>
        Enviar
      </Button>,
    )
    const btn = screen.getByRole("button", { name: "Enviar" })
    expect(btn).toHaveAttribute("type", "submit")
    expect(btn).toBeDisabled()
  })
})
