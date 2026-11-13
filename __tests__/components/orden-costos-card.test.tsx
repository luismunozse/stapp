// __tests__/components/orden-costos-card.test.tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { OrdenCostosCard } from "@/components/ordenes/orden-costos-card"

describe("OrdenCostosCard — etiqueta de saldo vs. cobrado", () => {
  it("orden totalmente pagada: 'Cobrado' aparece una sola vez (con su importe) y el saldo queda en $0", () => {
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

    // La línea del total cobrado dice "Cobrado" con su importe; la de saldo
    // muestra $0 y no repite la píldora "Cobrado".
    expect(screen.getAllByText("Cobrado")).toHaveLength(1)
    const saldo = screen.getByText("Saldo").parentElement!
    expect(saldo).toHaveTextContent(/\$\s?0(,00)?$/)
    expect(screen.queryByText("Pagado")).not.toBeInTheDocument()
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

describe("OrdenCostosCard — card consciente del estado", () => {
  it("fase cotización (PRESUPUESTADO): muestra 'Presupuesto' y NO 'Costo final'", () => {
    render(
      <OrdenCostosCard
        ordenId="o"
        presupuesto={1000}
        costoFinal={null}
        sena={0}
        estado="PRESUPUESTADO"
        onUpdateField={vi.fn()}
      />,
    )
    expect(screen.getByText("Presupuesto")).toBeInTheDocument()
    expect(screen.queryByText("Costo final")).not.toBeInTheDocument()
  })

  it("fase facturación (EN_REPARACION): muestra 'Costo final' y el presupuesto como contexto read-only", () => {
    render(
      <OrdenCostosCard
        ordenId="o"
        presupuesto={1000}
        costoFinal={1500}
        sena={0}
        estado="EN_REPARACION"
        onUpdateField={vi.fn()}
      />,
    )
    expect(screen.getByText("Costo final")).toBeInTheDocument()
    expect(screen.getByText(/Presupuesto estimado/i)).toBeInTheDocument()
  })

  it("flujo express (facturación sin presupuesto): no muestra la línea de presupuesto estimado", () => {
    render(
      <OrdenCostosCard
        ordenId="o"
        presupuesto={null}
        costoFinal={1500}
        sena={0}
        estado="EN_REPARACION"
        onUpdateField={vi.fn()}
      />,
    )
    expect(screen.getByText("Costo final")).toBeInTheDocument()
    expect(screen.queryByText(/Presupuesto estimado/i)).not.toBeInTheDocument()
  })

  it("ya no renderiza 'Horas trabajadas' (se movió a la card de comisión)", () => {
    render(
      <OrdenCostosCard
        ordenId="o"
        presupuesto={null}
        costoFinal={1500}
        sena={0}
        estado="EN_REPARACION"
        onUpdateField={vi.fn()}
      />,
    )
    expect(screen.queryByText("Horas trabajadas")).not.toBeInTheDocument()
  })
})

describe("OrdenCostosCard — notas de crédito", () => {
  it("lo que bajaron la deuda las NC cuenta para el saldo", () => {
    render(
      <OrdenCostosCard
        ordenId="o-nc"
        presupuesto={1000}
        costoFinal={1000}
        sena={0}
        totalCobrado={400}
        descuentoCobro={0}
        aplicadoNotasCredito={600}
        estadoCobro="PARCIAL"
        estado="ENTREGADO"
        onUpdateField={vi.fn()}
      />,
    )

    // 1000 - 400 cobrado - 600 de NC = 0: el saldo queda en $0, no debe $600.
    const saldo = screen.getByText("Saldo").parentElement!
    expect(saldo).toHaveTextContent(/\$\s?0(,00)?$/)
    expect(screen.getAllByText("Cobrado")).toHaveLength(1)
  })
})
