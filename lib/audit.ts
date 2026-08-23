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
  | "turnos"
  | "recepciones"

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
  description?: string
  ipAddress?: string
  userAgent?: string
}

// Labels amigables para entidades
const ENTITY_DISPLAY: Record<string, string> = {
  ordenes_servicio: "orden de servicio",
  clientes: "cliente",
  inventario: "producto",
  proveedores: "proveedor",
  cotizaciones: "cotización",
  facturas: "remito",
  garantias: "garantía",
  users: "usuario",
  checklist_templates: "checklist",
  ventas: "venta",
  devoluciones_venta: "devolución",
  movimientos_inventario: "movimiento de inventario",
  turnos: "turno",
  recepciones: "recepción",
}

// Campos con labels amigables para diffs
const FIELD_DISPLAY: Record<string, string> = {
  estado: "estado",
  nombre: "nombre",
  email: "email",
  telefono: "teléfono",
  direccion: "dirección",
  precio: "precio",
  total: "total",
  subtotal: "subtotal",
  cantidad: "cantidad",
  descripcion: "descripción",
  rol: "rol",
  activo: "activo",
  prioridad: "prioridad",
  diagnostico: "diagnóstico",
  observaciones: "observaciones",
  marca: "marca",
  modelo: "modelo",
  tipo_equipo: "tipo de equipo",
  fecha_entrega: "fecha de entrega",
  metodo_pago: "método de pago",
}

/**
 * Genera una descripción legible del cambio para la columna description.
 *
 * Se exporta porque las rutas que filtran campos del diff antes de devolverlo
 * tienen que RE-generar la descripción sobre el diff ya filtrado: la original
 * se armó con los campos completos y nombra los que se acaban de sacar. Ver
 * app/api/inventario/[id]/audit/route.ts.
 */
export function generateDescription(
  action: AuditAction,
  entity: AuditEntity,
  entityId: string,
  changes?: { before?: Record<string, unknown>; after?: Record<string, unknown> }
): string {
  const entityLabel = ENTITY_DISPLAY[entity] || entity

  if (action === "CREATE") {
    const name = changes?.after?.nombre || changes?.after?.nombre_completo || changes?.after?.titulo || ""
    return `Creó ${entityLabel}${name ? ` "${name}"` : ""} #${entityId.slice(-6)}`
  }

  if (action === "DELETE") {
    const name = changes?.before?.nombre || changes?.before?.nombre_completo || ""
    return `Eliminó ${entityLabel}${name ? ` "${name}"` : ""} #${entityId.slice(-6)}`
  }

  // UPDATE — mostrar campos que cambiaron
  if (action === "UPDATE" && changes?.before && changes?.after) {
    const changedFields: string[] = []
    const before = changes.before
    const after = changes.after

    for (const key of Object.keys(after)) {
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
        const label = FIELD_DISPLAY[key] || key
        const oldVal = before[key]
        const newVal = after[key]

        // Para campos de estado, mostrar transición
        if (key === "estado" && typeof oldVal === "string" && typeof newVal === "string") {
          changedFields.push(`${label} de '${oldVal}' a '${newVal}'`)
        } else if (typeof newVal === "boolean") {
          changedFields.push(`${label} a ${newVal ? "sí" : "no"}`)
        } else {
          changedFields.push(label)
        }
      }
    }

    if (changedFields.length === 0) {
      return `Actualizó ${entityLabel} #${entityId.slice(-6)}`
    }

    if (changedFields.length <= 2) {
      return `Cambió ${changedFields.join(" y ")} en ${entityLabel} #${entityId.slice(-6)}`
    }

    return `Actualizó ${changedFields.length} campos en ${entityLabel} #${entityId.slice(-6)}`
  }

  return `${action} en ${entityLabel} #${entityId.slice(-6)}`
}

/**
 * Registrar un log de auditoría
 */
export async function logAudit(params: AuditLogParams): Promise<void> {
  const desc = params.description || generateDescription(
    params.action,
    params.entity,
    params.entityId,
    params.changes
  )

  const { error } = await supabaseAdmin.from("audit_logs").insert({
    organization_id: params.organizationId,
    user_id: params.userId,
    action: params.action,
    entity: params.entity,
    entity_id: params.entityId,
    changes: params.changes as Json,
    description: desc,
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
    create: (entity: AuditEntity, entityId: string, data: Record<string, unknown>) => {
      const changes = { after: data }
      return logAudit({
        organizationId,
        userId,
        action: "CREATE",
        entity,
        entityId,
        changes,
        description: generateDescription("CREATE", entity, entityId, changes),
        ipAddress,
        userAgent,
      })
    },

    update: (
      entity: AuditEntity,
      entityId: string,
      before: Record<string, unknown>,
      after: Record<string, unknown>
    ) => {
      const changes = { before, after }
      return logAudit({
        organizationId,
        userId,
        action: "UPDATE",
        entity,
        entityId,
        changes,
        description: generateDescription("UPDATE", entity, entityId, changes),
        ipAddress,
        userAgent,
      })
    },

    delete: (entity: AuditEntity, entityId: string, data: Record<string, unknown>) => {
      const changes = { before: data }
      return logAudit({
        organizationId,
        userId,
        action: "DELETE",
        entity,
        entityId,
        changes,
        description: generateDescription("DELETE", entity, entityId, changes),
        ipAddress,
        userAgent,
      })
    },
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
