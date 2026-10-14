import { createAuditLogger, diffObjects } from "@/lib/audit"
import { emitWebhookEvent } from "@/lib/webhooks/dispatcher"

// Audit log entries and outbound webhooks of an inventory item. The single-item routes
// (create, update, archive) and the group save write the same events through these
// functions, so both paths emit identical payloads. Fire-and-forget: a failing audit or
// webhook never fails the request.

// Campos auditados (excluye stock — ya cubierto por movimientos_inventario).
// Cambios en estos campos generan un audit_log UPDATE.
export const AUDITED_FIELDS = [
  "codigo",
  "nombre",
  "descripcion",
  "categoria",
  "tipo_dispositivo",
  "precio_compra",
  "precio_venta",
  "proveedor",
  "proveedor_id",
  "stock_minimo",
  "stock_maximo",
  "punto_reorden",
  "barcode",
  "ubicacion",
] as const

export function pickAudited(row: Record<string, any>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of AUDITED_FIELDS) out[k] = row[k]
  return out
}

export interface ContextoEventos {
  organizationId: string
  userId: string | null | undefined
  request: Request
}

type Fila = Record<string, any>

/** inventario.created + CREATE audit entry. */
export function registrarCreacion(ctx: ContextoEventos, item: Fila): void {
  if (ctx.userId) {
    createAuditLogger(ctx.organizationId, ctx.userId, ctx.request)
      .create("inventario", item.id, {
        codigo: item.codigo,
        nombre: item.nombre,
        categoria: item.categoria,
        tipo_dispositivo: item.tipo_dispositivo,
        stock: item.stock,
        precio_compra: item.precio_compra,
        precio_venta: item.precio_venta,
        proveedor_id: item.proveedor_id,
        barcode: item.barcode,
      })
      .catch(() => {})
  }

  emitWebhookEvent(ctx.organizationId, "inventario.created", {
    id: item.id,
    codigo: item.codigo,
    nombre: item.nombre,
    categoria: item.categoria,
    tipoDispositivo: item.tipo_dispositivo,
    stock: item.stock,
    precioVenta: item.precio_venta,
    precioCompra: item.precio_compra,
    proveedorId: item.proveedor_id,
    barcode: item.barcode,
  }).catch(() => {})
}

/**
 * inventario.updated + UPDATE audit entry, only when an audited field changed (stock,
 * photos, archive state and the group link are not audited). Returns whether it emitted.
 */
export function registrarActualizacion(ctx: ContextoEventos, antes: Fila, despues: Fila): boolean {
  if (!ctx.userId) return false

  const before = pickAudited(antes)
  const after = pickAudited(despues)
  const diff = diffObjects(before, after)
  if (Object.keys(diff.after).length === 0) return false

  createAuditLogger(ctx.organizationId, ctx.userId, ctx.request)
    .update("inventario", despues.id, before, after)
    .catch(() => {})
  // changes: diff field -> {before, after} so the consumer knows what happened.
  const changes: Record<string, { before: unknown; after: unknown }> = {}
  for (const k of Object.keys(diff.after)) {
    changes[k] = { before: diff.before[k], after: diff.after[k] }
  }
  emitWebhookEvent(ctx.organizationId, "inventario.updated", {
    id: despues.id,
    codigo: despues.codigo,
    nombre: despues.nombre,
    changes,
  }).catch(() => {})
  return true
}

/** inventario.archived (soft delete) + DELETE audit entry marked ARCHIVADO. */
export function registrarArchivado(ctx: ContextoEventos, item: Fila): void {
  if (ctx.userId) {
    createAuditLogger(ctx.organizationId, ctx.userId, ctx.request)
      .delete("inventario", item.id, { ...pickAudited(item), accion: "ARCHIVADO" })
      .catch(() => {})
  }
  emitWebhookEvent(ctx.organizationId, "inventario.archived", {
    id: item.id,
    codigo: item.codigo,
    nombre: item.nombre,
    archivedBy: ctx.userId ?? null,
  }).catch(() => {})
}
