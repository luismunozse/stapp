import { NextResponse } from "next/server"
import { requireApiKey } from "@/lib/api-auth"
import { supabaseAdmin } from "@/lib/supabase"

const COLUMNS =
  "id, numero_orden, codigo_orden, estado, dispositivo, tipo_dispositivo, marca, problema_reportado, presupuesto, costo_final, cliente_id, tecnico_id, fecha_ingreso, fecha_prometida, fecha_completado, created_at"

export async function GET(request: Request) {
  const { error, organizationId } = await requireApiKey(request)
  if (error) return error

  try {
    const { searchParams } = new URL(request.url)
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"))
    const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 100)
    const offset = (page - 1) * limit
    const estado = searchParams.get("estado") || ""

    let query = supabaseAdmin
      .from("ordenes_servicio")
      .select(COLUMNS, { count: "exact" })
      .eq("organization_id", organizationId!)
      .order("fecha_ingreso", { ascending: false })
      .range(offset, offset + limit - 1)

    if (estado) query = query.eq("estado", estado)

    const { data, error: dbError, count } = await query
    if (dbError) throw dbError

    return NextResponse.json({
      data: data || [],
      total: count || 0,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit),
    })
  } catch (e) {
    console.error("v1 ordenes error:", e)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
