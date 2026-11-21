import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

export const PRINCIPAL_CON_STOCK = "PRINCIPAL_CON_STOCK"

const PAGE_SIZE = 1000

export interface StockDeLaPrincipal {
  sucursalId: string
  sucursalNombre: string
  items: number
  unidades: number
}

/**
 * Stock que hoy vive en los depositos de la sucursal principal ACTUAL de la org.
 *
 * Promover otra sucursal a principal solo mueve flags: el stock se queda donde
 * esta, pero el POS "Todas las sucursales" y las altas sin deposito pasan a usar
 * el deposito de la nueva principal. Las rutas llaman a esto ANTES de escribir
 * para poder avisar.
 *
 * Devuelve null si la org no tiene principal. Un error de la base LANZA (la ruta
 * responde 500): seguir adelante sin saber cuanto stock hay seria promover a
 * ciegas justo cuando la base falla. supabase-js no lanza por si solo.
 */
export async function stockDeLaPrincipal(organizationId: string): Promise<StockDeLaPrincipal | null> {
  const { data: principal, error: principalErr } = await supabaseAdmin
    .from("sucursales")
    .select("id, nombre")
    .eq("organization_id", organizationId)
    .eq("principal", true)
    .is("deleted_at", null)
    .maybeSingle()
  if (principalErr) throw principalErr
  if (!principal) return null

  const { data: depositos, error: depositosErr } = await supabaseAdmin
    .from("depositos")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("sucursal_id", principal.id)
    .is("deleted_at", null)
  if (depositosErr) throw depositosErr

  const depositoIds = (depositos || []).map((d: { id: string }) => d.id)
  const itemsConStock = new Set<string>()
  let unidades = 0

  if (depositoIds.length > 0) {
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data: rows, error: rowsErr } = await supabaseAdmin
        .from("inventario_depositos")
        .select("inventario_id, stock, inventario:inventario_id!inner(deleted_at)")
        .eq("organization_id", organizationId)
        .in("deposito_id", depositoIds)
        .gt("stock", 0)
        .is("inventario.deleted_at", null)
        .order("id")
        .range(from, from + PAGE_SIZE - 1)
      if (rowsErr) throw rowsErr

      for (const row of rows || []) {
        itemsConStock.add(row.inventario_id)
        unidades += Number(row.stock) || 0
      }
      if ((rows?.length ?? 0) < PAGE_SIZE) break
    }
  }

  return {
    sucursalId: principal.id,
    sucursalNombre: principal.nombre,
    items: itemsConStock.size,
    unidades,
  }
}

/**
 * Si cambiar la principal dejaria stock en la sucursal vieja y el cliente no lo
 * confirmo, devuelve la respuesta 409 a enviar; si no, null (seguir como siempre).
 */
export async function avisoCambioDePrincipal(
  organizationId: string,
  confirmado: boolean | undefined
): Promise<NextResponse | null> {
  const actual = await stockDeLaPrincipal(organizationId)
  if (!actual || actual.items === 0 || confirmado === true) return null

  return NextResponse.json(
    {
      error: `${actual.sucursalNombre} tiene stock en su depósito. Cambiar la principal no mueve el stock.`,
      code: PRINCIPAL_CON_STOCK,
      sucursalActual: actual.sucursalNombre,
      items: actual.items,
      unidades: actual.unidades,
    },
    { status: 409 }
  )
}
