// __tests__/components/orden-estado-card.test.tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { OrdenEstadoCard } from "@/components/ordenes/orden-estado-card"
import type { EstadoOrden } from "@/types"

// Noon UTC anchor, as stored by the API (DEFAULT_TIMEZONE is Buenos Aires).
const PROMETIDA_ISO = "2030-03-15T12:00:00.000Z"

function renderCard(
  props: Partial<React.ComponentProps<typeof OrdenEstadoCard>> = {},
) {
  return render(
    <OrdenEstadoCard
      estado={"EN_REPARACION" as EstadoOrden}
      fechaIngreso="2030-03-01T12:00:00.000Z"
      fechaPrometida={PROMETIDA_ISO}
      updating={false}
      onUpdateEstado={vi.fn()}
      onUpdateFechaPrometida={vi.fn().mockResolvedValue(true)}
      {...props}
    />,
  )
}

describe("OrdenEstadoCard — fecha prometida editable", () => {
  it("muestra el botón de editar cuando la orden está activa y hay handler", () => {
    renderCard()
    expect(screen.getByRole("button", { name: "Editar fecha prometida" })).toBeInTheDocument()
  })

  it("no muestra el botón en estado terminal (ENTREGADO)", () => {
    renderCard({ estado: "ENTREGADO" as EstadoOrden })
    expect(screen.queryByRole("button", { name: "Editar fecha prometida" })).not.toBeInTheDocument()
  })

  it("no muestra el botón sin handler", () => {
    renderCard({ onUpdateFechaPrometida: undefined })
    expect(screen.queryByRole("button", { name: "Editar fecha prometida" })).not.toBeInTheDocument()
  })

  it("sin fecha y editable: ofrece 'Agregar'", () => {
    renderCard({ fechaPrometida: null })
    expect(screen.getByText("Prometida")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Agregar" })).toBeInTheDocument()
  })

  it("sin fecha y no editable: no renderiza la fila", () => {
    renderCard({ fechaPrometida: null, onUpdateFechaPrometida: undefined })
    expect(screen.queryByText("Prometida")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Agregar" })).not.toBeInTheDocument()
  })

  it("precarga el input con el día en la zona horaria del taller", () => {
    renderCard()
    fireEvent.click(screen.getByRole("button", { name: "Editar fecha prometida" }))
    expect(screen.getByLabelText("Fecha prometida")).toHaveValue("2030-03-15")
  })

  it("Guardar llama al handler con YYYY-MM-DD", async () => {
    const onUpdate = vi.fn().mockResolvedValue(true)
    renderCard({ onUpdateFechaPrometida: onUpdate })
    fireEvent.click(screen.getByRole("button", { name: "Editar fecha prometida" }))
    fireEvent.change(screen.getByLabelText("Fecha prometida"), { target: { value: "2030-04-02" } })
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }))
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith("2030-04-02"))
    await waitFor(() => expect(screen.queryByLabelText("Fecha prometida")).not.toBeInTheDocument())
  })

  it("Guardar con el input vacío llama al handler con null", async () => {
    const onUpdate = vi.fn().mockResolvedValue(true)
    renderCard({ onUpdateFechaPrometida: onUpdate })
    fireEvent.click(screen.getByRole("button", { name: "Editar fecha prometida" }))
    fireEvent.change(screen.getByLabelText("Fecha prometida"), { target: { value: "" } })
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }))
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(null))
  })

  it("Quitar llama al handler con null", async () => {
    const onUpdate = vi.fn().mockResolvedValue(true)
    renderCard({ onUpdateFechaPrometida: onUpdate })
    fireEvent.click(screen.getByRole("button", { name: "Editar fecha prometida" }))
    fireEvent.click(screen.getByRole("button", { name: "Quitar" }))
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(null))
  })

  it("'Quitar' no aparece cuando no hay fecha", () => {
    renderCard({ fechaPrometida: null })
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }))
    expect(screen.queryByRole("button", { name: "Quitar" })).not.toBeInTheDocument()
  })

  it("Cancelar cierra sin llamar al handler", () => {
    const onUpdate = vi.fn().mockResolvedValue(true)
    renderCard({ onUpdateFechaPrometida: onUpdate })
    fireEvent.click(screen.getByRole("button", { name: "Editar fecha prometida" }))
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }))
    expect(onUpdate).not.toHaveBeenCalled()
    expect(screen.queryByLabelText("Fecha prometida")).not.toBeInTheDocument()
  })

  it("Escape cancela sin llamar al handler", () => {
    const onUpdate = vi.fn().mockResolvedValue(true)
    renderCard({ onUpdateFechaPrometida: onUpdate })
    fireEvent.click(screen.getByRole("button", { name: "Editar fecha prometida" }))
    fireEvent.keyDown(screen.getByLabelText("Fecha prometida"), { key: "Escape" })
    expect(onUpdate).not.toHaveBeenCalled()
    expect(screen.queryByLabelText("Fecha prometida")).not.toBeInTheDocument()
  })

  it("si el handler devuelve false el editor queda abierto", async () => {
    const onUpdate = vi.fn().mockResolvedValue(false)
    renderCard({ onUpdateFechaPrometida: onUpdate })
    fireEvent.click(screen.getByRole("button", { name: "Editar fecha prometida" }))
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }))
    await waitFor(() => expect(onUpdate).toHaveBeenCalled())
    expect(screen.getByLabelText("Fecha prometida")).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole("button", { name: "Guardar" })).toBeEnabled())
  })
})
