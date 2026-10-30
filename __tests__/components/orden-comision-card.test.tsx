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
  ...o,
})

const props = { ordenId: "o", tecnicoId: "t1", porcentajeComision: 10, horasTrabajadas: 2, version: "v1", onUpdateField: vi.fn() }

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
    expect(screen.getByText("Se devenga cuando la orden está cobrada y además reparada o entregada.")).toBeInTheDocument()
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
})
