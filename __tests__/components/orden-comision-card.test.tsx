// __tests__/components/orden-comision-card.test.tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { OrdenComisionCard } from "@/components/ordenes/orden-comision-card"

describe("OrdenComisionCard — horas trabajadas", () => {
  it("muestra el input de 'Horas trabajadas' cuando hay técnico asignado", () => {
    render(
      <OrdenComisionCard
        ordenId="o"
        tecnicoId="t1"
        costoFinal={1000}
        repuestos={[]}
        porcentajeComision={10}
        horasTrabajadas={2}
        onUpdateField={vi.fn()}
      />,
    )
    expect(screen.getByText("Horas trabajadas")).toBeInTheDocument()
  })

  it("no renderiza nada (ni horas) cuando no hay técnico", () => {
    const { container } = render(
      <OrdenComisionCard
        ordenId="o"
        tecnicoId={null}
        costoFinal={1000}
        repuestos={[]}
        porcentajeComision={10}
        horasTrabajadas={2}
        onUpdateField={vi.fn()}
      />,
    )
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByText("Horas trabajadas")).not.toBeInTheDocument()
  })
})
