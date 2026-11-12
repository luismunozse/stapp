import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"
import { DiagramaDanos } from "@/components/ordenes/danos/diagrama-danos"
import { ListaDanos } from "@/components/ordenes/danos/lista-danos"
import type { PinVista } from "@/components/ordenes/danos/pin-vista"

const RECT = { left: 100, top: 200, width: 200, height: 400, right: 300, bottom: 600, x: 100, y: 200, toJSON: () => ({}) }

function mockRect() {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(RECT as DOMRect)
}

const pinsBase: PinVista[] = [
  { numero: 1, diagrama: "celular@1", vista: "frente", x: 0.2, y: 0.2, tipo: "rayon", nota: null },
  { numero: 2, diagrama: "celular@1", vista: "dorso", x: 0.5, y: 0.5, tipo: "golpe", nota: null },
]

afterEach(() => vi.restoreAllMocks())

describe("DiagramaDanos", () => {
  it("muestra pestañas Frente y Dorso y filtra pins por vista", () => {
    render(<DiagramaDanos diagrama="celular@1" pins={pinsBase} editable={false} />)
    expect(screen.getByRole("tab", { name: "Frente" })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "Dorso" })).toBeInTheDocument()
    expect(screen.getByLabelText("Daño 1: rayón, frente")).toBeInTheDocument()
    expect(screen.queryByLabelText(/Daño 2/)).toBeNull()
    fireEvent.click(screen.getByRole("tab", { name: "Dorso" }))
    expect(screen.getByLabelText("Daño 2: golpe, dorso")).toBeInTheDocument()
    expect(screen.queryByLabelText(/Daño 1/)).toBeNull()
  })

  it("clic editable abre el selector y agrega con coordenadas relativas", () => {
    mockRect()
    const onAgregar = vi.fn()
    render(<DiagramaDanos diagrama="celular@1" pins={[]} editable onAgregar={onAgregar} />)
    fireEvent.click(screen.getByTestId("diagrama-svg"), { clientX: 200, clientY: 300 })
    fireEvent.click(screen.getByRole("button", { name: /Golpe/ }))
    expect(onAgregar).toHaveBeenCalledWith({ vista: "frente", x: 0.5, y: 0.25, tipo: "golpe", nota: null })
  })

  it("clampea fuera de los bordes a [0,1]", () => {
    mockRect()
    const onAgregar = vi.fn()
    render(<DiagramaDanos diagrama="celular@1" pins={[]} editable onAgregar={onAgregar} />)
    fireEvent.click(screen.getByTestId("diagrama-svg"), { clientX: 100 + 200 * 1.05, clientY: 200 - 400 * 0.03 })
    fireEvent.click(screen.getByRole("button", { name: /Rayón/ }))
    expect(onAgregar).toHaveBeenCalledWith({ vista: "frente", x: 1, y: 0, tipo: "rayon", nota: null })
  })

  it("envía la nota tipeada antes de elegir el tipo", () => {
    mockRect()
    const onAgregar = vi.fn()
    render(<DiagramaDanos diagrama="celular@1" pins={[]} editable onAgregar={onAgregar} />)
    fireEvent.click(screen.getByTestId("diagrama-svg"), { clientX: 200, clientY: 300 })
    fireEvent.change(screen.getByLabelText("Nota del daño"), { target: { value: "pantalla" } })
    fireEvent.click(screen.getByRole("button", { name: /Rotura/ }))
    expect(onAgregar).toHaveBeenCalledWith(expect.objectContaining({ tipo: "rotura", nota: "pantalla" }))
  })

  it("en solo lectura el clic no abre nada", () => {
    mockRect()
    render(<DiagramaDanos diagrama="celular@1" pins={[]} editable={false} />)
    fireEvent.click(screen.getByTestId("diagrama-svg"), { clientX: 200, clientY: 300 })
    expect(screen.queryByText("¿Qué daño es?")).toBeNull()
  })

  it("el botón Agregar daño agrega en el centro de la vista actual", () => {
    const onAgregar = vi.fn()
    render(<DiagramaDanos diagrama="celular@1" pins={[]} editable onAgregar={onAgregar} />)
    fireEvent.click(screen.getByRole("button", { name: "Agregar daño" }))
    fireEvent.click(screen.getByRole("button", { name: /Golpe/ }))
    expect(onAgregar).toHaveBeenCalledWith({ vista: "frente", x: 0.5, y: 0.5, tipo: "golpe", nota: null })
  })

  it("agregar desde la pestaña Dorso envía vista dorso", () => {
    mockRect()
    const onAgregar = vi.fn()
    render(<DiagramaDanos diagrama="celular@1" pins={[]} editable onAgregar={onAgregar} />)
    fireEvent.click(screen.getByRole("tab", { name: "Dorso" }))
    fireEvent.click(screen.getByTestId("diagrama-svg"), { clientX: 200, clientY: 300 })
    fireEvent.click(screen.getByRole("button", { name: /Golpe/ }))
    expect(onAgregar).toHaveBeenCalledWith(expect.objectContaining({ vista: "dorso" }))
  })

  it("clic en un pin no abre el selector", () => {
    mockRect()
    render(<DiagramaDanos diagrama="celular@1" pins={pinsBase} editable />)
    fireEvent.click(screen.getByLabelText("Daño 1: rayón, frente"))
    expect(screen.queryByText("¿Qué daño es?")).toBeNull()
  })

  it("al abrir el selector la nota no tiene el foco y se resetea al reabrir", () => {
    render(<DiagramaDanos diagrama="celular@1" pins={[]} editable />)
    const abrir = () => fireEvent.click(screen.getByRole("button", { name: "Agregar daño" }))
    abrir()
    const nota = screen.getByLabelText("Nota del daño") as HTMLTextAreaElement
    expect(document.activeElement).not.toBe(nota)
    fireEvent.change(nota, { target: { value: "algo" } })
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }))
    expect(screen.queryByText("¿Qué daño es?")).toBeNull()
    abrir()
    expect((screen.getByLabelText("Nota del daño") as HTMLTextAreaElement).value).toBe("")
  })

  it("los botones del selector tienen min-h-11", () => {
    mockRect()
    render(<DiagramaDanos diagrama="celular@1" pins={[]} editable />)
    fireEvent.click(screen.getByTestId("diagrama-svg"), { clientX: 200, clientY: 300 })
    expect(screen.getByRole("button", { name: /Humedad/ }).className).toContain("min-h-11")
  })
})

describe("ListaDanos", () => {
  it("formatea la línea y omite la nota vacía", () => {
    render(
      <ListaDanos
        pins={[
          { ...pinsBase[1], numero: 1, tipo: "golpe", vista: "frente", nota: "pantalla" },
          { ...pinsBase[0], numero: 2, tipo: "rayon", vista: "dorso", nota: null },
        ]}
      />,
    )
    expect(screen.getByText("1. Golpe – Frente · pantalla")).toBeInTheDocument()
    expect(screen.getByText("2. Rayón – Dorso")).toBeInTheDocument()
  })

  it("muestra autor y fecha con mostrarAutor", () => {
    render(
      <ListaDanos
        mostrarAutor
        pins={[{ ...pinsBase[0], createdByNombre: "Ana Pérez", createdAt: "2026-11-12T15:00:00Z" }]}
      />,
    )
    expect(screen.getByText(/Ana Pérez/)).toBeInTheDocument()
    expect(screen.getByText(/2026/)).toBeInTheDocument()
  })

  it("los pins de recepción muestran candado y leyenda, sin botón de quitar", () => {
    render(
      <ListaDanos
        onBorrar={vi.fn()}
        pins={[{ ...pinsBase[0], momento: "recepcion", id: "a" }]}
      />,
    )
    expect(screen.getByText("Firmado por el cliente")).toBeInTheDocument()
    expect(screen.getByTestId("icono-candado")).toBeInTheDocument()
    expect(screen.queryByLabelText(/Quitar/)).toBeNull()
  })

  it("quita pins locales por número y borra los guardados por id", () => {
    const onQuitar = vi.fn()
    const onBorrar = vi.fn()
    render(
      <ListaDanos
        onQuitar={onQuitar}
        onBorrar={onBorrar}
        pins={[
          { ...pinsBase[0], numero: 1 },
          { ...pinsBase[1], numero: 2, id: "x", momento: "diagnostico" },
        ]}
      />,
    )
    fireEvent.click(screen.getByLabelText("Quitar daño 1"))
    fireEvent.click(screen.getByLabelText("Quitar daño 2"))
    expect(onQuitar).toHaveBeenCalledWith(1)
    expect(onBorrar).toHaveBeenCalledWith("x")
  })
})
