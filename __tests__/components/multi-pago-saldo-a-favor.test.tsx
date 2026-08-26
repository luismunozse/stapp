// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { MultiPagoInput, createPagoLine } from "@/components/pagos/multi-pago-input"

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `$${n}` }),
}))

// CUENTA_CORRIENTE as a payment method spends the credit the client already
// deposited (every consumer routes it to usar_cuenta_corriente, which refuses
// to overdraw). Calling it "Cuenta" made cashiers read it as "sell on credit"
// and look for it to fiar a sale, which it can never do.
describe("MultiPagoInput — la cuenta corriente se llama saldo a favor", () => {
  it("etiqueta el método CUENTA_CORRIENTE como 'Saldo a favor'", () => {
    render(
      <MultiPagoInput
        montoPendiente={1000}
        pagos={[createPagoLine(1000)]}
        onChange={() => {}}
        saldoCuenta={5000}
        showCuentaCorriente
      />
    )

    expect(screen.getByText("Saldo a favor")).toBeInTheDocument()
    expect(screen.queryByText("Cuenta")).toBeNull()
  })
})
