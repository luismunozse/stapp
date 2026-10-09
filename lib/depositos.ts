import { supabaseAdmin } from "@/lib/supabase"
import { SUCURSAL_NINGUNA, sucursalParaLectura, getDepositoDeSucursal } from "@/lib/sucursal"

/**
 * Mensaje unico para TODO rechazo de un deposito enviado por el cliente: asi un
 * sondeo no distingue "es de otra org" de "esta inactivo" o "es de otra sucursal".
 */
export const DEPOSITO_INVALIDO = "El depósito elegido no es válido"

/**
 * "sucursal": el deposito debe ser de la sucursal del usuario (si no es ADMIN).
 * "organizacion": basta con que sea de la org (destino de una transferencia).
 */
export type AlcanceDeposito = "sucursal" | "organizacion"

interface ContextoDeposito {
  role: string | null
  userSucursalId: string | null
  alcance?: AlcanceDeposito
}

/**
 * Regla unica de a que sucursal queda atado un deposito elegido por el cliente.
 *
 * Devuelve la sucursal que el deposito debe tener, o null si no hay restriccion
 * de sucursal. El ADMIN nunca queda atado: la cookie de sucursal es un filtro de
 * vista, no una frontera de seguridad. El no-admin sin sucursal asignada cae al
 * sentinel, que no matchea ninguna fila (fail-closed).
 */
export function sucursalRequeridaParaDeposito(ctx: ContextoDeposito): string | null {
  if ((ctx.alcance ?? "sucursal") === "organizacion") return null
  if (ctx.role === "ADMIN") return null
  return ctx.userSucursalId ?? SUCURSAL_NINGUNA
}

/**
 * La misma regla aplicada a una fila de deposito ya leida (la usa el listado
 * para marcar que depositos puede usar como origen quien llama).
 */
export function depositoUsableDesde(
  deposito: { activo: boolean; deleted_at: string | null; sucursal_id: string | null },
  ctx: ContextoDeposito
): boolean {
  if (!deposito.activo || deposito.deleted_at) return false
  const requerida = sucursalRequeridaParaDeposito(ctx)
  return requerida === null || deposito.sucursal_id === requerida
}

/**
 * Valida un depositoId que viene del cliente antes de pasarlo a una RPC: las
 * RPCs solo chequean que el id exista (FK), no que sea de la org ni activo.
 *
 * Un error de la query LANZA para que la ruta responda 500: devolver false
 * disfrazaria una caida como "deposito invalido", y devolver true abriria el
 * agujero justo cuando la base falla. supabase-js no lanza por si solo.
 */
export async function depositoPermitido(params: {
  depositoId: string
  organizationId: string
  role: string | null
  userSucursalId: string | null
  alcance?: AlcanceDeposito
}): Promise<boolean> {
  let query = supabaseAdmin
    .from("depositos")
    .select("id")
    .eq("id", params.depositoId)
    .eq("organization_id", params.organizationId)
    .is("deleted_at", null)
    .eq("activo", true)

  const sucursalRequerida = sucursalRequeridaParaDeposito(params)
  if (sucursalRequerida !== null) {
    query = query.eq("sucursal_id", sucursalRequerida)
  }

  const { data, error } = await query.maybeSingle()
  if (error) throw error
  return !!data
}

/**
 * Deposito destino cuando el stock entra SIN un deposito explicito: el del
 * deposito principal de la sucursal de quien opera, en vez de caer siempre en la
 * Casa Central.
 *
 *  - No-admin: el de SU sucursal.
 *  - ADMIN con una sucursal elegida en la cookie: el de esa sucursal.
 *  - ADMIN viendo "todas", o sin sucursal / sin deposito: null. El llamador conserva
 *    el comportamiento de siempre (trigger al principal de la org; RPCs en modo
 *    global/drain, que le permite a un ADMIN "todas" descontar de donde haya stock).
 *
 * Es un DESTINO por defecto, no un chequeo de seguridad: por eso puede apoyarse en
 * la cookie de vista. Un id enviado por el cliente se valida con `depositoPermitido`.
 */
export async function depositoPorDefecto(params: {
  organizationId: string
  role: string | null
  userSucursalId: string | null
}): Promise<string | null> {
  const lectura = await sucursalParaLectura({
    role: params.role,
    userSucursalId: params.userSucursalId,
  })
  if (lectura.verTodas || !lectura.sucursalId || lectura.sucursalId === SUCURSAL_NINGUNA) {
    return null
  }
  return getDepositoDeSucursal(params.organizationId, lectura.sucursalId)
}

/**
 * Mueve el stock inicial de un item recien creado al deposito elegido.
 *
 * El trigger de la migracion 291 ya sembro la fila en el principal de la org. Se
 * mueve con un UPDATE de deposito_id: inventario_depositos solo tiene el trigger
 * BEFORE UPDATE de updated_at (169) y UNIQUE(inventario_id, deposito_id), y el
 * item recien creado no tiene otra fila, asi que no hay choque ni se dispara
 * logica de stock. La invariante stock = SUM(detalle) se mantiene.
 * Si falla LANZA: el llamador decide (el item ya existe, no conviene un 500).
 */
export async function moverStockInicialADeposito(params: {
  inventarioId: string
  depositoId: string
  stock: number
  organizationId: string
}): Promise<void> {
  const { inventarioId, depositoId, stock, organizationId } = params

  const { data: principalId, error: principalError } = await supabaseAdmin.rpc(
    "get_deposito_principal",
    { p_org_id: organizationId }
  )
  if (principalError) throw principalError
  // Ya cayo donde corresponde: nada que mover.
  if (principalId === depositoId) return

  if (principalId) {
    const { data: movidas, error: updateError } = await supabaseAdmin
      .from("inventario_depositos")
      .update({ deposito_id: depositoId })
      .eq("inventario_id", inventarioId)
      .eq("deposito_id", principalId)
      .eq("organization_id", organizationId)
      .select("id")
    if (updateError) throw updateError
    if (movidas && movidas.length > 0) return
  }

  // Org sin principal (el trigger no sembro nada) o fila ausente: se crea el
  // detalle directo en el deposito elegido para sostener la invariante.
  const { error: insertError } = await supabaseAdmin
    .from("inventario_depositos")
    .insert({
      inventario_id: inventarioId,
      deposito_id: depositoId,
      stock,
      stock_reservado: 0,
      organization_id: organizationId,
    })
  if (insertError) throw insertError
}

const LOTE_MOVER_STOCK = 200

/**
 * Version por lote de `moverStockInicialADeposito` para altas masivas: mueve las
 * filas sembradas por el trigger (migracion 291) en el principal de la org al
 * deposito elegido, con un UPDATE por tramo de ids. LANZA si falla. A diferencia
 * de la version unitaria no crea detalle faltante: una org sin principal no
 * siembra nada y tampoco tiene deposito de sucursal al que mover.
 */
export async function moverStockInicialLote(params: {
  inventarioIds: string[]
  depositoId: string
  organizationId: string
}): Promise<void> {
  const { inventarioIds, depositoId, organizationId } = params
  if (inventarioIds.length === 0) return

  const { data: principalId, error: principalError } = await supabaseAdmin.rpc(
    "get_deposito_principal",
    { p_org_id: organizationId }
  )
  if (principalError) throw principalError
  if (!principalId || principalId === depositoId) return

  for (let i = 0; i < inventarioIds.length; i += LOTE_MOVER_STOCK) {
    const { error } = await supabaseAdmin
      .from("inventario_depositos")
      .update({ deposito_id: depositoId })
      .in("inventario_id", inventarioIds.slice(i, i + LOTE_MOVER_STOCK))
      .eq("deposito_id", principalId)
      .eq("organization_id", organizationId)
    if (error) throw error
  }
}
