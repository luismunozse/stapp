import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatDate: (d: string) => `fmt(${d})` }),
}))

import { toast } from "sonner"
import { AnularPagoDialog } from "@/components/comisiones/anular-pago-dialog"

describe("AnularPagoDialog", () => {
  beforeEach(() => vi.clearAllMocks())

  it("keeps 'Anular pago' disabled until a reason is typed, then sends pagoId and reason", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ pagoId: "p1", filas: 2 }) }) as any
    const onAnulado = vi.fn()
    const onOpenChange = vi.fn()
    render(<AnularPagoDialog open onOpenChange={onOpenChange} pagoId="p1" fechaPago="2026-10-20T12:00:00Z" endpoint="/api/comisiones/pagar" onAnulado={onAnulado} />)
    const boton = screen.getByRole("button", { name: "Anular pago" })
    expect(boton).toBeDisabled()
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "monto equivocado" } })
    fireEvent.click(boton)
    expect(global.fetch).toHaveBeenCalledWith("/api/comisiones/pagar", expect.objectContaining({ method: "DELETE", body: JSON.stringify({ pagoId: "p1", motivo: "monto equivocado" }) }))
    await waitFor(() => expect(onAnulado).toHaveBeenCalled())
    expect(toast.success).toHaveBeenCalledWith("Pago anulado")
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("shows the server's 409 message and stays open", async () => {
    const msg = "Un pago posterior ya liquidó ajustes de este pago"
    global.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: msg }) }) as any
    const onAnulado = vi.fn()
    const onOpenChange = vi.fn()
    render(<AnularPagoDialog open onOpenChange={onOpenChange} pagoId="p1" fechaPago={null} endpoint="/api/comisiones/vendedores/pagar" onAnulado={onAnulado} />)
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "x" } })
    fireEvent.click(screen.getByRole("button", { name: "Anular pago" }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(msg))
    expect(onAnulado).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it("falls back to a generic message when fetch throws", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("net")) as any
    render(<AnularPagoDialog open onOpenChange={vi.fn()} pagoId="p1" fechaPago={null} endpoint="/api/comisiones/pagar" onAnulado={vi.fn()} />)
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "x" } })
    fireEvent.click(screen.getByRole("button", { name: "Anular pago" }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("No se pudo anular el pago"))
  })
})
