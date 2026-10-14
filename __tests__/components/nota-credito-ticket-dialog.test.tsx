// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

const printer = vi.hoisted(() => ({
  connected: true, connecting: false, isSupported: true, error: null, device: null,
  connect: vi.fn(), disconnect: vi.fn(), print: vi.fn(async () => true),
}))
vi.mock("@/components/pos/use-thermal-printer", () => ({ useThermalPrinter: () => printer }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { toast } from "sonner"
import { NotaCreditoTicketDialog } from "@/components/notas-credito/nota-credito-ticket-dialog"

const documento = {
  id: "nc-1", origen: "VENTA", origenId: "v-1", origenNumero: "V0042", numero: "NC-000010",
  fecha: "2026-10-13T15:00:00+00:00", modo: "ITEMS", motivoNc: "DEVOLUCION", detalle: null, observaciones: null,
  items: [{ descripcion: "Funda", cantidad: 1, precioUnitario: 100, subtotal: 100 }],
  monto: 100, montoAplicadoDeuda: 0, montoReembolso: 100, metodo: "EFECTIVO", pendienteActual: 0,
  anulada: false, anuladaAt: null, anuladaMotivo: null,
  cliente: { nombre: "Juan", dni: null, telefono: null, email: null, direccion: null },
  sucursalNombre: null, atendidoPor: null,
  emisor: { nombreEmpresa: "Taller", telefonoEmpresa: null, direccionEmpresa: null, domicilioFiscalEmpresa: null, cuitEmpresa: null, condicionIvaEmpresa: null, pais: "AR", logoUrl: null, moneda: "ARS", zonaHoraria: "America/Argentina/Buenos_Aires" },
}

function stubFetch(ok = true) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok, status: ok ? 200 : 404, json: async () => (ok ? documento : { error: "Nota de crédito no encontrada" }) })))
}

const abrir = (props: Partial<Parameters<typeof NotaCreditoTicketDialog>[0]> = {}) =>
  render(<NotaCreditoTicketDialog notaCreditoId="nc-1" open onOpenChange={vi.fn()} {...props} />)

describe("NotaCreditoTicketDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
  })

  it("trae el documento de esa NC y muestra la vista previa", async () => {
    stubFetch()
    abrir()
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/notas-credito/nc-1"))
    const preview = await screen.findByTitle("Vista previa del ticket")
    expect(preview.getAttribute("srcdoc")).toContain("NC-000010")
  })

  it("si la NC no se puede leer lo dice y no ofrece imprimir", async () => {
    stubFetch(false)
    abrir()
    expect(await screen.findByRole("alert")).toHaveTextContent("Nota de crédito no encontrada")
    expect(screen.queryByRole("button", { name: /imprimir/i })).not.toBeInTheDocument()
  })

  it("imprime por USB con el ancho elegido", async () => {
    stubFetch()
    abrir({ anchoInicial: 80 })
    fireEvent.click(await screen.findByRole("button", { name: "Imprimir térmica" }))
    await waitFor(() => expect(printer.print).toHaveBeenCalledTimes(1))
    expect(printer.print.mock.calls[0][0]).toBeInstanceOf(Uint8Array)
    expect(toast.success).toHaveBeenCalledWith("Ticket impreso")
  })

  it("avisa si la impresora USB falla", async () => {
    stubFetch()
    printer.print.mockResolvedValueOnce(false)
    abrir()
    fireEvent.click(await screen.findByRole("button", { name: "Imprimir térmica" }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("No se pudo imprimir el ticket"))
  })

  it("imprime por navegador escribiendo el HTML del ticket", async () => {
    stubFetch()
    const ventana = {
      document: { write: vi.fn(), close: vi.fn(), readyState: "complete", body: {}, fonts: { ready: Promise.resolve() } },
      focus: vi.fn(),
      print: vi.fn(),
    }
    vi.stubGlobal("open", vi.fn(() => ventana))
    abrir({ anchoInicial: 58 })
    fireEvent.click(await screen.findByRole("button", { name: "Imprimir (navegador)" }))
    expect(window.open).toHaveBeenCalledWith("", "_blank", "width=320,height=600")
    expect(ventana.document.write).toHaveBeenCalledWith(expect.stringContaining("@page { size: 58mm auto"))
    await waitFor(() => expect(ventana.print).toHaveBeenCalled())
  })

  it("cambiar el ancho lo recuerda en el dispositivo", async () => {
    stubFetch()
    abrir()
    fireEvent.click(await screen.findByRole("button", { name: "58mm" }))
    expect(window.localStorage.getItem("stapp:comprobante-ancho")).toBe("58")
    expect((await screen.findByTitle("Vista previa del ticket")).getAttribute("srcdoc")).toContain("58mm")
  })
})
