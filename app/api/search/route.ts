import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { sucursalParaLectura } from "@/lib/sucursal"

export async function GET(request: Request) {
  try {
    const { error, organizationId, session, role } = await requireAuth()
    if (error) return error

    const filtro = await sucursalParaLectura({
      role,
      userSucursalId: session!.user.sucursalId ?? null,
    })
    const sid = filtro.verTodas ? null : filtro.sucursalId

    const { searchParams } = new URL(request.url)
    const q = searchParams.get("q")?.trim()
    const type = searchParams.get("type") || "all"
    const limit = Math.min(parseInt(searchParams.get("limit") || "10"), 20)

    if (!q || q.length < 2) {
      return NextResponse.json({ clientes: [], ordenes: [] })
    }

    // Usar la función RPC de búsqueda unificada
    const { data, error: dbError } = await supabaseAdmin.rpc("search_all", {
      org_id: organizationId!,
      search_query: q,
      search_type: type,
      max_results: limit,
      p_sucursal_id: sid,
    })

    if (dbError) {
      // Fallback a búsqueda ILIKE si la función RPC no existe aún
      const results: { clientes: unknown[]; ordenes: unknown[] } = { clientes: [], ordenes: [] }

      if (type === "all" || type === "clientes") {
        const { data: clientes } = await supabaseAdmin
          .from("clientes")
          .select("id, nombre, telefono, email, dni")
          .eq("organization_id", organizationId!)
          .or(`nombre.ilike.%${q}%,telefono.ilike.%${q}%,email.ilike.%${q}%,dni.ilike.%${q}%`)
          .limit(limit)

        results.clientes = clientes || []
      }

      if (type === "all" || type === "ordenes") {
        let ordenesQuery = supabaseAdmin
          .from("ordenes_servicio")
          .select("id, numero_orden, dispositivo, estado, problema_reportado, marca, imei, clientes(nombre)")
          .eq("organization_id", organizationId!)
          .or(`dispositivo.ilike.%${q}%,problema_reportado.ilike.%${q}%,marca.ilike.%${q}%,imei.ilike.%${q}%`)
          .limit(limit)

        if (sid) ordenesQuery = ordenesQuery.eq("sucursal_id", sid)

        const { data: ordenes } = await ordenesQuery

        results.ordenes = (ordenes || []).map((o: Record<string, unknown>) => ({
          ...o,
          cliente_nombre: (o.clientes as Record<string, unknown>)?.nombre || null,
        }))
      }

      return NextResponse.json(results)
    }

    return NextResponse.json(data || { clientes: [], ordenes: [] })
  } catch (err) {
    console.error("Error en búsqueda:", err)
    return NextResponse.json(
      { error: "Error al buscar" },
      { status: 500 }
    )
  }
}
