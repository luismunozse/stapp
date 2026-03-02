import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params

    const { data: orden } = await supabaseAdmin
      .from("ordenes_servicio")
      .select("id")
      .eq("public_token", token)
      .single()

    if (!orden) {
      return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 })
    }

    const { data: fotos } = await supabaseAdmin
      .from("fotos_orden")
      .select("id, url, tipo, descripcion, created_at")
      .eq("orden_id", orden.id)
      .order("created_at", { ascending: true })

    // Agrupar por tipo
    const grouped = {
      INGRESO: (fotos || []).filter((f: Record<string, unknown>) => f.tipo === "INGRESO"),
      REPARACION: (fotos || []).filter((f: Record<string, unknown>) => f.tipo === "REPARACION"),
      ENTREGA: (fotos || []).filter((f: Record<string, unknown>) => f.tipo === "ENTREGA"),
    }

    return NextResponse.json(grouped)
  } catch (error) {
    console.error("Error fetching photos:", error)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
