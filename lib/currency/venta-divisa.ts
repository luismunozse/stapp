/**
 * Pure decision of how each sale line priced in a foreign currency is converted to the local
 * currency, or why it cannot be sold. No server imports: the POS uses it too.
 */
import { round2 } from "@/lib/ventas/totales"
import { convertirALocal, unidadRedondeo } from "@/lib/currency/convert"
import type { MonedaCatalogo } from "@/lib/currency/catalogo"
import type { ConfigMoneda } from "@/lib/currency/config-moneda"
import type { ResultadoTipoCambio } from "@/lib/currency/tipo-cambio"

export type MotivoNoVendible = "DESHABILITADA" | "OTRA_DIVISA" | "SIN_COTIZACION"

/** null when the item can be sold (local currency, or foreign with everything in place). */
export function motivoNoVendible(
  moneda: MonedaCatalogo,
  config: ConfigMoneda | null | undefined,
  tc: ResultadoTipoCambio | null | undefined
): MotivoNoVendible | null {
  if (moneda === null) return null
  if (!config || !config.habilitada) return "DESHABILITADA"
  if (moneda !== config.monedaExtranjera) return "OTRA_DIVISA"
  if (!tc?.disponible) return "SIN_COTIZACION"
  return null
}

export function mensajeNoVendible(motivo: MotivoNoVendible, nombre: string, moneda: "USD" | "EUR"): string {
  switch (motivo) {
    case "DESHABILITADA":
      return `"${nombre}" tiene precio en ${moneda} y la moneda extranjera está deshabilitada.`
    case "OTRA_DIVISA":
      return `"${nombre}" tiene precio en ${moneda}, que ya no es la divisa de la organización.`
    case "SIN_COTIZACION":
      return `No hay cotización de ${moneda} disponible para vender "${nombre}". Cargá una manual en Configuración → Operativa.`
  }
}

export interface ItemCatalogoVenta {
  id: string
  nombre: string
  moneda: MonedaCatalogo
  precioVenta: number
  precioCompra: number | null
}

export interface LineaPedidaDivisa {
  inventarioId?: string | null
  precioOrigen?: number | null
}

export type ResultadoLineasDivisa =
  | {
      ok: true
      lineas: Array<{ moneda: "USD" | "EUR"; precioOrigen: number; precioLocal: number; costoLocal: number | null } | null>
      tipoCambio: number | null
    }
  | { ok: false; motivo: MotivoNoVendible; mensaje: string }

export function resolverLineasDivisa(params: {
  lineas: LineaPedidaDivisa[]
  catalogo: Map<string, ItemCatalogoVenta>
  config: ConfigMoneda | null
  tc: ResultadoTipoCambio | null
}): ResultadoLineasDivisa {
  const { catalogo, config, tc } = params
  const unidad = config ? unidadRedondeo(config.redondeoConversion, config.monedaLocal) : 0
  const lineas: Array<NonNullable<Extract<ResultadoLineasDivisa, { ok: true }>["lineas"][number]> | null> = []
  let hayDivisa = false

  for (const l of params.lineas) {
    const item = l.inventarioId ? catalogo.get(l.inventarioId) : undefined
    if (!item || item.moneda === null) {
      lineas.push(null)
      continue
    }
    const motivo = motivoNoVendible(item.moneda, config, tc)
    if (motivo || !tc?.disponible) {
      const m = motivo ?? "SIN_COTIZACION"
      return { ok: false, motivo: m, mensaje: mensajeNoVendible(m, item.nombre, item.moneda) }
    }
    hayDivisa = true
    const pedido = l.precioOrigen
    const precioOrigen = round2(
      typeof pedido === "number" && Number.isFinite(pedido) && pedido > 0 ? pedido : item.precioVenta
    )
    const compra = item.precioCompra
    const costoLocal =
      typeof compra === "number" && Number.isFinite(compra) && compra >= 0
        ? convertirALocal(round2(compra), tc.valor, unidad)
        : null
    lineas.push({
      moneda: item.moneda,
      precioOrigen,
      precioLocal: convertirALocal(precioOrigen, tc.valor, unidad),
      costoLocal,
    })
  }
  return { ok: true, lineas, tipoCambio: hayDivisa && tc?.disponible ? tc.valor : null }
}

/** POS: recompute the local unit price of foreign lines at a new rate; other lines untouched. */
export function aplicarCotizacionLineas<
  T extends { moneda?: "USD" | "EUR" | null; precioOrigen?: number | null; precioUnitario: number },
>(lineas: T[], tc: number, unidad: number): T[] {
  return lineas.map((l) => {
    if (!l.moneda || typeof l.precioOrigen !== "number" || !Number.isFinite(l.precioOrigen) || l.precioOrigen < 0) {
      return l
    }
    return { ...l, precioUnitario: convertirALocal(l.precioOrigen, tc, unidad) }
  })
}
