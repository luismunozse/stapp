import { NextResponse } from "next/server"
import { requireApiKey } from "@/lib/api-auth"
import { supabaseAdmin } from "@/lib/supabase"

const COLUMNS =
  "id, nombre, telefono, email, direccion, dni, tipo_cliente, razon_social, cuit, created_at"

export async function GET(request: Request) {
  const { error, organizationId } = await requireApiKey(request)
  if (error) return error

  try {
    const { searchParams } = new URL(request.url)
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"))
    const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 100)
    const offset = (page - 1) * limit
    const search = searchParams.get("search") || ""

    let query = supabaseAdmin
      .from("clientes")
      .select(COLUMNS, { count: "exact" })
      .eq("organization_id", organizationId!)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1)

    if (search) {
      query = query.or(
        `nombre.ilike.%${search}%,telefono.ilike.%${search}%,email.ilike.%${search}%`
      )
    }

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
    console.error("v1 clientes error:", e)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
