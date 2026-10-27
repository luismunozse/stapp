import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, parseResponse } from "./helpers"
import { EmailSuprimidoError } from "@/lib/email/index"

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn().mockResolvedValue(true),
}))
vi.mock("@/lib/pdf", () => ({
  generateCotizacionPDF: vi.fn().mockResolvedValue(Buffer.from("fake-pdf")),
}))
vi.mock("@/lib/email", () => ({
  sendCotizacionEmail: vi.fn().mockResolvedValue({ id: "m1", proveedor: "resend" }),
}))

import { sendCotizacionEmail } from "@/lib/email"

function cotizacionRow(orgEmail: string | null) {
  return {
    id: "cot-1",
    estado: "BORRADOR",
    organization_id: "org-1",
    orden_id: null,
    revision_de: null,
    fecha_vencimiento: null,
    total: 120,
    numero_cotizacion: "COT-0001",
    ordenes_servicio: {
      id: "orden-1",
      numero_orden: 5,
      dispositivo: "iPhone 12",
      problema_reportado: "Pantalla rota",
      organization_id: "org-1",
      clientes: { email: "cliente@test.com", nombre: "Cliente Test", telefono: null, direccion: null },
      organizations: {
        id: "org-1", nombre_mostrar: "Taller Test", email: orgEmail, telefono: null, direccion: null,
        logo_url: null, moneda: "ARS", zona_horaria: "America/Argentina/Buenos_Aires",
      },
    },
    clientes: null,
    sectores_cliente: null,
    items_cotizacion: [],
  }
}

async function enviar(row: ReturnType<typeof cotizacionRow>) {
  const cotizacionesChain = createChainMock([{ total: 120 }])
  cotizacionesChain.single = vi.fn().mockResolvedValue({ data: row, error: null })
  mockSupabaseFrom({
    cotizaciones: cotizacionesChain,
    ordenes_servicio: createChainMock({ id: "orden-1", estado: "ENTREGADO" }),
    orden_eventos: createChainMock(null),
  })
  const { POST } = await import("@/app/api/cotizaciones/[id]/enviar/route")
  const response = await POST(
    new Request("http://localhost:3000/api/cotizaciones/cot-1/enviar", { method: "POST" }) as any,
    { params: Promise.resolve({ id: "cot-1" }) } as any
  )
  return { response, cotizacionesChain }
}

describe("POST /api/cotizaciones/[id]/enviar — canal de cliente", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess()
  })

  it("pasa el nombre del taller y su email como replyTo", async () => {
    const { response } = await enviar(cotizacionRow("taller@example.com"))

    expect(response.status).toBe(200)
    expect(sendCotizacionEmail).toHaveBeenCalledWith(
      expect.objectContaining({ fromName: "Taller Test", replyTo: "taller@example.com" })
    )
  })

  it("sin email del taller no pasa replyTo", async () => {
    await enviar(cotizacionRow(null))

    const args = vi.mocked(sendCotizacionEmail).mock.calls[0][0]
    expect(args.fromName).toBe("Taller Test")
    expect(args.replyTo).toBeUndefined()
  })

  it("si la direccion del cliente esta suprimida responde 422 claro y no marca la cotizacion como enviada", async () => {
    vi.mocked(sendCotizacionEmail).mockRejectedValueOnce(new EmailSuprimidoError("HARD_BOUNCE"))

    const { response, cotizacionesChain } = await enviar(cotizacionRow("taller@example.com"))
    const { status, body } = await parseResponse(response)

    expect(status).toBe(422)
    expect(body.error).toMatch(/otra dirección|otro correo|WhatsApp/i)
    expect(cotizacionesChain.update).not.toHaveBeenCalled()
  })

  it("otros errores de envio siguen siendo 500", async () => {
    vi.mocked(sendCotizacionEmail).mockRejectedValueOnce(new Error("proveedor caido"))

    const { response } = await enviar(cotizacionRow("taller@example.com"))

    expect(response.status).toBe(500)
  })
})
