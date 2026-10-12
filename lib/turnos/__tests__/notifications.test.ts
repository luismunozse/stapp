import { describe, it, expect, beforeEach, vi } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"

const ENV_URL = "https://backend.envialosimple.email/api/v1/mail/send"

// Partial mock: envolvemos sendCustomer en un spy que sigue ejecutando la
// implementacion real (importOriginal), para poder probar a la vez (a) que
// este modulo invoca especificamente sendCustomer -- no sendEmail/sendPlatform --
// y (b) el comportamiento real de extremo a extremo (el fetch que llega a
// EnvialoSimple no esta simulado).
vi.mock("@/lib/email/index", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/index")>()
  return {
    ...actual,
    sendCustomer: vi.fn(actual.sendCustomer),
  }
})

function wireSupabase(overrides: Record<string, any>) {
  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    const row = overrides[table] ?? null
    return {
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      update: vi.fn().mockReturnThis(),
      // sendCustomer consulta email_suprimidos (eq + maybeSingle) antes de
      // elegir proveedor. Sin overrides para esa tabla, row queda en null: la
      // direccion no esta suprimida y el envio sigue por el camino normal.
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: row, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
    } as any
  })
}

const baseCtx = {
  organizationId: "org1",
  organizationName: "Taller Pepe",
  turnoId: "turno1",
  inicio: "2026-09-01T10:00:00Z",
  tipo: "reparacion",
  destinatarioNombre: "Ana",
  destinatarioEmail: "cliente@example.com",
}

describe("sendTurnoNotification usa el canal de cliente", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env.ENVIALOSIMPLE_API_KEY = "key-test"
    process.env.EMAIL_FROM = "noreply@stapp.com.ar"
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "turno-es-1" }),
    }) as any
    wireSupabase({
      organizations: {
        notificaciones_email: true,
        notificaciones_whatsapp: false,
        plantillas_whatsapp: null,
      },
    })
  })

  it("el email de confirmacion de turno sale por sendCustomer y llega a EnvialoSimple", async () => {
    const { sendCustomer } = await import("@/lib/email/index")
    const { sendTurnoNotification } = await import("../notifications")

    const result = await sendTurnoNotification(baseCtx as any, "confirmacion", ["email"])

    expect(result.email?.sent).toBe(true)
    expect(sendCustomer).toHaveBeenCalledTimes(1)
    expect(vi.mocked(global.fetch).mock.calls[0][0]).toBe(ENV_URL)
    const body = JSON.parse(vi.mocked(global.fetch).mock.calls[0][1]!.body as string)
    expect(body.to).toBe("cliente@example.com")
  })
})
