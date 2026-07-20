import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { CobrarOrdenDialog } from "@/components/ordenes/cobrar-orden-dialog"

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `$${n}` }),
}))
vi.mock("@/contexts/modal-context", () => ({
  useModal: () => ({ showError: vi.fn(), showSuccess: vi.fn() }),
}))
vi.mock("@/contexts/offline-context", () => ({
  useOffline: () => ({ offlineFetch: vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) }),
}))

const orden = {
  id: "o1",
  numeroOrden: 1,
  costoFinal: 1000,
  totalCobrado: 0,
  estadoCobro: "PENDIENTE",
  descuentoCobro: 0,
  clienteId: null,
}

describe("CobrarOrdenDialog — descuento al cobrar con coma decimal", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }))
  })

  it("interpreta un descuento de 100,50 como 100.5 (nuevo pendiente $899.5, no $900)", () => {
    render(
      <CobrarOrdenDialog open onOpenChange={() => {}} orden={orden} onSuccess={() => {}} />
    )

    fireEvent.click(screen.getByText("+ Aplicar descuento"))

    // El input de descuento es el último con placeholder "0.00" (después del de multi-pago).
    const inputs = screen.getAllByPlaceholderText("0.00")
    fireEvent.change(inputs[inputs.length - 1], { target: { value: "100,50" } })

    expect(screen.getByText(/Nuevo pendiente/).textContent).toContain("$899.5")
  })
})
