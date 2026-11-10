import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { getOrderByPublicToken } from "@/lib/public-token"
import { firmarCampo } from "@/lib/storage-privado"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params
    const { orden, error } = await getOrderByPublicToken(token)
    if (error) return error

    const { data: fotosDb } = await supabaseAdmin
      .from("fotos_orden")
      .select("id, url, storage_path, tipo, descripcion, created_at")
      .eq("orden_id", orden.id)
      .order("created_at", { ascending: true })

    // El bucket es privado: se firman las URLs y no se expone storage_path.
    const fotos = (
      await firmarCampo("FOTOS_ORDENES", fotosDb ?? [], "url", { campoPath: "storage_path" })
    ).map(({ storage_path: _storagePath, ...resto }) => resto)

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
