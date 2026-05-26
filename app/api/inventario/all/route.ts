import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { createAuditLogger } from "@/lib/audit"

// Wipe all inventario for the caller's organization.
// FK-restricted rows (in use by órdenes / compras / devoluciones) are reported
// back as "blocked" so the UI can offer to archive them instead — mirrors the
// behavior of /api/inventario/bulk?action=delete.
export async function DELETE(request: Request) {
  try {
    const { error, organizationId, userId } = await requireAdmin()
    if (error) return error

    const { data: allRows, error: listErr } = await supabaseAdmin
      .from("inventario")
      .select("id, codigo, nombre")
      .eq("organization_id", organizationId!)

    if (listErr) throw listErr

    const ids = (allRows ?? []).map((r) => r.id as string)
    if (ids.length === 0) {
      return NextResponse.json({ deleted: 0, blocked: [] })
    }

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
    const blocked = (allRows ?? []).filter((r) => blockedSet.has(r.id as string)) as Array<{
      id: string
      codigo: string | null
      nombre: string | null
    }>

    let deleted = 0
    if (safeIds.length > 0) {
      const snapshots: Record<string, { codigo: string | null; nombre: string | null }> = {}
      for (const row of allRows ?? []) {
        if (!blockedSet.has(row.id as string)) {
          snapshots[row.id as string] = { codigo: row.codigo, nombre: row.nombre }
        }
      }

      const { error: delErr } = await supabaseAdmin
        .from("inventario")
        .delete()
        .in("id", safeIds)
        .eq("organization_id", organizationId!)

      if (delErr) {
        if ((delErr as any).code === "23503") {
          return NextResponse.json(
            {
              error: "Algunos items adquirieron referencias nuevas. Reintentá o archivalos.",
              code: "HAS_REFERENCES",
              canArchive: true,
            },
            { status: 409 }
          )
        }
        throw delErr
      }
      deleted = safeIds.length

      if (userId) {
        const logger = createAuditLogger(organizationId!, userId, request)
        for (const id of safeIds) {
          const snap = snapshots[id]
          logger
            .delete("inventario", id, {
              codigo: snap?.codigo ?? null,
              nombre: snap?.nombre ?? null,
              accion: "ELIMINADO_TODO",
            })
            .catch(() => {})
        }
      }
    }

    return NextResponse.json({ deleted, blocked })
  } catch (err) {
    console.error("Error wiping inventario:", err)
    return NextResponse.json(
      { error: "Error al eliminar el inventario" },
      { status: 500 }
    )
  }
}
