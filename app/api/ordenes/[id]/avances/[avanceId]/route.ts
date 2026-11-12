import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { actorDeSesion, cargarOrdenEnAlcance } from "@/lib/ordenes/alcance"
import { supabaseAdmin } from "@/lib/supabase"
import { TIPO_AVANCE } from "@/lib/ordenes/avances"

/** Borra un avance. Lo puede borrar quien lo escribió o un ADMIN. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; avanceId: string }> }
) {
  try {
    const autenticado = await requireAuth()
    const { error, organizationId, userId, role } = autenticado
    if (error) return error

    const { id, avanceId } = await params
    const cargada = await cargarOrdenEnAlcance(id, actorDeSesion(autenticado), "reparar", { select: "id" })
    if ("error" in cargada) return cargada.error

    const { data: avance, error: findError } = await supabaseAdmin
      .from("orden_eventos")
      .select("id, created_by")
      .eq("id", avanceId)
      .eq("orden_id", id)
      .eq("organization_id", organizationId!)
      .eq("tipo", TIPO_AVANCE)
      .maybeSingle()

    if (findError) throw findError
    if (!avance) return NextResponse.json({ error: "Avance no encontrado" }, { status: 404 })
    if (role !== "ADMIN" && avance.created_by !== userId) {
      return NextResponse.json({ error: "Solo quien lo escribió o un administrador puede borrarlo" }, { status: 403 })
    }

    const { error: delError } = await supabaseAdmin
      .from("orden_eventos")
      .delete()
      .eq("id", avanceId)
      .eq("organization_id", organizationId!)
      .eq("tipo", TIPO_AVANCE)

    if (delError) throw delError

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Error deleting avance:", error)
    return NextResponse.json({ error: "Error al borrar el avance" }, { status: 500 })
  }
}
