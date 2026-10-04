import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { requireCronAuth } from "@/lib/cron-auth"

export const maxDuration = 60

const BATCH_SIZE = 200
// Tope de lotes por corrida: un backlog grande se drena en varias horas en vez
// de arriesgar el timeout. El cron corre cada hora.
const MAX_BATCHES = 5

/**
 * Libera el stock reservado por solicitudes del catálogo público que nadie
 * respondió dentro de catalogo_config.reserva_horas (migración 337). No cambia
 * el estado de la cotización: solo devuelve el stock.
 */
export async function GET(request: Request) {
  const authError = requireCronAuth(request)
  if (authError) return authError

  let lotes = 0
  let revisadas = 0
  let liberadas = 0
  let itemsLiberados = 0
  let itemsCatalogoRestaurados = 0

  while (lotes < MAX_BATCHES) {
    const { data, error } = await supabaseAdmin.rpc("expirar_reservas_catalogo", { p_limite: BATCH_SIZE })
    if (error) {
      console.error("Error en expirar_reservas_catalogo:", error)
      return NextResponse.json({ error: error.message, lotes, revisadas }, { status: 500 })
    }
    lotes += 1
    const r = (data ?? {}) as Record<string, number>
    revisadas += r.revisadas ?? 0
    liberadas += r.liberadas ?? 0
    itemsLiberados += r.itemsLiberados ?? 0
    itemsCatalogoRestaurados += r.itemsCatalogoRestaurados ?? 0
    if ((r.revisadas ?? 0) < BATCH_SIZE) break
  }

  return NextResponse.json({ ok: true, lotes, revisadas, liberadas, itemsLiberados, itemsCatalogoRestaurados })
}
