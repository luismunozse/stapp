import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"

vi.mock("@/lib/whatsapp/platform-config", () => ({
  getPlatformEvolutionConfig: () => ({ baseUrl: "https://evo.test", apiKey: "k" }),
  buildInstanceName: (o: string) => `stapp-org-${o}`,
  buildSucursalInstanceName: (o: string, s: string) => `stapp-org-${o}-suc-${s}`,
}))

const evoSendText = vi.fn().mockResolvedValue({ success: true, messageId: "m1" })
vi.mock("@/lib/whatsapp/providers/evolution", () => ({
  sendText: (...args: any[]) => evoSendText(...args),
}))

/** Devuelve filas distintas segun la tabla que se consulte. */
function mockTablas(porTabla: Record<string, any>) {
  vi.mocked(supabaseAdmin.from).mockImplementation(
    (tabla: string) =>
      ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: porTabla[tabla] ?? null, error: null }),
      }) as any
  )
}

const ORG_AR = { pais: "AR" }
const CONFIG_EVOLUTION = {
  provider: "evolution",
  is_configured: true,
  evolution_base_url: "https://evo.test",
  evolution_instance_name: "stapp-org-org1",
  evolution_api_key_encrypted: null,
}

describe("sendWhatsAppText — destino invalido", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTablas({ organizations: ORG_AR, whatsapp_config: CONFIG_EVOLUTION })
  })

  it("no le pega al proveedor cuando al numero le falta el codigo de area", async () => {
    const { sendWhatsAppText } = await import("../providers")
    const res = await sendWhatsAppText("org1", "60351282", "hola")

    expect(evoSendText).not.toHaveBeenCalled()
    expect(res.success).toBe(false)
  })

  it("explica que corregir en vez de devolver Bad Request", async () => {
    const { sendWhatsAppText } = await import("../providers")
    const res = await sendWhatsAppText("org1", "60351282", "hola")

    expect(res.error).toMatch(/c[oó]digo de [aá]rea/i)
    expect(res.error).toMatch(/ficha del cliente/i)
  })

  it("deja pasar el numero completo", async () => {
    const { sendWhatsAppText } = await import("../providers")
    const res = await sendWhatsAppText("org1", "1160351282", "hola")

    expect(evoSendText).toHaveBeenCalledTimes(1)
    expect(res.success).toBe(true)
  })

  it("tambien frena en el camino de sucursal", async () => {
    const { sendWhatsAppText } = await import("../providers")
    const res = await sendWhatsAppText("org1", "60351282", "hola", {
      instanceNameOverride: "stapp-org-org1-suc-suc9",
    })

    expect(evoSendText).not.toHaveBeenCalled()
    expect(res.success).toBe(false)
    expect(res.provider).toBe("evolution")
  })

  it("usa el pais de la org: 9 digitos pasa en Chile", async () => {
    mockTablas({ organizations: { pais: "CL" }, whatsapp_config: CONFIG_EVOLUTION })
    const { sendWhatsAppText } = await import("../providers")
    const res = await sendWhatsAppText("org1", "912345678", "hola")

    expect(evoSendText).toHaveBeenCalledTimes(1)
    expect(res.success).toBe(true)
  })
})
