import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { EstadoFisico } from "@/components/seguimiento/estado-fisico"
import { ListaDanos } from "@/components/ordenes/danos/lista-danos"

const pin = (numero: number, momento: "recepcion" | "diagnostico") => ({
  numero, momento, diagrama: "celular", vista: "frente" as const, x: 0.4, y: 0.4, tipo: "rayon" as const, nota: null,
  id: `d${numero}`, createdAt: "2026-11-12T10:00:00Z",
})

describe("EstadoFisico (seguimiento público)", () => {
  it("un pin de diagnóstico dice 'Detectado por el técnico'", () => {
    render(<EstadoFisico data={{ danos: [pin(1, "recepcion"), pin(2, "diagnostico")], sinDanos: false, diagrama: "celular" }} />)
    expect(screen.getByText("Estado físico")).toBeTruthy()
    expect(screen.getAllByText("Detectado por el técnico")).toHaveLength(1)
  })

  it("sin pins y sin 'sin daños' no se renderiza", () => {
    const { container } = render(<EstadoFisico data={{ danos: [], sinDanos: false, diagrama: "celular" }} />)
    expect(container.innerHTML).toBe("")
  })

  it("sin daños declarado muestra el mensaje", () => {
    render(<EstadoFisico data={{ danos: [], sinDanos: true, diagrama: "celular" }} />)
    expect(screen.getByText("El equipo se recibió sin daños visibles.")).toBeTruthy()
  })
})

describe("ListaDanos etiquetaDiagnostico", () => {
  it("solo se muestra en pins de diagnóstico y si se pasa la prop", () => {
    const pins = [pin(1, "recepcion"), pin(2, "diagnostico")]
    const { rerender } = render(<ListaDanos pins={pins} />)
    expect(screen.queryByText("Detectado por el técnico")).toBeNull()
    rerender(<ListaDanos pins={pins} etiquetaDiagnostico="Detectado por el técnico" />)
    expect(screen.getAllByText("Detectado por el técnico")).toHaveLength(1)
  })
})
