/**
 * EditarEquipoDialog: la corrección de los datos del equipo desde el detalle de
 * la orden. Lo que se cuida acá es qué viaja en el PUT — el detalle audita cada
 * update, así que mandar los cuatro campos siempre dejaría "cambios" que nadie
 * hizo en el historial de la orden.
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, act } from "@testing-library/react"
import { EditarEquipoDialog } from "@/components/ordenes/editar-equipo-dialog"

vi.mock("@/contexts/currency-context", () => ({
  useTerminologia: () => (key: string) => (key === "serie" ? "Numero de serie" : "Equipo"),
}))

const equipo = {
  dispositivo: "HP 240 G7",
  marca: "",
  color: "",
  imei: "",
}

function renderDialog(onSave = vi.fn().mockResolvedValue(true)) {
  const onOpenChange = vi.fn()
  render(
    <EditarEquipoDialog open onOpenChange={onOpenChange} equipo={equipo} onSave={onSave} />
  )
  return { onSave, onOpenChange }
}

async function guardar() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }))
  })
}

describe("EditarEquipoDialog", () => {
  it("no pisa lo que se esta tipeando cuando el detalle refresca la orden sola", async () => {
    // OrdenDetail repolea cada 15s y le pasa un objeto `equipo` nuevo en cada
    // vuelta: si el dialogo reaccionara a eso, el operador veria desaparecer lo
    // que estaba escribiendo sin haber tocado nada.
    const onSave = vi.fn().mockResolvedValue(true)
    const { rerender } = render(
      <EditarEquipoDialog open onOpenChange={vi.fn()} equipo={equipo} onSave={onSave} />
    )

    fireEvent.change(screen.getByLabelText("Marca"), { target: { value: "HP" } })
    rerender(
      <EditarEquipoDialog open onOpenChange={vi.fn()} equipo={{ ...equipo }} onSave={onSave} />
    )

    expect(screen.getByLabelText("Marca")).toHaveValue("HP")
    await guardar()
    expect(onSave).toHaveBeenCalledWith({ marca: "HP" })
  })

  it("al reabrirlo parte de lo guardado, no de lo que se descarto con Cancelar", async () => {
    const onSave = vi.fn().mockResolvedValue(true)
    const { rerender } = render(
      <EditarEquipoDialog open onOpenChange={vi.fn()} equipo={equipo} onSave={onSave} />
    )

    fireEvent.change(screen.getByLabelText("Marca"), { target: { value: "Descartar" } })
    rerender(
      <EditarEquipoDialog open={false} onOpenChange={vi.fn()} equipo={equipo} onSave={onSave} />
    )
    rerender(
      <EditarEquipoDialog open onOpenChange={vi.fn()} equipo={equipo} onSave={onSave} />
    )

    expect(screen.getByLabelText("Marca")).toHaveValue("")
  })

  it("manda solo los campos que cambiaron", async () => {
    const { onSave } = renderDialog()

    fireEvent.change(screen.getByLabelText("Marca"), { target: { value: "HP" } })
    await guardar()

    expect(onSave).toHaveBeenCalledWith({ marca: "HP" })
  })

  it("no dispara el PUT cuando no se toco nada", async () => {
    const { onSave, onOpenChange } = renderDialog()

    await guardar()

    expect(onSave).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("no deja guardar el equipo sin nombre: es el titulo del comprobante", async () => {
    const { onSave } = renderDialog()

    fireEvent.change(screen.getByLabelText("Modelo / descripción *"), { target: { value: "  " } })

    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled()
    await guardar()
    expect(onSave).not.toHaveBeenCalled()
  })

  it("mantiene el dialogo abierto si el servidor rechaza el cambio", async () => {
    const onSave = vi.fn().mockResolvedValue(false)
    const { onOpenChange } = renderDialog(onSave)

    fireEvent.change(screen.getByLabelText("Numero de serie"), { target: { value: "123" } })
    await guardar()

    expect(onSave).toHaveBeenCalledWith({ imei: "123" })
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})
