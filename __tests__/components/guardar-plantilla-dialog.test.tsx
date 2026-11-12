import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { GuardarPlantillaDialog } from "@/components/cotizaciones/guardar-plantilla-dialog"

/** Reemplazo del `window.prompt("Nombre de la plantilla:")` de /cotizaciones. */
describe("GuardarPlantillaDialog", () => {
  it("no deja guardar con el nombre vacío o solo espacios", () => {
    render(<GuardarPlantillaDialog open onOpenChange={vi.fn()} onSubmit={vi.fn()} />)
    const guardar = screen.getByRole("button", { name: "Guardar plantilla" })
    expect(guardar).toBeDisabled()
    fireEvent.change(screen.getByLabelText("Nombre de la plantilla"), { target: { value: "   " } })
    expect(guardar).toBeDisabled()
  })

  it("envía el nombre recortado y cierra si se guardó", async () => {
    const onSubmit = vi.fn().mockResolvedValue(true)
    const onOpenChange = vi.fn()
    render(<GuardarPlantillaDialog open onOpenChange={onOpenChange} onSubmit={onSubmit} />)
    fireEvent.change(screen.getByLabelText("Nombre de la plantilla"), { target: { value: "  Cambio de módulo  " } })
    fireEvent.click(screen.getByRole("button", { name: "Guardar plantilla" }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("Cambio de módulo"))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it("queda abierto si el guardado falla", async () => {
    const onSubmit = vi.fn().mockResolvedValue(false)
    const onOpenChange = vi.fn()
    render(<GuardarPlantillaDialog open onOpenChange={onOpenChange} onSubmit={onSubmit} />)
    fireEvent.change(screen.getByLabelText("Nombre de la plantilla"), { target: { value: "Batería" } })
    fireEvent.click(screen.getByRole("button", { name: "Guardar plantilla" }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})
