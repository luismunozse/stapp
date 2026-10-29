import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { actorDeSesion, cargarOrdenEnAlcance } from "@/lib/ordenes/alcance"
import { supabaseAdmin } from "@/lib/supabase"

// GET - Obtener una foto específica con su URL
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; fotoId: string }> }
) {
  try {
    const autenticado = await requireAuth()
    const { error } = autenticado
    if (error) return error

    const { id: ordenId, fotoId } = await params

    // The order must belong to the organization and be within the caller's scope
    const cargada = await cargarOrdenEnAlcance(ordenId, actorDeSesion(autenticado), "ver", { select: "id" })
    if ("error" in cargada) return cargada.error

    const { data: foto, error: dbError } = await supabaseAdmin
      .from("fotos_orden")
      .select("*")
      .eq("id", fotoId)
      .eq("orden_id", ordenId)
      .single()

    if (dbError || !foto) {
      return NextResponse.json({ error: "Foto no encontrada" }, { status: 404 })
    }

    return NextResponse.json({
      id: foto.id,
      ordenId: foto.orden_id,
      url: foto.url,
      tipo: foto.tipo,
      descripcion: foto.descripcion,
      createdAt: foto.created_at,
    })
  } catch (error) {
    console.error("Error fetching foto:", error)
    return NextResponse.json(
      { error: "Error al obtener foto" },
      { status: 500 }
    )
  }
}
