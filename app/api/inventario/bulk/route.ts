import { NextResponse } from "next/server"
import { requireInventarioAccess } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { createAuditLogger } from "@/lib/audit"
import { z } from "zod"

const bulkSchema = z.object({
  // Los ids del inventario son cuids (TEXT), no uuids — validamos solo que no sean vacíos.
  ids: z.array(z.string().min(1)).min(1, "Se requiere al menos un item"),
  action: z.enum(["archive", "set_category", "price_adjust", "set_proveedor", "delete"]),
  payload: z
    .object({
      categoria: z.string().optional(),
      // price_adjust: porcentaje (-99..1000) y campo a ajustar
      percent: z.number().min(-99).max(1000).optional(),
      target: z.enum(["precioVenta", "precioCompra"]).optional(),
      // set_proveedor: id del proveedor o null para quitar
      proveedorId: z.string().min(1).nullable().optional(),
    })
    .optional(),
})

export async function PATCH(request: Request) {
  try {
    const { error, organizationId, userId } = await requireInventarioAccess()
    if (error) return error

    const body = await request.json()
    const { ids, action, payload } = bulkSchema.parse(body)

    // Asegurar que TODOS los ids pertenecen a la organización del usuario.
    // Sin esto, un admin podría afectar items de otra org pasando ids ajenos.
    const { data: owned, error: checkError } = await supabaseAdmin
      .from("inventario")
      .select("id")
      .eq("organization_id", organizationId!)
      .in("id", ids)

    if (checkError) throw checkError
    if (!owned || owned.length !== ids.length) {
      return NextResponse.json(
        { error: "Algunos items no existen o no pertenecen a tu organización" },
        { status: 403 }
      )
    }

    let updatedCount = 0
    let blocked: Array<{ id: string; codigo: string | null; nombre: string | null }> = []

    if (action === "archive") {
      const { data, error: dbError } = await supabaseAdmin
        .from("inventario")
        .update({
          deleted_at: new Date().toISOString(),
          deleted_by: userId,
        })
        .in("id", ids)
        .eq("organization_id", organizationId!)
        .is("deleted_at", null)
        .select("id")

      if (dbError) throw dbError
      updatedCount = data?.length || 0
    } else if (action === "set_category") {
      const categoria = payload?.categoria
      if (!categoria || !categoria.trim()) {
        return NextResponse.json(
          { error: "Categoría requerida" },
          { status: 400 }
        )
      }
      const { data, error: dbError } = await supabaseAdmin
        .from("inventario")
        .update({ categoria, updated_at: new Date().toISOString() })
        .in("id", ids)
        .eq("organization_id", organizationId!)
        .is("deleted_at", null)
        .select("id")

      if (dbError) throw dbError
      updatedCount = data?.length || 0
    } else if (action === "price_adjust") {
      const percent = payload?.percent
      const target = payload?.target ?? "precioVenta"
      if (percent == null || percent === 0) {
        return NextResponse.json(
          { error: "Porcentaje requerido y distinto de cero" },
          { status: 400 }
        )
      }
      // RPC con expresión SQL atómica: evita race entre read y write
      // (otra escritura concurrente entre fetch y update ya no se pisa).
      const column = target === "precioCompra" ? "precio_compra" : "precio_venta"
      const factor = 1 + percent / 100
      const { data, error: rpcErr } = await supabaseAdmin.rpc("bulk_price_adjust", {
        p_organization_id: organizationId!,
        p_ids: ids,
        p_column: column,
        p_factor: factor,
      })
      if (rpcErr) {
        if (rpcErr.code === "22023") {
          return NextResponse.json({ error: rpcErr.message }, { status: 400 })
        }
        throw rpcErr
      }
      updatedCount = (data as { updated: number })?.updated ?? 0
    } else if (action === "set_proveedor") {
      // proveedorId === null → quitar proveedor. String → setearlo.
      const proveedorId = payload?.proveedorId ?? null

      if (proveedorId) {
        // Validar que el proveedor pertenezca a la organización.
        const { data: prov, error: provErr } = await supabaseAdmin
          .from("proveedores")
          .select("id")
          .eq("id", proveedorId)
          .eq("organization_id", organizationId!)
          .maybeSingle()
        if (provErr) throw provErr
        if (!prov) {
          return NextResponse.json(
            { error: "Proveedor inválido" },
            { status: 400 }
          )
        }
      }

      const { data, error: dbError } = await supabaseAdmin
        .from("inventario")
        .update({ proveedor_id: proveedorId, updated_at: new Date().toISOString() })
        .in("id", ids)
        .eq("organization_id", organizationId!)
        .is("deleted_at", null)
        .select("id")

      if (dbError) throw dbError
      updatedCount = data?.length || 0
    } else if (action === "delete") {
      // Hard-delete bulk: bloquear ids con FK RESTRICT (mismo set que single delete).
      // items_venta / items_cotizacion son SET NULL, movimientos / historial son CASCADE.
      const [repuestos, devoluciones, ordenesCompra] = await Promise.all([
        supabaseAdmin.from("repuestos_orden").select("inventario_id").in("inventario_id", ids),
        supabaseAdmin.from("items_devolucion").select("inventario_id").in("inventario_id", ids),
        supabaseAdmin.from("items_orden_compra").select("inventario_id").in("inventario_id", ids),
      ])
      if (repuestos.error) throw repuestos.error
      if (devoluciones.error) throw devoluciones.error
      if (ordenesCompra.error) throw ordenesCompra.error

      const blockedSet = new Set<string>()
      for (const r of repuestos.data ?? []) blockedSet.add(r.inventario_id as string)
      for (const r of devoluciones.data ?? []) blockedSet.add(r.inventario_id as string)
      for (const r of ordenesCompra.data ?? []) blockedSet.add(r.inventario_id as string)

      const safeIds = ids.filter((id) => !blockedSet.has(id))
      const blockedIds = ids.filter((id) => blockedSet.has(id))

      if (blockedIds.length > 0) {
        const { data: blkRows, error: blkErr } = await supabaseAdmin
          .from("inventario")
          .select("id, codigo, nombre")
          .in("id", blockedIds)
          .eq("organization_id", organizationId!)
        if (blkErr) throw blkErr
        blocked = (blkRows ?? []) as typeof blocked
      }

      if (safeIds.length > 0) {
        // Snapshot para audit antes de borrar
        const snapshots: Record<string, { codigo: string | null; nombre: string | null }> = {}
        if (userId) {
          const { data: snapRows } = await supabaseAdmin
            .from("inventario")
            .select("id, codigo, nombre")
            .in("id", safeIds)
            .eq("organization_id", organizationId!)
          for (const row of snapRows ?? []) {
            snapshots[row.id as string] = { codigo: row.codigo, nombre: row.nombre }
          }
        }

        const { error: delError } = await supabaseAdmin
          .from("inventario")
          .delete()
          .in("id", safeIds)
          .eq("organization_id", organizationId!)
        if (delError) {
          // Fallback defensivo: FK nueva apareció entre chequeo y delete.
          if ((delError as any).code === "23503") {
            return NextResponse.json(
              {
                error: "Algunos items adquirieron referencias nuevas. Reintentá o archivalos.",
                code: "HAS_REFERENCES",
                canArchive: true,
              },
              { status: 409 }
            )
          }
          throw delError
        }
        updatedCount = safeIds.length

        if (userId) {
          const logger = createAuditLogger(organizationId!, userId, request)
          for (const id of safeIds) {
            const snap = snapshots[id]
            logger
              .delete("inventario", id, {
                codigo: snap?.codigo ?? null,
                nombre: snap?.nombre ?? null,
                accion: "ELIMINADO_MASIVO",
              })
              .catch(() => {})
          }
        }
      }
    }

    return NextResponse.json({ updated: updatedCount, blocked })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error in bulk inventario action:", error)
    return NextResponse.json(
      { error: "Error al ejecutar acción masiva" },
      { status: 500 }
    )
  }
}
