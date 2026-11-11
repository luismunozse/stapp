import { NextResponse } from "next/server"
import { supabaseAdmin } from "./supabase"
import type { Json } from "@/types/database"

/**
 * Acciones de auditoría extendidas para superadmin
 */
export type SuperadminAuditAction =
  | "CREATE"
  | "UPDATE"
  | "DELETE"
  | "LOGIN"
  | "LOGOUT"
  | "LOGIN_FAILED"
  | "TOGGLE_STATUS"
  | "BROADCAST"
  | "EMAIL_CAMPAIGN"
  | "CRON_RUN"
  | "SUBSCRIPTION_RENEW"
  | "TRIAL_EXTENSION"
  | "EXPORT"
  | "PLAN_TOGGLE"
  | "BULK_ACTION"
  | "TICKET_REPLY"
  | "VERIFY_EMAIL"
  | "ARCHIVE"
  | "RESTORE"
  | "BULK_DELETE"

/**
 * Entidades de auditoría extendidas
 */
export type SuperadminAuditEntity =
  | "organizations"
  | "users"
  | "subscriptions"
  | "plans"
  | "payments"
  | "subscription_payments"
  | "broadcasts"
  | "email_campaigns"
  | "support_tickets"
  | "cron_jobs"
  | "sessions"
  | "changelog"
  | "waitlist"
  | "system"
  | "email_templates"
  | "audit_alert_config"
  // Entidades de tenant
  | "ordenes_servicio"
  | "clientes"
  | "inventario"
  | "proveedores"
  | "cotizaciones"
  | "facturas"
  | "garantias"
  | "checklist_templates"
  | "ventas"
  | "devoluciones_venta"
  | "movimientos_inventario"

interface SuperadminAuditParams {
  userId?: string | null
  email?: string | null
  action: SuperadminAuditAction
  entity: SuperadminAuditEntity
  entityId?: string | null
  organizationId?: string | null
  description?: string
  metadata?: Record<string, unknown>
  ipAddress?: string | null
  userAgent?: string | null
}

/** Lo que describe una acción; el email, la IP y el user agent los pone el logger. */
export type SuperadminAuditEvent = Omit<SuperadminAuditParams, "email" | "ipAddress" | "userAgent">

/** Estado de un registro exigido: se escribe como "intento" ANTES de la acción. */
export type EstadoAuditoria = "intento" | "completado" | "fallido"

function construirFila(params: SuperadminAuditParams, extra?: { id: string; estado: EstadoAuditoria }) {
  const changes: Record<string, unknown> = {
    description: params.description || null,
    metadata: params.metadata || null,
    performer_email: params.email || null,
    is_superadmin_action: true,
  }
  if (extra) changes.estado = extra.estado
  return {
    ...(extra ? { id: extra.id } : {}),
    organization_id: params.organizationId || null,
    user_id: params.userId || null,
    action: params.action,
    entity: params.entity,
    entity_id: params.entityId || null,
    changes: changes as Json,
    description: params.description || null,
    ip_address: params.ipAddress || null,
    user_agent: params.userAgent || null,
  }
}

/**
 * Registrar un log de auditoría de superadmin — modo best-effort: si el INSERT falla
 * se loguea y se sigue. Para acciones sensibles usar `exigirAuditoriaSuperadmin`.
 * Usa la misma tabla audit_logs pero con campos extendidos en changes/metadata
 */
export async function logSuperadminAudit(params: SuperadminAuditParams): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from("audit_logs").insert(construirFila(params))

    if (error) {
      console.error("Error logging superadmin audit:", error)
    }
  } catch (err) {
    console.error("Error logging superadmin audit:", err)
  }
}

export type AuditoriaExigida =
  | {
      ok: true
      id: string
      /**
       * Anota el resultado en la misma fila (best-effort: la acción ya ocurrió y quedó
       * registrada como intento; si este UPDATE falla solo se pierde el detalle).
       */
      completar: (resultado?: Record<string, unknown>, estado?: Exclude<EstadoAuditoria, "intento">) => Promise<void>
    }
  | { ok: false; respuesta: NextResponse }

/**
 * Auditoría fail-closed para acciones sensibles.
 *
 * Escribe la fila (estado "intento") ANTES de ejecutar la acción. Si el INSERT falla,
 * o no hay superadmin identificado, devuelve `{ ok: false, respuesta }` con un 500 y la
 * ruta debe cortar sin ejecutar nada: nunca hay una acción sensible sin rastro. Si la
 * acción después falla, queda un "intento" de más — es el modo de falla aceptable.
 *
 *   const intento = await audit.exigir({ ... })
 *   if (!intento.ok) return intento.respuesta
 *   ...acción...
 *   await intento.completar({ count })
 */
export async function exigirAuditoriaSuperadmin(params: SuperadminAuditParams): Promise<AuditoriaExigida> {
  const fallo = (motivo: unknown): AuditoriaExigida => {
    console.error("Auditoría obligatoria de superadmin falló; se cancela la acción:", motivo)
    return {
      ok: false,
      respuesta: NextResponse.json(
        { error: "No se pudo registrar la auditoría; la acción no se ejecutó" },
        { status: 500 }
      ),
    }
  }

  if (!params.email) return fallo("sin email de superadmin")

  const id = crypto.randomUUID()
  const fila = construirFila(params, { id, estado: "intento" })
  try {
    const { error } = await supabaseAdmin.from("audit_logs").insert(fila)
    if (error) return fallo(error)
  } catch (err) {
    return fallo(err)
  }

  return {
    ok: true,
    id,
    completar: async (resultado, estado = "completado") => {
      try {
        const { error } = await supabaseAdmin
          .from("audit_logs")
          .update({ changes: { ...(fila.changes as Record<string, unknown>), estado, resultado: resultado ?? null } as Json })
          .eq("id", id)
        if (error) console.error("Error completando auditoría de superadmin:", error)
      } catch (err) {
        console.error("Error completando auditoría de superadmin:", err)
      }
    },
  }
}

/**
 * IP del cliente para auditoría. En Vercel `x-vercel-forwarded-for` y `x-real-ip` los
 * pone la plataforma; el primer elemento de `x-forwarded-for` lo puede mandar el
 * cliente, así que solo se usa como último recurso (fuera de Vercel / en local).
 * Mismo orden que `clientIp()` de `proxy.ts`.
 */
export function clientIpForAudit(headers: Headers): string | null {
  const primera = (valor: string | null) => valor?.split(",")[0]?.trim() || null
  return (
    primera(headers.get("x-vercel-forwarded-for")) ||
    primera(headers.get("x-real-ip")) ||
    primera(headers.get("x-forwarded-for"))
  )
}

/**
 * Helper para extraer IP y User-Agent de un request
 */
export function extractRequestInfo(request?: Request | null) {
  if (!request) return { ipAddress: null, userAgent: null }

  const ipAddress = clientIpForAudit(request.headers)
  const userAgent = request.headers.get("user-agent") || null

  return { ipAddress, userAgent }
}

/**
 * Crear un logger pre-configurado para acciones de superadmin
 */
/**
 * Header con el que una escritura sobre `plans` le dice al trigger de
 * plans_audit qué superadmin la hizo (migración 403). PostgREST lo expone en
 * `request.headers` dentro de la misma transacción; un `set_config` en otra
 * llamada no llegaría. El trigger solo lo cree si la escritura viene como
 * service_role, así que va en la consulta y nunca desde el navegador:
 *
 *   supabaseAdmin.from("plans").update(x).eq("id", id).setHeader(HEADER_AUTOR_PLANES, email)
 */
export const HEADER_AUTOR_PLANES = "x-stapp-superadmin"

export function createSuperadminAuditLogger(email: string | null, request?: Request | null) {
  const { ipAddress, userAgent } = extractRequestInfo(request)

  return {
    /** Best-effort: registra y sigue aunque el INSERT falle. */
    log: (params: SuperadminAuditEvent) =>
      logSuperadminAudit({
        ...params,
        email,
        ipAddress,
        userAgent,
      }),

    /** Fail-closed: registra ANTES de la acción; si no puede, devuelve el 500 a retornar. */
    exigir: (params: SuperadminAuditEvent) =>
      exigirAuditoriaSuperadmin({
        ...params,
        email,
        ipAddress,
        userAgent,
      }),

    toggleOrgStatus: (orgId: string, orgName: string, newStatus: boolean) =>
      logSuperadminAudit({
        email,
        action: "TOGGLE_STATUS",
        entity: "organizations",
        entityId: orgId,
        organizationId: orgId,
        description: `Organización "${orgName}" ${newStatus ? "activada" : "desactivada"}`,
        metadata: { newStatus, orgName },
        ipAddress,
        userAgent,
      }),

    bulkToggleOrgs: (orgIds: string[], newStatus: boolean) =>
      logSuperadminAudit({
        email,
        action: "BULK_ACTION",
        entity: "organizations",
        description: `Cambio masivo de estado: ${orgIds.length} organizaciones ${newStatus ? "activadas" : "desactivadas"}`,
        metadata: { orgIds, newStatus, count: orgIds.length },
        ipAddress,
        userAgent,
      }),

    broadcast: (title: string, totalUsers: number, target: string) =>
      logSuperadminAudit({
        email,
        action: "BROADCAST",
        entity: "broadcasts",
        description: `Broadcast enviado: "${title}" a ${totalUsers} usuarios (target: ${target})`,
        metadata: { title, totalUsers, target },
        ipAddress,
        userAgent,
      }),

    emailCampaign: (subject: string, sent: number, failed: number, segmentId?: string) =>
      logSuperadminAudit({
        email,
        action: "EMAIL_CAMPAIGN",
        entity: "email_campaigns",
        description: `Campaña de email: "${subject}" - ${sent} enviados, ${failed} fallidos`,
        metadata: { subject, sent, failed, segmentId },
        ipAddress,
        userAgent,
      }),

    cronRun: (cronPath: string, success: boolean) =>
      logSuperadminAudit({
        email,
        action: "CRON_RUN",
        entity: "cron_jobs",
        description: `Cron ejecutado manualmente: ${cronPath} - ${success ? "exitoso" : "fallido"}`,
        metadata: { cronPath, success },
        ipAddress,
        userAgent,
      }),

    subscriptionRenew: (orgId: string, orgName: string) =>
      logSuperadminAudit({
        email,
        action: "SUBSCRIPTION_RENEW",
        entity: "subscriptions",
        organizationId: orgId,
        description: `Suscripción renovada para "${orgName}"`,
        metadata: { orgName },
        ipAddress,
        userAgent,
      }),

    trialExtension: (orgId: string, orgName: string, newTrialEnd: string) =>
      logSuperadminAudit({
        email,
        action: "TRIAL_EXTENSION",
        entity: "subscriptions",
        organizationId: orgId,
        description: `Trial extendido para "${orgName}" hasta ${newTrialEnd}`,
        metadata: { orgName, newTrialEnd },
        ipAddress,
        userAgent,
      }),

    planToggle: (planId: string, planName: string, enabled: boolean) =>
      logSuperadminAudit({
        email,
        action: "PLAN_TOGGLE",
        entity: "plans",
        entityId: planId,
        description: `Plan "${planName}" ${enabled ? "habilitado" : "deshabilitado"}`,
        metadata: { planName, enabled },
        ipAddress,
        userAgent,
      }),

    planCreate: (planId: string, planName: string) =>
      logSuperadminAudit({
        email,
        action: "CREATE",
        entity: "plans",
        entityId: planId,
        description: `Plan creado: "${planName}"`,
        metadata: { planName },
        ipAddress,
        userAgent,
      }),

    planUpdate: (planId: string, planName: string, changes: Record<string, unknown>) =>
      logSuperadminAudit({
        email,
        action: "UPDATE",
        entity: "plans",
        entityId: planId,
        description: `Plan actualizado: "${planName}"`,
        metadata: { planName, changes },
        ipAddress,
        userAgent,
      }),

    ticketReply: (ticketId: string, orgName: string) =>
      logSuperadminAudit({
        email,
        action: "TICKET_REPLY",
        entity: "support_tickets",
        entityId: ticketId,
        description: `Respuesta a ticket de soporte de "${orgName}"`,
        metadata: { orgName },
        ipAddress,
        userAgent,
      }),

    verifyEmail: (userId: string, userEmail: string) =>
      logSuperadminAudit({
        email,
        action: "VERIFY_EMAIL",
        entity: "users",
        entityId: userId,
        description: `Email verificado manualmente: ${userEmail}`,
        metadata: { userEmail },
        ipAddress,
        userAgent,
      }),

    orgUpdate: (orgId: string, orgName: string, changes: Record<string, unknown>) =>
      logSuperadminAudit({
        email,
        action: "UPDATE",
        entity: "organizations",
        entityId: orgId,
        organizationId: orgId,
        description: `Organización actualizada: "${orgName}"`,
        metadata: { orgName, changes },
        ipAddress,
        userAgent,
      }),

    changelogCreate: (entryId: string, titulo: string) =>
      logSuperadminAudit({
        email,
        action: "CREATE",
        entity: "changelog",
        entityId: entryId,
        description: `Entrada de changelog creada: "${titulo}"`,
        metadata: { titulo },
        ipAddress,
        userAgent,
      }),

    changelogUpdate: (entryId: string, titulo: string, changes: Record<string, unknown>) =>
      logSuperadminAudit({
        email,
        action: "UPDATE",
        entity: "changelog",
        entityId: entryId,
        description: `Entrada de changelog actualizada: "${titulo}"`,
        metadata: { titulo, changes },
        ipAddress,
        userAgent,
      }),

    changelogDelete: (entryId: string) =>
      logSuperadminAudit({
        email,
        action: "DELETE",
        entity: "changelog",
        entityId: entryId,
        description: `Entrada de changelog eliminada`,
        metadata: {},
        ipAddress,
        userAgent,
      }),

    leadUpdate: (leadId: string, changes: Record<string, unknown>) =>
      logSuperadminAudit({
        email,
        action: "UPDATE",
        entity: "system",
        entityId: leadId,
        description: `Lead actualizado`,
        metadata: { changes },
        ipAddress,
        userAgent,
      }),

    betaAndroidUpdate: (ids: string[], estado: string) =>
      logSuperadminAudit({
        email,
        action: "BULK_ACTION",
        entity: "system",
        description: `Beta Android: ${ids.length} inscriptos marcados ${estado}`,
        metadata: { ids, estado, count: ids.length },
        ipAddress,
        userAgent,
      }),

    waitlistBulkDelete: (count: number, ids: string[]) =>
      logSuperadminAudit({
        email,
        action: "DELETE",
        entity: "waitlist",
        description: `Eliminación masiva de waitlist: ${count} registros`,
        metadata: { count, ids },
        ipAddress,
        userAgent,
      }),

    ticketMarkRead: (ticketId: string) =>
      logSuperadminAudit({
        email,
        action: "UPDATE",
        entity: "support_tickets",
        entityId: ticketId,
        description: `Ticket marcado como leído`,
        metadata: {},
        ipAddress,
        userAgent,
      }),
  }
}

/**
 * Registrar evento de login (superadmin o usuario regular)
 */
export async function logLoginEvent(params: {
  userId?: string | null
  email: string
  success: boolean
  isSuperadmin: boolean
  reason?: string
  ipAddress?: string | null
  userAgent?: string | null
}): Promise<void> {
  await logSuperadminAudit({
    userId: params.userId,
    email: params.email,
    action: params.success ? "LOGIN" : "LOGIN_FAILED",
    entity: "sessions",
    description: params.success
      ? `Login exitoso${params.isSuperadmin ? " (superadmin)" : ""}: ${params.email}`
      : `Login fallido: ${params.email}${params.reason ? ` - ${params.reason}` : ""}`,
    metadata: {
      isSuperadmin: params.isSuperadmin,
      success: params.success,
      reason: params.reason || null,
    },
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
  })
}

/**
 * Registrar evento de logout
 */
export async function logLogoutEvent(params: {
  userId: string
  email: string
  isSuperadmin: boolean
}): Promise<void> {
  await logSuperadminAudit({
    userId: params.userId,
    email: params.email,
    action: "LOGOUT",
    entity: "sessions",
    description: `Logout${params.isSuperadmin ? " (superadmin)" : ""}: ${params.email}`,
    metadata: { isSuperadmin: params.isSuperadmin },
  })
}
