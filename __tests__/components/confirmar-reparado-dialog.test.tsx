// __tests__/components/confirmar-reparado-dialog.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { ConfirmarReparadoDialog } from "@/components/ordenes/confirmar-reparado-dialog"

const baseOrden = {
  id: "o1",
  numeroOrden: 12,
  codigoOrden: "A-012",
  presupuesto: 10000,
  costoFinal: null as number | null,
  sena: 3000,
  totalCobrado: 3000,
  descuentoCobro: 0,
  clienteNombre: "Ana",
}

describe("ConfirmarReparadoDialog", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as any
  })

  it("pre-carga el costo con el presupuesto cuando la orden no tiene costo final", () => {
    render(<ConfirmarReparadoDialog open onOpenChange={vi.fn()} orden={baseOrden} onSuccess={vi.fn()} />)
    const input = screen.getByLabelText(/costo final/i) as HTMLInputElement
    expect(input.value).toBe("10000")
  })

  it("pre-carga con el costo final existente cuando ya hay uno (flujo con cotización)", () => {
    render(
      <ConfirmarReparadoDialog open onOpenChange={vi.fn()} orden={{ ...baseOrden, costoFinal: 15000 }} onSuccess={vi.fn()} />,
    )
    const input = screen.getByLabelText(/costo final/i) as HTMLInputElement
    expect(input.value).toBe("15000")
  })

  it("muestra el contexto de presupuesto y seña", () => {
    render(<ConfirmarReparadoDialog open onOpenChange={vi.fn()} orden={baseOrden} onSuccess={vi.fn()} />)
    expect(screen.getByText("Presupuesto")).toBeInTheDocument()
    expect(screen.getByText("Seña")).toBeInTheDocument()
  })

  it("deshabilita 'Marcar como Reparado' cuando el costo es 0", () => {
    render(
      <ConfirmarReparadoDialog
        open
        onOpenChange={vi.fn()}
        orden={{ ...baseOrden, presupuesto: null, costoFinal: null }}
        onSuccess={vi.fn()}
      />,
    )
    expect(screen.getByRole("button", { name: /marcar como reparado/i })).toBeDisabled()
  })

  it("al confirmar hace PUT con estado REPARADO y el costo final, y llama onSuccess", async () => {
    const onSuccess = vi.fn()
    render(
      <ConfirmarReparadoDialog open onOpenChange={vi.fn()} orden={{ ...baseOrden, costoFinal: 15000 }} onSuccess={onSuccess} />,
    )
    fireEvent.click(screen.getByRole("button", { name: /marcar como reparado/i }))

    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    const [url, opts] = (global.fetch as any).mock.calls[0]
    expect(url).toContain("/api/ordenes/o1")
    expect(opts.method).toBe("PUT")
    const body = JSON.parse(opts.body)
    expect(body.estado).toBe("REPARADO")
    expect(body.costoFinal).toBe(15000)
    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
  })
})
