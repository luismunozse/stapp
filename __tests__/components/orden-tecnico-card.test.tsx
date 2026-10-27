/**
 * The technician card lists the technicians of the branch that handles the order. An
 * order assigned to a technician of another branch (legacy: jed-electronics has San
 * Justo technicians on Tablada orders) must still show who has it, even though that
 * technician is not in the list, instead of reading "Sin asignar".
 */
import { describe, it, expect, vi } from "vitest"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { OrdenTecnicoCard } from "@/components/ordenes/orden-tecnico-card"

// Radix Select needs these from the browser to open under jsdom.
Element.prototype.hasPointerCapture = () => false
Element.prototype.scrollIntoView = () => {}

// A keyboard open is what Radix honours without PointerEvent, which jsdom does not have.
const abrir = (selector: HTMLElement) => fireEvent.keyDown(selector, { key: "ArrowDown" })

const DE_LA_SUCURSAL = [
  { id: "t-a", nombre: "Ana", email: "a@x.com", rol: "TECNICO" as const },
  { id: "t-a2", nombre: "Beto", email: "b@x.com", rol: "TECNICO" as const },
]
const DE_OTRA_SUCURSAL = { id: "t-b", nombre: "Carla", email: "c@x.com", rol: "TECNICO" as const }

const props = (extra: Record<string, unknown> = {}) => ({
  tecnicoId: "t-b",
  tecnicos: DE_LA_SUCURSAL,
  updating: false,
  onAsignarTecnico: vi.fn(),
  ...extra,
})

describe("OrdenTecnicoCard - assignee from another branch", () => {
  it("read-only: shows the assignee even though they are not in the list", () => {
    render(<OrdenTecnicoCard {...props({ readOnly: true, tecnicoActual: DE_OTRA_SUCURSAL })} />)

    expect(screen.getByText("Carla · otra sucursal")).toBeInTheDocument()
    expect(screen.queryByText("Sin asignar")).not.toBeInTheDocument()
  })

  it("read-only: still says Sin asignar when nobody is assigned", () => {
    render(<OrdenTecnicoCard {...props({ readOnly: true, tecnicoId: null, tecnicoActual: null })} />)

    expect(screen.getByText("Sin asignar")).toBeInTheDocument()
  })

  it("editable: the select shows the assignee and offers them next to the branch's technicians", async () => {
    render(<OrdenTecnicoCard {...props({ tecnicoActual: DE_OTRA_SUCURSAL })} />)

    const selector = screen.getByRole("combobox")
    expect(within(selector).getByText("Carla · otra sucursal")).toBeInTheDocument()

    abrir(selector)
    const opciones = (await screen.findAllByRole("option")).map((o) => o.textContent)
    expect(opciones).toEqual(["Sin asignar", "Ana", "Beto", "Carla · otra sucursal"])
  })

  it("an assignee who IS in the list is not marked", () => {
    render(<OrdenTecnicoCard {...props({ readOnly: true, tecnicoId: "t-a", tecnicoActual: DE_LA_SUCURSAL[0] })} />)

    expect(screen.getByText("Ana")).toBeInTheDocument()
    expect(screen.queryByText(/otra sucursal/)).not.toBeInTheDocument()
  })

  it("editable: an assignee who is in the list is not offered twice", async () => {
    render(
      <OrdenTecnicoCard
        {...props({ tecnicoId: "t-a", tecnicoActual: DE_LA_SUCURSAL[0] })}
      />,
    )

    abrir(screen.getByRole("combobox"))
    const opciones = (await screen.findAllByRole("option")).map((o) => o.textContent)
    expect(opciones).toEqual(["Sin asignar", "Ana", "Beto"])
  })

  it("editable: a previous assignee that is no longer the assignee is not offered", async () => {
    render(<OrdenTecnicoCard {...props({ tecnicoId: "t-otro", tecnicoActual: DE_OTRA_SUCURSAL })} />)

    abrir(screen.getByRole("combobox"))
    const opciones = (await screen.findAllByRole("option")).map((o) => o.textContent)
    expect(opciones).toEqual(["Sin asignar", "Ana", "Beto"])
  })

  it("editable: with nobody assigned the list is just the branch's technicians", async () => {
    render(<OrdenTecnicoCard {...props({ tecnicoId: null, tecnicoActual: null })} />)

    abrir(screen.getByRole("combobox"))
    const opciones = (await screen.findAllByRole("option")).map((o) => o.textContent)
    expect(opciones).toEqual(["Sin asignar", "Ana", "Beto"])
  })
})
