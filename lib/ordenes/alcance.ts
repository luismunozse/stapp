// The door the order routes use to read an order within the actor's scope
// (change sucursales-aislamiento: XC-1, XC-2, OI-2, OI-3, BM-6).
//
// Server-only on purpose: it reads the database. The rules themselves are the pure
// `politicaOrden` in `lib/sucursal-ordenes.ts`, which client code may import.

import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { resolveTecnicosTomanOrdenes } from "@/lib/auth-utils"
import { politicaOrden, type OrdenParaPolitica, type PermisosOrden } from "@/lib/sucursal-ordenes"

/** What the route wants to do with the order. `ver` is just "it is in my scope". */
export type AccionOrden = Exclude<keyof PermisosOrden, "rol">

export interface ActorCarga {
  organizationId: string
  userId: string
  role: string
  /** The FRESH branch `requireAuth()` returned, never the JWT copy. */
  sucursalId: string | null
}

export interface OpcionesCarga {
  /** The columns and embeds the route needs. The columns the policy reads are added when `*` is not asked for. */
  select?: string
  /** The route's own "not found" text; the same text answers a missing id and an out-of-scope one. */
  noEncontrada?: string
  /** The org flag `tecnicos_toman_ordenes`, when the route already read it (saves the lookup). */
  tomaSinAsignar?: boolean
}

export type OrdenCargada = { orden: any; permisos: PermisosOrden } | { error: NextResponse }

const COLUMNAS_DE_ALCANCE = "sucursal_id, tecnico_id"

/**
 * An order has ever been derived: the audit table that answers it arrives with the derivation.
 * Until then nothing is derived, so nothing has ever been.
 */
const HA_SIDO_DERIVADA = false

/** True when a PostgREST select list has a top-level `*` (an embed's `(*)` does not count). */
function pideTodasLasColumnas(select: string): boolean {
  let nivel = 0
  let item = ""
  const items: string[] = []
  for (const c of select) {
    if (c === "(") nivel++
    if (c === ")") nivel--
    if (c === "," && nivel === 0) {
      items.push(item)
      item = ""
    } else {
      item += c
    }
  }
  items.push(item)
  return items.some((i) => i.trim() === "*")
}

function selectConColumnasDeAlcance(select: string | undefined): string {
  if (!select || select.trim() === "") return "*"
  return pideTodasLasColumnas(select) ? select : `${select}, ${COLUMNAS_DE_ALCANCE}`
}

/** The order row as the policy reads it. */
function paraPolitica(fila: Record<string, any>): OrdenParaPolitica {
  return { sucursalId: fila.sucursal_id ?? null, tecnicoId: fila.tecnico_id ?? null }
}

/**
 * The org flag `tecnicos_toman_ordenes`, read only when it can change the answer: a TECNICO,
 * an unassigned order, handled by his own branch. Fail-closed like the resolver itself.
 */
async function tomaSinAsignarDe(actor: ActorCarga, orden: OrdenParaPolitica, opciones: OpcionesCarga): Promise<boolean> {
  if (actor.role !== "TECNICO") return false
  if (opciones.tomaSinAsignar !== undefined) return opciones.tomaSinAsignar
  const atiende = orden.derivadaA ?? orden.sucursalId
  const podriaTomarla = orden.tecnicoId === null && actor.sucursalId !== null && actor.sucursalId === atiende
  return podriaTomarla ? resolveTecnicosTomanOrdenes(actor.organizationId) : false
}

/**
 * Loads an order for the actor, or says why not:
 *  - missing, in another organization, or outside the actor's scope: 404, the SAME response for
 *    all three, decided before any lookup or side effect (XC-2);
 *  - in scope but `accion` is not his to take: 403 "No autorizado".
 *
 * Success returns the row (the route's `select` plus the columns the policy needs) and the
 * permissions, so the route does not decide twice.
 */
export async function cargarOrdenEnAlcance(
  id: string,
  actor: ActorCarga,
  accion: AccionOrden,
  opciones: OpcionesCarga = {},
): Promise<OrdenCargada> {
  const noEncontrada = () =>
    NextResponse.json({ error: opciones.noEncontrada ?? "Orden no encontrada" }, { status: 404 })

  const { data, error } = await supabaseAdmin
    .from("ordenes_servicio")
    .select(selectConColumnasDeAlcance(opciones.select))
    .eq("id", id)
    .eq("organization_id", actor.organizationId)
    .single()

  if (error || !data) return { error: noEncontrada() }
  const orden = data as unknown as Record<string, any>

  const entrada = paraPolitica(orden)
  const permisos = politicaOrden(
    {
      userId: actor.userId,
      role: actor.role,
      sucursalId: actor.sucursalId,
      tomaSinAsignar: await tomaSinAsignarDe(actor, entrada, opciones),
    },
    entrada,
    HA_SIDO_DERIVADA,
  )

  if (!permisos.ver) return { error: noEncontrada() }
  if (!permisos[accion]) return { error: NextResponse.json({ error: "No autorizado" }, { status: 403 }) }
  return { orden, permisos }
}

/** The actor out of what `requireAuth()` returned (call it after the `error` check). */
export function actorDeSesion(autenticado: {
  session: { user: { sucursalId?: string | null } } | null
  organizationId: string | null
  userId: string | null
  role: string | null
}): ActorCarga {
  return {
    organizationId: autenticado.organizationId!,
    userId: autenticado.userId!,
    role: autenticado.role!,
    sucursalId: autenticado.session?.user.sucursalId ?? null,
  }
}
