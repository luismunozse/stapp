import { supabaseAdmin } from "@/lib/supabase"
import { SUCURSAL_NINGUNA } from "@/lib/sucursal"

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
