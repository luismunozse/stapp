import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

// GET - Obtener una foto específica con su URL
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; fotoId: string }> }
) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { id: ordenId, fotoId } = await params

    // Verificar que la orden pertenece a la org
    const { data: orden, error: ordenError } = await supabaseAdmin
      .from("ordenes_servicio")
      .select("id")
      .eq("id", ordenId)
      .eq("organization_id", organizationId!)
      .single()

    if (ordenError || !orden) {
      return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 })
    }

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
