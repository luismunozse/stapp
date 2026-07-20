import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { PosProductSearch } from "@/components/pos/pos-product-search"

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `$${n}` }),
}))

describe("PosProductSearch — precio manual con coma decimal", () => {
  beforeEach(() => {
    // El componente hace fetch de productos recientes al montar.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => [] }))
  })

  it("agrega el producto manual con precio 1500,50 = 1500.5 (no 1500)", () => {
    const onAddManualProduct = vi.fn()
    render(
      <PosProductSearch
        onAddProduct={() => {}}
        onAddManualProduct={onAddManualProduct}
        onOpenScanner={() => {}}
        scanSuccess={null}
      />
    )

    // Abrir el formulario de producto manual.
    fireEvent.click(screen.getByTitle("Agregar producto manual (sin inventario)"))

    fireEvent.change(screen.getByPlaceholderText("Descripción del producto"), {
      target: { value: "Cable USB" },
    })
    fireEvent.change(screen.getByPlaceholderText("Precio"), {
      target: { value: "1500,50" },
    })

    fireEvent.click(screen.getByRole("button", { name: /agregar/i }))

    expect(onAddManualProduct).toHaveBeenCalledWith(
      expect.objectContaining({ nombre: "Cable USB", precioUnitario: 1500.5 })
    )
  })
})
