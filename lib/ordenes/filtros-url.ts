/**
 * Filtros de la lista de órdenes ⇄ query string de /ordenes.
 *
 * La lista guarda sus filtros en la URL para que:
 * - los links del dashboard ("Cobros pendientes", "Vencidas", "Sin diagnóstico"…)
 *   lleguen a la lista ya filtrada, y
 * - volver desde el detalle de una orden (o recargar) no pierda los filtros.
 *
 * Los nombres de los params son los mismos que acepta GET /api/ordenes, salvo
 * `filtro` (chip rápido, se traduce a otro param de la API) y `sort`/`dir`.
 * Todo valor que no se reconoce se ignora: una URL vieja o tipeada a mano nunca
 * rompe la lista, a lo sumo queda sin ese filtro.
 */
import type { EstadoOrden } from "@/types"

export const ESTADOS_ORDEN: readonly EstadoOrden[] = [
  "RECIBIDO",
  "EN_DIAGNOSTICO",
  "PRESUPUESTADO",
  "APROBADO",
  "EN_REPARACION",
  "ESPERANDO_REPUESTO",
  "REPARADO",
  "ENTREGADO",
  "CANCELADO",
  "SIN_REPARACION",
  "SIN_FALLA_DETECTADA",
  "ENTREGADO_SIN_REPARACION",
  "ENTREGADO_SIN_COBRO",
]

/** Órdenes en curso: lo que el dashboard cuenta como "Órdenes pendientes". */
export const ESTADOS_ACTIVOS: readonly EstadoOrden[] = [
  "RECIBIDO",
  "EN_DIAGNOSTICO",
  "PRESUPUESTADO",
  "APROBADO",
  "EN_REPARACION",
  "ESPERANDO_REPUESTO",
]

/**
 * Órdenes con deuda: misma definición que la tarjeta "Cobros pendientes" del
 * dashboard (lib/dashboard/datos.ts). Un equipo todavía en diagnóstico también
 * tiene estado_cobro PENDIENTE, pero no hay nada que cobrarle aún.
 */
export const COBRO_PENDIENTE_ESTADOS_COBRO = ["PENDIENTE", "PARCIAL"] as const
export const COBRO_PENDIENTE_ESTADOS_ORDEN: readonly EstadoOrden[] = [
  "REPARADO",
  "ENTREGADO",
  "ENTREGADO_SIN_REPARACION",
]

export const ESTADOS_COBRO = ["PENDIENTE", "PARCIAL", "COBRADO"] as const

export const FILTROS_RAPIDOS = ["vencidas", "venceHoy", "pendientesCobro", "sinTecnico", "activas"] as const
export type FiltroRapido = (typeof FILTROS_RAPIDOS)[number]

/** Columnas ordenables (claves que acepta `sortBy` en la API). */
export const SORT_KEYS = ["fechaIngreso", "fechaPrometida", "numeroOrden", "estado", "dispositivo", "presupuesto"] as const

export const PAGE_SIZE_DEFAULT = 20
const PAGE_SIZE_MAX = 100

export interface OrdenesSort {
  key: string
  direction: "asc" | "desc"
}

export interface OrdenesFiltros {
  search: string
  estado: EstadoOrden | ""
  estadoCobro: string
  tecnicoId: string
  tipoDispositivo: string
  marca: string
  conPresupuesto: "" | "si" | "no"
  conSena: "" | "si" | "no"
  fechaDesde: string
  fechaHasta: string
  fechaPrometidaDesde: string
  fechaPrometidaHasta: string
  fechaEntregaDesde: string
  fechaEntregaHasta: string
  filtro: FiltroRapido | ""
  page: number
  pageSize: number
  /** null = el orden por defecto del rol (lo decide la lista). */
  sort: OrdenesSort | null
}

export const FILTROS_VACIOS: OrdenesFiltros = {
  search: "",
  estado: "",
  estadoCobro: "",
  tecnicoId: "",
  tipoDispositivo: "",
  marca: "",
  conPresupuesto: "",
  conSena: "",
  fechaDesde: "",
  fechaHasta: "",
  fechaPrometidaDesde: "",
  fechaPrometidaHasta: "",
  fechaEntregaDesde: "",
  fechaEntregaHasta: "",
  filtro: "",
  page: 1,
  pageSize: PAGE_SIZE_DEFAULT,
  sort: null,
}

const TEXTO_KEYS = ["search", "tecnicoId", "tipoDispositivo", "marca"] as const
const FECHA_KEYS = [
  "fechaDesde",
  "fechaHasta",
  "fechaPrometidaDesde",
  "fechaPrometidaHasta",
  "fechaEntregaDesde",
  "fechaEntregaHasta",
] as const

/** Params alias que se aceptan al leer pero nunca se escriben. */
const ALIAS_KEYS = ["estado_cobro"] as const

/** Todo param que pertenece a los filtros; el resto de la URL (fromTurno, clienteId…) se respeta. */
export const FILTRO_PARAM_KEYS: readonly string[] = [
  ...TEXTO_KEYS,
  ...FECHA_KEYS,
  ...ALIAS_KEYS,
  "estado",
  "estadoCobro",
  "conPresupuesto",
  "conSena",
  "filtro",
  "page",
  "limit",
  "sort",
  "dir",
]

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/

function incluye<T extends string>(lista: readonly T[], valor: string | null | undefined): valor is T {
  return valor != null && (lista as readonly string[]).includes(valor)
}

function enteroPositivo(valor: string | null): number | null {
  if (!valor || !/^\d+$/.test(valor)) return null
  const n = Number(valor)
  return n >= 1 ? n : null
}

interface ParamsLike {
  get(name: string): string | null
}

export function parseOrdenesFiltros(params: ParamsLike | null | undefined): OrdenesFiltros {
  const f: OrdenesFiltros = { ...FILTROS_VACIOS }
  if (!params) return f

  for (const key of TEXTO_KEYS) f[key] = params.get(key)?.trim() ?? ""
  for (const key of FECHA_KEYS) {
    const v = params.get(key)
    f[key] = v && FECHA_RE.test(v) ? v : ""
  }

  const estado = params.get("estado")
  if (incluye(ESTADOS_ORDEN, estado)) {
    f.estado = estado
  } else if (estado?.toLowerCase() === "pendientes" || estado?.toLowerCase() === "activas") {
    // Link viejo del dashboard ("N órdenes pendientes"): no es un estado sino el grupo en curso.
    f.filtro = "activas"
  }

  const estadoCobro = (params.get("estadoCobro") ?? params.get("estado_cobro"))?.toUpperCase()
  if (incluye(ESTADOS_COBRO, estadoCobro)) f.estadoCobro = estadoCobro

  const conPresupuesto = params.get("conPresupuesto")
  if (conPresupuesto === "si" || conPresupuesto === "no") f.conPresupuesto = conPresupuesto
  const conSena = params.get("conSena")
  if (conSena === "si" || conSena === "no") f.conSena = conSena

  const filtro = params.get("filtro")
  if (incluye(FILTROS_RAPIDOS, filtro)) f.filtro = filtro

  f.page = enteroPositivo(params.get("page")) ?? 1
  f.pageSize = Math.min(enteroPositivo(params.get("limit")) ?? PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX)

  const sort = params.get("sort")
  if (incluye(SORT_KEYS, sort)) {
    f.sort = { key: sort, direction: params.get("dir") === "asc" ? "asc" : "desc" }
  }

  return f
}

/** Query string canónico de los filtros: sólo lo que difiere del default, en orden fijo. */
export function serializeOrdenesFiltros(f: Partial<OrdenesFiltros>): URLSearchParams {
  const p = new URLSearchParams()
  const set = (key: string, value: string | undefined) => {
    if (value) p.set(key, value)
  }
  set("search", f.search?.trim())
  set("estado", f.estado)
  set("estadoCobro", f.estadoCobro)
  set("filtro", f.filtro)
  set("tecnicoId", f.tecnicoId)
  set("tipoDispositivo", f.tipoDispositivo)
  set("marca", f.marca)
  set("conPresupuesto", f.conPresupuesto)
  set("conSena", f.conSena)
  for (const key of FECHA_KEYS) set(key, f[key])
  if (f.page && f.page > 1) p.set("page", String(f.page))
  if (f.pageSize && f.pageSize !== PAGE_SIZE_DEFAULT) p.set("limit", String(f.pageSize))
  if (f.sort) {
    p.set("sort", f.sort.key)
    p.set("dir", f.sort.direction)
  }
  return p
}

/**
 * URL de la lista con los filtros dados, conservando los params ajenos a los
 * filtros (fromTurno, clienteId…) que ya tenga `actual`. `nueva` se descarta:
 * es una orden de un solo uso ("abrí el form") que la lista consume al montar.
 */
export function urlListaConFiltros(
  pathname: string,
  actual: ParamsLike & { forEach(cb: (value: string, key: string) => void): void },
  f: Partial<OrdenesFiltros>
): string {
  const p = new URLSearchParams()
  actual.forEach((value, key) => {
    if (!FILTRO_PARAM_KEYS.includes(key) && key !== "nueva") p.append(key, value)
  })
  serializeOrdenesFiltros(f).forEach((value, key) => p.set(key, value))
  const qs = p.toString()
  return qs ? `${pathname}?${qs}` : pathname
}

/** Href de la lista filtrada, para los links del dashboard. */
export function ordenesHref(f: Partial<OrdenesFiltros> = {}): string {
  const qs = serializeOrdenesFiltros(f).toString()
  return qs ? `/ordenes?${qs}` : "/ordenes"
}

/** Params de GET /api/ordenes que corresponden a un chip rápido. */
export function apiParamsDeFiltroRapido(filtro: FiltroRapido | ""): Record<string, string> {
  switch (filtro) {
    case "vencidas":
      return { vencimiento: "vencidas" }
    case "venceHoy":
      return { vencimiento: "venceHoy" }
    case "pendientesCobro":
      return { cobroPendiente: "true" }
    case "sinTecnico":
      return { sinTecnico: "true" }
    case "activas":
      return { activas: "true" }
    default:
      return {}
  }
}

// --- Última lista visitada (para el "volver" del detalle) -------------------

const ULTIMA_LISTA_KEY = "stapp:ordenes:ultima-lista"

export function guardarUltimaListaOrdenes(url: string): void {
  try {
    sessionStorage.setItem(ULTIMA_LISTA_KEY, url)
  } catch {
    // Storage bloqueado (modo privado, iframe): el "volver" cae en /ordenes.
  }
}

/** URL de la última lista de órdenes de esta pestaña; "/ordenes" si no hay o no es válida. */
export function leerUltimaListaOrdenes(): string {
  try {
    const url = sessionStorage.getItem(ULTIMA_LISTA_KEY)
    if (url && (url === "/ordenes" || url.startsWith("/ordenes?"))) return url
  } catch {
    // idem
  }
  return "/ordenes"
}
