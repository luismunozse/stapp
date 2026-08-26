import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { requireCronAuth } from "@/lib/cron-auth"

export const maxDuration = 60

/**
 * Libera las reservas de stock que tomaron solicitudes del catálogo público y
 * quedaron sin respuesta.
 *
 * Una solicitud del catálogo reserva stock apenas se crea (migración 314) y la
 * toma un visitante anónimo. Rechazarla o borrarla libera; abandonarla, no.
 * Sin este barrido, cualquiera puede dejar un catálogo entero en "Agotado"
 * llenando el carrito y desapareciendo.
 *
 * Ventana de retención: `fecha_vencimiento` de la cotización si la tiene, si no
 * CATALOGO_RESERVA_DIAS días desde la creación (default 7).
 */
export async function GET(request: Request) {
  const authError = requireCronAuth(request)
  if (authError) return authError

  const dias = Number(process.env.CATALOGO_RESERVA_DIAS)
  const params = Number.isFinite(dias) && dias > 0 ? { p_dias: Math.trunc(dias) } : {}

  const { data, error } = await supabaseAdmin.rpc("expirar_reservas_catalogo", params)

  if (error) {
    console.error("Error en expirar_reservas_catalogo:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, result: data })
}
