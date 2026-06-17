// __tests__/components/catalogo-inline-edit-cell.test.tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { InlineEditCell } from "@/components/catalogo/inline-edit-cell"
import { parseStock } from "@/lib/catalogo/inline-edit"

function setup(onSave = vi.fn().mockResolvedValue(undefined), value: number | null = 5) {
  render(
    <InlineEditCell
      value={value}
      parse={parseStock}
      onSave={onSave}
      format={(v) => (v == null ? "—" : String(v))}
      ariaLabel="Editar stock"
    />,
  )
  return { onSave }
}

describe("InlineEditCell", () => {
  it("shows formatted value as a button", () => {
    setup(undefined, 5)
    expect(screen.getByRole("button", { name: "Editar stock" })).toHaveTextContent("5")
  })

  it("click reveals an input with the current value", () => {
    setup(undefined, 5)
    fireEvent.click(screen.getByRole("button", { name: "Editar stock" }))
    expect(screen.getByRole("spinbutton")).toHaveValue(5)
  })

  it("Enter with a changed valid value calls onSave with parsed value", async () => {
    const { onSave } = setup(vi.fn().mockResolvedValue(undefined), 5)
    fireEvent.click(screen.getByRole("button", { name: "Editar stock" }))
    const input = screen.getByRole("spinbutton")
    fireEvent.change(input, { target: { value: "8" } })
    fireEvent.keyDown(input, { key: "Enter" })
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(8))
  })

  it("Enter with unchanged value does NOT call onSave", async () => {
    const { onSave } = setup(vi.fn().mockResolvedValue(undefined), 5)
    fireEvent.click(screen.getByRole("button", { name: "Editar stock" }))
    const input = screen.getByRole("spinbutton")
    fireEvent.change(input, { target: { value: "5" } })
    fireEvent.keyDown(input, { key: "Enter" })
    await waitFor(() => expect(screen.getByRole("button", { name: "Editar stock" })).toBeInTheDocument())
    expect(onSave).not.toHaveBeenCalled()
  })

  it("invalid input does NOT call onSave and reverts", async () => {
    const { onSave } = setup(vi.fn().mockResolvedValue(undefined), 5)
    fireEvent.click(screen.getByRole("button", { name: "Editar stock" }))
    const input = screen.getByRole("spinbutton")
    fireEvent.change(input, { target: { value: "-3" } })
    fireEvent.keyDown(input, { key: "Enter" })
    await waitFor(() => expect(screen.getByRole("button", { name: "Editar stock" })).toHaveTextContent("5"))
    expect(onSave).not.toHaveBeenCalled()
  })

  it("Escape cancels without saving", () => {
    const { onSave } = setup(vi.fn().mockResolvedValue(undefined), 5)
    fireEvent.click(screen.getByRole("button", { name: "Editar stock" }))
    const input = screen.getByRole("spinbutton")
    fireEvent.change(input, { target: { value: "99" } })
    fireEvent.keyDown(input, { key: "Escape" })
    expect(screen.getByRole("button", { name: "Editar stock" })).toHaveTextContent("5")
    expect(onSave).not.toHaveBeenCalled()
  })
})
