// __tests__/components/orden-costos-card.test.tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { OrdenCostosCard } from "@/components/ordenes/orden-costos-card"

describe("OrdenCostosCard — etiqueta de saldo vs. cobrado", () => {
  it("orden totalmente pagada: muestra 'Cobrado' una sola vez y el saldo no dice 'Cobrado'", () => {
    render(
      <OrdenCostosCard
        ordenId="orden-1"
        presupuesto={1000}
        costoFinal={1000}
        sena={0}
        totalCobrado={1000}
        descuentoCobro={0}
        estadoCobro="COBRADO"
        estado="REPARADO"
        onUpdateField={vi.fn()}
      />,
    )

    // El total realmente cobrado sigue mostrándose (línea verde original).
    const cobradoMatches = screen.getAllByText("Cobrado")
    expect(cobradoMatches).toHaveLength(1)

    // La línea de saldo se rotula "Saldo" y en pago completo muestra el
    // badge "Pagado" — nunca la palabra "Cobrado".
    expect(screen.getByText("Saldo")).toBeInTheDocument()
    expect(screen.getByText("Pagado")).toBeInTheDocument()
  })

  it("orden con saldo pendiente: la línea de saldo dice 'Saldo' con el monto adeudado", () => {
    render(
      <OrdenCostosCard
        ordenId="orden-2"
        presupuesto={1000}
        costoFinal={1000}
        sena={0}
        totalCobrado={400}
        descuentoCobro={0}
        estadoCobro="PARCIAL"
        estado="REPARADO"
        onUpdateField={vi.fn()}
      />,
    )

    expect(screen.queryAllByText("Cobrado")).toHaveLength(1) // solo el total cobrado real
    expect(screen.getByText("Saldo")).toBeInTheDocument()
    expect(screen.queryByText("Pagado")).not.toBeInTheDocument()
  })
})
