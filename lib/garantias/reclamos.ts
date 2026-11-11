/**
 * Reclamos de garantía, de reparación y de venta (migración 401).
 *
 *   registrarReclamo   cualquier rol, sobre una garantía de su alcance.
 *   decidirReclamo     solo ADMIN: aceptar (crea el re-ingreso) o rechazar (con motivo).
 *   aceptarReclamo     EL camino único al re-ingreso: lo usan aceptar un
 *                      reclamo y el atajo "Re-ingreso por garantía" del menú.
 *   reingresoDesdeOrden  el atajo del menú: registra el reclamo (o toma el
 *                      que ya estaba abierto) y lo acepta en un paso.
 *
 * El RESUELTO no pasa por acá: lo pone un trigger al entregar el re-ingreso.
 * La garantía se lee de v_garantias, que ya trae el alcance (sucursal,
 * técnico, origen), el día de vencimiento en la zona de la org y el reclamo
 * abierto; las órdenes de práctica no están en la vista.
 */
import { supabaseAdmin } from "@/lib/supabase"
import { type AlcanceOrdenes } from "@/lib/ordenes/alcance-lectura"
import { diaCalendario } from "./estado"
import { ErrorReclamo } from "./errores"
import { formatReclamos, type ReclamoGarantiaApi, type ReclamoGarantiaRow } from "./formato"
import {
  COLUMNAS_VISTA_GARANTIAS,
  aplicarAlcanceGarantias,
  leerConfigOrg,
  mapearFilaGarantia,
  type ActorGarantias,
  type FilaVistaGarantia,
  type GarantiaListada,
} from "./listado"
import { ESTADOS_RECLAMO_ABIERTO, ESTADOS_RECLAMO_POR_DECIDIR, faseReclamo, reclamoPorDecidir } from "./reclamo-estado"
import { crearOrdenReingreso, type OrdenReingreso } from "./reingreso"
import type { OrigenGarantia } from "./estado"

export const COLUMNAS_RECLAMO =
  "id, garantia_id, garantia_venta_id, organization_id, descripcion, estado, orden_reingreso_id, " +
  "orden_reparacion_id, resolucion, motivo_rechazo, vigencia_forzada_motivo, registrado_por, decidido_por, " +
  "fecha_reclamo, fecha_decision, fecha_resolucion"

export type FilaReclamo = ReclamoGarantiaRow & { organization_id: string }

export interface Actor {
  userId: string
  role: string
}

const UNIQUE_VIOLATION = "23505"
const MOTIVO_MAX = 1000

const fechaCorta = (dia: string) => dia.split("-").reverse().join("/")

/** La garantía, si existe en la org y en el alcance de quien pide. Si no, 404. */
export async function leerGarantiaEnAlcance(
  organizationId: string,
  origen: OrigenGarantia,
  garantiaId: string,
  alcance: AlcanceOrdenes
): Promise<FilaVistaGarantia> {
  let query: any = supabaseAdmin
    .from("v_garantias")
    .select(COLUMNAS_VISTA_GARANTIAS)
    .eq("organization_id", organizationId)
    .eq("origen", origen)
    .eq("id", garantiaId)
  query = aplicarAlcanceGarantias(query, alcance)
  const { data, error } = await query.maybeSingle()
  if (error) throw error
  if (!data) throw new ErrorReclamo(404, "GARANTIA_NO_ENCONTRADA", "Garantía no encontrada")
  return data as FilaVistaGarantia
}

export interface ParametrosRegistro {
  organizationId: string
  actor: Actor
  alcance: AlcanceOrdenes
  origen: OrigenGarantia
  garantiaId: string
  descripcion: string
  /** Solo ADMIN: registrar sobre una garantía vencida, con el motivo. */
  motivoFueraDeVigencia?: string | null
  ahora?: Date
}

/**
 * Registra un reclamo ABIERTO (PENDIENTE). Cualquier rol; la garantía tiene que
 * estar en su alcance, no anulada, sin otro reclamo abierto y vigente. Una
 * vencida solo la reclama el ADMIN, dejando el motivo.
 */
export async function registrarReclamo(p: ParametrosRegistro): Promise<{ reclamo: FilaReclamo; garantia: FilaVistaGarantia }> {
  const descripcion = p.descripcion.trim()
  if (!descripcion) throw new ErrorReclamo(400, "DESCRIPCION_REQUERIDA", "Contá qué problema tiene el equipo o producto.")

  const garantia = await leerGarantiaEnAlcance(p.organizationId, p.origen, p.garantiaId, p.alcance)

  if (garantia.anulada) {
    throw new ErrorReclamo(409, "GARANTIA_ANULADA", "La garantía está anulada: no admite reclamos.")
  }
  if (garantia.tiene_reclamo_abierto) {
    throw new ErrorReclamo(409, "RECLAMO_DUPLICADO", "Esta garantía ya tiene un reclamo abierto.", {
      reclamoId: garantia.reclamo_id ?? null,
    })
  }

  const motivo = p.motivoFueraDeVigencia?.trim().slice(0, MOTIVO_MAX) || null
  const { zonaHoraria } = await leerConfigOrg(p.organizationId)
  const hoy = diaCalendario(p.ahora ?? new Date(), zonaHoraria)
  const vencida = garantia.dia_vencimiento < hoy
  if (vencida) {
    const cuando = `La garantía venció el ${fechaCorta(garantia.dia_vencimiento)}.`
    if (p.actor.role !== "ADMIN") {
      throw new ErrorReclamo(
        400,
        "GARANTIA_VENCIDA",
        `${cuando} Solo un administrador puede registrar el reclamo igual.`,
        { requiereMotivo: false }
      )
    }
    if (!motivo) {
      throw new ErrorReclamo(400, "GARANTIA_VENCIDA", `${cuando} Para registrar el reclamo igual, dejá un motivo.`, {
        requiereMotivo: true,
      })
    }
  }

  const { data, error } = await supabaseAdmin
    .from("reclamos_garantia")
    .insert({
      garantia_id: p.origen === "REPARACION" ? garantia.id : null,
      garantia_venta_id: p.origen === "VENTA" ? garantia.id : null,
      descripcion: descripcion.slice(0, 2000),
      estado: "PENDIENTE",
      registrado_por: p.actor.userId,
      vigencia_forzada_motivo: vencida ? motivo : null,
    })
    .select(COLUMNAS_RECLAMO)
    .single()

  if (error) {
    // El índice único parcial de la 401: alguien registró otro en paralelo.
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
      throw new ErrorReclamo(409, "RECLAMO_DUPLICADO", "Esta garantía ya tiene un reclamo abierto.")
    }
    throw error
  }
  return { reclamo: data as unknown as FilaReclamo, garantia }
}

async function leerReclamo(organizationId: string, reclamoId: string): Promise<FilaReclamo> {
  const { data, error } = await supabaseAdmin
    .from("reclamos_garantia")
    .select(COLUMNAS_RECLAMO)
    .eq("id", reclamoId)
    .eq("organization_id", organizationId)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new ErrorReclamo(404, "RECLAMO_NO_ENCONTRADO", "Reclamo no encontrado")
  return data as unknown as FilaReclamo
}

function origenDe(r: Pick<ReclamoGarantiaRow, "garantia_venta_id">): OrigenGarantia {
  return r.garantia_venta_id ? "VENTA" : "REPARACION"
}

function yaDecidido(r: Pick<ReclamoGarantiaRow, "estado">): ErrorReclamo {
  const fase = faseReclamo(r.estado)
  const texto =
    fase === "RECHAZADO" ? "ya fue rechazado" : fase === "RESUELTO" ? "ya está resuelto" : "ya fue aceptado"
  return new ErrorReclamo(409, "RECLAMO_YA_DECIDIDO", `Este reclamo ${texto}.`)
}

export interface ParametrosAceptar {
  organizationId: string
  actor: Actor
  reclamo: FilaReclamo
  garantia: FilaVistaGarantia
  request?: Request
}

/**
 * Acepta un reclamo y crea su re-ingreso. ÚNICO camino a una orden de
 * re-ingreso por garantía (decisión del ADMIN y atajo del menú).
 *
 * Primero toma el reclamo (PENDIENTE -> ACEPTADO, condicionado al estado: dos
 * ADMIN no lo aceptan dos veces), después crea la orden y la vincula. Si la
 * orden no se puede crear, el reclamo vuelve a PENDIENTE.
 */
export async function aceptarReclamo(p: ParametrosAceptar): Promise<{ reclamo: FilaReclamo; orden: OrdenReingreso }> {
  if (p.actor.role !== "ADMIN") {
    throw new ErrorReclamo(403, "SOLO_ADMIN", "Solo un administrador puede aceptar o rechazar reclamos.")
  }
  if (!reclamoPorDecidir(p.reclamo.estado)) throw yaDecidido(p.reclamo)

  const ahora = new Date().toISOString()
  const { data: tomado, error: errTomar } = await supabaseAdmin
    .from("reclamos_garantia")
    .update({ estado: "ACEPTADO", decidido_por: p.actor.userId, fecha_decision: ahora })
    .eq("id", p.reclamo.id)
    .eq("organization_id", p.organizationId)
    .in("estado", ESTADOS_RECLAMO_POR_DECIDIR as string[])
    .select(COLUMNAS_RECLAMO)
    .maybeSingle()
  if (errTomar) throw errTomar
  if (!tomado) throw yaDecidido({ estado: "ACEPTADO" })

  let orden: OrdenReingreso
  try {
    orden = await crearOrdenReingreso({
      organizationId: p.organizationId,
      userId: p.actor.userId,
      garantia: p.garantia,
      reclamo: { id: p.reclamo.id, descripcion: p.reclamo.descripcion },
      request: p.request,
    })
  } catch (err) {
    // Sin orden no hay aceptación: el reclamo vuelve a estar por decidir.
    await supabaseAdmin
      .from("reclamos_garantia")
      .update({ estado: "PENDIENTE", decidido_por: null, fecha_decision: null })
      .eq("id", p.reclamo.id)
      .eq("organization_id", p.organizationId)
    throw err
  }

  const { data: vinculado, error: errVincular } = await supabaseAdmin
    .from("reclamos_garantia")
    .update({ orden_reingreso_id: orden.id })
    .eq("id", p.reclamo.id)
    .eq("organization_id", p.organizationId)
    .select(COLUMNAS_RECLAMO)
    .single()
  if (errVincular) throw errVincular

  return { reclamo: vinculado as unknown as FilaReclamo, orden }
}

export interface ParametrosDecision {
  organizationId: string
  actor: Actor
  reclamoId: string
  accion: "aceptar" | "rechazar"
  motivo?: string | null
  request?: Request
}

/** Aceptar (crea el re-ingreso) o rechazar (con motivo). Solo ADMIN. */
export async function decidirReclamo(
  p: ParametrosDecision
): Promise<{ reclamo: FilaReclamo; orden: OrdenReingreso | null }> {
  if (p.actor.role !== "ADMIN") {
    throw new ErrorReclamo(403, "SOLO_ADMIN", "Solo un administrador puede aceptar o rechazar reclamos.")
  }
  const reclamo = await leerReclamo(p.organizationId, p.reclamoId)
  if (!reclamoPorDecidir(reclamo.estado)) throw yaDecidido(reclamo)

  if (p.accion === "rechazar") {
    const motivo = p.motivo?.trim().slice(0, MOTIVO_MAX)
    if (!motivo) throw new ErrorReclamo(400, "MOTIVO_REQUERIDO", "Contá por qué se rechaza el reclamo.")
    const ahora = new Date().toISOString()
    const { data, error } = await supabaseAdmin
      .from("reclamos_garantia")
      .update({
        estado: "RECHAZADO",
        motivo_rechazo: motivo,
        decidido_por: p.actor.userId,
        fecha_decision: ahora,
        fecha_resolucion: ahora,
      })
      .eq("id", reclamo.id)
      .eq("organization_id", p.organizationId)
      .in("estado", ESTADOS_RECLAMO_POR_DECIDIR as string[])
      .select(COLUMNAS_RECLAMO)
      .maybeSingle()
    if (error) throw error
    if (!data) throw yaDecidido({ estado: "RECHAZADO" })
    return { reclamo: data as unknown as FilaReclamo, orden: null }
  }

  // El ADMIN ve todas las sucursales cuando abre algo por id.
  const garantia = await leerGarantiaEnAlcance(
    p.organizationId,
    origenDe(reclamo),
    (reclamo.garantia_id ?? reclamo.garantia_venta_id) as string,
    { tipo: "todas" }
  )
  return aceptarReclamo({ organizationId: p.organizationId, actor: p.actor, reclamo, garantia, request: p.request })
}

export interface ParametrosReingresoOrden {
  organizationId: string
  actor: Actor
  ordenId: string
  descripcion: string
  motivoFueraDeVigencia?: string | null
  request?: Request
  ahora?: Date
}

/**
 * Atajo del menú "Re-ingreso por garantía": registra el reclamo sobre la
 * garantía de la orden y lo acepta en un paso (solo ADMIN). Si la garantía ya
 * tenía un reclamo por decidir, acepta ese. Valida la vigencia como cualquier
 * reclamo: vencida, solo con motivo.
 */
export async function reingresoDesdeOrden(
  p: ParametrosReingresoOrden
): Promise<{ reclamo: FilaReclamo; orden: OrdenReingreso }> {
  if (p.actor.role !== "ADMIN") {
    throw new ErrorReclamo(403, "SOLO_ADMIN", "Solo un administrador puede crear un re-ingreso por garantía.")
  }
  const { data: g, error } = await supabaseAdmin
    .from("garantias")
    .select("id")
    .eq("orden_id", p.ordenId)
    .eq("organization_id", p.organizationId)
    .maybeSingle()
  if (error) throw error
  if (!g) {
    throw new ErrorReclamo(
      409,
      "SIN_GARANTIA",
      "Esta orden no tiene garantía registrada. Creala desde la tarjeta de garantía para poder registrar el re-ingreso."
    )
  }

  const garantia = await leerGarantiaEnAlcance(p.organizationId, "REPARACION", g.id as string, { tipo: "todas" })

  // Ya había un reclamo abierto: si está por decidir se acepta ese; si ya
  // tiene el re-ingreso en curso, no se crea otro.
  if (garantia.tiene_reclamo_abierto && garantia.reclamo_id) {
    if (!reclamoPorDecidir(garantia.reclamo_estado)) {
      throw new ErrorReclamo(409, "REINGRESO_EN_CURSO", "Esta garantía ya tiene un re-ingreso en curso.", {
        ordenReingresoId: garantia.reclamo_orden_reingreso_id ?? null,
      })
    }
    const reclamo = await leerReclamo(p.organizationId, garantia.reclamo_id)
    return aceptarReclamo({ organizationId: p.organizationId, actor: p.actor, reclamo, garantia, request: p.request })
  }

  const { reclamo } = await registrarReclamo({
    organizationId: p.organizationId,
    actor: p.actor,
    alcance: { tipo: "todas" },
    origen: "REPARACION",
    garantiaId: garantia.id,
    descripcion: p.descripcion,
    motivoFueraDeVigencia: p.motivoFueraDeVigencia,
    ahora: p.ahora,
  })
  return aceptarReclamo({ organizationId: p.organizationId, actor: p.actor, reclamo, garantia, request: p.request })
}

export interface GarantiaConReclamos extends GarantiaListada {
  reclamos: ReclamoGarantiaApi[]
}

/**
 * Las garantías de una orden o una venta (en el alcance de quien mira) con su
 * estado derivado y la línea de tiempo de reclamos. La usan la tarjeta de
 * garantía de la orden y los certificados del detalle de venta.
 */
export async function garantiasConReclamos(p: {
  organizationId: string
  alcance: AlcanceOrdenes
  actor: ActorGarantias
  ordenId?: string | null
  ventaId?: string | null
  ahora?: Date
}): Promise<GarantiaConReclamos[]> {
  if (!p.ordenId && !p.ventaId) return []
  let query: any = supabaseAdmin
    .from("v_garantias")
    .select(COLUMNAS_VISTA_GARANTIAS)
    .eq("organization_id", p.organizationId)
  query = p.ventaId ? query.eq("origen", "VENTA").eq("venta_id", p.ventaId) : query.eq("origen", "REPARACION").eq("orden_id", p.ordenId)
  query = aplicarAlcanceGarantias(query, p.alcance)
  const { data, error } = await query
  if (error) throw error
  const filas = (data ?? []) as FilaVistaGarantia[]
  if (filas.length === 0) return []

  const ids = filas.map((f) => f.id)
  const { data: rows, error: errReclamos } = await supabaseAdmin
    .from("reclamos_garantia")
    .select(COLUMNAS_RECLAMO)
    .eq("organization_id", p.organizationId)
    .in(p.ventaId ? "garantia_venta_id" : "garantia_id", ids)
  if (errReclamos) throw errReclamos
  const reclamos = (rows ?? []) as unknown as FilaReclamo[]

  const ordenIds = [...new Set(reclamos.map((r) => r.orden_reingreso_id ?? r.orden_reparacion_id).filter((v): v is string => !!v))]
  const userIds = [...new Set(reclamos.flatMap((r) => [r.registrado_por, r.decidido_por]).filter((v): v is string => !!v))]
  const [ordenesR, usersR] = await Promise.all([
    ordenIds.length
      ? supabaseAdmin
          .from("ordenes_servicio")
          .select("id, numero_orden, codigo_orden")
          .eq("organization_id", p.organizationId)
          .in("id", ordenIds)
      : Promise.resolve({ data: [] as unknown[] }),
    userIds.length
      ? supabaseAdmin.from("users").select("id, nombre").eq("organization_id", p.organizationId).in("id", userIds)
      : Promise.resolve({ data: [] as unknown[] }),
  ])
  const numerosOrden = new Map(
    ((ordenesR.data ?? []) as { id: string; numero_orden: number; codigo_orden: string | null }[]).map((o) => [
      o.id,
      o.codigo_orden || `#${o.numero_orden}`,
    ])
  )
  const nombresUsuario = new Map(
    ((usersR.data ?? []) as { id: string; nombre: string | null }[]).map((u) => [u.id, u.nombre ?? ""])
  )

  const org = await leerConfigOrg(p.organizationId)
  const hoy = diaCalendario(p.ahora ?? new Date(), org.zonaHoraria)
  const ctx = { hoy, ventana: 7, org, actor: p.actor, sucursales: new Map<string, string>() }
  return filas.map((f) => ({
    ...mapearFilaGarantia(f, ctx),
    reclamos: formatReclamos(
      reclamos.filter((r) => (r.garantia_id ?? r.garantia_venta_id) === f.id),
      { numerosOrden, nombresUsuario }
    ),
  }))
}

export { ESTADOS_RECLAMO_ABIERTO }
