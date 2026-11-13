import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { DanosConfig } from "@/components/configuracion/danos-config"

describe("DanosConfig", () => {
  it("el switch llama a onChange(true)", () => {
    const onChange = vi.fn()
    render(<DanosConfig obligatorio={false} onChange={onChange} allowEdit />)
    fireEvent.click(screen.getByRole("switch", { name: "Exigir estado físico al recibir un equipo" }))
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it("queda deshabilitado sin permiso de edición", () => {
    render(<DanosConfig obligatorio onChange={vi.fn()} allowEdit={false} />)
    expect(screen.getByRole("switch", { name: "Exigir estado físico al recibir un equipo" })).toBeDisabled()
  })
})
