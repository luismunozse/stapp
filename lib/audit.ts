import { supabaseAdmin } from "./supabase"
import type { Json } from "@/types/database"
import { headers } from "next/headers"

export type AuditAction = "CREATE" | "UPDATE" | "DELETE"

export type AuditEntity =
  | "ordenes_servicio"
  | "clientes"
  | "inventario"
  | "proveedores"
  | "cotizaciones"
  | "facturas"
  | "garantias"
  | "users"
  | "checklist_templates"
  | "ventas"
  | "devoluciones_venta"
  | "movimientos_inventario"

interface AuditLogParams {
  organizationId: string
  userId: string
  action: AuditAction
  entity: AuditEntity
  entityId: string
  changes?: {
    before?: Record<string, unknown>
    after?: Record<string, unknown>
  }
  ipAddress?: string
  userAgent?: string
}

/**
 * Registrar un log de auditoría
 */
export async function logAudit(params: AuditLogParams): Promise<void> {
  const { error } = await supabaseAdmin.from("audit_logs").insert({
    organization_id: params.organizationId,
    user_id: params.userId,
    action: params.action,
    entity: params.entity,
    entity_id: params.entityId,
    changes: params.changes as Json,
    ip_address: params.ipAddress || null,
    user_agent: params.userAgent || null,
  })

  if (error) {
    // Log pero no fallar - la auditoría no debe bloquear operaciones
    console.error("Error logging audit:", error)
  }
}

/**
 * Crear un logger de auditoría pre-configurado para un request
 */
export function createAuditLogger(
  organizationId: string,
  userId: string,
  request?: Request
) {
  let ipAddress: string | undefined
  let userAgent: string | undefined

  if (request) {
    // Obtener IP del request
    ipAddress =
      request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      request.headers.get("x-real-ip") ||
      undefined

    userAgent = request.headers.get("user-agent") || undefined
  }

  return {
    create: (entity: AuditEntity, entityId: string, data: Record<string, unknown>) =>
      logAudit({
        organizationId,
        userId,
        action: "CREATE",
        entity,
        entityId,
        changes: { after: data },
        ipAddress,
        userAgent,
      }),

    update: (
      entity: AuditEntity,
      entityId: string,
      before: Record<string, unknown>,
      after: Record<string, unknown>
    ) =>
      logAudit({
        organizationId,
        userId,
        action: "UPDATE",
        entity,
        entityId,
        changes: { before, after },
        ipAddress,
        userAgent,
      }),

    delete: (entity: AuditEntity, entityId: string, data: Record<string, unknown>) =>
      logAudit({
        organizationId,
        userId,
        action: "DELETE",
        entity,
        entityId,
        changes: { before: data },
        ipAddress,
        userAgent,
      }),
  }
}

/**
 * Obtener logs de auditoría de una organización
 */
export async function getAuditLogs(
  organizationId: string,
  options?: {
    entity?: AuditEntity
    entityId?: string
    userId?: string
    limit?: number
    offset?: number
  }
) {
  let query = supabaseAdmin
    .from("audit_logs")
    .select(
      `
      *,
      users:user_id (
        id,
        nombre,
        email
      )
    `
    )
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })

  if (options?.entity) {
    query = query.eq("entity", options.entity)
  }

  if (options?.entityId) {
    query = query.eq("entity_id", options.entityId)
  }

  if (options?.userId) {
    query = query.eq("user_id", options.userId)
  }

  if (options?.limit) {
    query = query.limit(options.limit)
  }

  if (options?.offset) {
    query = query.range(options.offset, options.offset + (options.limit || 50) - 1)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(`Error fetching audit logs: ${error.message}`)
  }

  return data
}

/**
 * Obtener historial de cambios de una entidad específica
 */
export async function getEntityHistory(
  organizationId: string,
  entity: AuditEntity,
  entityId: string
) {
  const { data, error } = await supabaseAdmin
    .from("audit_logs")
    .select(
      `
      *,
      users:user_id (
        id,
        nombre,
        email
      )
    `
    )
    .eq("organization_id", organizationId)
    .eq("entity", entity)
    .eq("entity_id", entityId)
    .order("created_at", { ascending: false })

  if (error) {
    throw new Error(`Error fetching entity history: ${error.message}`)
  }

  return data
}

/**
 * Calcular diferencias entre dos objetos (para UPDATE)
 */
export function diffObjects(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const changedBefore: Record<string, unknown> = {}
  const changedAfter: Record<string, unknown> = {}

  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)])

  for (const key of allKeys) {
    // Ignorar campos internos
    if (["created_at", "updated_at", "password"].includes(key)) continue

    const beforeVal = before[key]
    const afterVal = after[key]

    // Comparar valores (stringify para comparar objetos/arrays)
    if (JSON.stringify(beforeVal) !== JSON.stringify(afterVal)) {
      changedBefore[key] = beforeVal
      changedAfter[key] = afterVal
    }
  }

  return { before: changedBefore, after: changedAfter }
}
