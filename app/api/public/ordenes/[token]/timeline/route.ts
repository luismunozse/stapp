import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params

    // Obtener orden por token público
    const { data: orden } = await supabaseAdmin
      .from("ordenes_servicio")
      .select("id, organization_id")
      .eq("public_token", token)
      .single()

    if (!orden) {
      return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 })
    }

    // Obtener eventos del timeline
    const { data: eventos } = await supabaseAdmin
      .from("orden_eventos")
      .select(`
        id, tipo, estado_anterior, estado_nuevo,
        descripcion, metadata, created_at,
        users:created_by (nombre)
      `)
      .eq("orden_id", orden.id)
      .order("created_at", { ascending: true })

    // Obtener fotos para enriquecer el timeline
    const { data: fotos } = await supabaseAdmin
      .from("fotos_orden")
      .select("id, url, tipo, descripcion, created_at")
      .eq("orden_id", orden.id)
      .order("created_at", { ascending: true })

    // Combinar eventos y fotos en un timeline unificado
    const timeline = [
      ...(eventos || []).map((e: Record<string, unknown>) => ({
        id: e.id,
        type: "evento" as const,
        eventType: e.tipo,
        estadoAnterior: e.estado_anterior,
        estadoNuevo: e.estado_nuevo,
        descripcion: e.descripcion,
        metadata: e.metadata,
        createdAt: e.created_at,
        createdBy: (e.users as Record<string, unknown>)?.nombre || null,
      })),
      ...(fotos || []).map((f: Record<string, unknown>) => ({
        id: f.id,
        type: "foto" as const,
        eventType: "FOTO_AGREGADA",
        url: f.url,
        fotoTipo: f.tipo,
        descripcion: f.descripcion,
        createdAt: f.created_at,
      })),
    ].sort((a, b) => new Date(a.createdAt as string).getTime() - new Date(b.createdAt as string).getTime())

    return NextResponse.json({ timeline })
  } catch (error) {
    console.error("Error fetching timeline:", error)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
