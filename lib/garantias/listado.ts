/**
 * Lectura unificada de garantías (reparación + venta) sobre `v_garantias`
 * (migración 400). La usan GET /api/garantias/unificadas y el conteo
 * "Garantías por vencer" del dashboard, así que el número de la tarjeta y la
 * lista salen de la MISMA consulta: misma definición, misma ventana y mismo
 * alcance.
 *
 * La vista solo la lee service_role: todo pasa por supabaseAdmin y TODA
 * lectura va acotada por organization_id.
 *
 * Alcance (se deriva del alcance de lectura de órdenes, que ya codifica el rol):
 *   - todas (ADMIN sin sucursal elegida): toda la organización.
 *   - sucursal (ADMIN con sucursal, VENDEDOR): las dos clases de garantía de
 *     esa sucursal, igual que /api/reportes/garantias-ventas.
 *   - sucursal_o_asignadas (TECNICO): solo garantías de reparación, de órdenes
 *     de su sucursal o asignadas a él. Las de venta no son suyas.
 */
import { supabaseAdmin } from "@/lib/supabase"
import { DEFAULT_TIMEZONE } from "@/lib/timezone"
import { aplicarAlcanceOrdenes, type AlcanceOrdenes } from "@/lib/ordenes/alcance-lectura"
import { terminoDeBusquedaSeguro } from "@/lib/sucursal-ordenes"
import { generateWhatsAppUrl } from "@/lib/notifications/whatsapp-templates"
import {
  ORIGENES_GARANTIA,
  TABS_GARANTIAS,
  VENTANA_POR_VENCER_DIAS,
  derivarEstadoGarantia,
  diaCalendario,
  normalizarVentana,
  sumarDias,
  type EstadoGarantia,
  type OrigenGarantia,
  type TabGarantias,
} from "./estado"
import { faseReclamo, reclamoPorDecidir, type FaseReclamo } from "./reclamo-estado"

export const COLUMNAS_VISTA_GARANTIAS =
  "id, origen, organization_id, sucursal_id, tecnico_id, vendedor_id, cliente_id, cliente_nombre, " +
  "cliente_telefono, descripcion, orden_id, numero_orden, codigo_orden, orden_estado, venta_id, " +
  "numero_venta, numero_garantia, referencia, dias_validez, fecha_inicio, fecha_vencimiento, " +
  "dia_vencimiento, estado_guardado, anulada, tiene_reclamo_abierto, reclamo_id, reclamo_estado, " +
  "reclamo_descripcion, reclamo_fecha, reclamo_orden_reingreso_id, reclamo_orden_reingreso_numero"

/** Una fila de v_garantias tal como la devuelve PostgREST. */
export interface FilaVistaGarantia {
  id: string
  origen: OrigenGarantia
  organization_id: string
  sucursal_id: string | null
  tecnico_id: string | null
  vendedor_id: string | null
  cliente_id: string | null
  cliente_nombre: string | null
  cliente_telefono: string | null
  descripcion: string | null
  orden_id: string | null
  numero_orden: number | null
  codigo_orden: string | null
  orden_estado: string | null
  venta_id: string | null
  numero_venta: number | null
  numero_garantia: string | null
  referencia: string | null
  dias_validez: number | null
  fecha_inicio: string | null
  fecha_vencimiento: string
  dia_vencimiento: string
  estado_guardado: string | null
  anulada: boolean | null
  tiene_reclamo_abierto: boolean | null
  /** El reclamo abierto (PENDIENTE o ACEPTADO) de la garantía, si hay (401). */
  reclamo_id?: string | null
  reclamo_estado?: string | null
  reclamo_descripcion?: string | null
  reclamo_fecha?: string | null
  reclamo_orden_reingreso_id?: string | null
  reclamo_orden_reingreso_numero?: string | null
}

export interface ReclamoAbiertoListado {
  id: string
  fase: FaseReclamo
  descripcion: string
  fecha: string | null
  ordenReingreso: { id: string; numero: string | null } | null
}

export interface GarantiaListada {
  id: string
  origen: OrigenGarantia
  estado: EstadoGarantia
  /** 0 = vence hoy; negativo = venció hace N días. Por día, en la zona de la org. */
  diasRestantes: number
  diaVencimiento: string
  fechaInicio: string | null
  fechaVencimiento: string
  diasValidez: number | null
  cliente: { id: string | null; nombre: string; telefono: string | null }
  descripcion: string
  referencia: { tipo: "ORDEN" | "VENTA"; id: string; numero: string }
  numeroGarantia: string | null
  sucursal: { id: string; nombre: string | null } | null
  /** El reclamo abierto de la garantía (por decidir o con el re-ingreso en curso). */
  reclamo: ReclamoAbiertoListado | null
  acciones: {
    /** Detalle de la orden o la venta; null si quien mira no puede abrirlo. */
    verHref: string | null
    /** Certificado (venta) o comprobante de entrega (reparación). */
    certificadoUrl: string | null
    whatsappUrl: string | null
    /**
     * Registrar un reclamo desde la fila (cualquier rol con la garantía en su
     * alcance). null = no se puede; "vigente" = directo; "forzar" = la garantía
     * venció y solo el ADMIN la puede reclamar dejando un motivo.
     */
    registrarReclamo: "vigente" | "forzar" | null
    /** Aceptar o rechazar el reclamo abierto: solo ADMIN y solo si está por decidir. */
    decidirReclamo: boolean
  }
}

export interface FiltrosGarantias {
  tab: TabGarantias
  origen: OrigenGarantia | null
  q: string | null
  page: number
  limit: number
  ventana: number
  /** Solo ADMIN: "todas", un id de sucursal o null (= lo que diga el selector global). */
  sucursal: string | null
}

export type ConteosGarantias = Record<TabGarantias, number>

export interface ActorGarantias {
  role: string | null
  userId: string | null
}

const ID_SEGURO_RE = /^[A-Za-z0-9_-]{1,64}$/

function entero(v: string | null, porDefecto: number): number {
  const n = Number.parseInt(v ?? "", 10)
  return Number.isFinite(n) ? n : porDefecto
}

function enLista<T extends string>(v: string | null, lista: readonly T[]): T | null {
  return v !== null && (lista as readonly string[]).includes(v) ? (v as T) : null
}

/**
 * Filtros desde la query string. Un valor inválido se ignora (no hay 400): un
 * link viejo o mal armado tiene que seguir mostrando la lista.
 */
export function parseFiltrosGarantias(sp: URLSearchParams): FiltrosGarantias {
  const q = (sp.get("q") ?? "").trim().slice(0, 60)
  const sucursal = sp.get("sucursal")
  return {
    tab: enLista(sp.get("tab"), TABS_GARANTIAS) ?? "por-vencer",
    origen: enLista(sp.get("origen"), ORIGENES_GARANTIA),
    q: q || null,
    page: Math.max(entero(sp.get("page"), 1), 1),
    limit: Math.min(Math.max(entero(sp.get("limit"), 20), 1), 100),
    ventana: sp.has("ventana") ? normalizarVentana(sp.get("ventana")) : VENTANA_POR_VENCER_DIAS,
    sucursal: sucursal === "todas" || (sucursal && ID_SEGURO_RE.test(sucursal)) ? sucursal : null,
  }
}

/** Alcance de lectura de órdenes → filtro sobre la vista. */
export function aplicarAlcanceGarantias<Q extends { eq: (c: string, v: string) => any; or: (f: string, o?: { referencedTable: string }) => any }>(
  query: Q,
  alcance: AlcanceOrdenes
): Q {
  if (alcance.tipo === "todas") return query
  if (alcance.tipo === "sucursal") return query.eq("sucursal_id", alcance.sucursalId)
  // TECNICO: solo reparación, de su sucursal o asignadas (vendedor_id/tecnico_id
  // de las filas de venta es NULL, así que el .or() solo las dejaría pasar por
  // sucursal: el origen las saca explícitamente).
  return aplicarAlcanceOrdenes(query.eq("origen", "REPARACION"), alcance)
}

/** Filtro de cada pestaña. `hoy` es el día de la org; las pestañas no se pisan. */
export function aplicarTab<Q extends { eq: (c: string, v: unknown) => any; or: (f: string) => any; gte: (c: string, v: string) => any; lte: (c: string, v: string) => any; gt: (c: string, v: string) => any }>(
  query: Q,
  tab: TabGarantias,
  hoy: string,
  ventana: number
): Q {
  const limite = sumarDias(hoy, ventana)
  switch (tab) {
    case "por-vencer":
      return query.eq("anulada", false).eq("tiene_reclamo_abierto", false).gte("dia_vencimiento", hoy).lte("dia_vencimiento", limite)
    case "vigentes":
      return query.eq("anulada", false).eq("tiene_reclamo_abierto", false).gt("dia_vencimiento", limite)
    case "reclamos":
      return query.eq("anulada", false).eq("tiene_reclamo_abierto", true)
    case "vencidas":
      return query.or(`anulada.is.true,and(tiene_reclamo_abierto.is.false,dia_vencimiento.lt.${hoy})`)
  }
}

function aplicarBusqueda<Q extends { or: (f: string) => any }>(query: Q, q: string | null): Q {
  if (!q) return query
  const t = terminoDeBusquedaSeguro(q)
  const filtros = [
    `cliente_nombre.ilike.%${t}%`,
    `cliente_telefono.ilike.%${t}%`,
    `descripcion.ilike.%${t}%`,
    `referencia.ilike.%${t}%`,
    `numero_garantia.ilike.%${t}%`,
  ]
  // "#123", "V0012" o "0012": también el número de orden o venta exacto.
  const numero = /^[#vV]?0*(\d{1,9})$/.exec(q.trim())?.[1]
  if (numero) filtros.push(`referencia.eq.${numero}`)
  return query.or(filtros.join(","))
}

interface ConfigOrg {
  zonaHoraria: string
  pais: string | null
  nombre: string
}

/** Zona horaria, país y nombre de la org. Una falla nunca tumba la lectura. */
export async function leerConfigOrg(organizationId: string): Promise<ConfigOrg> {
  try {
    const { data } = await supabaseAdmin
      .from("organizations")
      .select("zona_horaria, pais, nombre, nombre_mostrar")
      .eq("id", organizationId)
      .single()
    return {
      zonaHoraria: (data?.zona_horaria as string | null) || DEFAULT_TIMEZONE,
      pais: (data?.pais as string | null) ?? null,
      nombre: (data?.nombre_mostrar as string | null) || (data?.nombre as string | null) || "",
    }
  } catch {
    return { zonaHoraria: DEFAULT_TIMEZONE, pais: null, nombre: "" }
  }
}

async function nombresSucursales(ids: string[], organizationId: string): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const { data, error } = await supabaseAdmin
    .from("sucursales")
    .select("id, nombre")
    .in("id", ids)
    .eq("organization_id", organizationId)
  if (error) return new Map()
  return new Map(((data ?? []) as { id: string; nombre: string | null }[]).map((r) => [r.id, r.nombre ?? ""]))
}

const fechaCorta = (dia: string) => dia.split("-").reverse().join("/")

export function numeroReferencia(f: Pick<FilaVistaGarantia, "origen" | "codigo_orden" | "numero_orden" | "numero_venta">): string {
  if (f.origen === "VENTA") return f.numero_venta != null ? `V${String(f.numero_venta).padStart(4, "0")}` : "—"
  if (f.codigo_orden) return f.codigo_orden
  return f.numero_orden != null ? `#${f.numero_orden}` : "—"
}

const ESTADOS_ENTREGADA = new Set(["ENTREGADO", "ENTREGADO_SIN_REPARACION"])

function mensajeWhatsApp(f: FilaVistaGarantia, estado: EstadoGarantia, numero: string, org: ConfigOrg): string {
  const nombre = f.cliente_nombre?.trim() || ""
  const saludo = nombre ? `Hola ${nombre}` : "Hola"
  const de = org.nombre ? ` de ${org.nombre}` : ""
  const que =
    f.origen === "VENTA"
      ? `la garantía de ${f.descripcion ?? "tu compra"}${f.numero_garantia ? ` (certificado ${f.numero_garantia})` : ""}`
      : `la garantía de la reparación de tu ${f.descripcion ?? "equipo"} (orden ${numero})`
  const cuando =
    estado === "VENCIDA" ? `Venció el ${fechaCorta(f.dia_vencimiento)}.` : `Está vigente hasta el ${fechaCorta(f.dia_vencimiento)}.`
  return `${saludo}, te escribimos${de} por ${que}. ${cuando}`
}

/**
 * Registrar un reclamo: cualquier rol (decisión 3 del dueño) sobre una garantía
 * vigente sin reclamo abierto; una vencida, solo el ADMIN y con motivo. El
 * alcance ya lo filtró la consulta.
 */
export function accionRegistrarReclamo(estado: EstadoGarantia, role: string | null): "vigente" | "forzar" | null {
  if (!role) return null
  if (estado === "VIGENTE" || estado === "POR_VENCER") return "vigente"
  if (estado === "VENCIDA" && role === "ADMIN") return "forzar"
  return null
}

export function mapearFilaGarantia(
  f: FilaVistaGarantia,
  ctx: { hoy: string; ventana: number; org: ConfigOrg; actor: ActorGarantias | null; sucursales: Map<string, string> }
): GarantiaListada {
  const { estado, diasRestantes } = derivarEstadoGarantia({
    anulada: f.anulada === true,
    reclamoAbierto: f.tiene_reclamo_abierto === true,
    diaVencimiento: f.dia_vencimiento,
    hoy: ctx.hoy,
    ventana: ctx.ventana,
  })
  const role = ctx.actor?.role ?? null
  const userId = ctx.actor?.userId ?? null
  const numero = numeroReferencia(f)
  const esVenta = f.origen === "VENTA"

  let verHref: string | null = null
  let certificadoUrl: string | null = null

  if (esVenta && f.venta_id) {
    // El detalle y el certificado de una venta: el ADMIN siempre, el resto solo
    // las propias (soloVeSusVentas en /api/ventas/[id] y en el PDF).
    const puedeAbrir = role === "ADMIN" || (!!userId && f.vendedor_id === userId)
    if (puedeAbrir) {
      verHref = `/ventas/${f.venta_id}`
      if (estado !== "ANULADA") certificadoUrl = `/api/ventas/${f.venta_id}/garantia/${f.id}/pdf`
    }
  } else if (f.orden_id) {
    verHref = `/ordenes/${f.orden_id}`
    // Comprobante de entrega (lleva la garantía). El técnico solo el de sus órdenes.
    const puedeComprobante = role !== "TECNICO" || (!!userId && f.tecnico_id === userId)
    if (f.orden_estado && ESTADOS_ENTREGADA.has(f.orden_estado) && puedeComprobante) {
      certificadoUrl = `/api/ordenes/${f.orden_id}/comprobante-entrega`
    }
  }

  const registrarReclamo = accionRegistrarReclamo(estado, role)
  const decidirReclamo = role === "ADMIN" && !!f.reclamo_id && reclamoPorDecidir(f.reclamo_estado)

  const telefono = f.cliente_telefono?.trim() || null
  const whatsappUrl =
    telefono && estado !== "ANULADA" && role !== "TECNICO"
      ? generateWhatsAppUrl(telefono, mensajeWhatsApp(f, estado, numero, ctx.org), ctx.org.pais)
      : null

  return {
    id: f.id,
    origen: f.origen,
    estado,
    diasRestantes,
    diaVencimiento: f.dia_vencimiento,
    fechaInicio: f.fecha_inicio,
    fechaVencimiento: f.fecha_vencimiento,
    diasValidez: f.dias_validez,
    cliente: { id: f.cliente_id, nombre: f.cliente_nombre?.trim() || "Consumidor final", telefono },
    descripcion: f.descripcion?.trim() || "—",
    referencia: {
      tipo: esVenta ? "VENTA" : "ORDEN",
      id: (esVenta ? f.venta_id : f.orden_id) ?? "",
      numero,
    },
    numeroGarantia: f.numero_garantia,
    sucursal: f.sucursal_id ? { id: f.sucursal_id, nombre: ctx.sucursales.get(f.sucursal_id) ?? null } : null,
    reclamo: f.reclamo_id
      ? {
          id: f.reclamo_id,
          fase: faseReclamo(f.reclamo_estado),
          descripcion: f.reclamo_descripcion ?? "",
          fecha: f.reclamo_fecha ?? null,
          ordenReingreso: f.reclamo_orden_reingreso_id
            ? { id: f.reclamo_orden_reingreso_id, numero: f.reclamo_orden_reingreso_numero ?? null }
            : null,
        }
      : null,
    acciones: { verHref, certificadoUrl, whatsappUrl, registrarReclamo, decidirReclamo },
  }
}

export interface ParametrosListado {
  organizationId: string
  alcance: AlcanceOrdenes
  filtros: Pick<FiltrosGarantias, "tab" | "origen" | "q" | "page" | "limit" | "ventana">
  actor: ActorGarantias | null
  /** Conteo por pestaña (cuatro HEAD más). El dashboard no lo necesita. */
  conConteos?: boolean
  ahora?: Date
}

export interface ResultadoListado {
  data: GarantiaListada[]
  total: number
  conteos: ConteosGarantias | null
  hoy: string
  ventana: number
  zonaHoraria: string
}

/**
 * La consulta de la lista. El conteo del dashboard pasa por acá con
 * tab = "por-vencer", así que no puede divergir de la página.
 */
export async function listarGarantias(p: ParametrosListado): Promise<ResultadoListado> {
  const org = await leerConfigOrg(p.organizationId)
  const hoy = diaCalendario(p.ahora ?? new Date(), org.zonaHoraria)
  const { tab, origen, q, page, limit, ventana } = p.filtros

  const base = (opciones?: { count: "exact"; head?: boolean }) => {
    let query: any = supabaseAdmin
      .from("v_garantias")
      .select(COLUMNAS_VISTA_GARANTIAS, opciones)
      .eq("organization_id", p.organizationId)
    query = aplicarAlcanceGarantias(query, p.alcance)
    if (origen) query = query.eq("origen", origen)
    return aplicarBusqueda(query, q)
  }

  const offset = (page - 1) * limit
  // Las vencidas, la más reciente primero; el resto, la que vence antes primero.
  const asc = tab !== "vencidas"
  const lista = aplicarTab(base({ count: "exact" }), tab, hoy, ventana)
    .order("dia_vencimiento", { ascending: asc })
    .order("id", { ascending: true })
    .range(offset, offset + limit - 1)

  const conteosQ = p.conConteos
    ? Promise.all(TABS_GARANTIAS.map((t) => aplicarTab(base({ count: "exact", head: true }), t, hoy, ventana)))
    : Promise.resolve(null)

  const [{ data, error, count }, conteosR] = await Promise.all([lista, conteosQ])

  // PGRST103: página más allá de la última. Lista vacía con el total real.
  let filas = (data ?? []) as FilaVistaGarantia[]
  let total = count ?? 0
  if (error) {
    if ((error as { code?: string }).code !== "PGRST103") throw error
    const { count: real, error: errReal } = await aplicarTab(base({ count: "exact", head: true }), tab, hoy, ventana)
    if (errReal) throw errReal
    filas = []
    total = real ?? 0
  }

  let conteos: ConteosGarantias | null = null
  if (conteosR) {
    conteos = {} as ConteosGarantias
    TABS_GARANTIAS.forEach((t, i) => {
      const r = conteosR[i] as { count: number | null; error: unknown }
      if (r.error) throw r.error
      conteos![t] = r.count ?? 0
    })
    // El de la pestaña abierta es el mismo número que el total de la lista.
    conteos[tab] = total
  }

  const sucursales = await nombresSucursales(
    [...new Set(filas.map((f) => f.sucursal_id).filter((v): v is string => !!v))],
    p.organizationId
  )
  const ctx = { hoy, ventana, org, actor: p.actor, sucursales }

  return {
    data: filas.map((f) => mapearFilaGarantia(f, ctx)),
    total,
    conteos,
    hoy,
    ventana,
    zonaHoraria: org.zonaHoraria,
  }
}

/**
 * "Reclamos abiertos" del dashboard: el total de la pestaña Reclamos abiertos
 * de /garantias, con la misma consulta.
 */
export async function contarReclamosAbiertos(
  organizationId: string,
  alcance: AlcanceOrdenes,
  opciones: { ahora?: Date } = {}
): Promise<number> {
  const r = await listarGarantias({
    organizationId,
    alcance,
    filtros: { tab: "reclamos", origen: null, q: null, page: 1, limit: 1, ventana: VENTANA_POR_VENCER_DIAS },
    actor: null,
    ahora: opciones.ahora,
  })
  return r.total
}

/**
 * "Garantías por vencer" del dashboard: el total y las primeras, con la misma
 * consulta que la pestaña Por vencer de /garantias.
 */
export async function resumenGarantiasPorVencer(
  organizationId: string,
  alcance: AlcanceOrdenes,
  opciones: { limite?: number; ventana?: number; ahora?: Date } = {}
): Promise<{ total: number; primeras: GarantiaListada[] }> {
  const r = await listarGarantias({
    organizationId,
    alcance,
    filtros: {
      tab: "por-vencer",
      origen: null,
      q: null,
      page: 1,
      limit: opciones.limite ?? 3,
      ventana: opciones.ventana ?? VENTANA_POR_VENCER_DIAS,
    },
    actor: null,
    ahora: opciones.ahora,
  })
  return { total: r.total, primeras: r.data }
}
