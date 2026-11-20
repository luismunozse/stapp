// @vitest-environment jsdom
import React from "react"
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({
    formatPrice: (n: number) => `$${n}`,
    formatDate: (f: string) => f,
    formatDateTime: (f: string) => f,
  }),
}))

import { CobrosOrdenLista, type CobroOrden } from "@/components/ordenes/cobros-orden-lista"
import { PagosHistorial } from "@/components/facturacion/pagos-historial"

const cobro = (extra: Partial<CobroOrden> = {}): CobroOrden => ({
  id: "co-1",
  monto: 1000,
  metodoPago: "EFECTIVO",
  fecha: "2026-11-20T10:00:00Z",
  anulado: false,
  ...extra,
})

const corregir = () => screen.queryAllByRole("button", { name: /corregir/i })

describe("Corregir pago desde la orden (CobrosOrdenLista)", () => {
  it("sin onCorregir no ofrece la acción", () => {
    render(<CobrosOrdenLista cobros={[cobro()]} />)
    expect(corregir()).toHaveLength(0)
  })

  it("ofrece Corregir en el cobro vigente y entrega ese cobro", () => {
    const onCorregir = vi.fn()
    const c = cobro({ referencia: "OP-1" })
    render(<CobrosOrdenLista cobros={[c]} onCorregir={onCorregir} />)
    fireEvent.click(corregir()[0])
    expect(onCorregir).toHaveBeenCalledWith(c)
  })

  it("no lo ofrece en cobros anulados ni en los de saldo a favor", () => {
    render(
      <CobrosOrdenLista
        cobros={[cobro({ id: "a", anulado: true }), cobro({ id: "b", metodoPago: "CUENTA_CORRIENTE" })]}
        onCorregir={vi.fn()}
      />
    )
    expect(corregir()).toHaveLength(0)
  })

  it("Corregir no depende de poder anular (orden entregada)", () => {
    render(<CobrosOrdenLista cobros={[cobro()]} puedeAnular={false} onCorregir={vi.fn()} />)
    expect(corregir()).toHaveLength(1)
    expect(screen.queryByRole("button", { name: /anular/i })).toBeNull()
  })
})

describe("Corregir pago desde la venta (PagosHistorial)", () => {
  const pago = { id: "pv-1", monto: 500, fecha: "2026-11-20", metodoPago: "TRANSFERENCIA", observaciones: "Banco Nación" }

  it("sin onCorregir no ofrece la acción (facturación)", () => {
    render(<PagosHistorial pagos={[pago]} />)
    expect(corregir()).toHaveLength(0)
  })

  it("ofrece Corregir, entrega el pago y muestra el comentario", () => {
    const onCorregir = vi.fn()
    render(<PagosHistorial pagos={[pago]} onCorregir={onCorregir} />)
    expect(screen.getByText("Nota: Banco Nación")).toBeTruthy()
    fireEvent.click(corregir()[0])
    expect(onCorregir).toHaveBeenCalledWith(pago)
  })

  it("no lo ofrece en pagos con saldo a favor", () => {
    render(<PagosHistorial pagos={[{ ...pago, metodoPago: "CUENTA_CORRIENTE" }]} onCorregir={vi.fn()} />)
    expect(corregir()).toHaveLength(0)
  })
})
