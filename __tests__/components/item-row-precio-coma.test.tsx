import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { ItemRow } from "@/components/cotizaciones/item-row"

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `$${n}` }),
}))
vi.mock("@/contexts/modal-context", () => ({
  useModal: () => ({ confirm: vi.fn() }),
}))

describe("ItemRow (cotización) — precio con coma decimal", () => {
  it("actualiza precioUnitario con 1500,50 = 1500.5 (no 1500)", () => {
    const onUpdate = vi.fn()
    const item = { descripcion: "Servicio", cantidad: 1, precioUnitario: 0, descuentoValor: 0 }

    render(
      <ItemRow item={item} index={0} onUpdate={onUpdate} onRemove={() => {}} />
    )

    // item-row renderiza dos layouts (responsive); ambos usan el mismo state.
    const precioInputs = screen.getAllByPlaceholderText("Precio")
    fireEvent.change(precioInputs[0], { target: { value: "1500,50" } })

    expect(onUpdate).toHaveBeenCalledWith(0, "precioUnitario", 1500.5)
  })
})
