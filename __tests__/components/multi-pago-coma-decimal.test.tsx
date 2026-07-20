import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { MultiPagoInput, createPagoLine } from "@/components/pagos/multi-pago-input"

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `$${n}` }),
}))

describe("MultiPagoInput — monto del pago con coma decimal", () => {
  it("parsea 1500,50 como 1500.5 en el monto del pago (no 1500)", () => {
    const onChange = vi.fn()
    render(
      <MultiPagoInput montoPendiente={2000} pagos={[createPagoLine(0)]} onChange={onChange} />
    )

    fireEvent.change(screen.getByPlaceholderText("0.00"), {
      target: { value: "1500,50" },
    })

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ monto: 1500.5 }),
    ])
  })
})
