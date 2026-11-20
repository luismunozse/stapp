import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { TrabajosARealizarInput } from "@/components/ordenes/trabajos-a-realizar-input"

describe("TrabajosARealizarInput", () => {
  it("muestra un campo por trabajo guardado", () => {
    render(<TrabajosARealizarInput id="t" value={"Cambio de pantalla\nCambio de batería"} onCommit={vi.fn()} />)
    expect(screen.getByDisplayValue("Cambio de pantalla")).toBeInTheDocument()
    expect(screen.getByDisplayValue("Cambio de batería")).toBeInTheDocument()
  })

  it("agregar un trabajo y salir del campo guarda uno por línea", () => {
    const onCommit = vi.fn()
    render(<TrabajosARealizarInput id="t" value="Cambio de pantalla" onCommit={onCommit} />)
    fireEvent.click(screen.getByRole("button", { name: /Agregar trabajo/ }))
    const nuevo = screen.getByLabelText("Trabajo 2")
    fireEvent.change(nuevo, { target: { value: "Cambio de batería" } })
    fireEvent.blur(nuevo)
    expect(onCommit).toHaveBeenLastCalledWith("Cambio de pantalla\nCambio de batería")
  })

  it("quitar un trabajo lo guarda sin él", () => {
    const onCommit = vi.fn()
    render(<TrabajosARealizarInput id="t" value={"Cambio de pantalla\nCambio de batería"} onCommit={onCommit} />)
    fireEvent.click(screen.getByRole("button", { name: "Quitar Cambio de pantalla" }))
    expect(onCommit).toHaveBeenLastCalledWith("Cambio de batería")
  })

  it("no deja agregar otro campo mientras el último está vacío", () => {
    render(<TrabajosARealizarInput id="t" value={null} onCommit={vi.fn()} />)
    expect(screen.getByRole("button", { name: /Agregar trabajo/ })).toBeDisabled()
  })

  it("en modo formulario avisa en cada cambio", () => {
    const onCommit = vi.fn()
    render(<TrabajosARealizarInput id="t" value={null} onCommit={onCommit} commitOnChange />)
    fireEvent.change(screen.getByPlaceholderText("Ej: Cambio de batería"), { target: { value: "Cambio de pin" } })
    expect(onCommit).toHaveBeenLastCalledWith("Cambio de pin")
  })
})
