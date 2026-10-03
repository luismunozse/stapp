// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
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

function buildItem(extra: Partial<PosCartItem> = {}): PosCartItem {
  return {
    lineId: "l1", inventarioId: "inv1", nombre: "Monitor", codigo: "",
    precioUnitario: 10000, cantidad: 1, stockDisponible: 10,
    diasGarantia: 0, descuento: 0, tipoDescuento: "MONTO",
    porcentajeDescuento: 0, trackeaSeries: false, serieIds: [],
    ...extra,
  }
}

function stubFetch() {
  const calls: Array<{ url: string; body: any }> = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : null
      calls.push({ url, body })
      if (url.includes("/check-stock")) return { ok: true, json: async () => ({ stock: { inv1: 10 } }) }
      if (url.includes("/cuenta-corriente")) return { ok: true, json: async () => ({ saldo: 0 }) }
      if (url.includes("/recargos-metodo")) {
        return { ok: true, json: async () => ({ recargos: [{ metodo: "TARJETA_CREDITO", porcentaje: 10 }] }) }
      }
      if (url.includes("/operadores")) return { ok: true, json: async () => [] }
      return { ok: true, json: async () => ({ ventaId: "v1" }) }
    })
  )
  return calls
}

const CLIENTE = { id: "c1", nombre: "Ana", telefono: "" }

async function confirmarYLeerPayload(calls: Array<{ url: string; body: any }>) {
  fireEvent.click(screen.getByRole("button", { name: /confirmar venta/i }))
  await waitFor(() => expect(calls.some((c) => c.url === "/api/ventas")).toBe(true))
  return calls.find((c) => c.url === "/api/ventas")!.body
}

describe("PosCheckoutDialog — recargo del método igual que el servidor", () => {
  beforeEach(() => showError.mockClear())

  it("con descuento en monto, cobra con tarjeta el precio descontado más el recargo", async () => {
    const calls = stubFetch()
    render(
      <PosCheckoutDialog
        open onClose={() => {}} items={[buildItem({ descuento: 1000 })]}
        cliente={CLIENTE as any} onComplete={() => {}}
      />
    )

    fireEvent.click(await screen.findByRole("button", { name: /t\. crédito/i }))
    expect(await screen.findByText("$9900")).toBeInTheDocument()

    const payload = await confirmarYLeerPayload(calls)
    expect(showError).not.toHaveBeenCalled()
    expect(payload.metodoPago).toBe("TARJETA_CREDITO")
    expect(payload.pagos).toEqual([{ metodo: "TARJETA_CREDITO", monto: 9900, cuotas: 1 }])
  })

  it("al destildar Pago parcial vuelve al total con el método elegido, no a efectivo", async () => {
    const calls = stubFetch()
    render(
      <PosCheckoutDialog
        open onClose={() => {}} items={[buildItem()]}
        cliente={CLIENTE as any} onComplete={() => {}}
      />
    )

    fireEvent.click(await screen.findByRole("button", { name: /t\. crédito/i }))
    expect(await screen.findByText("$11000")).toBeInTheDocument()

    const parcial = screen.getByLabelText(/pago parcial/i)
    fireEvent.click(parcial)
    fireEvent.click(parcial)

    const payload = await confirmarYLeerPayload(calls)
    expect(showError).not.toHaveBeenCalled()
    expect(payload.pagosParcial).toBe(false)
    expect(payload.pagos).toEqual([{ metodo: "TARJETA_CREDITO", monto: 11000, cuotas: 1 }])
  })
})
