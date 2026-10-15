import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
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
    const { error, organizationId, userId, role } = await requireAuth()
    if (error) return error

    const { id } = await params

    const { data: orden, error: ordenError } = await supabaseAdmin
      .from("ordenes_servicio")
      .select("id, tecnico_id")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .maybeSingle()
    if (ordenError) throw ordenError
    if (!orden || (role === "TECNICO" && orden.tecnico_id !== userId)) {
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
