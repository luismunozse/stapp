import { NextResponse } from "next/server"
import { revalidateTag } from "next/cache"
import { requireAuth, requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { formatInventario } from "@/lib/db-utils"
import { createAuditLogger, diffObjects } from "@/lib/audit"
import { emitWebhookEvent } from "@/lib/webhooks/dispatcher"
import { z } from "zod"

// Campos auditados (excluye stock — ya cubierto por movimientos_inventario).
// Cambios en estos campos generan un audit_log UPDATE.
const AUDITED_FIELDS = [
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

function pickAudited(row: Record<string, any>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of AUDITED_FIELDS) out[k] = row[k]
  return out
}

const inventarioSchema = z.object({
  codigo: z.string().min(1).optional(),
  nombre: z.string().min(1).optional(),
  descripcion: z.string().optional(),
  categoria: z.string().min(1).optional(),
  tipoDispositivo: z.string().min(1).optional(),
  stock: z.number().int().min(0).optional(),
  precioCompra: z.number().min(0).optional(),
  precioVenta: z.number().min(0).optional(),
  proveedor: z.string().optional(),
  // Nota: los ids del schema usan cuid, no uuid.
  proveedorId: z.string().min(1).nullable().optional(),
  stockMinimo: z.number().int().min(0).nullable().optional(),
  stockMaximo: z.number().int().min(0).nullable().optional(),
  puntoReorden: z.number().int().min(0).nullable().optional(),
  barcode: z.string().nullable().optional(),
  ubicacion: z.string().max(200).nullable().optional(),
  trackeaLotes: z.boolean().optional(),
  trackeaSeries: z.boolean().optional(),
  diasAlertaVencimiento: z.number().int().min(1).max(365).nullable().optional(),
  diasGarantiaDefault: z.number().int().min(0).nullable().optional(),
  tieneVariantes: z.boolean().optional(),
  esKit: z.boolean().optional(),
  tipoKit: z.enum(["ENSAMBLADO", "VIRTUAL"]).nullable().optional(),
})

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { id } = await params

    const { data: item, error: dbError } = await supabaseAdmin
      .from("inventario")
      .select("*, proveedores:proveedor_id(id, nombre)")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .is("deleted_at", null)
      .single()

    if (dbError || !item) {
      return NextResponse.json(
        { error: "Item no encontrado" },
        { status: 404 }
      )
    }

    return NextResponse.json(formatInventario(item))
  } catch (error) {
    console.error("Error fetching inventario:", error)
    return NextResponse.json(
      { error: "Error al obtener item" },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId } = await requireAdmin()
    if (error) return error

    const { id } = await params
    const body = await request.json()
    const data = inventarioSchema.parse(body)

    // Verificar pertenencia y traer snapshot completo para diff de auditoría
    const { data: existingItem, error: fetchError } = await supabaseAdmin
      .from("inventario")
      .select("*")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .is("deleted_at", null)
      .single()

    if (fetchError || !existingItem) {
      return NextResponse.json(
        { error: "Item no encontrado" },
        { status: 404 }
      )
    }

    // Preparar datos para update
    const updateData: Record<string, any> = {}
    if (data.codigo !== undefined) updateData.codigo = data.codigo
    if (data.nombre !== undefined) updateData.nombre = data.nombre
    if (data.descripcion !== undefined) updateData.descripcion = data.descripcion
    if (data.categoria !== undefined) updateData.categoria = data.categoria
    if (data.tipoDispositivo !== undefined) {
      updateData.tipo_dispositivo = data.tipoDispositivo
    }
    if (data.stock !== undefined) updateData.stock = data.stock
    if (data.precioCompra !== undefined) updateData.precio_compra = data.precioCompra
    if (data.precioVenta !== undefined) updateData.precio_venta = data.precioVenta
    if (data.proveedor !== undefined) updateData.proveedor = data.proveedor
    if (data.proveedorId !== undefined) updateData.proveedor_id = data.proveedorId
    if (data.stockMinimo !== undefined) updateData.stock_minimo = data.stockMinimo
    if (data.stockMaximo !== undefined) updateData.stock_maximo = data.stockMaximo
    if (data.puntoReorden !== undefined) updateData.punto_reorden = data.puntoReorden
    if (data.barcode !== undefined) {
      const trimmed = (data.barcode ?? "").trim()
      updateData.barcode = trimmed.length > 0 ? trimmed : null
    }
    if (data.ubicacion !== undefined) {
      const trimmed = (data.ubicacion ?? "").trim()
      updateData.ubicacion = trimmed.length > 0 ? trimmed : null
    }
    if (data.trackeaLotes !== undefined) updateData.trackea_lotes = data.trackeaLotes
    if (data.trackeaSeries !== undefined) updateData.trackea_series = data.trackeaSeries
    if (data.diasAlertaVencimiento !== undefined) updateData.dias_alerta_vencimiento = data.diasAlertaVencimiento
    if (data.tieneVariantes !== undefined) updateData.tiene_variantes = data.tieneVariantes
    if (data.esKit !== undefined) updateData.es_kit = data.esKit
    if (data.tipoKit !== undefined) updateData.tipo_kit = data.tipoKit
    if (data.diasGarantiaDefault !== undefined) {
      const v = data.diasGarantiaDefault
      updateData.dias_garantia_default =
        v != null && Number.isFinite(v) && v >= 0 ? v : null
    }

    let { data: item, error: updateError } = await supabaseAdmin
      .from("inventario")
      .update(updateData)
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .select("*, proveedores:proveedor_id(id, nombre)")
      .single()

    // Deploy-safe: if migration 231 hasn't run yet, column doesn't exist — retry without it
    if (updateError && (updateError as any).code === "PGRST204") {
      delete updateData.dias_garantia_default
      const retry = await supabaseAdmin
        .from("inventario")
        .update(updateData)
        .eq("id", id)
        .eq("organization_id", organizationId!)
        .select("*, proveedores:proveedor_id(id, nombre)")
        .single()
      item = retry.data
      updateError = retry.error as any
    }

    if (updateError) {
      // Codigo duplicado: error amigable en vez de 500.
      if ((updateError as any).code === "23505") {
        return NextResponse.json(
          { error: "Ya existe un item con ese código" },
          { status: 400 }
        )
      }
      throw updateError
    }

    // Audit log: si cambió algún campo no-stock relevante, registrar UPDATE
    if (item && userId) {
      const before = pickAudited(existingItem)
      const after = pickAudited(item)
      const diff = diffObjects(before, after)
      if (Object.keys(diff.after).length > 0) {
        createAuditLogger(organizationId!, userId, request)
          .update("inventario", id, before, after)
          .catch(() => {})
        // Webhook outbound: solo si cambió algún campo NO-stock relevante.
        // changes: diff field → {before, after} para que el consumidor sepa qué pasó.
        const changes: Record<string, { before: unknown; after: unknown }> = {}
        for (const k of Object.keys(diff.after)) {
          changes[k] = { before: diff.before[k], after: diff.after[k] }
        }
        emitWebhookEvent(organizationId!, "inventario.updated", {
          id: item.id,
          codigo: item.codigo,
          nombre: item.nombre,
          changes,
        }).catch(() => {})
      }
    }

    if (data.stock !== undefined && data.stock !== existingItem.stock) {
      const { error: movError } = await supabaseAdmin.from('movimientos_inventario').insert({
        inventario_id: id,
        tipo: 'AJUSTE',
        cantidad: data.stock - existingItem.stock,
        stock_anterior: existingItem.stock,
        stock_posterior: data.stock,
        referencia_tipo: 'AJUSTE_MANUAL',
        usuario_id: userId,
        organization_id: organizationId,
      })
      // Stock ya quedó actualizado; log explícito si falla auditoría para
      // no perder el evento en silencio.
      if (movError) {
        console.error("Error registrando movimiento de stock (item actualizado igual):", {
          inventarioId: id,
          stockAnterior: existingItem.stock,
          stockPosterior: data.stock,
          error: movError,
        })
      }
    }

    // Si cambió stock, invalidar caché del catálogo público (items linkean
    // a este inventario via inventario_id).
    if (data.stock !== undefined && data.stock !== existingItem.stock) {
      revalidateTag("catalogo", "max")
    }

    return NextResponse.json(formatInventario(item))
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error updating inventario:", error)
    return NextResponse.json(
      { error: "Error al actualizar item" },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId } = await requireAdmin()
    if (error) return error

    const { id } = await params
    const url = new URL(request.url)
    const archive = url.searchParams.get("archive") === "true"

    // Verificar pertenencia + snapshot completo para audit log
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("inventario")
      .select("*")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .maybeSingle()

    if (fetchError || !existing) {
      return NextResponse.json({ error: "Item no encontrado" }, { status: 404 })
    }

    // Modo archivar: soft-delete (conserva historial)
    if (archive) {
      if (existing.deleted_at) {
        return NextResponse.json({ success: true, archived: true })
      }
      const { error: updateError } = await supabaseAdmin
        .from("inventario")
        .update({ deleted_at: new Date().toISOString(), deleted_by: userId })
        .eq("id", id)
      if (updateError) throw updateError
      if (userId) {
        createAuditLogger(organizationId!, userId, request)
          .delete("inventario", id, { ...pickAudited(existing), accion: "ARCHIVADO" })
          .catch(() => {})
      }
      // Webhook outbound: inventario.archived (soft-delete)
      emitWebhookEvent(organizationId!, "inventario.archived", {
        id,
        codigo: existing.codigo,
        nombre: existing.nombre,
        archivedBy: userId ?? null,
      }).catch(() => {})
      return NextResponse.json({ success: true, archived: true })
    }

    // Modo hard-delete: primero chequear referencias bloqueantes (FK RESTRICT).
    // items_venta y items_cotizacion usan ON DELETE SET NULL — no bloquean.
    // movimientos_inventario e historial_precios usan CASCADE — se limpian solos.
    const [repuestos, devoluciones, ordenesCompra] = await Promise.all([
      supabaseAdmin.from("repuestos_orden").select("id", { count: "exact", head: true }).eq("inventario_id", id),
      supabaseAdmin.from("items_devolucion").select("id", { count: "exact", head: true }).eq("inventario_id", id),
      supabaseAdmin.from("items_orden_compra").select("id", { count: "exact", head: true }).eq("inventario_id", id),
    ])

    const refs = {
      ordenesServicio: repuestos.count ?? 0,
      devoluciones: devoluciones.count ?? 0,
      ordenesCompra: ordenesCompra.count ?? 0,
    }
    const total = refs.ordenesServicio + refs.devoluciones + refs.ordenesCompra

    if (total > 0) {
      const detalles: string[] = []
      if (refs.ordenesServicio) detalles.push(`${refs.ordenesServicio} orden${refs.ordenesServicio === 1 ? "" : "es"} de servicio`)
      if (refs.devoluciones) detalles.push(`${refs.devoluciones} devolución${refs.devoluciones === 1 ? "" : "es"}`)
      if (refs.ordenesCompra) detalles.push(`${refs.ordenesCompra} orden${refs.ordenesCompra === 1 ? "" : "es"} de compra`)
      return NextResponse.json(
        {
          error: `Este item está en uso en ${detalles.join(", ")}. No se puede eliminar permanentemente; podés archivarlo.`,
          code: "HAS_REFERENCES",
          canArchive: true,
          references: refs,
        },
        { status: 409 }
      )
    }

    // Audit del hard delete (antes de borrar; el log sobrevive al item)
    if (userId) {
      createAuditLogger(organizationId!, userId, request)
        .delete("inventario", id, { ...pickAudited(existing), accion: "ELIMINADO" })
        .catch(() => {})
    }

    // Sin referencias bloqueantes: hard delete.
    const { error: deleteError } = await supabaseAdmin
      .from("inventario")
      .delete()
      .eq("id", id)
      .eq("organization_id", organizationId!)

    if (deleteError) {
      // Fallback defensivo: si una FK nueva apareció entre el chequeo y el delete.
      if ((deleteError as any).code === "23503") {
        return NextResponse.json(
          {
            error: "Este item está siendo usado en otros registros. Archivalo en su lugar.",
            code: "HAS_REFERENCES",
            canArchive: true,
          },
          { status: 409 }
        )
      }
      throw deleteError
    }

    return NextResponse.json({ success: true, archived: false })
  } catch (error) {
    console.error("Error deleting inventario:", error)
    return NextResponse.json(
      { error: "Error al eliminar item" },
      { status: 500 }
    )
  }
}
