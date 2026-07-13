import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { TipoConfigEditor } from "@/components/configuracion/tipo-config-editor"
import type { TipoDispositivoConfig } from "@/types"

function setup() {
  const config: TipoDispositivoConfig = {
    camposExtra: [{ key: "estado", label: "Estado", tipo: "select", opciones: ["Nuevo"] }],
  }
  const onSave = vi.fn().mockResolvedValue(undefined)
  render(
    <TipoConfigEditor
      tipoId="t1"
      tipoNombre="Celular"
      config={config}
      onSave={onSave}
      onClose={vi.fn()}
    />,
  )
  return { onSave }
}

describe("TipoConfigEditor — opciones de lista desplegable", () => {
  it("permite agregar varias opciones usando la coma como separador", () => {
    setup()
    // La opción preexistente se muestra como chip
    expect(screen.getByText("Nuevo")).toBeInTheDocument()

    const input = screen.getByPlaceholderText(/agregar opción/i)
    fireEvent.change(input, { target: { value: "Usado" } })
    fireEvent.keyDown(input, { key: "," })

    // La coma confirma la opción y queda un segundo chip
    expect(screen.getByText("Usado")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /quitar usado/i })).toBeInTheDocument()
  })

  it("guarda todas las opciones cargadas", () => {
    const { onSave } = setup()
    const input = screen.getByPlaceholderText(/agregar opción/i)

    fireEvent.change(input, { target: { value: "Usado" } })
    fireEvent.keyDown(input, { key: "Enter" })
    fireEvent.change(input, { target: { value: "Reacondicionado" } })
    fireEvent.keyDown(input, { key: "," })

    fireEvent.click(screen.getByRole("button", { name: /guardar/i }))

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        camposExtra: [
          expect.objectContaining({ opciones: ["Nuevo", "Usado", "Reacondicionado"] }),
        ],
      }),
    )
  })
})
