import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { CierreDialog } from "@/components/caja/cierre-dialog"

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `$${n}` }),
}))

function renderDialog(props: { saldoInicial: number; ingresos: number; egresos?: number }) {
  render(
    <CierreDialog
      open
      onOpenChange={() => {}}
      sesionId="s1"
      saldoInicial={props.saldoInicial}
      totalIngresosEfectivo={props.ingresos}
      totalEgresosEfectivo={props.egresos ?? 0}
      onSuccess={() => {}}
    />
  )
}

describe("CierreDialog — redondeo del arqueo (ruido de float)", () => {
  it("ingresos 0.1 + 0.2 sin redondear y contado 0,3 → Caja cuadrada, no Faltante", () => {
    renderDialog({ saldoInicial: 0, ingresos: 0.1 + 0.2 })
    fireEvent.change(screen.getByPlaceholderText("0,00"), { target: { value: "0,3" } })

    expect(screen.getByText("Caja cuadrada")).toBeInTheDocument()
    expect(screen.queryByText("Faltante")).not.toBeInTheDocument()
    expect(screen.queryByText("Sobrante")).not.toBeInTheDocument()
  })

  it("una diferencia real de un centavo sigue mostrándose como Faltante", () => {
    renderDialog({ saldoInicial: 0, ingresos: 0.1 + 0.2 })
    fireEvent.change(screen.getByPlaceholderText("0,00"), { target: { value: "0,29" } })

    expect(screen.getByText("Faltante")).toBeInTheDocument()
    expect(screen.getByText("$0.01")).toBeInTheDocument()
  })
})
