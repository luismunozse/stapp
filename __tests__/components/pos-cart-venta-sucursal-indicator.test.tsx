// __tests__/components/pos-cart-venta-sucursal-indicator.test.tsx
//
// The "Vendiendo desde: {sucursal}" indicator in the POS cart header.
//
// Whether the indicator is MEANINGFUL (admin, "todas las sucursales" selected,
// org with more than one branch, non-drain sale) is decided server-side — see
// resolverIndicadorVenta in lib/sucursal.ts and its tests. The browser cannot
// read the httpOnly sucursal cookie, so any client-side reconstruction of that
// state is a guess. PosCart therefore holds no policy at all: it renders the
// name when the server sent one and stays quiet otherwise, which also keeps it
// free of a SessionProvider dependency for every consumer.
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { PosCart } from "@/components/pos/pos-cart"

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `$${n}` }),
}))

const noop = () => {}

function renderCart(ventaSucursalNombre: string | null, ventaAlcanceOrg = false) {
  render(
    <PosCart
      items={[]}
      cliente={{ id: null, nombre: "", telefono: "" }}
      onUpdateQuantity={noop}
      onRemoveItem={noop}
      onSetGarantia={noop}
      onSetSerieIds={noop}
      onSetCliente={noop}
      onCheckout={noop}
      onHoldSale={noop}
      onRecallSale={noop}
      onClearCart={noop}
      heldCount={0}
      showClienteSearch={false}
      onToggleClienteSearch={noop}
      descuentoGlobal={null}
      descuentoMotivo=""
      onSetItemDescuento={noop}
      onSetDescuentoGlobal={noop}
      onSetDescuentoMotivo={noop}
      onSetPrecio={noop}
      ventaSucursalNombre={ventaSucursalNombre}
      ventaAlcanceOrg={ventaAlcanceOrg}
    />
  )
}

describe("PosCart — indicador 'Vendiendo desde'", () => {
  it("con sucursal resuelta por el server: muestra el indicador", () => {
    renderCart("Sucursal Centro")

    expect(screen.getByText("Vendiendo desde:")).toBeInTheDocument()
    expect(screen.getByText("Sucursal Centro")).toBeInTheDocument()
  })

  it("sin sucursal resuelta (el server decidio no mostrarlo): NO muestra el indicador", () => {
    renderCart(null)

    expect(screen.queryByText("Vendiendo desde:")).not.toBeInTheDocument()
  })

  it("alcance org: dice de donde sale el stock en vez de no decir nada", () => {
    // Estado: ADMIN con la sucursal X elegida, X sin deposito principal. El
    // chip del switcher dice "Sucursal X" mientras la grilla lista stock que
    // esta en otras sucursales, y el server no manda nombre porque nombrar una
    // sola sucursal seria mentira (el RPC drena de cualquier deposito). Sin
    // este aviso no queda NADA en pantalla que explique la diferencia.
    renderCart(null, true)

    expect(screen.getByText(/todas las sucursales/i)).toBeInTheDocument()
    expect(screen.getByText(/no tiene depósito principal/i)).toBeInTheDocument()
    // Y sigue sin afirmar una sucursal concreta.
    expect(screen.queryByText("Vendiendo desde:")).not.toBeInTheDocument()
  })

  it("sin alcance org: no muestra el aviso", () => {
    renderCart("Sucursal Centro")

    expect(screen.queryByText(/todas las sucursales/i)).not.toBeInTheDocument()
  })

  it("no requiere SessionProvider: monta sin next-auth en el arbol", () => {
    // Regression guard: PosCart used to call useSession() to gate the
    // indicator, which threw for every consumer rendered without a provider.
    expect(() => renderCart(null)).not.toThrow()
  })
})
