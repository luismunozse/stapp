import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"

const sendPushToUsers = vi.fn().mockResolvedValue({})
const sendPushToUser = vi.fn().mockResolvedValue({})
vi.mock("@/lib/push/send", () => ({
  sendPushToUsers: (...a: unknown[]) => sendPushToUsers(...a),
  sendPushToUser: (...a: unknown[]) => sendPushToUser(...a),
}))

import { sendNotificationDirect } from "../send-direct"

describe("sendNotificationDirect APROBADO", () => {
  beforeEach(() => vi.clearAllMocks())

  it("inserta el aviso pero no pushea directo (lo cubre el barrido de avisos-push)", async () => {
    const insert = vi.fn().mockResolvedValue({ data: null, error: null })
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "organizations") {
        const org = { notificaciones_email: false, notificaciones_whatsapp: false, plantillas_whatsapp: null, pais: "AR" }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: org, error: null }),
        } as any
      }
      if (table === "users") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: [{ id: "adm", rol: "ADMIN" }], error: null }),
        } as any
      }
      if (table === "user_notifications") return { insert } as any
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
        insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      } as any
    })

    await sendNotificationDirect({
      organizationId: "org1",
      ordenId: "o1",
      clienteId: "c1",
      tipo: "CAMBIO_ESTADO",
      context: {
        organizationName: "Org",
        cliente: { id: "c1", nombre: "Ana", email: null, telefono: null },
        orden: { id: "o1", numeroOrden: 1, dispositivo: "iPhone", estado: "APROBADO", tecnicoId: "tec1" },
      },
    } as any)

    expect(insert).toHaveBeenCalledTimes(1)
    expect(sendPushToUsers).not.toHaveBeenCalled()
    expect(sendPushToUser).not.toHaveBeenCalled()
  })
})
