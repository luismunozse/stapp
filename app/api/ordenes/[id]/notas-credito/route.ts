import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { actorDeSesion, cargarOrdenEnAlcance } from "@/lib/ordenes/alcance"
import { supabaseAdmin } from "@/lib/supabase"
import { COLUMNAS_VISTA_NC, leerFilasNC, type FilaVistaNC } from "@/lib/notas-credito/listado"

/**
 * GET /api/ordenes/[id]/notas-credito — las NC de una orden, para el bloque
 * del detalle. Mismo alcance que GET /api/ordenes/[id]: la organización, y el
 * técnico solo sus órdenes. Incluye las anuladas (el bloque las muestra con
 * su estado).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const autenticado = await requireAuth()
    const { error, organizationId, userId, role } = autenticado
    if (error) return error

    const { id } = await params

    // Within the caller's scope: an order of another branch is "not found". A TECNICO then
    // gets only his own orders, as ever.
    const cargada = await cargarOrdenEnAlcance(id, actorDeSesion(autenticado), "ver", {
      select: "id, tecnico_id",
    })
    if ("error" in cargada) return cargada.error
    const { orden } = cargada
    if (role === "TECNICO" && orden.tecnico_id !== userId) {
      return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 })
    }

    const { data, error: dbError } = await supabaseAdmin
      .from("v_notas_credito")
      .select(COLUMNAS_VISTA_NC)
      .eq("organization_id", organizationId!)
      .eq("origen", "ORDEN")
      .eq("origen_id", id)
      .order("fecha", { ascending: false })
      .order("id", { ascending: false })
    if (dbError) throw dbError

    const filas = await leerFilasNC((data ?? []) as unknown as FilaVistaNC[], organizationId!)
    return NextResponse.json(filas, { headers: { "Cache-Control": "no-store" } })
  } catch (err) {
    console.error("Error listando notas de credito de la orden:", err)
    return NextResponse.json({ error: "Error al obtener notas de crédito" }, { status: 500 })
  }
}
