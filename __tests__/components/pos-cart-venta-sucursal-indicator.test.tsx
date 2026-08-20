// __tests__/components/pos-cart-venta-sucursal-indicator.test.tsx
//
// The "Vendiendo desde: {sucursal}" indicator in the POS cart header must
// only appear when it disambiguates something: an ADMIN who has "todas las
// sucursales" selected can't otherwise tell which branch a sale will draw
// stock from. It must stay hidden for non-admins and for an ADMIN who has a
// specific sucursal selected (the selector already shows that).
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { PosCart } from "@/components/pos/pos-cart"

const mockUseSession = vi.fn()
vi.mock("next-auth/react", () => ({ useSession: () => mockUseSession() }))
vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `$${n}` }),
}))

function mockSession(role: string | undefined) {
  mockUseSession.mockReturnValue({ data: role ? { user: { role } } : null })
}

function mockSelectorMirror(value: string | null) {
  if (value === null) {
    window.localStorage.removeItem("sucursal-activa-ui")
  } else {
    window.localStorage.setItem("sucursal-activa-ui", value)
  }
}

const noop = () => {}

function renderCart(ventaSucursalNombre: string | null) {
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
    />
  )
}

describe("PosCart — indicador 'Vendiendo desde'", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
  })

  it("ADMIN en 'todas' (sin mirror en localStorage) con sucursal resuelta: muestra el indicador", () => {
    mockSession("ADMIN")
    mockSelectorMirror(null)
    renderCart("Sucursal Centro")

    expect(screen.getByText("Vendiendo desde:")).toBeInTheDocument()
    expect(screen.getByText("Sucursal Centro")).toBeInTheDocument()
  })

  it('ADMIN con mirror "todas" explícito: muestra el indicador', () => {
    mockSession("ADMIN")
    mockSelectorMirror("todas")
    renderCart("Sucursal Centro")

    expect(screen.getByText("Vendiendo desde:")).toBeInTheDocument()
  })

  it("ADMIN con una sucursal específica seleccionada: NO muestra el indicador (el selector ya lo dice)", () => {
    mockSession("ADMIN")
    mockSelectorMirror("suc-A")
    renderCart("Sucursal Centro")

    expect(screen.queryByText("Vendiendo desde:")).not.toBeInTheDocument()
  })

  it("VENDEDOR (no admin): NO muestra el indicador aunque venga resuelto", () => {
    mockSession("VENDEDOR")
    mockSelectorMirror(null)
    renderCart("Sucursal Centro")

    expect(screen.queryByText("Vendiendo desde:")).not.toBeInTheDocument()
  })

  it("ADMIN en 'todas' pero sin sucursal resuelta aún (null): NO muestra el indicador", () => {
    mockSession("ADMIN")
    mockSelectorMirror(null)
    renderCart(null)

    expect(screen.queryByText("Vendiendo desde:")).not.toBeInTheDocument()
  })
})
