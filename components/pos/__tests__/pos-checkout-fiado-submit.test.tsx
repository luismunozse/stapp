// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react"
import { PosCheckoutDialog } from "@/components/pos/pos-checkout-dialog"
import type { PosCartItem } from "@/components/pos/pos-types"

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `$${n}` }),
}))
const showError = vi.fn()
vi.mock("@/contexts/modal-context", () => ({
  useModal: () => ({ showError: (...a: unknown[]) => showError(...a), showSuccess: vi.fn() }),
}))
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "u1", role: "ADMIN" } } }),
}))

// 1234 is deliberately NOT a multiple of the 100 rounding unit used below, so
// flipping roundCash actually moves `total` (1234 -> 1200). A round number would
// make the cash-rounding test a no-op that passes for the wrong reason.
function buildItem(): PosCartItem {
  return {
    lineId: "l1", inventarioId: "inv1", nombre: "Teclado", codigo: "",
    precioUnitario: 1234, cantidad: 1, stockDisponible: 10,
    diasGarantia: 0, descuento: 0, tipoDescuento: "MONTO",
    porcentajeDescuento: 0, trackeaSeries: false, serieIds: [],
  }
}

// Routes each endpoint the dialog calls so the pre-checkout stock guard passes
// and does not swallow the submit we are actually asserting on.
function stubFetch() {
  const calls: Array<{ url: string; body: any }> = []
  const impl = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : null
    calls.push({ url, body })
    if (url.includes("/check-stock")) {
      return { ok: true, json: async () => ({ stock: { inv1: 10 } }) }
    }
    if (url.includes("/cuenta-corriente")) {
      return { ok: true, json: async () => ({ saldo: 0 }) }
    }
    if (url.includes("/recargos-metodo")) {
      return { ok: true, json: async () => ({ recargos: [] }) }
    }
    if (url.includes("/operadores")) {
      return { ok: true, json: async () => [] }
    }
    return { ok: true, json: async () => ({ ventaId: "v1" }) }
  })
  vi.stubGlobal("fetch", impl)
  return calls
}

const CLIENTE = { id: "c1", nombre: "Ana", telefono: "" }

describe("PosCheckoutDialog — el botón Fiar realmente deja la venta impaga", () => {
  beforeEach(() => {
    showError.mockClear()
  })

  it("manda pagosParcial y sin pagos cuando se confirma una venta fiada", async () => {
    const calls = stubFetch()
    render(
      <PosCheckoutDialog
        open onClose={() => {}} items={[buildItem()]}
        cliente={CLIENTE as any} onComplete={() => {}}
      />
    )

    fireEvent.click(await screen.findByRole("button", { name: /fiar \/ cuenta corriente/i }))
    expect(screen.getByText(/venta sin pago/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /confirmar venta/i }))

    await waitFor(() => {
      expect(calls.some((c) => c.url === "/api/ventas")).toBe(true)
    })
    const venta = calls.find((c) => c.url === "/api/ventas")!
    expect(showError).not.toHaveBeenCalled()
    expect(venta.body.pagosParcial).toBe(true)
    expect(venta.body.pagos).toBeUndefined()
    expect(venta.body.clienteId).toBe("c1")
  })

  // computeVentaTotals rounds the total only when every payment line is cash, so
  // switching the line back to EFECTIVO changes `total` -- and the [open, total]
  // effect that reseeds the dialog also calls setPagoParcial(false), silently
  // undoing the fiado the cashier just asked for.
  it("no deshace el fiado cuando el redondeo en efectivo cambia el total", async () => {
    stubFetch()
    render(
      <PosCheckoutDialog
        open onClose={() => {}} items={[buildItem()]}
        cliente={CLIENTE as any} onComplete={() => {}}
        fiscal={{ regimen: "EXENTO", tasa: 0, redondeoEfectivo: 100 } as any}
      />
    )

    // Cashier first picks a non-cash method, so the total is NOT cash-rounded.
    fireEvent.click(await screen.findByRole("button", { name: /t\. crédito/i }))
    // Then decides to fiar instead.
    fireEvent.click(screen.getByRole("button", { name: /fiar \/ cuenta corriente/i }))

    expect(screen.getByText(/venta sin pago/i)).toBeInTheDocument()
  })

  // pos-terminal fetches the fiscal config asynchronously and passes it down as a
  // prop. If it lands after the cashier has already asked to fiar, `total` moves
  // and the [open, total] reseed effect runs setPagoParcial(false) -- wiping the
  // fiado without a word. Same shape for a global discount applied late.
  it("no deshace el fiado si la config fiscal llega despues de tocar Fiar", async () => {
    stubFetch()
    const props = {
      open: true as const,
      onClose: () => {},
      items: [buildItem()],
      cliente: CLIENTE as any,
      onComplete: () => {},
    }
    const { rerender } = render(<PosCheckoutDialog {...props} fiscal={null} />)

    fireEvent.click(await screen.findByRole("button", { name: /fiar \/ cuenta corriente/i }))
    expect(screen.getByText(/venta sin pago/i)).toBeInTheDocument()

    // Fiscal config resolves now, changing the total under the cashier's feet.
    await act(async () => {
      rerender(
        <PosCheckoutDialog
          {...props}
          fiscal={{ regimen: "ADITIVO", tasa: 21, redondeoEfectivo: 0 } as any}
        />
      )
    })

    expect(screen.getByText(/venta sin pago/i)).toBeInTheDocument()
  })
})
