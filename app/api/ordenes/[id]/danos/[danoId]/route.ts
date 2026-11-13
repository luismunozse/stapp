import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { actorDeSesion, cargarOrdenEnAlcance } from "@/lib/ordenes/alcance"
import { supabaseAdmin } from "@/lib/supabase"
import { mensajeErrorDanos } from "@/lib/ordenes/danos"

// DELETE - Borrar un daño de diagnóstico (el trigger limita la ventana a 10 minutos).
// Un pin de recepción no coincide con el filtro momento = 'diagnostico': responde 404.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; danoId: string }> }
) {
  try {
    const autenticado = await requireAuth()
    const { error, organizationId } = autenticado
    if (error) return error

    const { id: ordenId, danoId } = await params
    const cargada = await cargarOrdenEnAlcance(ordenId, actorDeSesion(autenticado), "reparar", { select: "id" })
    if ("error" in cargada) return cargada.error

    const { data, error: deleteError } = await supabaseAdmin
      .from("orden_danos")
      .delete()
      .eq("id", danoId)
      .eq("orden_id", ordenId)
      .eq("organization_id", organizationId!)
      .eq("momento", "diagnostico")
      .select("id")

    if (deleteError) {
      const { status, error: mensaje } = mensajeErrorDanos(deleteError, "quitar")
      if (status === 500) console.error("Error deleting order damage:", deleteError)
      return NextResponse.json({ error: mensaje }, { status })
    }
    if (!data || data.length === 0) {
      return NextResponse.json({ error: "Daño no encontrado" }, { status: 404 })
    }
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    console.error("Error deleting order damage:", error)
    return NextResponse.json({ error: "No se pudo borrar el daño" }, { status: 500 })
  }
}
