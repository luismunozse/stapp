// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

const printer = vi.hoisted(() => ({
  connected: false, connecting: false, isSupported: true, error: null, device: null,
  connect: vi.fn(), disconnect: vi.fn(), print: vi.fn(async (_c: Uint8Array) => true),
}))
const modal = vi.hoisted(() => ({ confirm: vi.fn(), showSuccess: vi.fn(), showError: vi.fn().mockResolvedValue(undefined) }))

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "u1", role: "ADMIN" } } }) }))
vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `$${n}`, pais: "AR", timezone: "America/Argentina/Buenos_Aires" }),
}))
vi.mock("@/contexts/modal-context", () => ({ useModal: () => modal }))
vi.mock("@/contexts/offline-context", () => ({ useOffline: () => ({ isOnline: true }) }))
vi.mock("@/components/pos/use-thermal-printer", () => ({ useThermalPrinter: () => printer }))
vi.mock("@/components/pos/pos-product-search", async () => {
  const { forwardRef, useImperativeHandle } = await import("react")
  return {
    PosProductSearch: forwardRef((_props: any, ref: any) => {
      useImperativeHandle(ref, () => ({ focusSearch: () => {} }))
      return null
    }),
  }
})
vi.mock("@/components/pos/pos-cart", () => ({ PosCart: () => null }))
vi.mock("@/components/pos/pos-checkout-dialog", () => ({ PosCheckoutDialog: () => null }))
vi.mock("@/components/pos/pos-held-sales", () => ({ PosHeldSales: () => null }))
vi.mock("@/components/pos/pos-ticket-share", () => ({ PosTicketShare: () => null }))
vi.mock("@/components/inventario/barcode-scanner", () => ({ BarcodeScanner: () => null }))
vi.mock("@/components/pos/pos-devolucion-search", () => ({
  PosDevolucionSearch: (p: any) =>
    p.open ? (
      <button
        type="button"
        onClick={() =>
          p.onVentaFound({ id: "v1", numeroVenta: 42, sucursalId: "suc-1", total: 100, clienteId: null, saldoPendiente: 0, devoluciones: [], items: [] })
        }
      >
        mock-elegir-venta
      </button>
    ) : null,
}))
vi.mock("@/components/notas-credito/nota-credito-venta-dialog", () => ({
  NotaCreditoVentaDialog: (p: any) => (
    <div role="dialog" aria-label={p.rotulo}>
      <button type="button" onClick={() => p.onEmitida({ id: "nc-9", numero: "NC-000009" })}>
        mock-emitir
      </button>
    </div>
  ),
}))
vi.mock("@/components/notas-credito/nota-credito-ticket-dialog", () => ({
  NotaCreditoTicketDialog: (p: any) => (p.open ? <div>ticket {p.notaCreditoId} a {p.anchoInicial}mm</div> : null),
}))

import { PosTerminal } from "@/components/pos/pos-terminal"

const documento = {
  id: "nc-9", origen: "VENTA", origenId: "v1", origenNumero: "42", numero: "NC-000009",
  fecha: "2026-10-19T15:00:00+00:00", modo: "MONTO", motivoNc: "AJUSTE_PRECIO", detalle: null, observaciones: null,
  items: [], monto: 20, montoAplicadoDeuda: 0, montoReembolso: 20, metodo: "EFECTIVO", pendienteActual: 0,
  anulada: false, anuladaAt: null, anuladaMotivo: null,
  cliente: { nombre: "Consumidor final", dni: null, telefono: null, email: null, direccion: null },
  sucursalNombre: null, atendidoPor: null,
  emisor: { nombreEmpresa: "Taller", telefonoEmpresa: null, direccionEmpresa: null, domicilioFiscalEmpresa: null, cuitEmpresa: null, condicionIvaEmpresa: null, pais: "AR", logoUrl: null, moneda: "ARS", zonaHoraria: "America/Argentina/Buenos_Aires" },
}

function stubFetch() {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url === "/api/notas-credito/nc-9") return { ok: true, status: 200, json: async () => documento }
    // La config operativa con sus defaults: sin ella el POS loguea un error en cada test.
    if (url === "/api/configuracion/operativa") return { ok: true, status: 200, json: async () => ({}) }
    return { ok: false, status: 404, json: async () => ({}) }
  }))
}

async function emitirDesdeElPos() {
  render(<PosTerminal />)
  fireEvent.click(screen.getByRole("button", { name: "Devolución (nota de crédito)" }))
  fireEvent.click(await screen.findByRole("button", { name: "mock-elegir-venta" }))
  fireEvent.click(screen.getByRole("button", { name: "mock-emitir" }))
}

describe("PosTerminal — devolución como nota de crédito", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    printer.connected = false
    printer.print.mockResolvedValue(true)
    window.localStorage.setItem("pos_printer_width", "80")
    stubFetch()
  })

  it("Devolución abre el diálogo de nota de crédito con el rótulo del POS", async () => {
    render(<PosTerminal />)
    fireEvent.click(screen.getByRole("button", { name: "Devolución (nota de crédito)" }))
    fireEvent.click(await screen.findByRole("button", { name: "mock-elegir-venta" }))
    expect(screen.getByRole("dialog", { name: "Devolución (nota de crédito)" })).toBeInTheDocument()
  })

  it("sin térmica conectada, al emitir abre el ticket de esa NC con el ancho del POS", async () => {
    await emitirDesdeElPos()
    expect(await screen.findByText("ticket nc-9 a 80mm")).toBeInTheDocument()
    expect(printer.print).not.toHaveBeenCalled()
  })

  it("con la térmica conectada imprime el ticket de la NC sin abrir el diálogo", async () => {
    printer.connected = true
    await emitirDesdeElPos()
    await waitFor(() => expect(printer.print).toHaveBeenCalledTimes(1))
    expect(printer.print.mock.calls[0][0]).toBeInstanceOf(Uint8Array)
    expect(screen.queryByText(/ticket nc-9/)).not.toBeInTheDocument()
  })

  it("si la térmica falla, avisa y abre el diálogo del ticket para reimprimir", async () => {
    printer.connected = true
    printer.print.mockResolvedValueOnce(false)
    await emitirDesdeElPos()
    await waitFor(() =>
      expect(modal.showError).toHaveBeenCalledWith(
        "La nota de crédito se emitió, pero no se pudo imprimir el ticket. Revisá la impresora."
      )
    )
    expect(await screen.findByText("ticket nc-9 a 80mm")).toBeInTheDocument()
  })
})
