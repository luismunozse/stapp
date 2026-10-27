import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { sucursalParaLectura } from "@/lib/sucursal"
import { alcanceLecturaOrdenes, type ActorLectura } from "@/lib/ordenes/alcance-lectura"
import { combinarOr, filtroVisibleEnSucursal, terminoDeBusquedaSeguro } from "@/lib/sucursal-ordenes"

const COLUMNAS_ORDEN = "id, numero_orden, dispositivo, estado, problema_reportado, marca, imei, clientes(nombre)"

/** The most words of a term that count: a long text cannot build an unbounded filter. */
const MAX_PALABRAS = 6

/** The words of a term, in order, without the blanks, up to MAX_PALABRAS. */
function palabrasDe(q: string): string[] {
  return q.split(/\s+/).filter((palabra) => palabra !== "").slice(0, MAX_PALABRAS)
}

/**
 * The conditions that make an order match ONE word: the text columns the `search_all` function looks
 * at (device, reported problem, IMEI) and the exact order number, plus the brand, the order code and the
 * diagnosis and notes that feed its `search_vector`. The function matches that vector by stemmed words
 * (`@@`), which an ILIKE cannot reproduce (and the in-memory table cannot parse an `fts` operator), so a
 * word matches here as a substring of the same columns. The function also ANDs the words of a term
 * (`plainto_tsquery`): a term of several words is one list per word (see ordenesDelTecnico), not one
 * substring. The word is sanitized (a comma or a parenthesis would close the group around the scope and
 * add a clause next to it).
 */
function coincidencias(q: string): string {
  const termino = terminoDeBusquedaSeguro(q)
  const lista = [
    `dispositivo.ilike.%${termino}%`,
    `problema_reportado.ilike.%${termino}%`,
    `marca.ilike.%${termino}%`,
    `imei.ilike.%${termino}%`,
    `codigo_orden.ilike.%${termino}%`,
    `diagnostico.ilike.%${termino}%`,
    `observaciones.ilike.%${termino}%`,
  ]
  if (/^\d{1,9}$/.test(q)) lista.push(`numero_orden.eq.${q}`)
  return lista.join(",")
}

type ResultadoOrden = { id: string; [campo: string]: unknown }

function aResultado(o: Record<string, unknown>): ResultadoOrden {
  return { ...o, id: o.id as string, cliente_nombre: (o.clientes as Record<string, unknown> | null)?.nombre || null }
}

/**
 * The orders that match a term inside a technician's list scope (what the list shows him: what is assigned
 * to him from any branch, BM-6, and with the org opt-in the unassigned ones of his branch, OI-3). The
 * `search_all` function scopes by branch only, so for a technician its order rows would include the ones
 * assigned to a colleague of his branch, which he cannot open. Like the function, every word of the term
 * has to match (in any column, in any order): one list per word, ANDed with the scope by the door inside
 * ONE `or()`, so no word can widen the scope.
 */
async function ordenesDelTecnico(actor: ActorLectura, q: string, limit: number): Promise<ResultadoOrden[]> {
  const alcance = await alcanceLecturaOrdenes(actor)
  const { data } = await alcance
    .aplicar(supabaseAdmin.from("ordenes_servicio").select(COLUMNAS_ORDEN).eq("organization_id", actor.organizationId), palabrasDe(q).map(coincidencias))
    .order("fecha_ingreso", { ascending: false })
    .limit(limit)
  return (data || []).map(aResultado)
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
    // A technician's orders come from his list scope, not from the function's branch-wide rows.
    const deTecnico =
      role === "TECNICO" && buscaOrdenes
        ? await ordenesDelTecnico({ organizationId: organizationId!, userId: userId!, role, sucursalId: session!.user.sucursalId ?? null }, q, limit)
        : null
    if (deTecnico && type === "ordenes") return NextResponse.json({ clientes: [], ordenes: deTecnico })

    // Usar la función RPC de búsqueda unificada (a technician only asks it for clients)
    const { data, error: dbError } = await supabaseAdmin.rpc("search_all", {
      org_id: organizationId!,
      search_query: q,
      search_type: deTecnico ? "clientes" : type,
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

      if (deTecnico) {
        results.ordenes = deTecnico
      } else if (buscaOrdenes) {
        // The branch and the term are ONE expression, so the term can never widen the branch.
        const { data: ordenes } = await supabaseAdmin
          .from("ordenes_servicio")
          .select(COLUMNAS_ORDEN)
          .eq("organization_id", organizationId!)
          .or(combinarOr(sid ? filtroVisibleEnSucursal(sid) : "", coincidencias(q)))
          .limit(limit)

        results.ordenes = (ordenes || []).map(aResultado)
      }

      return NextResponse.json(results)
    }

    const encontrado = data || { clientes: [], ordenes: [] }
    return NextResponse.json(deTecnico ? { ...encontrado, ordenes: deTecnico } : encontrado)
  } catch (err) {
    console.error("Error en búsqueda:", err)
    return NextResponse.json(
      { error: "Error al buscar" },
      { status: 500 }
    )
  }
}
