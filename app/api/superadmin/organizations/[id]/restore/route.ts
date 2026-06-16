import { NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"

/**
 * POST /api/superadmin/organizations/[id]/restore
 * Restaura una org archivada (limpia deleted_at/deleted_by/archived_reason).
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error: authError, email } = await requireSuperadmin()
    if (authError) return authError

    const { id } = await params

    const { data: org, error: orgError } = await supabaseAdmin
      .from("organizations")
      .select("id, nombre, slug, deleted_at")
      .eq("id", id)
      .single()

    if (orgError || !org) {
      return NextResponse.json({ error: "Organización no encontrada" }, { status: 404 })
    }
    if (org.slug === "superadmin") {
      return NextResponse.json(
        { error: "No se puede restaurar la organización del panel admin" },
        { status: 403 }
      )
    }
    if (!org.deleted_at) {
      return NextResponse.json({ error: "La organización no está archivada" }, { status: 409 })
    }

    // Update atómico: solo restaura si sigue archivada (evita TOCTOU con otra
    // request concurrente).
    const { data: restoredRows, error: updateError } = await supabaseAdmin
      .from("organizations")
      .update({ deleted_at: null, deleted_by: null, archived_reason: null })
      .eq("id", id)
      .not("deleted_at", "is", null)
      .select("id")

    if (updateError) {
      console.error("Error restoring organization:", updateError)
      return NextResponse.json({ error: "Error al restaurar la organización" }, { status: 500 })
    }
    if (!restoredRows || restoredRows.length === 0) {
      return NextResponse.json({ error: "La organización no está archivada" }, { status: 409 })
    }

    try {
      await supabaseAdmin.from("audit_logs").insert({
        organization_id: id,
        user_id: null,
        action: "RESTORE",
        entity: "organizations",
        entity_id: id,
        changes: { superadmin_email: email },
      })
    } catch {
      // best effort
    }

    return NextResponse.json({ success: true, message: `Organización "${org.nombre}" restaurada` })
  } catch (error) {
    console.error("Error in POST restore:", error)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}
