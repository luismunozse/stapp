// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { PosCart } from "@/components/pos/pos-cart"
import type { PosCartItem } from "@/components/pos/pos-types"

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
const baseProps = {
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
  descuentoGlobal: null,
  descuentoMotivo: "",
  onSetDescuentoGlobal: noop,
  onSetDescuentoMotivo: noop,
}

describe("PosCart — botón Editar", () => {
  it("muestra 'Precio unit.' recién al tocar 'Editar'", () => {
    render(<PosCart {...(baseProps as any)} />)
    expect(screen.queryByText(/Precio unit/i)).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: /editar/i }))
    expect(screen.getByText(/Precio unit/i)).toBeInTheDocument()
  })
})
