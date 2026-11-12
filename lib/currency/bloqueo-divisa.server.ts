import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

type Ids = (string | null | undefined)[] | undefined

function unicos(ids: Ids): string[] {
  return [...new Set((ids ?? []).filter((x): x is string => typeof x === "string" && x !== ""))]
}

async function buscarEnDivisa(
  tabla: "inventario" | "servicios",
  ids: string[],
  organizationId: string
): Promise<{ nombre: string; moneda: string } | null> {
  if (ids.length === 0) return null
  const { data, error } = await supabaseAdmin
    .from(tabla)
    .select("id, nombre, moneda")
    .in("id", ids)
    .eq("organization_id", organizationId)
  if (error) {
    // Column missing (migration 365 not applied): nothing can be in a foreign currency.
    if ((error as { code?: string }).code === "42703") return null
    throw error
  }
  const filas = (Array.isArray(data) ? data : data ? [data] : []) as Array<{ nombre: string; moneda: string | null }>
  const fila = filas.find((r) => r.moneda != null)
  return fila ? { nombre: fila.nombre, moneda: fila.moneda as string } : null
}

/**
 * Until currency conversion reaches sales, orders and quotes, catalog items priced in a foreign
 * currency must not enter them (their raw number would be charged as local currency).
 * Returns a 409 response for the first offending item, or null when everything is local.
 */
export async function rechazarItemsEnDivisa(params: {
  organizationId: string
  inventarioIds?: Ids
  servicioIds?: Ids
}): Promise<NextResponse | null> {
  const { organizationId } = params
  const ofensor =
    (await buscarEnDivisa("inventario", unicos(params.inventarioIds), organizationId)) ??
    (await buscarEnDivisa("servicios", unicos(params.servicioIds), organizationId))
  if (!ofensor) return null
  return NextResponse.json(
    {
      error: `"${ofensor.nombre}" tiene precio en ${ofensor.moneda}: todavía no se puede usar en ventas, órdenes ni cotizaciones.`,
      code: "ITEM_EN_DIVISA",
    },
    { status: 409 }
  )
}
