import { describe, it, expect, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { Trash2 } from "lucide-react"
import { IconButton } from "@/components/ui/icon-button"
import { Spinner } from "@/components/ui/spinner"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"

describe("IconButton", () => {
  it("usa el label como nombre accesible", () => {
    render(
      <IconButton label="Eliminar foto">
        <Trash2 />
      </IconButton>,
    )
    const btn = screen.getByRole("button", { name: "Eliminar foto" })
    expect(btn).toHaveAttribute("aria-label", "Eliminar foto")
    expect(btn).toHaveAttribute("data-touch-icon")
  })

  it("oculta el ícono a los lectores de pantalla", () => {
    const { container } = render(
      <IconButton label="Eliminar foto">
        <Trash2 />
      </IconButton>,
    )
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true")
  })

  it("es ghost por defecto y respeta la variante que le pases", () => {
    const { rerender } = render(
      <IconButton label="Cerrar">
        <Trash2 />
      </IconButton>,
    )
    expect(screen.getByRole("button")).not.toHaveClass("border")
    rerender(
      <IconButton label="Cerrar" variant="outline">
        <Trash2 />
      </IconButton>,
    )
    expect(screen.getByRole("button")).toHaveClass("border")
  })

  it("muestra el label como tooltip al enfocar", async () => {
    render(
      <IconButton label="Página siguiente">
        <Trash2 />
      </IconButton>,
    )
    fireEvent.focus(screen.getByRole("button", { name: "Página siguiente" }))
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Página siguiente")
  })

  it("con tooltip={false} no monta el tooltip pero mantiene el nombre", () => {
    render(
      <IconButton label="Cerrar" tooltip={false}>
        <Trash2 />
      </IconButton>,
    )
    fireEvent.focus(screen.getByRole("button", { name: "Cerrar" }))
    expect(screen.queryByRole("tooltip")).toBeNull()
  })

  it("dispara onClick y respeta disabled", () => {
    const onClick = vi.fn()
    const { rerender } = render(
      <IconButton label="Quitar" onClick={onClick}>
        <Trash2 />
      </IconButton>,
    )
    fireEvent.click(screen.getByRole("button", { name: "Quitar" }))
    expect(onClick).toHaveBeenCalledTimes(1)
    rerender(
      <IconButton label="Quitar" onClick={onClick} disabled>
        <Trash2 />
      </IconButton>,
    )
    expect(screen.getByRole("button", { name: "Quitar" })).toBeDisabled()
  })

  it("acepta loading", () => {
    render(
      <IconButton label="Enviar mensaje" loading>
        <Trash2 />
      </IconButton>,
    )
    const btn = screen.getByRole("button", { name: "Enviar mensaje" })
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute("aria-busy", "true")
  })

  it("funciona como hijo de un Trigger asChild", () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton label="Más acciones">
            <Trash2 />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Editar</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    )
    const btn = screen.getByRole("button", { name: "Más acciones" })
    expect(btn).toHaveAttribute("aria-expanded", "false")
    fireEvent.click(btn)
    expect(btn).toHaveAttribute("aria-expanded", "true")
  })
})

describe("Spinner", () => {
  it("tiene role status y un texto para lectores de pantalla", () => {
    render(<Spinner />)
    expect(screen.getByRole("status")).toHaveTextContent("Cargando…")
  })

  it("acepta un label propio", () => {
    render(<Spinner label="Buscando clientes…" />)
    expect(screen.getByRole("status")).toHaveTextContent("Buscando clientes…")
  })
})
