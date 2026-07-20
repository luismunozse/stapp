import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"
import { DevolucionForm } from "@/components/ventas/devolucion-form"

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `$${n}` }),
}))
vi.mock("@/contexts/modal-context", () => ({
  useModal: () => ({ showError: vi.fn(), showSuccess: vi.fn() }),
}))

// Venta 10×$100 con 10% de descuento de línea → el cliente pagó $900.
const venta = {
  id: "v1",
  numeroVenta: 1,
  total: 900,
  items: [
    {
      id: "iv1",
      inventarioId: null,
      descripcion: "Item con descuento",
      cantidad: 10,
      precioUnitario: 100,
      descuento: 0,
      tipoDescuento: "PORCENTAJE" as const,
      porcentajeDescuento: 10,
    },
  ],
}

describe("DevolucionForm — preview del reembolso neto (bug #2 follow-up)", () => {
  it("muestra el neto ($900) como Total a reembolsar, no el bruto ($1000)", () => {
    render(
      <DevolucionForm open onOpenChange={() => {}} venta={venta} onSuccess={() => {}} />
    )

    // Seleccionar el ítem (cantidad completa por defecto = 10).
    fireEvent.click(screen.getByRole("checkbox"))

    const totalRow = screen.getByText("Total a reembolsar:").closest("div") as HTMLElement
    expect(within(totalRow).getByText("$900")).toBeInTheDocument()
    expect(within(totalRow).queryByText("$1000")).not.toBeInTheDocument()
  })
})
