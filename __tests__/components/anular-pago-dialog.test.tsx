import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatDate: (d: string) => `fmt(${d})`, formatPrice: (n: number) => `$${n}` }),
}))

import { toast } from "sonner"
import { AnularPagoDialog } from "@/components/comisiones/anular-pago-dialog"

const DETALLE = { pagoId: "p1", fechaPago: "2026-10-20T12:00:00Z", origen: "APP", total: 150, anulado: false, filas: 3, beneficiarioNombre: "Ana" }

// GET /api/comisiones/pagos/:id answers the summary; DELETE answers the annul result.
function mockFetch(opts: { detalle?: unknown; detalleOk?: boolean; anular?: { ok: boolean; body: unknown } } = {}) {
  const anular = opts.anular ?? { ok: true, body: { pagoId: "p1", filas: 2 } }
  global.fetch = vi.fn().mockImplementation(async (_url: string, init?: { method?: string }) =>
    init?.method === "DELETE"
      ? { ok: anular.ok, json: async () => anular.body }
      : { ok: opts.detalleOk ?? true, json: async () => opts.detalle ?? DETALLE }
  ) as any
}

describe("AnularPagoDialog", () => {
  beforeEach(() => vi.clearAllMocks())

  it("keeps 'Anular pago' disabled until a reason is typed, then sends pagoId and reason", async () => {
    mockFetch()
    const onAnulado = vi.fn()
    const onOpenChange = vi.fn()
    render(<AnularPagoDialog open onOpenChange={onOpenChange} pagoId="p1" fechaPago="2026-10-20T12:00:00Z" endpoint="/api/comisiones/pagar" onAnulado={onAnulado} />)
    const boton = screen.getByRole("button", { name: "Anular pago" })
    expect(boton).toBeDisabled()
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "monto equivocado" } })
    fireEvent.click(boton)
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith("/api/comisiones/pagar", expect.objectContaining({ method: "DELETE", body: JSON.stringify({ pagoId: "p1", motivo: "monto equivocado" }) }))
    )
    await waitFor(() => expect(onAnulado).toHaveBeenCalled())
    expect(toast.success).toHaveBeenCalledWith("Pago anulado: 2 comisión(es) vuelven a pendientes.")
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("shows the server's 409 message and stays open", async () => {
    const msg = "Un pago posterior ya liquidó ajustes de este pago"
    mockFetch({ anular: { ok: false, body: { error: msg } } })
    const onAnulado = vi.fn()
    const onOpenChange = vi.fn()
    render(<AnularPagoDialog open onOpenChange={onOpenChange} pagoId="p1" fechaPago={null} endpoint="/api/comisiones/vendedores/pagar" onAnulado={onAnulado} />)
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "x" } })
    fireEvent.click(screen.getByRole("button", { name: "Anular pago" }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(msg))
    expect(onAnulado).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it("falls back to a generic message when the annul call throws", async () => {
    global.fetch = vi.fn().mockImplementation(async (_url: string, init?: { method?: string }) => {
      if (init?.method === "DELETE") throw new Error("net")
      return { ok: true, json: async () => DETALLE }
    }) as any
    render(<AnularPagoDialog open onOpenChange={vi.fn()} pagoId="p1" fechaPago={null} endpoint="/api/comisiones/pagar" onAnulado={vi.fn()} />)
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "x" } })
    fireEvent.click(screen.getByRole("button", { name: "Anular pago" }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("No se pudo anular el pago"))
  })

  it("tells how many commissions and how much it un-pays, and warns when there are several", async () => {
    mockFetch()
    render(<AnularPagoDialog open onOpenChange={vi.fn()} pagoId="p1" fechaPago="2026-10-20T12:00:00Z" endpoint="/api/comisiones/pagar" onAnulado={vi.fn()} />)
    expect(await screen.findByText("3 comisión(es) · total $150 · pagado el fmt(2026-10-20T12:00:00Z)")).toBeInTheDocument()
    expect(
      screen.getByText("Anular este pago deja pendientes las 3 comisiones. Las de órdenes vuelven con el monto actual, no con el pagado.")
    ).toBeInTheDocument()
    expect(global.fetch).toHaveBeenCalledWith("/api/comisiones/pagos/p1")
  })

  it("does not warn when the payout has a single commission", async () => {
    mockFetch({ detalle: { ...DETALLE, filas: 1, total: 40 } })
    render(<AnularPagoDialog open onOpenChange={vi.fn()} pagoId="p1" fechaPago={null} endpoint="/api/comisiones/pagar" onAnulado={vi.fn()} />)
    expect(await screen.findByText(/^1 comisión\(es\) · total \$40/)).toBeInTheDocument()
    expect(screen.queryByText(/Anular este pago deja pendientes/)).not.toBeInTheDocument()
  })

  it("on a failed summary read says so and keeps the annul button usable", async () => {
    mockFetch({ detalleOk: false, detalle: { error: "Pago no encontrado." } })
    render(<AnularPagoDialog open onOpenChange={vi.fn()} pagoId="p1" fechaPago={null} endpoint="/api/comisiones/pagar" onAnulado={vi.fn()} />)
    expect(await screen.findByText("No se pudo cargar el pago.")).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "x" } })
    expect(screen.getByRole("button", { name: "Anular pago" })).toBeEnabled()
  })
})
