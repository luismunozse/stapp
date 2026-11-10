// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { PosCheckoutDialog } from "@/components/pos/pos-checkout-dialog"
import type { PosCartItem } from "@/components/pos/pos-types"

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `$${n}` }),
}))
vi.mock("@/contexts/modal-context", () => ({
  useModal: () => ({ showError: vi.fn(), showSuccess: vi.fn() }),
}))
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "u1", role: "ADMIN" } } }),
}))

const CLIENTE = { id: null, nombre: "", telefono: "" }
const VENTA = { id: "v1", numeroVenta: 7, total: 1500, items: [] }

function buildItem(): PosCartItem {
  return {
    lineId: "l1", inventarioId: "inv1", nombre: "Teclado", codigo: "",
    precioUnitario: 1500, cantidad: 1, stockDisponible: 10,
    diasGarantia: 0, descuento: 0, tipoDescuento: "MONTO",
    porcentajeDescuento: 0, trackeaSeries: false, serieIds: [],
  }
}

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/check-stock")) return { ok: true, json: async () => ({ stock: { inv1: 10 } }) }
      if (url === "/api/ventas") return { ok: true, json: async () => VENTA }
      return { ok: false, json: async () => ({}) }
    })
  )
}

describe("PosCheckoutDialog — cobro de mostrador hacia onComplete", () => {
  beforeEach(() => stubFetch())

  it("pasa monto recibido y vuelto como segundo argumento cuando se cobra en efectivo", async () => {
    const onComplete = vi.fn()
    render(
      <PosCheckoutDialog open onClose={() => {}} items={[buildItem()]} cliente={CLIENTE as any} onComplete={onComplete} />
    )
    const input = await screen.findByPlaceholderText(/monto recibido/i)
    fireEvent.change(input, { target: { value: "2000" } })
    fireEvent.click(await screen.findByRole("button", { name: /confirmar venta/i }))

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    expect(onComplete).toHaveBeenCalledWith(VENTA, { montoRecibido: 2000, vuelto: 500 })
  })

  it("no pasa cobro cuando no se ingresó monto recibido", async () => {
    const onComplete = vi.fn()
    render(
      <PosCheckoutDialog open onClose={() => {}} items={[buildItem()]} cliente={CLIENTE as any} onComplete={onComplete} />
    )
    fireEvent.click(await screen.findByRole("button", { name: /confirmar venta/i }))

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    expect(onComplete).toHaveBeenCalledWith(VENTA, undefined)
  })

  it("no pasa cobro en una venta fiada aunque haya monto recibido (el vuelto no es real)", async () => {
    const onComplete = vi.fn()
    render(
      <PosCheckoutDialog
        open onClose={() => {}} items={[buildItem()]}
        cliente={{ id: "c1", nombre: "Ana", telefono: "" } as any} onComplete={onComplete}
      />
    )
    fireEvent.click(await screen.findByRole("button", { name: /fiar \/ cuenta corriente/i }))
    const input = await screen.findByPlaceholderText(/monto recibido/i)
    fireEvent.change(input, { target: { value: "2000" } })
    fireEvent.click(screen.getByRole("button", { name: /confirmar venta/i }))

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    expect(onComplete).toHaveBeenCalledWith(VENTA, undefined)
  })
})
