import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { safeParseBody } from "@/lib/api-utils"
import { assertSucursalEnOrg } from "@/lib/sucursal"
import { ESTADOS_ACTIVOS } from "@/lib/order-states"

// Always a concrete branch: clearing it would orphan the user (CHECK from
// migration 241) and an ADMIN is never a valid target anyway.
const moverSchema = z.object({ sucursalId: z.string().trim().min(1).max(100) })

// The only roles that belong to a branch; an ADMIN picks one through the cookie.
const ROLES_CON_SUCURSAL = ["TECNICO", "VENDEDOR"]

// Appointments still to happen: the non-final states of the turnos state machine
// (app/api/turnos/[id]/route.ts); cancelado, no_show, realizado and orden_generada are done.
const ESTADOS_TURNO_PENDIENTE = ["agendado", "confirmado", "en_camino"]

interface Grupo {
  sucursalId: string | null
  sucursalNombre: string | null
  cantidad: number
}

/**
 * Loads the user a move applies to, or the response to return instead. The org
 * check is here and not in the query on purpose: a user of another organization
 * is "does not exist" (404), never a 403 that would confirm the id exists.
 */
async function cargarUsuarioMovible(id: string, organizationId: string) {
  const { data: usuario, error: readError } = await supabaseAdmin
    .from("users")
    .select("id, nombre, rol, organization_id, sucursal_id, deleted_at")
    .eq("id", id)
    .maybeSingle()
  if (readError) throw readError

  if (!usuario || usuario.organization_id !== organizationId || usuario.deleted_at) {
    return { error: NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 }) }
  }
  if (usuario.rol === "ADMIN") {
    return {
      error: NextResponse.json({ error: "Un administrador no pertenece a ninguna sucursal." }, { status: 400 }),
    }
  }
  return { usuario }
}

/** id -> nombre, for labels only: a failed lookup leaves names out instead of failing the request. */
async function nombresDeSucursales(organizationId: string, ids: string[]) {
  const nombres = new Map<string, string>()
  if (ids.length === 0) return nombres

  const { data, error } = await supabaseAdmin
    .from("sucursales")
    .select("id, nombre")
    .eq("organization_id", organizationId)
    .in("id", ids)
  if (error) {
    console.warn("[usuarios/sucursal] Could not read sucursal names:", error.message)
    return nombres
  }
  for (const s of data ?? []) nombres.set(s.id, s.nombre)
  return nombres
}

/**
 * The cash session the user opened and has not closed, if any. A non-admin can
 * only close a session of their own branch (caja/sesiones/[id]/cerrar answers
 * 404 otherwise), and that branch cannot open another while this one is ABIERTA
 * (unique index from migration 252): a move would strand the money.
 */
async function cajaAbiertaDe(userId: string, organizationId: string) {
  const { data, error } = await supabaseAdmin
    .from("sesiones_caja")
    .select("id, sucursal_id")
    .eq("organization_id", organizationId)
    .eq("usuario_apertura_id", userId)
    .eq("estado", "ABIERTA")
  if (error) throw error
  return (data ?? [])[0] as { id: string; sucursal_id: string } | undefined
}

function agruparPorSucursal(filas: Array<{ sucursal_id: string | null }> | null, nombres: Map<string, string>): Grupo[] {
  const cantidades = new Map<string | null, number>()
  for (const f of filas ?? []) {
    cantidades.set(f.sucursal_id ?? null, (cantidades.get(f.sucursal_id ?? null) ?? 0) + 1)
  }
  return [...cantidades]
    .map(([sucursalId, cantidad]) => ({
      sucursalId,
      sucursalNombre: sucursalId ? (nombres.get(sucursalId) ?? null) : null,
      cantidad,
    }))
    .sort((a, b) => {
      if (a.cantidad !== b.cantidad) return b.cantidad - a.cantidad
      if (a.sucursalNombre === b.sucursalNombre) return 0
      if (a.sucursalNombre === null) return 1
      if (b.sucursalNombre === null) return -1
      return a.sucursalNombre.localeCompare(b.sucursalNombre, "es")
    })
}

/**
 * GET /api/usuarios/[id]/sucursal — what a move would leave behind (BM-3).
 *
 * - `ordenesAbiertas`: the user's open (non-terminal) assigned orders, grouped by
 *   the branch they live in. An order's branch is not necessarily the user's (a
 *   technician working another branch's orders is a real setup), so one count
 *   would hide it.
 * - `turnosPendientes`: upcoming appointments assigned to the user, by branch.
 *   After the move the agenda only lists the new branch, so these drop out of sight.
 * - `cajaAbierta`: the cash session the user has open, if any. PUT refuses to move
 *   a user in that state.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { id } = await params
    const cargado = await cargarUsuarioMovible(id, organizationId!)
    if (cargado.error) return cargado.error
    const { usuario } = cargado

    const [ordenes, turnos, caja] = await Promise.all([
      supabaseAdmin
        .from("ordenes_servicio")
        .select("sucursal_id")
        .eq("organization_id", organizationId!)
        .eq("tecnico_id", id)
        .in("estado", ESTADOS_ACTIVOS as unknown as string[]),
      supabaseAdmin
        .from("turnos")
        .select("sucursal_id")
        .eq("organization_id", organizationId!)
        .eq("tecnico_id", id)
        .in("estado", ESTADOS_TURNO_PENDIENTE)
        .gte("inicio", new Date().toISOString()),
      cajaAbiertaDe(id, organizationId!),
    ])
    // A failed read is a 500, never an empty list: "no warning" would read as
    // "nothing to lose" and the ADMIN would confirm blind.
    if (ordenes.error) throw ordenes.error
    if (turnos.error) throw turnos.error

    const ids = new Set<string>()
    for (const f of [...(ordenes.data ?? []), ...(turnos.data ?? []), ...(caja ? [caja] : [])]) {
      if (f.sucursal_id) ids.add(f.sucursal_id)
    }
    const nombres = await nombresDeSucursales(organizationId!, [...ids])

    const ordenesAbiertas = agruparPorSucursal(ordenes.data, nombres)
    const turnosPendientes = agruparPorSucursal(turnos.data, nombres)
    const suma = (grupos: Grupo[]) => grupos.reduce((acc, g) => acc + g.cantidad, 0)

    return NextResponse.json(
      {
        usuario: { id: usuario.id, nombre: usuario.nombre, rol: usuario.rol, sucursalId: usuario.sucursal_id },
        ordenesAbiertas,
        totalOrdenesAbiertas: suma(ordenesAbiertas),
        turnosPendientes,
        totalTurnosPendientes: suma(turnosPendientes),
        cajaAbierta: caja
          ? { sesionId: caja.id, sucursalId: caja.sucursal_id, sucursalNombre: nombres.get(caja.sucursal_id) ?? null }
          : null,
      },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (err) {
    console.error("Error leyendo lo que quedaría atrás al mover al usuario:", err)
    return NextResponse.json({ error: "No pudimos leer el trabajo pendiente del usuario" }, { status: 500 })
  }
}

/**
 * PUT /api/usuarios/[id]/sucursal — move a technician or seller to another
 * active branch of the organization.
 *
 * Writes `users.sucursal_id` and nothing else:
 *  - No `invalidateRefreshToken` (unlike the role change): requireAuth() re-reads
 *    the user's branch (cached ~5 s per instance), so the move applies within a
 *    few seconds with no new login.
 *  - No `ordenes_servicio` or `turnos` write: the user keeps their assigned work
 *    wherever it is (BM-3). Moving it is a separate, explicit action.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { error, organizationId, userId } = await requireAdmin()
    if (error) return error

    const { id } = await params
    const parsed = await safeParseBody(request, moverSchema)
    if ("error" in parsed) return parsed.error
    const { sucursalId } = parsed.data

    const cargado = await cargarUsuarioMovible(id, organizationId!)
    if (cargado.error) return cargado.error
    const { usuario } = cargado

    if (usuario.sucursal_id === sucursalId) {
      return NextResponse.json({ error: `${usuario.nombre} ya está en esa sucursal.` }, { status: 400 })
    }

    // Org-scoped AND active-only: assertSucursalEnOrg alone lets an inactive
    // branch through, and a user moved there would land where nobody can select.
    if (!(await assertSucursalEnOrg(sucursalId, organizationId!, { soloActiva: true }))) {
      return NextResponse.json({ error: "La sucursal elegida no existe o está inactiva." }, { status: 400 })
    }

    const caja = await cajaAbiertaDe(id, organizationId!)
    if (caja) {
      const nombres = await nombresDeSucursales(organizationId!, [caja.sucursal_id])
      return NextResponse.json(
        {
          error: `Tiene una caja abierta en ${nombres.get(caja.sucursal_id) ?? "su sucursal actual"}. Cerrala antes de moverlo.`,
          code: "CAJA_ABIERTA",
        },
        { status: 409 }
      )
    }

    // The write is conditional on the row still being what we read: same
    // organization, still a TECNICO/VENDEDOR (not promoted to ADMIN), not deleted,
    // and still in the branch we compared against. If another request changed it
    // in between nothing matches and we answer 409 instead of overwriting.
    let actualizar = supabaseAdmin
      .from("users")
      .update({ sucursal_id: sucursalId })
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .in("rol", ROLES_CON_SUCURSAL)
      .is("deleted_at", null)
    actualizar =
      usuario.sucursal_id === null ? actualizar.is("sucursal_id", null) : actualizar.eq("sucursal_id", usuario.sucursal_id)

    const { data: escritas, error: updateError } = await actualizar.select("id")
    if (updateError) throw updateError
    if (!escritas || escritas.length === 0) {
      return NextResponse.json(
        { error: "El usuario cambió mientras tanto. Recargá e intentá de nuevo." },
        { status: 409 }
      )
    }

    const nombres = await nombresDeSucursales(
      organizationId!,
      [usuario.sucursal_id, sucursalId].filter((s): s is string => !!s)
    )
    const desde = usuario.sucursal_id ? (nombres.get(usuario.sucursal_id) ?? "su sucursal anterior") : "sin sucursal"
    const hacia = nombres.get(sucursalId) ?? "la nueva sucursal"

    // The move is already applied: a failed audit row must not turn it into an error.
    const { error: auditError } = await supabaseAdmin.from("audit_logs").insert({
      organization_id: organizationId,
      user_id: userId,
      action: "UPDATE",
      entity: "users",
      entity_id: id,
      changes: {
        field: "sucursal_id",
        before: usuario.sucursal_id,
        after: sucursalId,
        action_description: `Sucursal de "${usuario.nombre}" cambiada de ${desde} a ${hacia}`,
      },
    })
    if (auditError) console.warn("[usuarios/sucursal] Could not write the audit row:", auditError.message)

    return NextResponse.json({
      success: true,
      sucursalId,
      message: `${usuario.nombre} ahora está en ${hacia}. El cambio se aplica en unos segundos, sin volver a iniciar sesión.`,
    })
  } catch (err) {
    console.error("Error moviendo al usuario de sucursal:", err)
    return NextResponse.json({ error: "No pudimos mover al usuario de sucursal" }, { status: 500 })
  }
}
