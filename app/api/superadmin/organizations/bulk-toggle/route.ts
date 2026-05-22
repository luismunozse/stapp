import { NextResponse } from "next/server"
import { z } from "zod"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { safeParseBody } from "@/lib/api-utils"

const bulkToggleSchema = z.object({
  ids: z.array(z.string().min(1, "ID inválido")).min(1, "Debe seleccionar al menos una organización"),
  activo: z.boolean(),
})

export async function POST(request: Request) {
  try {
    const { error: authError, email } = await requireSuperadmin()
    if (authError) return authError

    const parsed = await safeParseBody(request, bulkToggleSchema)
    if ("error" in parsed) return parsed.error

    const { ids, activo } = parsed.data

    // Guard: filtrar la org del panel admin para no desactivarla
    const { data: protectedOrgs } = await supabaseAdmin
      .from("organizations")
      .select("id")
      .in("id", ids)
      .eq("slug", "superadmin")
    const protectedIds = (protectedOrgs || []).map((o) => o.id)
    const targetIds = ids.filter((id) => !protectedIds.includes(id))

    if (targetIds.length === 0) {
      return NextResponse.json(
        { error: "Ninguna organización válida (la del panel admin está protegida)" },
        { status: 400 }
      )
    }

    const { data, error: dbError } = await supabaseAdmin
      .from("organizations")
      .update({ activo })
      .in("id", targetIds)
      .select("id")

    if (dbError) throw dbError

    const count = data?.length ?? 0

    // Registrar en audit_logs
    await supabaseAdmin.from("audit_logs").insert({
      organization_id: null,
      user_id: null,
      action: "UPDATE",
      entity: "organizations",
      entity_id: null,
      changes: {
        field: "activo",
        after: activo,
        bulk_ids: ids,
        count,
        superadmin_email: email,
        action_description: activo
          ? `${count} organizaciones activadas en lote`
          : `${count} organizaciones desactivadas en lote`,
      },
    })

    return NextResponse.json({ success: true, count })
  } catch (error) {
    console.error("Error bulk toggling organizations:", error)
    return NextResponse.json(
      { error: "Error al cambiar estado de organizaciones en lote" },
      { status: 500 }
    )
  }
}
