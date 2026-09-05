import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

/**
 * Alimenta el autocompletado de "Para ser presentado ante". No hay tabla de
 * entidades a proposito: el campo es texto libre y esto solo evita que la misma
 * aseguradora quede escrita de cinco formas distintas.
 */
export async function GET() {
  const { error, organizationId } = await requireAuth()
  if (error) return error

  const { data, error: dbError } = await supabaseAdmin
    .from("cotizaciones")
    .select("presentado_ante")
    .eq("organization_id", organizationId!)
    .not("presentado_ante", "is", null)
    .is("deleted_at", null)
    .limit(500)

  if (dbError) {
    console.error("Error listando entidades:", dbError)
    return NextResponse.json({ error: "Error al listar entidades" }, { status: 500 })
  }

  // PostgREST no expone SELECT DISTINCT, asi que se deduplica aca. El limite de
  // 500 filas acota el costo: un taller no trabaja con 500 aseguradoras, y si
  // alguna queda afuera el campo sigue siendo escribible a mano.
  const entidades = Array.from(
    new Set((data || []).map((fila) => (fila.presentado_ante || "").trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b, "es"))

  return NextResponse.json({ entidades })
}
