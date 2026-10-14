import { NextResponse } from "next/server"
import { revalidateTag } from "next/cache"
import {
  requireAuth,
  requireInventarioAccess,
  hasInventarioAccess,
  lazyInventarioAccess,
  resolveVendedoresHabilitados,
} from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { formatInventario } from "@/lib/db-utils"
import { isMissingColumnError } from "@/lib/db-errors"
import { DEPOSITO_INVALIDO, depositoPermitido, depositoPorDefecto } from "@/lib/depositos"
import { registrarActualizacion, registrarArchivado, registrarCreacion } from "@/lib/inventario-eventos"
import { argumentosGuardarGrupo, guardarGrupoSchema } from "@/lib/variantes-schema"
import { conReintento, migracionPendiente, respuestaDeError, respuestaDeValidacion } from "@/lib/variantes-api"

type Contexto = { params: Promise<{ id: string }> }
type Fila = Record<string, any>

const GRUPO_NO_ENCONTRADO = "Grupo no encontrado"

// A role without cost access gets NO precioCompra key (not even null): formatInventario
// emits `precioCompra: null` for it, which this endpoint drops.
function formatHijo(row: unknown, canViewCost: boolean) {
  const { precioCompra, ...resto } = formatInventario(row, canViewCost)!
  return canViewCost ? { ...resto, precioCompra } : resto
}

type LecturaGrupo =
  | { tipo: "ok"; grupo: Fila; hijos: Fila[] }
  | { tipo: "no_encontrado" }
  | { tipo: "pendiente" }

// The group and ALL its children (active and archived) in two queries, both scoped by
// organization. GET answers with them and PUT re-reads them after the save, so both
// answer with the same shape. "pendiente" = migration 355 is not applied.
async function leerGrupo(id: string, organizationId: string): Promise<LecturaGrupo> {
  const { data: grupo, error: grupoError } = await supabaseAdmin
    .from("inventario_grupos")
    .select("id, nombre, opciones")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle()

  if (grupoError) {
    if (isMissingColumnError(grupoError)) return { tipo: "pendiente" }
    throw grupoError
  }
  // Another organization's group looks exactly like a missing one.
  if (!grupo) return { tipo: "no_encontrado" }

  // Active and archived children in one query, split by the caller. Oldest first, ties by
  // id: the children of one RPC save share created_at (the transaction NOW()), so within a
  // save the order is by id, not creation order. The form lays the rows out from the
  // group options, not from this order.
  const { data: hijos, error: hijosError } = await supabaseAdmin
    .from("inventario")
    .select("*, proveedores:proveedor_id(id, nombre)")
    .eq("grupo_id", id)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })

  if (hijosError) {
    if (isMissingColumnError(hijosError)) return { tipo: "pendiente" }
    throw hijosError
  }
  return { tipo: "ok", grupo, hijos: hijos ?? [] }
}

function cuerpoDelGrupo(grupo: Fila, hijos: Fila[], canViewCost: boolean) {
  return {
    grupo,
    variantes: hijos.filter((h) => !h.deleted_at).map((h) => formatHijo(h, canViewCost)),
    archivadas: hijos
      .filter((h) => h.deleted_at)
      .map((h) => ({ id: h.id, atributos: h.atributos ?? null, stock: h.stock })),
  }
}

export async function GET(_request: Request, { params }: Contexto) {
  try {
    const { error, organizationId, role } = await requireAuth()
    if (error) return error

    const { id } = await params

    const lectura = await leerGrupo(id, organizationId!)
    if (lectura.tipo === "pendiente") return migracionPendiente()
    if (lectura.tipo === "no_encontrado") return NextResponse.json({ error: GRUPO_NO_ENCONTRADO }, { status: 404 })

    const vendedoresHabilitados = role === "VENDEDOR"
      ? await resolveVendedoresHabilitados(organizationId!)
      : false
    const canViewCost = hasInventarioAccess(role, vendedoresHabilitados)

    return NextResponse.json(cuerpoDelGrupo(lectura.grupo, lectura.hijos, canViewCost))
  } catch (error) {
    console.error("Error fetching grupo de variantes:", error)
    return NextResponse.json({ error: "Error al obtener el grupo" }, { status: 500 })
  }
}

// Create or edit a group in ONE atomic RPC call: the group row, its variants (by client id),
// the shared fields, the initial stock of NEW variants, archive and restore. The save is
// FULL-STATE (every active member must be in the payload) and last-write-wins: there is no
// version check, see lib/variantes-api.ts. A deadlock is retried once there.
//
// The organization, the user and the group id come from the session and the URL, never from
// the body (the schema is strict). A role without cost access never sends precio_compra.
export async function PUT(request: Request, { params }: Contexto) {
  try {
    const { error, organizationId, userId, role, session } = await requireInventarioAccess()
    if (error) return error

    const { id } = await params

    let cuerpo: unknown
    try {
      cuerpo = await request.json()
    } catch {
      return NextResponse.json({ error: "El pedido no es un JSON válido", code: "PAYLOAD_INVALIDO" }, { status: 400 })
    }
    const validado = guardarGrupoSchema.safeParse(cuerpo)
    if (!validado.success) return respuestaDeValidacion(validado.error)
    const datos = validado.data

    // The guard above already limits this route to roles with inventory access, which today
    // are the roles with cost access. The gate is resolved again on purpose: if the guard is
    // ever relaxed, a role without cost still cannot write or read purchase prices here.
    const canViewCost = await lazyInventarioAccess(role, organizationId!)()

    // Initial-stock depot: an explicit one the caller may use, else the default of their
    // branch (null lets the RPC use the principal depot).
    const userSucursalId = session!.user.sucursalId ?? null
    let depositoInicial: string | null
    if (datos.depositoId) {
      const permitido = await depositoPermitido({ depositoId: datos.depositoId, organizationId: organizationId!, role, userSucursalId })
      if (!permitido) return NextResponse.json({ error: DEPOSITO_INVALIDO, code: "DEPOSITO_INVALIDO" }, { status: 400 })
      depositoInicial = datos.depositoId
    } else {
      depositoInicial = await depositoPorDefecto({ organizationId: organizationId!, role, userSucursalId })
    }

    // Snapshot BEFORE the RPC, scoped by organization: the audit diff and the events of
    // existing rows compare against it.
    const idsPedidos = [...datos.variantes.map((v) => v.id), ...(datos.archivar ?? [])]
    const antes = new Map<string, Fila>()
    if (idsPedidos.length > 0) {
      const { data: previas, error: previasError } = await supabaseAdmin
        .from("inventario")
        .select("*")
        .eq("organization_id", organizationId!)
        .in("id", idsPedidos)
      if (previasError) throw previasError
      for (const fila of previas ?? []) antes.set(fila.id, fila)
    }

    const args = argumentosGuardarGrupo({
      organizationId: organizationId!,
      userId: userId ?? null,
      grupoId: id,
      depositoInicial,
      canViewCost,
      datos,
    })
    const { data: resultado, error: rpcError } = await conReintento(() =>
      supabaseAdmin.rpc("guardar_grupo_variantes", args)
    )
    if (rpcError) {
      const respuesta = respuestaDeError(rpcError)
      if (respuesta) return respuesta
      throw rpcError
    }

    // The save is committed: the catalog cache must not wait for what comes next.
    revalidateTag("catalogo", "max")

    const lectura = await leerGrupo(id, organizationId!)
    if (lectura.tipo !== "ok") throw new Error(`El grupo ${id} se guardó pero no se pudo releer (${lectura.tipo})`)

    // Events per child, from the rows as they are now. `actualizados` lists every row the
    // RPC touched even when nothing changed, so the diff decides; a retry converges to no events.
    const despues = new Map<string, Fila>(lectura.hijos.map((h) => [h.id, h]))
    const ids = (clave: string): string[] => (Array.isArray(resultado?.[clave]) ? resultado[clave] : [])
    const eventos = { organizationId: organizationId!, userId, request }
    for (const hijoId of ids("creados")) {
      const fila = despues.get(hijoId)
      if (fila) registrarCreacion(eventos, fila)
    }
    for (const hijoId of [...ids("actualizados"), ...ids("promovidos"), ...ids("restaurados")]) {
      const previa = antes.get(hijoId)
      const fila = despues.get(hijoId)
      if (previa && fila) registrarActualizacion(eventos, previa, fila)
    }
    for (const hijoId of ids("archivados")) {
      const fila = despues.get(hijoId)
      if (fila) registrarArchivado(eventos, fila)
    }

    return NextResponse.json(cuerpoDelGrupo(lectura.grupo, lectura.hijos, canViewCost))
  } catch (error) {
    console.error("Error guardando grupo de variantes:", error)
    return NextResponse.json({ error: "Error al guardar las variantes" }, { status: 500 })
  }
}

// Ungroup. Only the group row is deleted: the BEFORE DELETE trigger of the group clears
// `atributos` on its children and the composite foreign key frees `grupo_id`, in the
// same statement. Names, prices, stock, codes and each child's own photo stay as they are.
export async function DELETE(_request: Request, { params }: Contexto) {
  try {
    const { error, organizationId } = await requireInventarioAccess()
    if (error) return error

    const { id } = await params

    const { data, error: dbError } = await supabaseAdmin
      .from("inventario_grupos")
      .delete()
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .select("id")

    if (dbError) {
      if (isMissingColumnError(dbError)) return migracionPendiente()
      throw dbError
    }
    // Nothing deleted: unknown id, another organization's group, or already ungrouped.
    if (!data || data.length === 0) {
      return NextResponse.json({ error: GRUPO_NO_ENCONTRADO }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error ungrouping variantes:", error)
    return NextResponse.json({ error: "Error al desagrupar las variantes" }, { status: 500 })
  }
}
