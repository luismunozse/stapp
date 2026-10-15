/**
 * Lectura del listado de notas de crédito sobre `v_notas_credito` (migración
 * 356): las devoluciones de ventas y las NC de órdenes en una sola lista,
 * con anuladas e historial DEV- incluidos.
 *
 * La vista solo la lee service_role, así que todo pasa por supabaseAdmin y
 * TODA lectura va acotada por organization_id: los números de documento se
 * repiten entre organizaciones.
 */
import { supabaseAdmin } from "@/lib/supabase"
import { DEFAULT_TIMEZONE } from "@/lib/timezone"
import {
  MOTIVOS_NC,
  CONSUMIDOR_FINAL,
  esMotivoNC,
  etiquetaMotivo,
  etiquetaMetodo,
  numeroOperacion,
  type ModoNC,
  type MotivoNC,
  type OrigenNC,
} from "./catalogo"

export interface FiltrosListadoNC {
  page: number
  limit: number
  desde: string | null
  hasta: string | null
  origen: OrigenNC | null
  modo: ModoNC | null
  motivo: MotivoNC | null
  estado: "ACTIVA" | "ANULADA" | null
  clienteId: string | null
  q: string | null
}

const DIA = /^\d{4}-\d{2}-\d{2}$/

function entero(v: string | null, porDefecto: number): number {
  const n = Number.parseInt(v ?? "", 10)
  return Number.isFinite(n) ? n : porDefecto
}

function enLista<T extends string>(v: string | null, lista: readonly T[]): T | null {
  return v !== null && (lista as readonly string[]).includes(v) ? (v as T) : null
}

/**
 * Filtros del listado desde la query string. Un valor inválido se ignora en
 * vez de responder 400: un link viejo o mal armado tiene que seguir mostrando
 * la lista, sin ese filtro.
 */
export function parseFiltrosListadoNC(sp: URLSearchParams): FiltrosListadoNC {
  const desde = sp.get("desde")
  const hasta = sp.get("hasta")
  // Los números son NC-000123 / DEV-0042: con letras, dígitos y guion alcanza,
  // y sin comodines ni comas no hay nada que escapar para PostgREST.
  const q = (sp.get("q") ?? "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 40)

  return {
    page: Math.max(entero(sp.get("page"), 1), 1),
    limit: Math.min(Math.max(entero(sp.get("limit"), 20), 1), 100),
    desde: desde && DIA.test(desde) ? desde : null,
    hasta: hasta && DIA.test(hasta) ? hasta : null,
    origen: enLista(sp.get("origen"), ["VENTA", "ORDEN"] as const),
    modo: enLista(sp.get("modo"), ["ITEMS", "MONTO"] as const),
    motivo: enLista(sp.get("motivo"), MOTIVOS_NC),
    estado: enLista(sp.get("estado"), ["ACTIVA", "ANULADA"] as const),
    clienteId: sp.get("cliente")?.trim() || null,
    q: q || null,
  }
}

export const COLUMNAS_VISTA_NC =
  "id, origen, origen_id, origen_numero, numero, fecha, modo, motivo_nc, detalle, monto, " +
  "monto_aplicado_deuda, monto_reembolso, metodo, cliente_id, sucursal_id, organization_id, user_id, anulada"

/** Una fila de v_notas_credito tal como la devuelve PostgREST. */
export interface FilaVistaNC {
  id: string
  origen: OrigenNC
  origen_id: string
  origen_numero: string | null
  numero: string
  fecha: string
  modo: ModoNC
  motivo_nc: string | null
  detalle: string | null
  monto: string | number
  monto_aplicado_deuda: string | number
  monto_reembolso: string | number
  metodo: string | null
  cliente_id: string | null
  sucursal_id: string | null
  organization_id: string
  user_id: string | null
  anulada: boolean | null
}

export interface NotaCreditoFila {
  id: string
  origen: OrigenNC
  origenId: string
  origenNumero: string
  numero: string
  fecha: string
  modo: ModoNC
  motivoNc: MotivoNC | null
  motivo: string
  detalle: string | null
  monto: number
  montoAplicadoDeuda: number
  montoReembolso: number
  metodo: string | null
  metodoLabel: string | null
  clienteId: string | null
  clienteNombre: string
  sucursalId: string | null
  sucursalNombre: string | null
  usuarioNombre: string | null
  anulada: boolean
}

export const dinero = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100

const unicos = (vals: (string | null)[]) => [...new Set(vals.filter((v): v is string => !!v))]

async function nombresPorId(
  tabla: "clientes" | "sucursales" | "users",
  ids: string[],
  organizationId: string
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const { data, error } = await supabaseAdmin
    .from(tabla)
    .select("id, nombre")
    .in("id", ids)
    .eq("organization_id", organizationId)
  if (error) throw error
  return new Map(((data ?? []) as { id: string; nombre: string | null }[]).map((r) => [r.id, r.nombre ?? ""]))
}

async function clientesDeMostrador(ventaIds: string[], organizationId: string): Promise<Map<string, string>> {
  if (ventaIds.length === 0) return new Map()
  const { data, error } = await supabaseAdmin
    .from("ventas")
    .select("id, cliente_nombre")
    .in("id", ventaIds)
    .eq("organization_id", organizationId)
  if (error) throw error
  return new Map(((data ?? []) as { id: string; cliente_nombre: string | null }[]).map((r) => [r.id, r.cliente_nombre ?? ""]))
}

/**
 * Completa las filas de la vista con los nombres que la vista no trae (y que
 * PostgREST no puede embeber a través de un UNION ALL). Cuatro lecturas en
 * lote como máximo, sea cual sea el tamaño de la página.
 */
export async function leerFilasNC(filas: FilaVistaNC[], organizationId: string): Promise<NotaCreditoFila[]> {
  if (filas.length === 0) return []

  const ventasSinCliente = unicos(filas.filter((f) => f.origen === "VENTA" && !f.cliente_id).map((f) => f.origen_id))
  const [clientes, sucursales, usuarios, mostrador] = await Promise.all([
    nombresPorId("clientes", unicos(filas.map((f) => f.cliente_id)), organizationId),
    nombresPorId("sucursales", unicos(filas.map((f) => f.sucursal_id)), organizationId),
    nombresPorId("users", unicos(filas.map((f) => f.user_id)), organizationId),
    clientesDeMostrador(ventasSinCliente, organizationId),
  ])

  return filas.map((f) => ({
    id: f.id,
    origen: f.origen,
    origenId: f.origen_id,
    origenNumero: numeroOperacion(f.origen, f.origen_numero),
    numero: f.numero,
    fecha: f.fecha,
    modo: f.modo,
    motivoNc: esMotivoNC(f.motivo_nc) ? f.motivo_nc : null,
    motivo: etiquetaMotivo(f.motivo_nc, f.detalle),
    detalle: f.detalle,
    monto: dinero(f.monto),
    montoAplicadoDeuda: dinero(f.monto_aplicado_deuda),
    montoReembolso: dinero(f.monto_reembolso),
    metodo: f.metodo,
    metodoLabel: etiquetaMetodo(f.metodo),
    clienteId: f.cliente_id,
    clienteNombre: f.cliente_id
      ? clientes.get(f.cliente_id) || "—"
      : f.origen === "VENTA"
        ? mostrador.get(f.origen_id) || CONSUMIDOR_FINAL
        : "—",
    sucursalId: f.sucursal_id,
    sucursalNombre: f.sucursal_id ? sucursales.get(f.sucursal_id) ?? null : null,
    usuarioNombre: f.user_id ? usuarios.get(f.user_id) ?? null : null,
    anulada: f.anulada === true,
  }))
}

/** Zona horaria de la organización. Una falla nunca tumba la lectura: cae a Argentina. */
export async function zonaHorariaDeOrganizacion(organizationId: string): Promise<string> {
  try {
    const { data } = await supabaseAdmin
      .from("organizations")
      .select("zona_horaria")
      .eq("id", organizationId)
      .single()
    return (data?.zona_horaria as string | null | undefined) || DEFAULT_TIMEZONE
  } catch {
    return DEFAULT_TIMEZONE
  }
}
