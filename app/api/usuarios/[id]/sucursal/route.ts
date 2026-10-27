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
 * GET /api/usuarios/[id]/sucursal — what a move would leave behind (BM-3).
 *
 * The user's open (non-terminal) assigned orders, grouped by the branch they
 * live in: an order's branch is not necessarily the user's (a technician
 * working another branch's orders is a real setup), so one count would hide it.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { id } = await params
    const cargado = await cargarUsuarioMovible(id, organizationId!)
    if (cargado.error) return cargado.error
    const { usuario } = cargado

    const { data: ordenes, error: ordenesError } = await supabaseAdmin
      .from("ordenes_servicio")
      .select("sucursal_id")
      .eq("organization_id", organizationId!)
      .eq("tecnico_id", id)
      .in("estado", ESTADOS_ACTIVOS as unknown as string[])
    // A failed read is a 500, never an empty list: "no warning" would read as
    // "nothing to lose" and the ADMIN would confirm blind.
    if (ordenesError) throw ordenesError

    const cantidades = new Map<string | null, number>()
    for (const o of ordenes ?? []) {
      cantidades.set(o.sucursal_id ?? null, (cantidades.get(o.sucursal_id ?? null) ?? 0) + 1)
    }
    const nombres = await nombresDeSucursales(
      organizationId!,
      [...cantidades.keys()].filter((k): k is string => k !== null)
    )
    const ordenesAbiertas = [...cantidades]
      .map(([sucursalId, cantidad]) => ({
        sucursalId,
        sucursalNombre: sucursalId ? (nombres.get(sucursalId) ?? null) : null,
        cantidad,
      }))
      .sort((a, b) => b.cantidad - a.cantidad)

    return NextResponse.json(
      {
        usuario: { id: usuario.id, nombre: usuario.nombre, rol: usuario.rol, sucursalId: usuario.sucursal_id },
        ordenesAbiertas,
        totalOrdenesAbiertas: ordenesAbiertas.reduce((acc, g) => acc + g.cantidad, 0),
      },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (err) {
    console.error("Error leyendo las órdenes abiertas del usuario:", err)
    return NextResponse.json({ error: "No pudimos leer las órdenes abiertas del usuario" }, { status: 500 })
  }
}

/**
 * PUT /api/usuarios/[id]/sucursal — move a technician or seller to another
 * active branch of the organization.
 *
 * Writes `users.sucursal_id` and nothing else:
 *  - No `invalidateRefreshToken` (unlike the role change): requireAuth()
 *    re-reads the branch on every non-admin request, so the user's very next
 *    request is already scoped to the new branch.
 *  - No `ordenes_servicio` write: the user keeps their assigned orders wherever
 *    they are (BM-3). Moving orders is a separate, explicit action.
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

    // The role filter closes the window between the read above and this write:
    // a user promoted to ADMIN in between is not touched.
    const { error: updateError } = await supabaseAdmin
      .from("users")
      .update({ sucursal_id: sucursalId })
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .in("rol", ROLES_CON_SUCURSAL)
    if (updateError) throw updateError

    const nombres = await nombresDeSucursales(
      organizationId!,
      [usuario.sucursal_id, sucursalId].filter((s): s is string => !!s)
    )
    const desde = usuario.sucursal_id ? (nombres.get(usuario.sucursal_id) ?? usuario.sucursal_id) : "sin sucursal"
    const hacia = nombres.get(sucursalId) ?? sucursalId

    // The move is already applied: a failed audit row must not turn it into an error.
    await supabaseAdmin.from("audit_logs").insert({
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

    return NextResponse.json({
      success: true,
      sucursalId,
      message: `${usuario.nombre} ahora está en ${hacia}. El cambio se aplica en su próxima acción, sin volver a iniciar sesión.`,
    })
  } catch (err) {
    console.error("Error moviendo al usuario de sucursal:", err)
    return NextResponse.json({ error: "No pudimos mover al usuario de sucursal" }, { status: 500 })
  }
}
