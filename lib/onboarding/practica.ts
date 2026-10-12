import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import {
  ORDEN_PRACTICA_ERROR,
  type PracticaEstado,
  type PracticaOrden,
} from "@/lib/onboarding/practica-shared"

/** codigo_orden of the practice order: TEXT, nullable, not unique (migration 013). */
export const PRACTICA_CODIGO_ORDEN = "PRACTICA"

/** Columns every practice read needs, including what the notification context uses. */
export const PRACTICA_ORDEN_SELECT =
  "id, estado, public_token, tipo_dispositivo, dispositivo, problema_reportado, costo_final, fecha_completado, sucursal_id, cliente_id, clientes (id, nombre, email)"

export interface PracticaOrdenRow {
  id: string
  estado: string
  public_token: string | null
  tipo_dispositivo: string
  dispositivo: string
  problema_reportado: string
  costo_final: string | number | null
  fecha_completado?: string | null
  sucursal_id?: string | null
  cliente_id?: string
  clientes?: { id: string; nombre: string; email: string | null } | null
}

type DbClient = typeof supabaseAdmin

function toPracticaEstado(estado: string): PracticaEstado {
  if (estado === "REPARADO" || estado === "ENTREGADO_SIN_COBRO") return estado
  // EN_REPARACION exists only for an instant inside "reparar". If the second
  // write failed, the wizard must offer "reparar" again.
  return "RECIBIDO"
}

export function toPracticaOrden(row: PracticaOrdenRow): PracticaOrden {
  return {
    id: row.id,
    estado: toPracticaEstado(row.estado),
    publicToken: row.public_token ?? "",
    tipoDispositivo: row.tipo_dispositivo,
    dispositivo: row.dispositivo,
    problemaReportado: row.problema_reportado,
    costoFinal: row.costo_final === null || row.costo_final === undefined ? null : Number(row.costo_final),
  }
}

/** The org's raw practice row (with the clientes embed), or null. Throws on a database error. */
export async function getPracticaOrdenRow(
  organizationId: string,
  client: DbClient = supabaseAdmin
): Promise<PracticaOrdenRow | null> {
  const { data, error } = await client
    .from("ordenes_servicio")
    .select(PRACTICA_ORDEN_SELECT)
    .eq("organization_id", organizationId)
    .eq("es_practica", true)
    .maybeSingle()
  if (error) throw new Error(`getPracticaOrden: ${error.message}`)
  return (data as unknown as PracticaOrdenRow | null) ?? null
}

/** The org's practice order, or null. Throws on a database error. */
export async function getPracticaOrden(
  organizationId: string,
  client: DbClient = supabaseAdmin
): Promise<PracticaOrden | null> {
  const row = await getPracticaOrdenRow(organizationId, client)
  return row ? toPracticaOrden(row) : null
}

/**
 * Deletes the org's practice order and its client. The client is kept, and
 * turned into a real one, when anything outside the practice references it.
 * All of it runs in borrar_datos_practica (migration 348), so a cascading FK
 * can never take real data with it. Throws on error; callers decide.
 */
export async function deletePracticeData(
  organizationId: string,
  client: DbClient = supabaseAdmin
): Promise<{ ordenBorrada: boolean; clienteConservado: boolean }> {
  const { data, error } = await client.rpc("borrar_datos_practica", { p_org_id: organizationId })
  if (error) throw new Error(`borrar_datos_practica: ${error.message}`)
  const result = (data ?? {}) as { orden_borrada?: boolean; cliente_conservado?: boolean }
  return {
    ordenBorrada: result.orden_borrada === true,
    clienteConservado: result.cliente_conservado === true,
  }
}

/**
 * 409 when the order is the org's practice order, null otherwise. Fails open on
 * a database error: this guard backs up a read-only UI, and failing closed would
 * block every money route if the column were ever missing.
 */
export async function rejectIfPractica(
  ordenId: string,
  organizationId: string,
  client: DbClient = supabaseAdmin
): Promise<NextResponse | null> {
  const { data, error } = await client
    .from("ordenes_servicio")
    .select("id, es_practica")
    .eq("id", ordenId)
    .eq("organization_id", organizationId)
    .maybeSingle()
  if (error) {
    console.error("[practica] rejectIfPractica could not read the order:", error.message)
    return null
  }
  if ((data as { es_practica?: boolean } | null)?.es_practica === true) {
    return NextResponse.json(ORDEN_PRACTICA_ERROR, { status: 409 })
  }
  return null
}

/** Orders that are not the practice. Throws on a database error. */
export async function countRealOrders(
  organizationId: string,
  client: DbClient = supabaseAdmin
): Promise<number> {
  const { count, error } = await client
    .from("ordenes_servicio")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("es_practica", false)
  if (error) throw new Error(`countRealOrders: ${error.message}`)
  return count ?? 0
}
