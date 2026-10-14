import { NextResponse } from "next/server"
import { requireInventarioAccess } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { createAuditLogger } from "@/lib/audit"
import { isMissingColumnError } from "@/lib/db-errors"

// A cap on the read of the children that remain: PostgREST answers at most this many rows, and a
// group is only deleted when the answer proves which groups still have a child.
const LIMITE_HIJOS_RESTANTES = 1000

// Deletes the variant groups of the organization that no child points at any more: the ones
// the wipe just emptied and the empty ones a single hard delete may have left (VG-15). The group
// of a child that could not be deleted stays. Best-effort and after the wipe: it never changes the
// answer of the wipe. A missing migration (no table or column yet) means there is nothing to do.
// Deleting a group a child still points at would detach that child (the foreign key sets NULL),
// so when the remaining children cannot be listed completely nothing is deleted.
async function borrarGruposSinHijos(organizationId: string): Promise<void> {
  try {
    const { data: restantes, error: restantesError, count } = await supabaseAdmin
      .from("inventario")
      .select("grupo_id", { count: "exact" })
      .eq("organization_id", organizationId)
      .not("grupo_id", "is", null)
      .limit(LIMITE_HIJOS_RESTANTES)
    if (restantesError) throw restantesError
    // The server may cut the answer below our own limit (its max_rows): the count says how many
    // children really remain, and a read that does not cover all of them proves nothing.
    if (count === null || count === undefined || count > (restantes ?? []).length || (restantes ?? []).length >= LIMITE_HIJOS_RESTANTES) {
      console.error("No se borraron los grupos de variantes: quedan demasiados productos para saber cuáles siguen en uso")
      return
    }

    const conHijos = [...new Set((restantes ?? []).map((r) => r.grupo_id as string))]
    let borrado = supabaseAdmin.from("inventario_grupos").delete().eq("organization_id", organizationId)
    if (conHijos.length > 0) {
      borrado = borrado.not("id", "in", `(${conHijos.map((id) => `"${id}"`).join(",")})`)
    }
    const { error: borradoError } = await borrado
    if (borradoError) throw borradoError
  } catch (e) {
    if (isMissingColumnError(e)) return
    console.error("Error borrando los grupos de variantes sin productos:", e)
  }
}

// Wipe all inventario for the caller's organization.
// FK-restricted rows (in use by órdenes / compras / devoluciones) are reported
// back as "blocked" so the UI can offer to archive them instead — mirrors the
// behavior of /api/inventario/bulk?action=delete.
export async function DELETE(request: Request) {
  try {
    const { error, organizationId, userId } = await requireInventarioAccess()
    if (error) return error

    const { data: allRows, error: listErr } = await supabaseAdmin
      .from("inventario")
      .select("id, codigo, nombre")
      .eq("organization_id", organizationId!)

    if (listErr) throw listErr

    const ids = (allRows ?? []).map((r) => r.id as string)
    if (ids.length === 0) {
      await borrarGruposSinHijos(organizationId!)
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

    await borrarGruposSinHijos(organizationId!)

    return NextResponse.json({ deleted, blocked })
  } catch (err) {
    console.error("Error wiping inventario:", err)
    return NextResponse.json(
      { error: "Error al eliminar el inventario" },
      { status: 500 }
    )
  }
}
