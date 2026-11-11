/**
 * El helper único de auditoría de superadmin (`lib/superadmin-audit.ts`):
 * - la IP sale de los headers que pone Vercel, no del primer `x-forwarded-for`;
 * - toda fila lleva `performer_email`, IP y user agent;
 * - best-effort (`log`) nunca corta la request;
 * - fail-closed (`exigir`) escribe ANTES y, si no puede, devuelve un 500.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { montarSupabaseEnMemoria } from "../helpers/supabase-memoria"
import { createChainMock, mockSupabaseFrom } from "../api/helpers"
import { clientIpForAudit, createSuperadminAuditLogger, extractRequestInfo } from "@/lib/superadmin-audit"

const SUPERADMIN = "admin@stapp.com.ar"

function req(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/superadmin/x", { method: "POST", headers })
}

describe("clientIpForAudit", () => {
  it("prefiere x-vercel-forwarded-for sobre un x-forwarded-for que manda el cliente", () => {
    const h = new Headers({ "x-forwarded-for": "6.6.6.6, 10.0.0.1", "x-vercel-forwarded-for": "1.2.3.4" })
    expect(clientIpForAudit(h)).toBe("1.2.3.4")
  })

  it("usa x-real-ip antes que x-forwarded-for", () => {
    const h = new Headers({ "x-forwarded-for": "6.6.6.6", "x-real-ip": "5.5.5.5" })
    expect(clientIpForAudit(h)).toBe("5.5.5.5")
  })

  it("cae a x-forwarded-for solo cuando no hay headers de la plataforma", () => {
    expect(clientIpForAudit(new Headers({ "x-forwarded-for": " 7.7.7.7 , 8.8.8.8" }))).toBe("7.7.7.7")
  })

  it("devuelve null sin ningún header", () => {
    expect(clientIpForAudit(new Headers())).toBeNull()
    expect(extractRequestInfo(null)).toEqual({ ipAddress: null, userAgent: null })
  })
})

describe("createSuperadminAuditLogger().log — best-effort", () => {
  beforeEach(() => vi.clearAllMocks())

  it("graba performer_email, IP de Vercel y user agent", async () => {
    const db = montarSupabaseEnMemoria({ audit_logs: [] })
    const audit = createSuperadminAuditLogger(SUPERADMIN, req({
      "x-vercel-forwarded-for": "1.2.3.4",
      "x-forwarded-for": "6.6.6.6",
      "user-agent": "UA/1.0",
    }))

    await audit.log({ action: "UPDATE", entity: "system", description: "algo" })

    const [fila] = db.filas("audit_logs")
    expect(fila.ip_address).toBe("1.2.3.4")
    expect(fila.user_agent).toBe("UA/1.0")
    expect(fila.user_id).toBeNull()
    expect(fila.changes.performer_email).toBe(SUPERADMIN)
    expect(fila.changes.is_superadmin_action).toBe(true)
  })

  it("si el INSERT falla no tira: la acción de bajo riesgo sigue", async () => {
    mockSupabaseFrom({ audit_logs: createChainMock(null, { message: "db caída" }) })
    const audit = createSuperadminAuditLogger(SUPERADMIN, req({}))
    await expect(audit.log({ action: "UPDATE", entity: "system" })).resolves.toBeUndefined()
  })
})

describe("createSuperadminAuditLogger().exigir — fail-closed", () => {
  beforeEach(() => vi.clearAllMocks())

  it("escribe la fila como 'intento' con id propio, y completar() la cierra por id", async () => {
    // Una fila previa: el UPDATE por id no debe tocarla (y le da columnas al fixture).
    const db = montarSupabaseEnMemoria({ audit_logs: [{ id: "previa", changes: { estado: "intento" } }] })
    const audit = createSuperadminAuditLogger(SUPERADMIN, req({ "x-vercel-forwarded-for": "1.2.3.4" }))

    const intento = await audit.exigir({ action: "CRON_RUN", entity: "cron_jobs", metadata: { cronPath: "/x" } })
    expect(intento.ok).toBe(true)
    if (!intento.ok) return

    const fila = db.filas("audit_logs")[1]
    expect(fila.id).toBe(intento.id)
    expect(fila.changes.estado).toBe("intento")
    expect(fila.changes.performer_email).toBe(SUPERADMIN)
    expect(fila.ip_address).toBe("1.2.3.4")

    await intento.completar({ ok: true })
    const update = db.escrituras.find((e) => e.operacion === "update")
    expect(update?.filtros).toEqual([["eq", "id", intento.id]])
    expect(db.filas("audit_logs")[1].changes).toMatchObject({
      estado: "completado",
      resultado: { ok: true },
      performer_email: SUPERADMIN,
    })
    expect(db.filas("audit_logs")[0].changes.estado).toBe("intento")
  })

  it("si el INSERT devuelve error → { ok: false } con un 500", async () => {
    mockSupabaseFrom({ audit_logs: createChainMock(null, { message: "db caída" }) })
    const intento = await createSuperadminAuditLogger(SUPERADMIN, req({})).exigir({ action: "DELETE", entity: "organizations" })

    expect(intento.ok).toBe(false)
    if (intento.ok) return
    expect(intento.respuesta.status).toBe(500)
  })

  it("si el INSERT tira → { ok: false } con un 500", async () => {
    vi.mocked((await import("@/lib/supabase")).supabaseAdmin.from).mockImplementation(() => {
      throw new Error("red")
    })
    const intento = await createSuperadminAuditLogger(SUPERADMIN, req({})).exigir({ action: "DELETE", entity: "organizations" })
    expect(intento.ok).toBe(false)
  })

  it("sin email de superadmin no escribe nada y devuelve 500", async () => {
    const db = montarSupabaseEnMemoria({ audit_logs: [] })
    const intento = await createSuperadminAuditLogger(null, req({})).exigir({ action: "DELETE", entity: "organizations" })

    expect(intento.ok).toBe(false)
    expect(db.escrituras).toHaveLength(0)
  })
})
