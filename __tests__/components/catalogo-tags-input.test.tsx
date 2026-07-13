// __tests__/components/catalogo-tags-input.test.tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { TagsInput } from "@/components/catalogo/tags-input"

function setup(value: string[] = [], onChange = vi.fn(), suggestions: string[] = []) {
  render(<TagsInput value={value} onChange={onChange} suggestions={suggestions} />)
  return { onChange }
}

describe("TagsInput", () => {
  it("Enter adds a trimmed tag", () => {
    const { onChange } = setup([])
    const input = screen.getByRole("textbox")
    fireEvent.change(input, { target: { value: "  rojo  " } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(onChange).toHaveBeenCalledWith(["rojo"])
  })

  it("comma adds a tag", () => {
    const { onChange } = setup([])
    const input = screen.getByRole("textbox")
    fireEvent.change(input, { target: { value: "azul" } })
    fireEvent.keyDown(input, { key: "," })
    expect(onChange).toHaveBeenCalledWith(["azul"])
  })

  it("ignores empty and dedups case-insensitively", () => {
    const onChange = vi.fn()
    setup(["Rojo"], onChange)
    const input = screen.getByRole("textbox")
    fireEvent.change(input, { target: { value: "   " } })
    fireEvent.keyDown(input, { key: "Enter" })
    fireEvent.change(input, { target: { value: "rojo" } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(onChange).not.toHaveBeenCalled()
  })

  it("X on a chip removes it", () => {
    const { onChange } = setup(["rojo", "azul"])
    fireEvent.click(screen.getByRole("button", { name: /quitar rojo/i }))
    expect(onChange).toHaveBeenCalledWith(["azul"])
  })

  it("Backspace on empty input removes the last tag", () => {
    const { onChange } = setup(["rojo", "azul"])
    const input = screen.getByRole("textbox")
    fireEvent.keyDown(input, { key: "Backspace" })
    expect(onChange).toHaveBeenCalledWith(["rojo"])
  })

  it("clicking a suggestion adds it", () => {
    const { onChange } = setup(["rojo"], vi.fn(), ["rojo", "oferta"])
    fireEvent.click(screen.getByRole("button", { name: /agregar oferta/i }))
    expect(onChange).toHaveBeenCalledWith(["rojo", "oferta"])
  })

  it("blur commits the pending draft so it is not silently lost", () => {
    const { onChange } = setup([])
    const input = screen.getByRole("textbox")
    fireEvent.change(input, { target: { value: "verde" } })
    fireEvent.blur(input)
    expect(onChange).toHaveBeenCalledWith(["verde"])
    expect(input).toHaveValue("")
  })

  it("blur with empty or duplicate draft does nothing", () => {
    const onChange = vi.fn()
    setup(["Rojo"], onChange)
    const input = screen.getByRole("textbox")
    fireEvent.change(input, { target: { value: "   " } })
    fireEvent.blur(input)
    fireEvent.change(input, { target: { value: "rojo" } })
    fireEvent.blur(input)
    expect(onChange).not.toHaveBeenCalled()
  })
})
