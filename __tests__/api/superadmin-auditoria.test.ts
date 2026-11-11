/**
 * Auditoría unificada de superadmin en las rutas.
 *
 * Fail-closed: en las acciones sensibles la fila de auditoría se escribe ANTES de la acción;
 * si ese INSERT falla la ruta responde 500 y la acción NO ocurre.
 *
 * Rutas que antes no dejaban rastro (planes, banner, soporte, templates, waitlist,
 * alert-config) ahora escriben una fila con el email del superadmin que actuó.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { createChainMock, mockSupabaseFrom, parseResponse } from "./helpers"
import { montarSupabaseEnMemoria } from "../helpers/supabase-memoria"

vi.mock("@/lib/superadmin-auth", () => ({
  requireSuperadmin: vi.fn().mockResolvedValue({ error: null, email: "admin@stapp.com.ar" }),
}))

vi.mock("next/cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/cache")>()),
  revalidateTag: vi.fn(),
}))

vi.mock("@/lib/impersonation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/impersonation")>()),
  mintImpersonationToken: vi.fn().mockResolvedValue("token-impersonacion"),
}))

import { cookies } from "next/headers"
import { POST as bulkDelete } from "@/app/api/superadmin/organizations/bulk-delete/route"
import { POST as changeRole } from "@/app/api/superadmin/users/[userId]/change-role/route"
import { POST as toggleActive } from "@/app/api/superadmin/users/[userId]/toggle-active/route"
import { POST as togglePlan } from "@/app/api/superadmin/plans/[id]/toggle/route"
import { POST as createPlan } from "@/app/api/superadmin/plans/route"
import { POST as cancelSub } from "@/app/api/superadmin/subscriptions/cancel/route"
import { POST as impersonate } from "@/app/api/superadmin/impersonate/route"
import { PUT as maintenanceBanner } from "@/app/api/superadmin/maintenance-banner/route"
import { DELETE as waitlistDelete } from "@/app/api/superadmin/waitlist/ios/route"
import { PATCH as soportePatch } from "@/app/api/superadmin/soporte/[id]/route"
import { PUT as alertConfigPut } from "@/app/api/superadmin/audit-logs/alert-config/route"
import { PATCH as emailTemplatePatch } from "@/app/api/superadmin/email-templates/[id]/route"
import { GET as auditLogs } from "@/app/api/superadmin/audit-logs/route"

const SUPERADMIN = "admin@stapp.com.ar"
const AUDITORIA_CAIDA = () => createChainMock(null, { message: "audit_logs no disponible" })

function json(method: string, body: unknown, headers: Record<string, string> = {}): any {
  return new Request("http://localhost/api/superadmin/x", {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  })
}

/** El 500 tiene que ser el de la auditoría, no otro error que casualmente también corte. */
async function esElDeAuditoria(res: Response) {
  const { status, body } = await parseResponse(res)
  expect(status).toBe(500)
  expect(body.error).toMatch(/auditoría/)
}

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) })

describe("fail-closed: si la auditoría no se puede escribir, la acción no ocurre", () => {
  beforeEach(() => vi.clearAllMocks())

  it("bulk-delete (borrado permanente) → 500 y no borra", async () => {
    const orgs = {
      ...createChainMock([{ id: "o1", nombre: "A", slug: "a" }]),
      delete: vi.fn().mockReturnValue(createChainMock(null, null, 1)),
      update: vi.fn().mockReturnValue(createChainMock(null, null, 1)),
    }
    mockSupabaseFrom({ organizations: orgs as any, audit_logs: AUDITORIA_CAIDA() })

    const res = await bulkDelete(json("POST", { ids: ["o1"], hard: true, confirm: true }))

    await esElDeAuditoria(res)
    expect(orgs.delete).not.toHaveBeenCalled()
    expect(orgs.update).not.toHaveBeenCalled()
  })

  it("bulk-delete (archivado) → 500 y no archiva", async () => {
    const orgs = {
      ...createChainMock([{ id: "o1", nombre: "A", slug: "a" }]),
      delete: vi.fn().mockReturnValue(createChainMock(null, null, 1)),
      update: vi.fn().mockReturnValue(createChainMock(null, null, 1)),
    }
    mockSupabaseFrom({ organizations: orgs as any, audit_logs: AUDITORIA_CAIDA() })

    const res = await bulkDelete(json("POST", { ids: ["o1"] }))

    await esElDeAuditoria(res)
    expect(orgs.update).not.toHaveBeenCalled()
  })

  it("change-role → 500 y el rol no cambia", async () => {
    const users = createChainMock({
      id: "u1", nombre: "Ana", email: "ana@x.com", rol: "TECNICO", organization_id: "org-1", sucursal_id: "s1",
    })
    mockSupabaseFrom({ users, audit_logs: AUDITORIA_CAIDA() })

    const res = await changeRole(json("POST", { rol: "VENDEDOR" }), params({ userId: "u1" }))

    await esElDeAuditoria(res)
    expect(users.update).not.toHaveBeenCalled()
  })

  it("toggle-active de usuario → 500 y el acceso no cambia", async () => {
    const users = createChainMock({ id: "u1", nombre: "Ana", email: "ana@x.com", email_verified: true, organization_id: "org-1" })
    mockSupabaseFrom({ users, audit_logs: AUDITORIA_CAIDA() })

    const res = await toggleActive(json("POST", { activo: false }), params({ userId: "u1" }))

    await esElDeAuditoria(res)
    expect(users.update).not.toHaveBeenCalled()
  })

  it("toggle de plan → 500 y el plan no cambia", async () => {
    const plans = createChainMock({ id: "p1", nombre: "Pro", activo: false, subscriptions: [] })
    mockSupabaseFrom({ plans, audit_logs: AUDITORIA_CAIDA() })

    const res = await togglePlan(json("POST", { activo: true }), params({ id: "p1" }))

    await esElDeAuditoria(res)
    expect(plans.update).not.toHaveBeenCalled()
  })

  it("cancelar suscripción → 500 y no cancela", async () => {
    const subscriptions = createChainMock({ id: "sub1", status: "ACTIVE", organization_id: "org-1", current_period_end: null })
    const history = createChainMock(null, null)
    mockSupabaseFrom({ subscriptions, subscription_history: history, audit_logs: AUDITORIA_CAIDA() })

    const res = await cancelSub(json("POST", { organizationId: "org-1", immediate: true }))

    await esElDeAuditoria(res)
    expect(subscriptions.update).not.toHaveBeenCalled()
    expect(history.insert).not.toHaveBeenCalled()
  })

  it("impersonación → 500 y no toca las cookies de sesión", async () => {
    process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || "test-secret"
    const store = { get: vi.fn().mockReturnValue({ value: "sesion-real" }), set: vi.fn() }
    vi.mocked(cookies).mockResolvedValue(store as any)
    mockSupabaseFrom({
      organizations: createChainMock({ id: "org-1", slug: "taller", nombre: "Taller" }),
      users: createChainMock({ id: "u1", nombre: "Ana", email: "ana@x.com", rol: "ADMIN", sucursal_id: null, organization_id: "org-1" }),
      audit_logs: AUDITORIA_CAIDA(),
    })

    const res = await impersonate(json("POST", { organizationId: "org-1" }))

    await esElDeAuditoria(res)
    expect(store.set).not.toHaveBeenCalled()
  })

  it("impersonación con la auditoría disponible → setea las cookies", async () => {
    process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || "test-secret"
    const store = { get: vi.fn().mockReturnValue({ value: "sesion-real" }), set: vi.fn() }
    vi.mocked(cookies).mockResolvedValue(store as any)
    const audit = createChainMock(null, null)
    mockSupabaseFrom({
      organizations: createChainMock({ id: "org-1", slug: "taller", nombre: "Taller" }),
      users: createChainMock({ id: "u1", nombre: "Ana", email: "ana@x.com", rol: "ADMIN", sucursal_id: null, organization_id: "org-1" }),
      audit_logs: audit,
    })

    const res = await impersonate(json("POST", { organizationId: "org-1" }))

    expect(res.status).toBe(200)
    expect(store.set).toHaveBeenCalled()
    expect(audit.insert.mock.calls[0][0].changes.performer_email).toBe(SUPERADMIN)
  })

  it("con la auditoría disponible, la acción ocurre y la fila queda 'intento' antes del cambio", async () => {
    const orden: string[] = []
    const audit = createChainMock(null, null)
    audit.insert.mockImplementation(() => (orden.push("audit"), audit))
    const plans = createChainMock({ id: "p1", nombre: "Pro", activo: false, subscriptions: [] })
    plans.update.mockImplementation(() => (orden.push("update"), plans))
    mockSupabaseFrom({ plans, audit_logs: audit })

    const res = await togglePlan(json("POST", { activo: true }), params({ id: "p1" }))

    expect(res.status).toBe(200)
    expect(orden).toEqual(["audit", "update"])
    const fila = audit.insert.mock.calls[0][0]
    expect(fila.changes).toMatchObject({ estado: "intento", performer_email: SUPERADMIN })
  })
})

describe("rutas que antes no auditaban: dejan fila con el superadmin real", () => {
  beforeEach(() => vi.clearAllMocks())

  const filaDeAuditoria = (db: ReturnType<typeof montarSupabaseEnMemoria>) => {
    const inserts = db.escrituras.filter((e) => e.tabla === "audit_logs" && e.operacion === "insert")
    expect(inserts).toHaveLength(1)
    return inserts[0].carga as any
  }

  it("plans POST", async () => {
    const db = montarSupabaseEnMemoria({ plans: [], audit_logs: [{ id: "previa", changes: {} }] })

    const res = await createPlan(json("POST", {
      nombre: "Pro", tipo: "PREMIUM", slug: "pro", descripcion: null,
      precio_mensual: 10, precio_anual: 100,
      limite_ordenes: null, limite_tecnicos: null, limite_clientes: null, limite_vendedores: null, limite_storage_mb: null,
    }, { "x-vercel-forwarded-for": "1.2.3.4" }))

    expect(res.status).toBe(201)
    const fila = filaDeAuditoria(db)
    expect(fila).toMatchObject({ action: "CREATE", entity: "plans", ip_address: "1.2.3.4" })
    expect(fila.changes.performer_email).toBe(SUPERADMIN)
    // Ya no se llama al rpc("set_config") inexistente que dejaba todo como "system".
    expect(db.escrituras.some((e) => e.operacion === "rpc")).toBe(false)
  })

  it("maintenance-banner PUT", async () => {
    const db = montarSupabaseEnMemoria({ maintenance_banner: [], audit_logs: [] })

    const res = await maintenanceBanner(json("PUT", { active: true, message: "Mantenimiento", severity: "INFO" }))

    expect(res.status).toBe(200)
    const fila = filaDeAuditoria(db)
    expect(fila.changes.performer_email).toBe(SUPERADMIN)
    expect(fila.entity_id).toBe("maintenance_banner")
  })

  it("waitlist iOS DELETE", async () => {
    const id = "11111111-1111-4111-8111-111111111111"
    const db = montarSupabaseEnMemoria({ ios_waitlist: [{ id }], audit_logs: [] })

    const res = await waitlistDelete(json("DELETE", { id }))

    expect(res.status).toBe(200)
    const fila = filaDeAuditoria(db)
    expect(fila).toMatchObject({ action: "DELETE", entity: "waitlist", entity_id: id })
    expect(fila.changes.performer_email).toBe(SUPERADMIN)
  })

  it("soporte PATCH", async () => {
    const db = montarSupabaseEnMemoria({
      support_tickets: [{ id: "t1", estado: "ABIERTO", organization_id: "org-1" }],
      audit_logs: [],
    })

    const res = await soportePatch(json("PATCH", { estado: "RESUELTO" }), params({ id: "t1" }))

    expect(res.status).toBe(200)
    const fila = filaDeAuditoria(db)
    expect(fila).toMatchObject({ entity: "support_tickets", entity_id: "t1", organization_id: "org-1" })
    expect(fila.changes.performer_email).toBe(SUPERADMIN)
  })

  it("alert-config PUT (fail-closed: fija la retención de la auditoría)", async () => {
    const db = montarSupabaseEnMemoria({
      audit_alert_config: [{ id: "default", retention_days: 90, updated_at: null, updated_by: null }],
      audit_logs: [{ id: "previa", changes: {} }],
    })

    const res = await alertConfigPut(json("PUT", { retention_days: 30 }))

    expect(res.status).toBe(200)
    const fila = filaDeAuditoria(db)
    expect(fila.changes.performer_email).toBe(SUPERADMIN)
    expect(fila.changes.metadata).toEqual({ changes: { retention_days: 30 } })
  })

  it("alert-config PUT con la auditoría caída → 500 y la config no cambia", async () => {
    const config = createChainMock({ id: "default" })
    mockSupabaseFrom({ audit_alert_config: config, audit_logs: AUDITORIA_CAIDA() })

    const res = await alertConfigPut(json("PUT", { retention_days: 30 }))

    await esElDeAuditoria(res)
    expect(config.update).not.toHaveBeenCalled()
  })

  it("email-templates PATCH", async () => {
    const db = montarSupabaseEnMemoria({
      email_templates: [{ id: "tpl1", type: "welcome", subject: "Hola", html_body: "<p>x</p>", status: "DRAFT", notes: null }],
      email_template_history: [],
      audit_logs: [],
    })

    const res = await emailTemplatePatch(json("PATCH", { subject: "Hola!" }), params({ id: "tpl1" }))

    expect(res.status).toBe(200)
    const fila = filaDeAuditoria(db)
    expect(fila).toMatchObject({ entity: "email_templates", entity_id: "tpl1" })
    expect(fila.changes.performer_email).toBe(SUPERADMIN)
  })
})

describe("rutas migradas: ya no escriben audit_logs a mano con user_id = afectado", () => {
  beforeEach(() => vi.clearAllMocks())

  it("change-role deja performer_email y no pone al usuario afectado como autor", async () => {
    const audit = createChainMock(null, null)
    const users = createChainMock({
      id: "u1", nombre: "Ana", email: "ana@x.com", rol: "TECNICO", organization_id: "org-1", sucursal_id: "s1",
    })
    mockSupabaseFrom({ users, audit_logs: audit })

    const res = await changeRole(json("POST", { rol: "VENDEDOR" }), params({ userId: "u1" }))
    const { status } = await parseResponse(res)

    expect(status).toBe(200)
    const fila = audit.insert.mock.calls[0][0]
    expect(fila.user_id).toBeNull()
    expect(fila.entity_id).toBe("u1")
    expect(fila.changes).toMatchObject({ performer_email: SUPERADMIN, is_superadmin_action: true })
  })
})

describe("pestaña superadmin del visor de auditoría", () => {
  beforeEach(() => vi.clearAllMocks())

  it("filtra por la marca del helper, no por una lista fija de acciones", async () => {
    const logs = createChainMock([], null, 0)
    mockSupabaseFrom({ audit_logs: logs })

    const res = await auditLogs(new Request("http://localhost/api/superadmin/audit-logs?tab=superadmin"))

    expect(res.status).toBe(200)
    expect(logs.eq).toHaveBeenCalledWith("changes->>is_superadmin_action", "true")
    expect(logs.not).toHaveBeenCalledWith("action", "in", "(LOGIN,LOGOUT,LOGIN_FAILED)")
    expect(logs.in).not.toHaveBeenCalled()
  })
})
