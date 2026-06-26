import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { sucursalParaLectura } from "@/lib/sucursal"

export async function GET(request: Request) {
  try {
    const { error, organizationId, role, session } = await requireAuth()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const rolFilter = searchParams.get("rol")

    const filtro = await sucursalParaLectura({
      role,
      userSucursalId: session!.user.sucursalId ?? null,
    })

    let query = supabaseAdmin
      .from("users")
      .select("id, nombre, rol")
      .eq("organization_id", organizationId!)
      .eq("activo", true)
      .order("nombre", { ascending: true })

    if (rolFilter) {
      query = query.eq("rol", rolFilter)
    }

    // Operadores de la sucursal activa + ADMINs (cross-sucursal).
    // ADMIN sin cookie ('todas') => todos los de la org.
    if (!filtro.verTodas && filtro.sucursalId) {
      query = query.or(`sucursal_id.eq.${filtro.sucursalId},rol.eq.ADMIN`)
    }

    const { data, error: dbError } = await query
    if (dbError) throw dbError

    return NextResponse.json(data ?? [], {
      headers: { "Cache-Control": "no-store" },
    })
  } catch (e) {
    console.error("Error fetching operadores:", e)
    return NextResponse.json({ error: "Error al obtener operadores" }, { status: 500 })
  }
}
