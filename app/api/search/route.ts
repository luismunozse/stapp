import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { sucursalParaLectura } from "@/lib/sucursal"
import { puedeVerTelefonoClientes } from "@/lib/telefono-cliente"
import { terminoDeBusquedaSeguro } from "@/lib/sucursal-ordenes"

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

    // Teléfono del cliente oculto para el técnico (416). `search_all` busca clientes también
    // por teléfono y lo devuelve, así que para él los clientes no pasan por la función: se
    // buscan por nombre, email y DNI, y la función solo resuelve las órdenes.
    const verTelefono = await puedeVerTelefonoClientes(role, organizationId!)
    const quiereClientes = type === "all" || type === "clientes"
    const quiereOrdenes = type === "all" || type === "ordenes"

    // Búsqueda ILIKE de clientes: el respaldo si la función no existe, y el único camino para
    // quien no ve teléfonos.
    const clientesPorIlike = async () => {
      const termino = terminoDeBusquedaSeguro(q)
      const { data: clientes } = await supabaseAdmin
        .from("clientes")
        .select(verTelefono ? "id, nombre, telefono, email, dni" : "id, nombre, email, dni")
        .eq("organization_id", organizationId!)
        .or(
          verTelefono
            ? `nombre.ilike.%${termino}%,telefono.ilike.%${termino}%,email.ilike.%${termino}%,dni.ilike.%${termino}%`
            : `nombre.ilike.%${termino}%,email.ilike.%${termino}%,dni.ilike.%${termino}%`
        )
        .limit(limit)
      const filas = (clientes || []) as unknown as Record<string, unknown>[]
      return verTelefono ? filas : filas.map((c) => ({ ...c, telefono: null }))
    }

    const ordenesPorIlike = async () => {
      const termino = terminoDeBusquedaSeguro(q)
      let ordenesQuery = supabaseAdmin
        .from("ordenes_servicio")
        .select("id, numero_orden, dispositivo, estado, problema_reportado, marca, imei, clientes(nombre)")
        .eq("organization_id", organizationId!)
        .or(`dispositivo.ilike.%${termino}%,problema_reportado.ilike.%${termino}%,marca.ilike.%${termino}%,imei.ilike.%${termino}%`)
        .limit(limit)

      if (sid) ordenesQuery = ordenesQuery.eq("sucursal_id", sid)

      const { data: ordenes } = await ordenesQuery

      return (ordenes || []).map((o: Record<string, unknown>) => ({
        ...o,
        cliente_nombre: (o.clientes as Record<string, unknown>)?.nombre || null,
      }))
    }

    // Usar la función RPC de búsqueda unificada. Quien no ve teléfonos solo le pide las órdenes.
    const tipoRpc = verTelefono ? type : "ordenes"
    const { data, error: dbError } =
      verTelefono || quiereOrdenes
        ? await supabaseAdmin.rpc("search_all", {
            org_id: organizationId!,
            search_query: q,
            search_type: tipoRpc,
            max_results: limit,
            p_sucursal_id: sid,
          })
        : { data: { ordenes: [] }, error: null }

    if (dbError) {
      // Fallback a búsqueda ILIKE si la función RPC no existe aún
      return NextResponse.json({
        clientes: quiereClientes ? await clientesPorIlike() : [],
        ordenes: quiereOrdenes ? await ordenesPorIlike() : [],
      })
    }

    if (!verTelefono) {
      return NextResponse.json({
        clientes: quiereClientes ? await clientesPorIlike() : [],
        ordenes: (data as { ordenes?: unknown[] } | null)?.ordenes ?? [],
      })
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
