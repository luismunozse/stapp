import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { requireCronAuth } from "@/lib/cron-auth"

export const maxDuration = 60

/**
 * Purge diario de PII del catálogo público (Ley 25.326 / GDPR-like).
 * Llama la RPC purgar_pii_catalogo_publico que aplica:
 *  - Carritos abandonados sin consent: 7 días
 *  - Carritos abandonados con consent no recovered: 90 días
 *  - Views (analytics): 60 días
 */
export async function GET(request: Request) {
  const authError = requireCronAuth(request)
  if (authError) return authError

  const { data, error } = await supabaseAdmin.rpc("purgar_pii_catalogo_publico")

  if (error) {
    console.error("Error en purgar_pii_catalogo_publico:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, result: data })
}
