// __tests__/components/orden-comision-card.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"

const swr = vi.hoisted(() => ({ data: undefined as any, error: undefined as any, isLoading: false, keys: [] as Array<string | null> }))

vi.mock("swr", () => ({
  default: (key: string | null) => {
    swr.keys.push(key)
    return { data: key ? swr.data : undefined, error: key ? swr.error : undefined, isLoading: key ? swr.isLoading : false }
  },
}))

import { OrdenComisionCard } from "@/components/ordenes/orden-comision-card"
import { commissionCardVersion, orderCommissionKeyPrefix } from "@/lib/commissions/card-version"
import { ORDER_ACCRUAL_HINT } from "@/lib/commissions/types"

const row = (o: Record<string, unknown> = {}) => ({
  clave: "ORDEN:o:TECNICO:ORIGINAL:-",
  beneficiarioId: "t1",
  beneficiarioNombre: "Ana",
  tipo: "ORIGINAL",
  base: 800,
  porcentaje: 10,
  monto: 80,
  devengada: true,
  pagado: false,
  fechaPago: null,
  documentoTotal: 1000,
  documentoCostoRepuestos: 200,
  rol: "TECNICO",
  baseTipo: "MANO_DE_OBRA",
  documentoMonto: 1000,
  motivoSinDevengo: null,
  ...o,
})

const props = { ordenId: "o", tecnicoId: "t1", recibidoPorId: null as string | null, porcentajeComision: 10, horasTrabajadas: 2, version: "v1", onUpdateField: vi.fn() }

describe("OrdenComisionCard", () => {
  beforeEach(() => {
    swr.data = { filas: [row()] }
    swr.error = undefined
    swr.isLoading = false
    swr.keys = []
  })

  it("muestra el input de 'Horas trabajadas' cuando hay técnico asignado", () => {
    render(<OrdenComisionCard {...props} />)
    expect(screen.getByText("Horas trabajadas")).toBeInTheDocument()
  })

  it("no renderiza nada (ni horas) cuando no hay técnico", () => {
    const { container } = render(<OrdenComisionCard {...props} tecnicoId={null} />)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByText("Horas trabajadas")).not.toBeInTheDocument()
    expect(swr.keys.every((k) => k === null)).toBe(true)
  })

  it("keys the request by order and version", () => {
    render(<OrdenComisionCard {...props} version='{"a":1}' />)
    expect(swr.keys[0]).toBe(`/api/comisiones/orden/o?v=${encodeURIComponent('{"a":1}')}`)
  })

  it("shows the definition's amount, not a client computation", () => {
    swr.data = { filas: [row({ monto: 123.45, base: 999, porcentaje: 7 })] }
    render(<OrdenComisionCard {...props} />)
    expect(screen.getByText(/123[.,]45/)).toBeInTheDocument()
  })

  it("labels a non-accrued row as projected", () => {
    swr.data = { filas: [row({ devengada: false, monto: 0 })] }
    render(<OrdenComisionCard {...props} />)
    expect(screen.getByText("Proyectada")).toBeInTheDocument()
  })

  it("a paid row locks the rate and names who was paid when the technician changed", () => {
    swr.data = { filas: [row({ pagado: true, beneficiarioId: "t-old", beneficiarioNombre: "Beto", fechaPago: "2026-10-05T10:00:00Z" })] }
    render(<OrdenComisionCard {...props} tecnicoId="t-new" />)
    expect(screen.queryByRole("spinbutton", { name: /comisión/i })).not.toBeInTheDocument()
    expect(screen.getByText("Pagada")).toBeInTheDocument()
    expect(screen.getByText("Pagada a Beto")).toBeInTheDocument()
  })

  it("shows loading and error states", () => {
    swr.data = undefined
    swr.isLoading = true
    const { unmount } = render(<OrdenComisionCard {...props} />)
    expect(screen.getByText("Cargando…")).toBeInTheDocument()
    unmount()
    swr.isLoading = false
    swr.error = new Error("x")
    render(<OrdenComisionCard {...props} />)
    expect(screen.getByText("No se pudo cargar la comisión.")).toBeInTheDocument()
  })
  it("shows the technician and the receiver as two blocks with their names", () => {
    swr.data = { filas: [row(), row({ clave: "ORDEN:o:RECEPCION:ORIGINAL:-", rol: "RECEPCION", beneficiarioId: "r1", beneficiarioNombre: "Rita", baseTipo: "MONTO_ORDEN", base: 850, porcentaje: 5, monto: 42.5 })] }
    render(<OrdenComisionCard {...props} recibidoPorId="r1" />)
    expect(screen.getByText("Técnico · Ana")).toBeInTheDocument()
    expect(screen.getByText("Recepción · Rita")).toBeInTheDocument()
    expect(screen.getAllByRole("spinbutton", { name: "% Comisión" })).toHaveLength(1)
  })

  it("explains discounts and credit notes, and repuestos only for a labour base", () => {
    swr.data = { filas: [row({ documentoTotal: 1000, documentoMonto: 850, documentoCostoRepuestos: 200, baseTipo: "MANO_DE_OBRA", base: 650 })] }
    const { unmount } = render(<OrdenComisionCard {...props} />)
    expect(screen.getByText("Descuentos y notas de crédito")).toBeInTheDocument()
    expect(screen.getByText(/150/)).toBeInTheDocument()
    expect(screen.getByText("Repuestos")).toBeInTheDocument()
    expect(screen.getByText("Mano de obra")).toBeInTheDocument()
    unmount()
    swr.data = { filas: [row({ rol: "RECEPCION", beneficiarioId: "r1", documentoTotal: 1000, documentoMonto: 1000, baseTipo: "MONTO_ORDEN", base: 1000 })] }
    render(<OrdenComisionCard {...props} recibidoPorId="r1" />)
    expect(screen.queryByText("Descuentos y notas de crédito")).not.toBeInTheDocument()
    expect(screen.queryByText("Repuestos")).not.toBeInTheDocument()
    expect(screen.getByText("Monto de la orden")).toBeInTheDocument()
  })

  it.each(Object.entries(ORDER_ACCRUAL_HINT))("a row blocked by %s shows its hint", (code, hint) => {
    swr.data = { filas: [row({ devengada: false, motivoSinDevengo: code })] }
    render(<OrdenComisionCard {...props} />)
    expect(screen.getByText("Proyectada")).toBeInTheDocument()
    expect(screen.getByText(hint)).toBeInTheDocument()
  })

  it("shows no hint for an unknown or missing accrual code", () => {
    swr.data = { filas: [row({ devengada: false, motivoSinDevengo: "OTRO" })] }
    const { container } = render(<OrdenComisionCard {...props} />)
    expect(screen.getByText("Proyectada")).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/undefined/)
  })

  it("loads for an order with a receiver and no technician, without the hours block", () => {
    swr.data = { filas: [row({ rol: "RECEPCION", beneficiarioId: "r1", beneficiarioNombre: "Rita" })] }
    render(<OrdenComisionCard {...props} tecnicoId={null} recibidoPorId="r1" />)
    expect(swr.keys[0]).not.toBeNull()
    expect(screen.queryByText("Horas trabajadas")).not.toBeInTheDocument()
    expect(screen.getByText("Recepción · Rita")).toBeInTheDocument()
  })

  it("renders nothing with neither person", () => {
    const { container } = render(<OrdenComisionCard {...props} tecnicoId={null} recibidoPorId={null} />)
    expect(container).toBeEmptyDOMElement()
    expect(swr.keys.every((k) => k === null)).toBe(true)
  })

  it("renders nothing when loaded with no rows and no technician", () => {
    swr.data = { filas: [] }
    const { container } = render(<OrdenComisionCard {...props} tecnicoId={null} recibidoPorId="r1" />)
    expect(container).toBeEmptyDOMElement()
  })

  it("the receiver's rate is read-only and a paid row names who was paid", () => {
    swr.data = { filas: [row({ rol: "RECEPCION", beneficiarioId: "r-old", beneficiarioNombre: "Rosa", pagado: true, fechaPago: "2026-10-05T10:00:00Z" })] }
    render(<OrdenComisionCard {...props} tecnicoId={null} recibidoPorId="r-new" />)
    expect(screen.queryByRole("spinbutton", { name: /comisión/i })).not.toBeInTheDocument()
    expect(screen.getByText("Pagada a Rosa")).toBeInTheDocument()
  })

  it("the card key starts with the shared prefix and the version changes with the discount", () => {
    render(<OrdenComisionCard {...props} />)
    expect(swr.keys[0]!.startsWith(orderCommissionKeyPrefix("o"))).toBe(true)
    expect(commissionCardVersion({ descuentoCobro: 0 })).not.toBe(commissionCardVersion({ descuentoCobro: 100 }))
    expect(commissionCardVersion({ fechaEntrega: null })).not.toBe(commissionCardVersion({ fechaEntrega: "2026-10-01" }))
  })
})
