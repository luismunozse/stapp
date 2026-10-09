import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { EditableTextField } from "@/components/ui/editable-text-field"

describe("EditableTextField - maxLength", () => {
  it("propaga maxLength al textarea de edicion", () => {
    render(<EditableTextField label="Trabajo" value="Hola" onSave={vi.fn()} maxLength={2000} />)
    fireEvent.click(screen.getByRole("button"))
    expect(screen.getByRole("textbox")).toHaveAttribute("maxlength", "2000")
  })

  it("sin maxLength no limita", () => {
    render(<EditableTextField label="Trabajo" value="Hola" onSave={vi.fn()} />)
    fireEvent.click(screen.getByRole("button"))
    expect(screen.getByRole("textbox")).not.toHaveAttribute("maxlength")
  })
})
