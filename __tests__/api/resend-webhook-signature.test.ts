import { describe, it, expect, beforeEach, vi } from "vitest"
import { Webhook } from "svix"
import { createChainMock, mockSupabaseFrom } from "./helpers"

/**
 * A proposito NO se mockea `svix` aca (a diferencia de resend-webhook.test.ts).
 * Ese mock reemplaza `Webhook.verify` por un `vi.fn()` que devuelve lo que el
 * test le pida, lo cual esconde el contrato real de la libreria: `verify()`
 * no devuelve el payload (tira si la firma no coincide, y con
 * `{ jsonParse: false }` no devuelve nada en exito). Este archivo ejercita
 * el `Webhook` real para probar que la ruta funciona de punta a punta contra
 * la libreria de verdad, no contra una idea equivocada de como se comporta.
 */

// Secreto en el formato que exige el constructor: prefijo whsec_ + base64.
// El contenido no importa, solo que decodifique a bytes no vacios.
const SECRET = "whsec_" + Buffer.from("clave-de-prueba-para-el-webhook").toString("base64")

function firmar(msgId: string, timestamp: Date, payload: string) {
  return new Webhook(SECRET).sign(msgId, timestamp, payload)
}

async function postFirmado(payload: string, opts?: { bodyEnviado?: string }) {
  const { POST } = await import("@/app/api/webhooks/resend/route")
  const msgId = "msg_real_1"
  const timestamp = new Date()
  const svixTimestamp = String(Math.floor(timestamp.getTime() / 1000))
  const signature = firmar(msgId, timestamp, payload)

  return POST(
    new Request("http://localhost:3000/api/webhooks/resend", {
      method: "POST",
      headers: {
        "svix-id": msgId,
        "svix-timestamp": svixTimestamp,
        "svix-signature": signature,
      },
      // Si opts.bodyEnviado esta presente, el cuerpo real difiere del que se
      // firmo -simula un tamperer entre la firma y la llegada.
      body: opts?.bodyEnviado ?? payload,
    })
  )
}

describe("POST /api/webhooks/resend — firma real de svix", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env.RESEND_WEBHOOK_SECRET = SECRET
  })

  it("con firma valida verifica end-to-end y correlaciona el evento", async () => {
    const payload = JSON.stringify({
      type: "email.delivered",
      created_at: "2026-08-31T12:00:00.000Z",
      data: {
        email_id: "re-real-1",
        from: "Taller Pepe <avisos@avisos.stapp.com.ar>",
        to: ["cliente@example.com"],
        subject: "Tu orden esta lista",
      },
    })
    const logs = createChainMock([{ id: "log-1", organization_id: "org-1" }])
    mockSupabaseFrom({ notification_logs: logs })

    const res = await postFirmado(payload)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.correlacionado).toBe(true)
    // Prueba que el evento procesado viene de parsear el `raw` verificado
    // (no del valor de retorno de verify(), que es undefined en exito).
    expect(logs.update).toHaveBeenCalledWith(
      expect.objectContaining({ estado_entrega: "ENTREGADO" })
    )
  })

  it("si el cuerpo se altera despues de firmar, la firma no matchea y responde 401 sin escribir nada", async () => {
    const payloadFirmado = JSON.stringify({
      type: "email.delivered",
      created_at: "2026-08-31T12:00:00.000Z",
      data: {
        email_id: "re-real-1",
        from: "Taller Pepe <avisos@avisos.stapp.com.ar>",
        to: ["cliente@example.com"],
        subject: "Tu orden esta lista",
      },
    })
    // Mismo tipo de evento, pero con el email_id cambiado: firma calculada
    // sobre `payloadFirmado`, cuerpo realmente enviado distinto.
    const payloadAlterado = payloadFirmado.replace("re-real-1", "re-otro-2")

    const { supabaseAdmin } = await import("@/lib/supabase")
    const fromSpy = vi.fn()
    vi.mocked(supabaseAdmin.from).mockImplementation(fromSpy as any)

    const res = await postFirmado(payloadFirmado, { bodyEnviado: payloadAlterado })

    expect(res.status).toBe(401)
    expect(fromSpy).not.toHaveBeenCalled()
  })
})
