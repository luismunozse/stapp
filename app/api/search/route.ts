import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { sucursalParaLectura } from "@/lib/sucursal"
import { combinarOr, filtroVisibleEnSucursal, terminoDeBusquedaSeguro } from "@/lib/sucursal-ordenes"

const COLUMNAS_ORDEN = "id, numero_orden, dispositivo, estado, problema_reportado, marca, imei, clientes(nombre)"

/**
 * The conditions that make an order match a term, the way the search function does: its text columns
 * and the exact order number. The term is sanitized (a comma or a parenthesis would close the group
 * around the branch scope and add a clause next to it).
 */
function coincidencias(q: string): string {
  const termino = terminoDeBusquedaSeguro(q)
  const lista = [
    `dispositivo.ilike.%${termino}%`,
    `problema_reportado.ilike.%${termino}%`,
    `marca.ilike.%${termino}%`,
    `imei.ilike.%${termino}%`,
  ]
  if (/^\d{1,9}$/.test(q)) lista.push(`numero_orden.eq.${q}`)
  return lista.join(",")
}

type ResultadoOrden = { id: string; [campo: string]: unknown }

function aResultado(o: Record<string, unknown>): ResultadoOrden {
  return { ...o, id: o.id as string, cliente_nombre: (o.clientes as Record<string, unknown> | null)?.nombre || null }
}

/** The orders assigned to a technician that match the term, from any branch (BM-6). */
async function ordenesAsignadas(organizationId: string, tecnicoId: string, q: string, limit: number): Promise<ResultadoOrden[]> {
  const { data } = await supabaseAdmin
    .from("ordenes_servicio")
    .select(COLUMNAS_ORDEN)
    .eq("organization_id", organizationId)
    .eq("tecnico_id", tecnicoId)
    .or(coincidencias(q))
    .limit(limit)
  return (data || []).map(aResultado)
}

/** His own orders first, then what the branch search found, once each, up to the limit. */
function unirAsignadas(propias: Array<{ id: string }>, asignadas: Array<{ id: string }>, limit: number) {
  const vistas = new Set(asignadas.map((o) => o.id))
  return [...asignadas, ...propias.filter((o) => !vistas.has(o.id))].slice(0, limit)
}

export async function GET(request: Request) {
  try {
    const { error, organizationId, userId, session, role } = await requireAuth()
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

    const buscaOrdenes = type === "all" || type === "ordenes"
    // A technician also finds what is assigned to him in another branch.
    const asignadas = role === "TECNICO" && buscaOrdenes ? await ordenesAsignadas(organizationId!, userId!, q, limit) : []

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
      const termino = terminoDeBusquedaSeguro(q)

      if (type === "all" || type === "clientes") {
        const { data: clientes } = await supabaseAdmin
          .from("clientes")
          .select("id, nombre, telefono, email, dni")
          .eq("organization_id", organizationId!)
          .or(`nombre.ilike.%${termino}%,telefono.ilike.%${termino}%,email.ilike.%${termino}%,dni.ilike.%${termino}%`)
          .limit(limit)

        results.clientes = clientes || []
      }

      if (buscaOrdenes) {
        // The branch and the term are ONE expression, so the term can never widen the branch.
        const { data: ordenes } = await supabaseAdmin
          .from("ordenes_servicio")
          .select(COLUMNAS_ORDEN)
          .eq("organization_id", organizationId!)
          .or(combinarOr(sid ? filtroVisibleEnSucursal(sid) : "", coincidencias(q)))
          .limit(limit)

        results.ordenes = unirAsignadas((ordenes || []).map(aResultado), asignadas, limit)
      }

      return NextResponse.json(results)
    }

    const encontrado = data || { clientes: [], ordenes: [] }
    if (!buscaOrdenes) return NextResponse.json(encontrado)
    return NextResponse.json({
      ...encontrado,
      ordenes: unirAsignadas((encontrado.ordenes ?? []) as ResultadoOrden[], asignadas, limit),
    })
  } catch (err) {
    console.error("Error en búsqueda:", err)
    return NextResponse.json(
      { error: "Error al buscar" },
      { status: 500 }
    )
  }
}
