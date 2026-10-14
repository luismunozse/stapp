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
import { createAuditLogger } from "@/lib/audit"
import { isMissingColumnError } from "@/lib/db-errors"
import { DEPOSITO_INVALIDO, depositoPermitido, depositoPorDefecto } from "@/lib/depositos"
import {
  registrarActualizacion,
  registrarArchivado,
  registrarCreacion,
  type ContextoEventos,
} from "@/lib/inventario-eventos"
import { imagenRespaldoDe } from "@/lib/variantes"
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
  const activos = hijos.filter((h) => !h.deleted_at)
  // Display-only fallback photo of a child without its own, computed in memory from the children
  // already loaded (0 queries). Archived rows never lend: only ACTIVE siblings are candidates.
  const hermanos = activos.map((h) => ({ id: h.id as string, atributos: h.atributos, foto: h.imagen_url as string | null }))
  return {
    grupo,
    variantes: activos.map((h) => {
      const hijoFormateado = formatHijo(h, canViewCost)
      if (h.imagen_url) return hijoFormateado
      const imagenRespaldo = imagenRespaldoDe(grupo.opciones, hermanos, h.id)
      return imagenRespaldo ? { ...hijoFormateado, imagenRespaldo } : hijoFormateado
    }),
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

// Events are dispatched in small AWAITED batches before the response: a serverless runtime may
// cut off what is still pending when the answer goes out, and up to ~200 un-awaited calls
// (100 rows x audit and webhook) is exactly that. The repo does not use after() from next/server.
const LOTE_EVENTOS = 10
// supabaseAdmin has no fetch timeout and the function has a hard limit (maxDuration): one hung
// lookup must not hold the answer until the platform kills it after the commit. A batch that does
// not settle within this time is abandoned (logged) and the next one goes out.
const PLAZO_LOTE_EVENTOS_MS = 3_000

type TareaEvento = (ctx: ContextoEventos) => void

/**
 * Created / updated / archived events per child of a committed save. Best-effort: it never
 * throws, a failing child does not stop the others, and it logs what it cannot do.
 * `hijos` are the rows as they are now when the group was re-read; without them (the re-read
 * failed) they are read by the ids the RPC returned.
 */
async function emitirEventosDelGrupo(p: {
  contexto: ContextoEventos
  resultado: Fila | null
  antes: Map<string, Fila>
  hijos: Fila[] | null
}): Promise<void> {
  try {
    const ids = (clave: string): string[] => (Array.isArray(p.resultado?.[clave]) ? p.resultado![clave] : [])
    const creados = ids("creados")
    const actualizados = [...ids("actualizados"), ...ids("promovidos"), ...ids("restaurados")]
    const archivados = ids("archivados")

    let filas = p.hijos
    if (!filas) {
      const pedidos = [...creados, ...actualizados, ...archivados]
      if (pedidos.length === 0) return
      const { data, error } = await supabaseAdmin
        .from("inventario")
        .select("*")
        .eq("organization_id", p.contexto.organizationId)
        .in("id", pedidos)
      if (error) throw error
      filas = data ?? []
    }
    const despues = new Map<string, Fila>(filas.map((h) => [h.id, h]))

    // `actualizados` lists every row the RPC touched even when nothing changed, so the diff
    // decides; a retry converges to no events. A row with no snapshot (it appeared between
    // the snapshot and the RPC: a double submit) has nothing to diff against: no event.
    const tareas: TareaEvento[] = []
    for (const hijoId of creados) {
      const fila = despues.get(hijoId)
      if (fila) tareas.push((ctx) => registrarCreacion(ctx, fila))
    }
    for (const hijoId of actualizados) {
      const previa = p.antes.get(hijoId)
      const fila = despues.get(hijoId)
      if (previa && fila) tareas.push((ctx) => void registrarActualizacion(ctx, previa, fila))
    }
    for (const hijoId of archivados) {
      const fila = despues.get(hijoId)
      if (fila) tareas.push((ctx) => registrarArchivado(ctx, fila))
    }

    for (let i = 0; i < tareas.length; i += LOTE_EVENTOS) {
      const esperar: Promise<unknown>[] = []
      for (const tarea of tareas.slice(i, i + LOTE_EVENTOS)) {
        try {
          tarea({ ...p.contexto, esperar })
        } catch (tareaError) {
          console.error("Error emitiendo un evento del grupo:", tareaError)
        }
      }
      let temporizador: ReturnType<typeof setTimeout> | undefined
      const plazo = new Promise<"plazo">((resolver) => {
        temporizador = setTimeout(() => resolver("plazo"), PLAZO_LOTE_EVENTOS_MS)
      })
      const resultado = await Promise.race([Promise.allSettled(esperar).then(() => "listo" as const), plazo])
      clearTimeout(temporizador)
      if (resultado === "plazo") {
        console.error(`Los eventos del grupo no terminaron a tiempo (${PLAZO_LOTE_EVENTOS_MS} ms): se sigue sin esperarlos`)
      }
    }
  } catch (eventosError) {
    console.error("Error emitiendo los eventos del grupo:", eventosError)
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

    // Snapshot BEFORE the RPC, scoped by organization: the audit diff and the events of
    // existing rows compare against it, and it tells which rows are new.
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

    // Initial-stock depot. The RPC takes stock_inicial from NEW rows only (an existing, restored
    // or promoted row ignores it, and the depot is re-validated just for the new ones), so only a
    // new row (an id the snapshot does not have) with stock makes the route resolve it: an edit
    // of existing rows neither pays the queries nor 400s on a stale depositoId.
    // When it is needed: an explicit one the caller may use, else the default of their branch
    // (null lets the RPC use the principal depot).
    const generaStock = datos.variantes.some((v) => (v.stockInicial ?? 0) > 0 && !antes.has(v.id))
    let depositoInicial: string | null = null
    if (generaStock) {
      const userSucursalId = session!.user.sucursalId ?? null
      if (datos.depositoId) {
        const permitido = await depositoPermitido({ depositoId: datos.depositoId, organizationId: organizationId!, role, userSucursalId })
        if (!permitido) return NextResponse.json({ error: DEPOSITO_INVALIDO, code: "DEPOSITO_INVALIDO" }, { status: 400 })
        depositoInicial = datos.depositoId
      } else {
        depositoInicial = await depositoPorDefecto({ organizationId: organizationId!, role, userSucursalId })
      }
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

    // The save is committed: the catalog cache must not wait for what comes next. If the
    // invalidation itself throws, that is logged and nothing else changes.
    try {
      revalidateTag("catalogo", "max")
    } catch (cacheError) {
      console.error("Error invalidando el catálogo tras guardar el grupo:", cacheError)
    }

    // From here nothing may turn a committed save into an error: the form would re-send, the
    // rows would look existing and the created events (only the first call can emit them) would
    // be lost for good. The re-read and the events are best-effort and logged.
    let lectura: LecturaGrupo | null = null
    try {
      lectura = await leerGrupo(id, organizationId!)
    } catch (relecturaError) {
      console.error("Error releyendo el grupo tras guardarlo:", relecturaError)
    }

    await emitirEventosDelGrupo({
      contexto: { organizationId: organizationId!, userId, request },
      resultado,
      antes,
      hijos: lectura?.tipo === "ok" ? lectura.hijos : null,
    })

    if (lectura && lectura.tipo !== "ok") {
      console.error(`El grupo ${id} se guardó pero no se pudo releer (${lectura.tipo})`)
    }
    if (lectura?.tipo === "ok") {
      try {
        return NextResponse.json(cuerpoDelGrupo(lectura.grupo, lectura.hijos, canViewCost))
      } catch (respuestaError) {
        console.error("Error armando la respuesta del grupo guardado:", respuestaError)
      }
    }
    // Saved, but the answer could not be built: the form re-hydrates with GET instead of re-sending.
    return NextResponse.json({ guardado: true, relectura: false, grupoId: id })
  } catch (error) {
    console.error("Error guardando grupo de variantes:", error)
    return NextResponse.json({ error: "Error al guardar las variantes" }, { status: 500 })
  }
}

// Ungroup. Only the group row is deleted: the BEFORE DELETE trigger of the group clears
// `atributos` on its children and the composite foreign key frees `grupo_id`, in the
// same statement. Names, prices, stock, codes and each child's own photo stay as they are.
export async function DELETE(request: Request, { params }: Contexto) {
  try {
    const { error, organizationId, userId } = await requireInventarioAccess()
    if (error) return error

    const { id } = await params

    const { data, error: dbError } = await supabaseAdmin
      .from("inventario_grupos")
      .delete()
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .select("id, nombre, opciones")

    if (dbError) {
      if (isMissingColumnError(dbError)) return migracionPendiente()
      throw dbError
    }
    // Nothing deleted: unknown id, another organization's group, or already ungrouped.
    if (!data || data.length === 0) {
      return NextResponse.json({ error: GRUPO_NO_ENCONTRADO }, { status: 404 })
    }

    // One entry for the group; the children keep their own history. Awaited (a serverless
    // runtime may cut off a pending write) and swallowed: the ungroup is already done.
    if (userId) {
      try {
        await createAuditLogger(organizationId!, userId, request).delete("inventario_grupos", id, {
          nombre: data[0].nombre,
          opciones: data[0].opciones,
          accion: "DESAGRUPADO",
        })
      } catch (auditoriaError) {
        console.error("Error auditando el desagrupado:", auditoriaError)
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error ungrouping variantes:", error)
    return NextResponse.json({ error: "Error al desagrupar las variantes" }, { status: 500 })
  }
}
