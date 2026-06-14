import { NextResponse } from "next/server"
import { z } from "zod"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { safeParseBody } from "@/lib/api-utils"

const bulkDeleteSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, "Debe seleccionar al menos una organización"),
  hard: z.boolean().optional(),
  confirm: z.boolean().optional(),
})

export async function POST(request: Request) {
  try {
    const { error: authError, email } = await requireSuperadmin()
    if (authError) return authError

    const parsed = await safeParseBody(request, bulkDeleteSchema)
    if ("error" in parsed) return parsed.error

    const { ids, hard, confirm } = parsed.data

    // Obtener nombres + slug para guard + log
    const { data: orgs } = await supabaseAdmin
      .from("organizations")
      .select("id, nombre, slug")
      .in("id", ids)

    // Guard: filtrar la org del panel admin del set a procesar
    const protectedIds = (orgs || [])
      .filter((o) => o.slug === "superadmin")
      .map((o) => o.id)
    const targetIds = ids.filter((id) => !protectedIds.includes(id))

    if (targetIds.length === 0) {
      return NextResponse.json(
        { error: "Ninguna organización válida para eliminar (la del panel admin está protegida)" },
        { status: 400 }
      )
    }

    // Permanent purge — only when BOTH hard AND confirm are explicitly true
    if (hard === true && confirm === true) {
      const { error: deleteError, count } = await supabaseAdmin
        .from("organizations")
        .delete({ count: "exact" })
        .in("id", targetIds)
        .neq("slug", "superadmin")

      if (deleteError) {
        console.error("Bulk delete error:", deleteError)
        return NextResponse.json(
          { error: "Error al eliminar organizaciones" },
          { status: 500 }
        )
      }

      // Audit log
      try {
        await supabaseAdmin.from("audit_logs").insert({
          organization_id: null,
          user_id: null,
          action: "BULK_DELETE",
          entity: "organizations",
          entity_id: null,
          changes: {
            deleted_count: count,
            deleted_orgs: orgs
              ?.filter((o) => targetIds.includes(o.id))
              .map((o) => ({ id: o.id, nombre: o.nombre })),
            superadmin_email: email,
          },
        })
      } catch {
        // best effort
      }

      return NextResponse.json({
        success: true,
        deleted: count,
        message: `${count} organización(es) eliminada(s) permanentemente`,
      })
    }

    // Default path — archive (soft delete)
    const { count: archivedCount, error: archiveError } = await supabaseAdmin
      .from("organizations")
      .update({ deleted_at: new Date().toISOString(), deleted_by: email }, { count: "exact" })
      .in("id", targetIds)
      .neq("slug", "superadmin")
      .is("deleted_at", null)

    if (archiveError) {
      console.error("Bulk archive error:", archiveError)
      return NextResponse.json(
        { error: "Error al archivar organizaciones" },
        { status: 500 }
      )
    }

    const archived = archivedCount ?? 0

    // Audit log — best effort
    try {
      await supabaseAdmin.from("audit_logs").insert({
        organization_id: null,
        user_id: null,
        action: "ARCHIVE",
        entity: "organizations",
        entity_id: null,
        changes: {
          archived_count: archived,
          archived_orgs: orgs
            ?.filter((o) => targetIds.includes(o.id))
            .map((o) => ({ id: o.id, nombre: o.nombre })),
          superadmin_email: email,
        },
      })
    } catch {
      // best effort
    }

    return NextResponse.json({
      success: true,
      archived,
      deleted: archived,
      message: `${archived} organización(es) archivada(s)`,
    })
  } catch (error) {
    console.error("Error in bulk delete:", error)
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    )
  }
}
