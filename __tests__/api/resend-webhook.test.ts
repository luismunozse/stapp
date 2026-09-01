import { describe, it, expect, beforeEach, vi } from "vitest"
import { createChainMock, mockSupabaseFrom, parseResponse } from "./helpers"

// La verificacion real de firma es de svix; aca se mockea para poder ejercitar
// tanto el camino valido como el invalido sin fabricar firmas reales.
const verify = vi.fn()
vi.mock("svix", () => ({
  Webhook: class {
    verify(...args: any[]) {
      return verify(...args)
    }
  },
}))

async function post(body: unknown, headers: Record<string, string> = {}) {
  const { POST } = await import("@/app/api/webhooks/resend/route")
  const raw = JSON.stringify(body)
  return POST(
    new Request("http://localhost:3000/api/webhooks/resend", {
      method: "POST",
      headers: {
        "svix-id": "msg_1",
        "svix-timestamp": "1700000000",
        "svix-signature": "v1,firma",
        ...headers,
      },
      body: raw,
    })
  )
}

function evento(type: string, extra: Record<string, unknown> = {}) {
  return {
    type,
    created_at: "2026-08-31T12:00:00.000Z",
    data: {
      email_id: "re-abc",
      from: "Taller Pepe <avisos@avisos.stapp.com.ar>",
      to: ["cliente@example.com"],
      subject: "Tu orden esta lista",
      ...extra,
    },
  }
}

describe("POST /api/webhooks/resend", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env.RESEND_WEBHOOK_SECRET = "whsec_test"
  })

  it("rechaza con 401 si la firma es invalida y no escribe nada", async () => {
    verify.mockImplementation(() => {
      throw new Error("No matching signature found")
    })
    const { supabaseAdmin } = await import("@/lib/supabase")
    const fromSpy = vi.fn()
    vi.mocked(supabaseAdmin.from).mockImplementation(fromSpy as any)

    const res = await post(evento("email.delivered"))

    expect(res.status).toBe(401)
    expect(fromSpy).not.toHaveBeenCalled()
  })

  it("email.delivered marca ENTREGADO", async () => {
    const payload = evento("email.delivered")
    verify.mockReturnValue(payload)
    // El update termina en .select(), asi que la cadena resuelve un ARRAY de
    // filas alcanzadas, no un objeto. Un objeto suelto haria que filas[0] sea
    // undefined y el test pasaria por el camino de "sin correlacionar".
    const logs = createChainMock([{ id: "log-1", organization_id: "org-1" }])
    mockSupabaseFrom({ notification_logs: logs })

    const res = await post(payload)

    expect(res.status).toBe(200)
    expect(logs.update).toHaveBeenCalledWith(
      expect.objectContaining({ estado_entrega: "ENTREGADO" })
    )
  })

  it("bounce Permanent marca REBOTADO y suprime la direccion", async () => {
    const payload = evento("email.bounced", {
      bounce: { message: "Unknown User", subType: "General", type: "Permanent" },
    })
    verify.mockReturnValue(payload)
    const logs = createChainMock([{ id: "log-1", organization_id: "org-1" }])
    const suprimidos = createChainMock(null)
    mockSupabaseFrom({ notification_logs: logs, email_suprimidos: suprimidos })

    const res = await post(payload)

    expect(res.status).toBe(200)
    expect(logs.update).toHaveBeenCalledWith(
      expect.objectContaining({ estado_entrega: "REBOTADO", bounce_tipo: "HARD" })
    )
    expect(suprimidos.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ email: "cliente@example.com", motivo: "HARD_BOUNCE" }),
      expect.anything()
    )
  })

  it("bounce Transient NO cambia estado_entrega ni suprime", async () => {
    const payload = evento("email.bounced", {
      bounce: { message: "Mailbox full", subType: "MailboxFull", type: "Transient" },
    })
    verify.mockReturnValue(payload)
    const logs = createChainMock([{ id: "log-1", organization_id: "org-1" }])
    const suprimidos = createChainMock(null)
    mockSupabaseFrom({ notification_logs: logs, email_suprimidos: suprimidos })

    await post(payload)

    const patch = vi.mocked(logs.update).mock.calls[0][0] as Record<string, unknown>
    expect(patch).not.toHaveProperty("estado_entrega")
    expect(patch.bounce_tipo).toBe("SOFT")
    // Sin estado nuevo no hay guard de precedencia: el soft bounce solo deja
    // constancia y no compite con ningun otro evento.
    expect(logs.or).not.toHaveBeenCalled()
    expect(suprimidos.upsert).not.toHaveBeenCalled()
  })

  it("email.complained marca QUEJA y suprime", async () => {
    const payload = evento("email.complained")
    verify.mockReturnValue(payload)
    const logs = createChainMock([{ id: "log-1", organization_id: "org-1" }])
    const suprimidos = createChainMock(null)
    mockSupabaseFrom({ notification_logs: logs, email_suprimidos: suprimidos })

    await post(payload)

    expect(logs.update).toHaveBeenCalledWith(
      expect.objectContaining({ estado_entrega: "QUEJA", bounce_tipo: "QUEJA" })
    )
    expect(suprimidos.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ motivo: "QUEJA" }),
      expect.anything()
    )
  })

  it("un delivered que llega DESPUES de una queja no la pisa", async () => {
    const payload = evento("email.delivered")
    verify.mockReturnValue(payload)
    // La fila ya esta en QUEJA, asi que el WHERE del update no alcanza ninguna:
    // devuelve array vacio.
    const logs = createChainMock([])
    mockSupabaseFrom({ notification_logs: logs })

    const res = await post(payload)

    expect(res.status).toBe(200)
    // El guard de precedencia va en el WHERE, no en una lectura previa: el
    // update se emite acotado a los estados previos permitidos y no toca nada.
    expect(logs.or).toHaveBeenCalledWith("estado_entrega.is.null")
    const { body } = await parseResponse(res.clone())
    expect(body.correlacionado).toBe(false)
  })

  it("un email_id desconocido devuelve 200, no 500", async () => {
    const payload = evento("email.delivered")
    verify.mockReturnValue(payload)
    mockSupabaseFrom({ notification_logs: createChainMock(null) })

    const res = await post(payload)

    expect(res.status).toBe(200)
  })

  it("un hard bounce sin fila correlacionada igual suprime la direccion", async () => {
    // Ej. correo de turnos: lib/turnos/notifications.ts registra en
    // turno_notificaciones, no en notification_logs, asi que nunca hay fila
    // para correlacionar. El bounce es igual autoritativo sobre el destinatario.
    const payload = evento("email.bounced", {
      bounce: { message: "Unknown User", subType: "General", type: "Permanent" },
    })
    verify.mockReturnValue(payload)
    const suprimidos = createChainMock(null)
    mockSupabaseFrom({ notification_logs: createChainMock(null), email_suprimidos: suprimidos })

    const res = await post(payload)

    expect(res.status).toBe(200)
    // `suprimirEmail` (lib/email/suppression.ts) traduce a snake_case antes
    // de llamar a `.upsert()`; estas son las claves que llegan a la tabla.
    expect(suprimidos.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "cliente@example.com",
        motivo: "HARD_BOUNCE",
        organization_id: null,
        notification_log_id: null,
      }),
      expect.anything()
    )
  })

  it("un tipo de evento que no manejamos devuelve 200 sin tocar la base", async () => {
    const payload = evento("email.opened")
    verify.mockReturnValue(payload)
    const fromSpy = vi.fn()
    const { supabaseAdmin } = await import("@/lib/supabase")
    vi.mocked(supabaseAdmin.from).mockImplementation(fromSpy as any)

    const res = await post(payload)

    expect(res.status).toBe(200)
    expect(fromSpy).not.toHaveBeenCalled()
  })
})
