import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { CierreDialog } from "@/components/caja/cierre-dialog"

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `$${n}` }),
}))

describe("CierreDialog — arqueo con coma decimal (bug input es-AR)", () => {
  it("interpreta 1500,50 como 1500.5, no como 1500", () => {
    render(
      <CierreDialog
        open
        onOpenChange={() => {}}
        sesionId="s1"
        saldoInicial={1000}
        totalIngresosEfectivo={0}
        totalEgresosEfectivo={0}
        onSuccess={() => {}}
      />
    )

    // Cajero cuenta $1500,50 en efectivo (coma decimal del teclado es-AR).
    fireEvent.change(screen.getByPlaceholderText("0.00"), {
      target: { value: "1500,50" },
    })

    // esperado = 1000 → diferencia = 500,50 (sobrante), NO 500.
    expect(screen.getByText("$500.5")).toBeInTheDocument()
    expect(screen.queryByText("$500")).not.toBeInTheDocument()
  })
})
