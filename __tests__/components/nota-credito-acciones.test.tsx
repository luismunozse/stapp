// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { toast } from "sonner"
vi.mock("@/components/notas-credito/nota-credito-ticket-dialog", () => ({
  NotaCreditoTicketDialog: (p: { open: boolean; notaCreditoId: string }) =>
    p.open ? <div role="dialog">ticket de {p.notaCreditoId}</div> : null,
}))

vi.mock("@/lib/notas-credito/whatsapp", async () => {
  const real = await vi.importActual<typeof import("@/lib/notas-credito/whatsapp")>("@/lib/notas-credito/whatsapp")
  return { ...real, compartirNotaCredito: vi.fn() }
})
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import { NotaCreditoAcciones } from "@/components/notas-credito/nota-credito-acciones"
import { compartirNotaCredito } from "@/lib/notas-credito/whatsapp"

const documento = {
  id: "nc-1", origen: "VENTA", origenId: "v-1", origenNumero: "V0042", numero: "NC-000010",
  fecha: "2026-10-13T15:00:00+00:00", modo: "MONTO", motivoNc: "OTRO", detalle: null, observaciones: null,
  items: [], monto: 100, montoAplicadoDeuda: 0, montoReembolso: 100, metodo: "EFECTIVO", pendienteActual: 0,
  anulada: false, anuladaAt: null, anuladaMotivo: null,
  cliente: { nombre: "Juan", dni: null, telefono: "1155550000", email: null, direccion: null },
  sucursalNombre: null, atendidoPor: null,
  emisor: { nombreEmpresa: "Taller", telefonoEmpresa: null, direccionEmpresa: null, domicilioFiscalEmpresa: null, cuitEmpresa: null, condicionIvaEmpresa: null, pais: "AR", logoUrl: null, moneda: "ARS", zonaHoraria: "America/Argentina/Buenos_Aires" },
}

function stubDocumento(config: unknown = { plantillasWhatsapp: {} }) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) =>
    url === "/api/notificaciones/config"
      ? { ok: true, json: async () => config }
      : url.endsWith("/pdf")
        ? { ok: true, blob: async () => new Blob(["%PDF"], { type: "application/pdf" }) }
        : { ok: true, json: async () => documento }
  ))
}

describe("NotaCreditoAcciones", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal("open", vi.fn())
  })

  it("PDF abre el documento de esa NC en una pestaña nueva", () => {
    render(<NotaCreditoAcciones id="nc-1" />)
    fireEvent.click(screen.getByRole("button", { name: "PDF" }))
    expect(window.open).toHaveBeenCalledWith("/api/notas-credito/nc-1/pdf", "_blank")
  })

  it("compacto conserva el nombre accesible", () => {
    render(<NotaCreditoAcciones id="nc-1" compacto />)
    expect(screen.getByRole("button", { name: "PDF" })).toBeInTheDocument()
  })

  it("Ticket abre el diálogo de impresión de esa NC", () => {
    render(<NotaCreditoAcciones id="nc-1" />)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Ticket" }))
    expect(screen.getByRole("dialog")).toHaveTextContent("ticket de nc-1")
  })

  it("WhatsApp comparte el PDF con el mensaje de la plantilla del taller", async () => {
    stubDocumento({ plantillasWhatsapp: { nota_credito_comprobante: "Tu NC {numero_nc}" } })
    vi.mocked(compartirNotaCredito).mockResolvedValue("compartido")
    render(<NotaCreditoAcciones id="nc-1" />)
    fireEvent.click(screen.getByRole("button", { name: "WhatsApp" }))
    await waitFor(() =>
      expect(compartirNotaCredito).toHaveBeenCalledWith({
        numero: "NC-000010", telefono: "1155550000", pais: "AR", mensaje: "Tu NC NC-000010", pdf: expect.any(Blob),
      })
    )
  })

  it("si solo se descargó (sin teléfono, en la compu) avisa qué hacer", async () => {
    stubDocumento()
    vi.mocked(compartirNotaCredito).mockResolvedValue("descargado")
    render(<NotaCreditoAcciones id="nc-1" />)
    fireEvent.click(screen.getByRole("button", { name: "WhatsApp" }))
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith(expect.stringContaining("no tiene teléfono")))
  })

  it("cancelar la hoja de compartir no es un error", async () => {
    stubDocumento()
    vi.mocked(compartirNotaCredito).mockRejectedValue(Object.assign(new Error("cancelado"), { name: "AbortError" }))
    render(<NotaCreditoAcciones id="nc-1" />)
    fireEvent.click(screen.getByRole("button", { name: "WhatsApp" }))
    await waitFor(() => expect(compartirNotaCredito).toHaveBeenCalled())
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("si la NC no se puede leer, avisa y no comparte", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({ error: "x" }) })))
    render(<NotaCreditoAcciones id="nc-1" />)
    fireEvent.click(screen.getByRole("button", { name: "WhatsApp" }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("No se pudo preparar la nota de crédito para WhatsApp"))
    expect(compartirNotaCredito).not.toHaveBeenCalled()
  })

  // El gesto del click vence en unos segundos: documento, plantilla y PDF salen juntos, no en cadena.
  it("pide el documento, la plantilla y el PDF a la vez", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})))
    render(<NotaCreditoAcciones id="nc-1" />)
    fireEvent.click(screen.getByRole("button", { name: "WhatsApp" }))
    const urls = vi.mocked(fetch).mock.calls.map((c) => c[0])
    expect(urls).toEqual(expect.arrayContaining([
      "/api/notas-credito/nc-1", "/api/notificaciones/config", "/api/notas-credito/nc-1/pdf",
    ]))
    expect(urls).toHaveLength(3)
  })

  it("si el navegador bloqueó la ventana de WhatsApp, avisa que abra WhatsApp a mano", async () => {
    stubDocumento()
    vi.mocked(compartirNotaCredito).mockResolvedValue("bloqueado")
    render(<NotaCreditoAcciones id="nc-1" />)
    fireEvent.click(screen.getByRole("button", { name: "WhatsApp" }))
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith(expect.stringContaining("abrí WhatsApp")))
  })

  it("una NC anulada no se envía por WhatsApp; PDF y Ticket siguen", () => {
    render(<NotaCreditoAcciones id="nc-1" anulada />)
    expect(screen.queryByRole("button", { name: "WhatsApp" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "PDF" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Ticket" })).toBeInTheDocument()
  })

  it("con onAnular, el botón Anular lleva el número de la NC y la anula", () => {
    const onAnular = vi.fn()
    render(<NotaCreditoAcciones id="nc-1" numero="NC-000010" onAnular={onAnular} />)
    fireEvent.click(screen.getByRole("button", { name: "Anular la nota de crédito NC-000010" }))
    expect(onAnular).toHaveBeenCalledTimes(1)
  })

  it("si todavía no se puede anular, el botón queda deshabilitado y dice por qué", () => {
    const motivo = "Se anulan de la más reciente a la primera: primero anulá la NC-000011."
    render(<NotaCreditoAcciones id="nc-1" numero="NC-000010" onAnular={vi.fn()} bloqueoAnular={motivo} />)
    const boton = screen.getByRole("button", { name: "Anular la nota de crédito NC-000010" })
    expect(boton).toBeDisabled()
    expect(boton.closest("span")).toHaveAttribute("title", motivo)
  })

  it("el motivo del bloqueo se ve en pantalla y el botón lo declara, sin depender del title", () => {
    const motivo = "Se anulan de la más reciente a la primera: primero anulá la NC-000011."
    render(<NotaCreditoAcciones id="nc-1" numero="NC-000010" onAnular={vi.fn()} bloqueoAnular={motivo} />)
    const boton = screen.getByRole("button", { name: "Anular la nota de crédito NC-000010" })
    const texto = screen.getByText(motivo)
    expect(texto).toBeVisible()
    expect(boton).toHaveAttribute("aria-describedby", texto.id)
  })

  it("sin bloqueo no hay texto de motivo ni descripción", () => {
    render(<NotaCreditoAcciones id="nc-1" numero="NC-000010" onAnular={vi.fn()} />)
    expect(screen.getByRole("button", { name: "Anular la nota de crédito NC-000010" })).not.toHaveAttribute("aria-describedby")
  })

  it("caracterización: una NC anulada no ofrece WhatsApp, y tampoco anularla otra vez", () => {
    render(<NotaCreditoAcciones id="nc-1" numero="NC-000010" anulada onAnular={vi.fn()} />)
    expect(screen.queryByRole("button", { name: /Anular/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "WhatsApp" })).not.toBeInTheDocument()
  })

  it("caracterización: sin onAnular (listado, otros roles) no hay botón Anular", () => {
    render(<NotaCreditoAcciones id="nc-1" />)
    expect(screen.queryByRole("button", { name: /Anular/ })).not.toBeInTheDocument()
  })
})
