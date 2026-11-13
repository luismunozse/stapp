// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { useState } from "react"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { PosCheckoutDialog } from "@/components/pos/pos-checkout-dialog"
import type { PosCartItem } from "@/components/pos/pos-types"
import { aplicarCotizacionLineas } from "@/lib/currency/venta-divisa"
import { botonConfirmarListo } from "./checkout-test-utils"

// Tras un 409 COTIZACION_CAMBIO el total cambia: los pagos se vuelven a sembrar como al abrir
// (una línea por el total nuevo, sin pago parcial ni monto recibido) para que el segundo
// confirmar no lleve montos viejos ni convierta la diferencia en deuda.

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `$${n}` }),
}))
const showError = vi.fn().mockResolvedValue(undefined)
vi.mock("@/contexts/modal-context", () => ({
  useModal: () => ({ showError, showSuccess: vi.fn() }),
}))
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "u1", role: "ADMIN" } } }),
}))

const CLIENTE = { id: "c1", nombre: "Ana", telefono: "" }
const LINEA_USD: PosCartItem = {
  lineId: "l1", inventarioId: "u1", codigo: "U1", nombre: "Funda",
  precioUnitario: 12000, cantidad: 1, stockDisponible: 5, diasGarantia: 0,
  trackeaSeries: false, serieIds: [], moneda: "USD", precioOrigen: 10,
}
const nueva = { disponible: true, valor: 1300, fuente: "BLUE", moneda: "USD", en: new Date().toISOString(), estado: "vivo" }

let ventasBodies: any[] = []
function stubFetch() {
  ventasBodies = []
  let primera = true
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body })
      if (url.includes("/check-stock")) return json(200, { stock: { u1: 5 } })
      if (url.includes("/cuenta-corriente")) return json(200, { saldo: 0 })
      if (url.includes("/recargos-metodo")) return json(200, { recargos: [] })
      if (url.includes("/operadores")) return json(200, [])
      if (url === "/api/ventas") {
        ventasBodies.push(JSON.parse(String(init?.body)))
        if (primera) {
          primera = false
          return json(409, { error: "La cotización cambió.", code: "COTIZACION_CAMBIO", anterior: 1200, nueva })
        }
        return json(201, { id: "v1" })
      }
      return json(200, {})
    })
  )
}

// El terminal reconvierte el carrito con la cotización nueva (redondeo 10).
function Terminal() {
  const [items, setItems] = useState([LINEA_USD])
  const [tc, setTc] = useState(1200)
  return (
    <PosCheckoutDialog
      open onClose={() => {}} items={items} cliente={CLIENTE} onComplete={() => {}}
      tipoCambio={tc}
      onCotizacionCambiada={(n) => {
        setTc(n)
        setItems((prev) => aplicarCotizacionLineas(prev, n, 10))
      }}
    />
  )
}

async function confirmarDosVeces() {
  fireEvent.click(await botonConfirmarListo())
  await waitFor(() => expect(showError).toHaveBeenCalledWith("La cotización cambió."))
  fireEvent.click(await botonConfirmarListo())
  await waitFor(() => expect(ventasBodies).toHaveLength(2))
}

describe("PosCheckoutDialog — pagos tras un 409 COTIZACION_CAMBIO", () => {
  beforeEach(() => {
    showError.mockClear()
    stubFetch()
  })

  it("con pago parcial: vuelve a una línea por el total nuevo, sin dejar deuda", async () => {
    render(<Terminal />)
    fireEvent.click(await screen.findByRole("checkbox"))
    fireEvent.change(screen.getAllByLabelText(/Monto \*/)[0], { target: { value: "5000" } })

    await confirmarDosVeces()

    expect(ventasBodies[0]).toMatchObject({ pagosParcial: true, pagos: [{ monto: 5000 }] })
    expect(ventasBodies[1].pagosParcial).toBe(false)
    expect(ventasBodies[1].pagos).toEqual([expect.objectContaining({ metodo: "EFECTIVO", monto: 13000 })])
    expect(ventasBodies[1].idempotencyKey).toBe(ventasBodies[0].idempotencyKey)
  })

  it("con dos líneas de pago: vuelve a una sola por el total nuevo", async () => {
    render(<Terminal />)
    const montoUno = await screen.findByLabelText(/Monto \*/)
    fireEvent.change(montoUno, { target: { value: "6000" } })
    fireEvent.click(screen.getByRole("button", { name: /agregar otro método de pago/i }))
    const montos = screen.getAllByLabelText(/Monto \*/)
    expect(montos).toHaveLength(2)
    fireEvent.change(montos[1], { target: { value: "6000" } })

    await confirmarDosVeces()

    expect(ventasBodies[0].pagos).toHaveLength(2)
    expect(ventasBodies[1].pagos).toEqual([expect.objectContaining({ metodo: "EFECTIVO", monto: 13000 })])
    expect(ventasBodies[1].tipoCambio).toBe(1300)
  })
})
