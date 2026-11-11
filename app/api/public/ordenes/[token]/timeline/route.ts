import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { getOrderByPublicToken } from "@/lib/public-token"
import { firmarCampo } from "@/lib/storage-privado"

/**
 * Endpoint PÚBLICO (sin auth, sólo el token de seguimiento). Todo lo que sale
 * de acá lo ve el cliente final, así que se arma con lista blanca:
 *
 * - Eventos: sólo cambios de estado y eventos del presupuesto. Las NOTA (y
 *   cualquier tipo nuevo) son internas del taller y nunca se exponen.
 * - De cada evento se devuelven sólo tipo, estado nuevo y fecha. La
 *   `descripcion` la escribe el sistema/staff (códigos de recepción, motivos
 *   internos, enums crudos), `metadata` es interna y `created_by` es un
 *   empleado: ninguno sale. El texto lo arma el cliente a partir del estado.
 * - Fotos: sólo los mismos tipos que ya expone el endpoint /photos (INGRESO,
 *   REPARACION, ENTREGA); las de DIAGNOSTICO/COMPONENTE no salen.
 */
const EVENTOS_PUBLICOS = [
  "CAMBIO_ESTADO",
  "PRESUPUESTO_DEFINIDO",
  "PRESUPUESTO_APROBADO",
  "PRESUPUESTO_RECHAZADO",
]

const FOTOS_PUBLICAS = ["INGRESO", "REPARACION", "ENTREGA"]

interface EventoRow {
  id: string
  tipo: string
  estado_nuevo: string | null
  created_at: string
}

interface FotoRow extends Record<string, unknown> {
  id: string
  url: string
  storage_path: string
  tipo: string
  descripcion: string | null
  created_at: string
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params
    const { orden, error } = await getOrderByPublicToken(token)
    if (error) return error

    const { data: eventos } = await supabaseAdmin
      .from("orden_eventos")
      .select("id, tipo, estado_nuevo, created_at")
      .eq("orden_id", orden.id)
      .in("tipo", EVENTOS_PUBLICOS)
      .order("created_at", { ascending: true })

    const { data: fotosDb } = await supabaseAdmin
      .from("fotos_orden")
      .select("id, url, storage_path, tipo, descripcion, created_at")
      .eq("orden_id", orden.id)
      .in("tipo", FOTOS_PUBLICAS)
      .order("created_at", { ascending: true })

    // Se vuelve a filtrar en memoria: la lista blanca no depende sólo del query.
    const fotosVisibles = ((fotosDb ?? []) as FotoRow[]).filter((f) => FOTOS_PUBLICAS.includes(f.tipo))

    // El bucket es privado: cada foto sale con una URL firmada que vence.
    const fotos = await firmarCampo("FOTOS_ORDENES", fotosVisibles, "url", { campoPath: "storage_path" })

    const timeline = [
      ...((eventos ?? []) as EventoRow[])
        .filter((e) => EVENTOS_PUBLICOS.includes(e.tipo))
        .filter((e) => e.tipo !== "CAMBIO_ESTADO" || !!e.estado_nuevo)
        .map((e) => ({
          id: e.id,
          type: "evento" as const,
          eventType: e.tipo,
          estadoNuevo: e.estado_nuevo,
          createdAt: e.created_at,
        })),
      ...fotos.map((f) => ({
        id: f.id,
        type: "foto" as const,
        eventType: "FOTO_AGREGADA",
        url: f.url,
        fotoTipo: f.tipo,
        descripcion: f.descripcion,
        createdAt: f.created_at,
      })),
    ].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

    return NextResponse.json({ timeline })
  } catch (error) {
    console.error("Error fetching timeline:", error)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
