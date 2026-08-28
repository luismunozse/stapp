// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { PosCart } from "@/components/pos/pos-cart"
import type { PosCartItem, DescuentoConfig } from "@/components/pos/pos-types"

function buildItem(): PosCartItem {
  return {
    lineId: "l1", inventarioId: "inv1", nombre: "Teclado",
    codigo: "",
    precioUnitario: 45000, cantidad: 1, stockDisponible: 10,
    diasGarantia: 0, descuento: 0, tipoDescuento: "MONTO",
    porcentajeDescuento: 0, trackeaSeries: false, serieIds: [],
  }
}

const noop = vi.fn()
function baseProps(descuentoGlobal: DescuentoConfig | null) {
  return {
    items: [buildItem()],
    cliente: { id: null, nombre: "", telefono: "" },
    onUpdateQuantity: noop,
    onRemoveItem: noop,
    onSetPrecio: noop,
    onSetGarantia: noop,
    onSetItemDescuento: noop,
    onSetSerieIds: noop,
    onSetCliente: noop,
    onCheckout: noop,
    onHoldSale: noop,
    onRecallSale: noop,
    onClearCart: noop,
    heldCount: 0,
    showClienteSearch: false,
    onToggleClienteSearch: noop,
    descuentoGlobal,
    descuentoMotivo: "",
    onSetDescuentoGlobal: noop,
    onSetDescuentoMotivo: noop,
  }
}

function descuentoInput() {
  // El input de descuento global es el único <input type="number"> con
  // placeholder "0" fuera de las líneas del carrito (que están colapsadas).
  return screen.getByPlaceholderText("0") as HTMLInputElement
}

describe("PosCart — el descuento global no arrastra el valor del cliente anterior", () => {
  it("al volver descuentoGlobal a null, el input se vacía y el tipo vuelve a %", () => {
    const { rerender } = render(<PosCart {...(baseProps({ tipo: "MONTO", valor: 500 }) as any)} />)
    expect(descuentoInput().value).toBe("500")
    expect(screen.getByRole("button", { name: "$" })).toHaveClass("bg-primary")

    rerender(<PosCart {...(baseProps(null) as any)} />)

    expect(descuentoInput().value).toBe("")
    expect(screen.getByRole("button", { name: "%" })).toHaveClass("bg-primary")
  })

  it("al cambiar a un descuentoGlobal distinto, el input refleja el nuevo valor y tipo", () => {
    const { rerender } = render(<PosCart {...(baseProps({ tipo: "PORCENTAJE", valor: 10 }) as any)} />)
    expect(descuentoInput().value).toBe("10")

    rerender(<PosCart {...(baseProps({ tipo: "MONTO", valor: 2500 }) as any)} />)

    expect(descuentoInput().value).toBe("2500")
    expect(screen.getByRole("button", { name: "$" })).toHaveClass("bg-primary")
  })

  it("escribir en el campo mientras el prop no cambia no se pisa solo", () => {
    render(<PosCart {...(baseProps({ tipo: "PORCENTAJE", valor: 10 }) as any)} />)
    const input = descuentoInput()

    fireEvent.change(input, { target: { value: "15" } })

    expect(descuentoInput().value).toBe("15")
  })
})
