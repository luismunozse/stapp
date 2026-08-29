// @vitest-environment jsdom
import { useEffect, useState } from "react"
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, act } from "@testing-library/react"
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

})

// ---------------------------------------------------------------------------
// Arnés con estado real: reproduce cómo pos-terminal.tsx cablea el carrito
// (`onSetDescuentoGlobal={setDescuentoGlobal}` apunta a un useState real),
// a diferencia de baseProps() de arriba, donde ese callback es un vi.fn()
// que nunca hace que `descuentoGlobal` cambie. Sin un prop que de verdad
// vuelva a bajar no hay feedback loop que probar, y el bug que este archivo
// cubre (el resync pisando lo que el cajero acaba de tipear) depende
// exactamente de eso.
// ---------------------------------------------------------------------------
function DescuentoHarness({
  initial,
  externalSetterRef,
}: {
  initial: DescuentoConfig | null
  externalSetterRef?: { current: ((d: DescuentoConfig | null) => void) | null }
}) {
  const [descuentoGlobal, setDescuentoGlobal] = useState<DescuentoConfig | null>(initial)
  useEffect(() => {
    if (externalSetterRef) externalSetterRef.current = setDescuentoGlobal
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <PosCart
      {...(baseProps(descuentoGlobal) as any)}
      onSetDescuentoGlobal={setDescuentoGlobal}
    />
  )
}

describe("PosCart — el resync no pisa la propia escritura del cajero (feedback loop con el padre)", () => {
  it("reemplazar un 10% existente tipeando 0 (primer paso hacia 0.5) no borra el 0 recién tipeado", () => {
    render(<DescuentoHarness initial={{ tipo: "PORCENTAJE", valor: 10 }} />)
    expect(descuentoInput().value).toBe("10")

    // Cajero selecciona todo y tipea "0" (va camino a "0.5"). No se prueba el
    // paso intermedio "0." porque un <input type="number"> sanea ese valor a
    // "" a nivel DOM (no matchea la regexp de número válido de la spec de
    // HTML5) — es una restricción de jsdom/navegador, no del componente.
    fireEvent.change(descuentoInput(), { target: { value: "0" } })
    expect(descuentoInput().value).toBe("0")

    fireEvent.change(descuentoInput(), { target: { value: "0.5" } })
    expect(descuentoInput().value).toBe("0.5")
  })

  it("un reset externo real (no producido por este componente, ej. venta completada) sí limpia el draft", () => {
    const externalSetterRef: { current: ((d: DescuentoConfig | null) => void) | null } = { current: null }
    render(
      <DescuentoHarness
        initial={{ tipo: "MONTO", valor: 500 }}
        externalSetterRef={externalSetterRef}
      />
    )
    expect(descuentoInput().value).toBe("500")

    // Simula lo que hace pos-terminal.tsx tras completar la venta / vaciar
    // el carrito / F2 / recuperar un apartado: llama a setDescuentoGlobal
    // directamente, sin pasar por el onChange del propio PosCart.
    act(() => {
      externalSetterRef.current?.(null)
    })

    expect(descuentoInput().value).toBe("")
    expect(screen.getByRole("button", { name: "%" })).toHaveClass("bg-primary")
  })
})
