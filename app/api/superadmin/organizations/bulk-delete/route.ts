import { NextResponse } from "next/server"
import { z } from "zod"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { safeParseBody } from "@/lib/api-utils"

const bulkDeleteSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, "Debe seleccionar al menos una organización"),
})

export async function POST(request: Request) {
  try {
    const { error: authError, email } = await requireSuperadmin()
    if (authError) return authError

    const parsed = await safeParseBody(request, bulkDeleteSchema)
    if ("error" in parsed) return parsed.error

    const { ids } = parsed.data

    // Obtener nombres + slug para guard + log
    const { data: orgs } = await supabaseAdmin
      .from("organizations")
      .select("id, nombre, slug")
      .in("id", ids)

    // Guard: filtrar la org del panel admin del set a borrar
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

    // Eliminar organizaciones (CASCADE borra todo)
    const { error: deleteError, count } = await supabaseAdmin
      .from("organizations")
      .delete({ count: "exact" })
      .in("id", targetIds)

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
          deleted_orgs: orgs?.map((o) => ({ id: o.id, nombre: o.nombre })),
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
  } catch (error) {
    console.error("Error in bulk delete:", error)
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    )
  }
}
