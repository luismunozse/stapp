import { supabaseAdmin } from "@/lib/supabase"
import { diagramaPorRef, refDiagrama, resolverDiagrama } from "@/components/ordenes/danos/diagramas"
import type { DanoOrden } from "@/lib/ordenes/danos"

const COLUMNAS_DANO = "id, numero, diagrama, vista, x, y, tipo, nota, momento, created_at, created_by"

/**
 * Daños de una orden ordenados por número, el flag "sin daños" y la referencia del diagrama:
 * la del primer pin de recepción si existe (el dibujo con el que se marcó) y, si no, la que
 * corresponde al tipo de equipo actual.
 */
export async function listarDanosOrden(
  ordenId: string,
  organizationId: string,
  opts: { incluirAutor: boolean },
): Promise<{ danos: DanoOrden[]; sinDanos: boolean; diagrama: string }> {
  const { data: orden, error: ordenError } = await supabaseAdmin
    .from("ordenes_servicio")
    .select("id, tipo_dispositivo, recepcion_sin_danos")
    .eq("id", ordenId)
    .eq("organization_id", organizationId)
    .single()
  if (ordenError && ordenError.code !== "PGRST116") throw ordenError

  const select = opts.incluirAutor ? `${COLUMNAS_DANO}, users:created_by (nombre)` : COLUMNAS_DANO
  const { data: filas, error } = await supabaseAdmin
    .from("orden_danos")
    .select(select)
    .eq("orden_id", ordenId)
    .eq("organization_id", organizationId)
    .order("numero", { ascending: true })
  if (error) throw error

  const danos: DanoOrden[] = ((filas ?? []) as any[]).map((f) => ({
    id: f.id,
    numero: f.numero,
    diagrama: f.diagrama,
    vista: f.vista,
    x: Number(f.x),
    y: Number(f.y),
    tipo: f.tipo,
    nota: f.nota ?? null,
    momento: f.momento,
    createdAt: f.created_at,
    createdByNombre: opts.incluirAutor ? (f.users?.nombre ?? null) : null,
  }))

  const primeraRecepcion = danos.find((d) => d.momento === "recepcion")
  const diagrama = primeraRecepcion
    ? primeraRecepcion.diagrama
    : refDiagrama(resolverDiagrama(orden?.tipo_dispositivo ?? null))

  return { danos, sinDanos: orden?.recepcion_sin_danos === true, diagrama }
}

export function vistaExisteEnDiagrama(ref: string, vista: string): boolean {
  return diagramaPorRef(ref).vistas.some((v) => v.id === vista)
}
