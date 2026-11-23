import { precioVentaRepuesto } from "@/lib/db-utils"
import { cotizacionesVigentes, type CotizacionDeOrden } from "@/lib/servicios/suma-lineas-orden"

/**
 * Detalle de lo que se le cobra a una orden y la ganancia estimada, para la
 * tarjeta "Presupuesto y costos" (solo ADMIN: lleva costos).
 *
 * PRECIO: el mismo total que sumaLineasOrden / suma_lineas_orden (421):
 * cotizaciones vigentes + servicios y repuestos que suman aparte.
 *
 * COSTO, sin contar dos veces la misma pieza:
 *   - ítems de las cotizaciones vigentes: costo_unitario cargado en la
 *     cotización (o el precio de compra del inventario si no tiene);
 *   - repuestos que suman aparte: su costo;
 *   - repuestos marcados "en el presupuesto": son la misma pieza que un ítem
 *     de la cotización. Su costo cuenta SOLO si la cotización no trae ningún
 *     costo (lo habitual hoy: el costo vive en la pestaña Repuestos). Si la
 *     cotización ya trae costos, contarlos sería duplicar.
 *   - servicios: no tienen costo cargado; todo su precio es ganancia.
 * Es la misma regla que costo_repuestos_orden (migración 422), la base de la
 * comisión del técnico: cambiar una sin la otra hace que la ganancia que ve el
 * taller y la que comisiona el técnico no coincidan.
 * Las filas sin costo conocido muestran costo null y no restan.
 */

export interface ItemCotizacionDeOrden {
  id?: string
  descripcion?: string | null
  cantidad?: number | string | null
  precio_unitario?: number | string | null
  subtotal?: number | string | null
  costo_unitario?: number | string | null
  inventario?: { precio_compra?: number | string | null } | null
}

export interface FilaDetalleCobro {
  key: string
  concepto: string
  cantidad: number
  /** Lo que se cobra por esta fila; null si no suma (ya está en el presupuesto). */
  precio: number | null
  costo: number | null
  /** La fila está dentro del presupuesto y no suma aparte. */
  incluida: boolean
}

export interface GrupoDetalleCobro {
  titulo: string
  filas: FilaDetalleCobro[]
}

export interface DetalleCobro {
  grupos: GrupoDetalleCobro[]
  total: number
  costo: number
  ganancia: number
  /** Ganancia / total, 0..100. null si el total es 0. */
  margen: number | null
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const redondear = (n: number) => Math.round(n * 100) / 100

export function calcularDetalleCobro(input: {
  cotizaciones?: Array<CotizacionDeOrden & { items_cotizacion?: ItemCotizacionDeOrden[] | null }> | null
  servicios?: Array<{ id: string; nombre: string; cantidad: number; precioUnitario: number | string; incluidoEnPresupuesto?: boolean }> | null
  repuestos?: Array<{
    id: string
    nombre?: string | null
    inventario?: { nombre?: string | null } | null
    cantidad: number
    precioUnitario?: number | string | null
    precioVentaUnitario?: number | string | null
    incluidoEnPresupuesto?: boolean
  }> | null
}): DetalleCobro {
  const vigentes = cotizacionesVigentes(input.cotizaciones)
  const hayPresupuesto = vigentes.length > 0
  const grupos: GrupoDetalleCobro[] = []

  let cotizacionTraeCostos = false
  for (const c of vigentes) {
    const items = c.items_cotizacion || []
    const filas: FilaDetalleCobro[] = items.map((it, i) => {
      const cantidad = num(it.cantidad) ?? 0
      const costoUnit = num(it.costo_unitario) ?? num(it.inventario?.precio_compra)
      if (costoUnit !== null) cotizacionTraeCostos = true
      return {
        key: `cot-${c.id ?? ""}-${it.id ?? i}`,
        concepto: it.descripcion || "Ítem",
        cantidad,
        // subtotal ya trae el descuento de la línea.
        precio: num(it.subtotal) ?? cantidad * (num(it.precio_unitario) ?? 0),
        costo: costoUnit === null ? null : cantidad * costoUnit,
        incluida: false,
      }
    })
    // Descuento global / IVA de la cotización: el total manda. La diferencia
    // contra la suma de ítems va como una fila aparte para que cierre.
    const sumaItems = filas.reduce((s, f) => s + (f.precio ?? 0), 0)
    const ajuste = redondear((num(c.total) ?? 0) - sumaItems)
    if (Math.abs(ajuste) >= 0.01) {
      filas.push({
        key: `cot-${c.id ?? ""}-ajuste`,
        concepto: ajuste < 0 ? "Descuento del presupuesto" : "IVA / recargo del presupuesto",
        cantidad: 1,
        precio: ajuste,
        costo: null,
        incluida: false,
      })
    }
    grupos.push({ titulo: `Presupuesto ${c.numero_cotizacion ?? ""}`.trim(), filas })
  }

  const servicios = (input.servicios || []).map((s): FilaDetalleCobro => {
    const incluida = hayPresupuesto && !!s.incluidoEnPresupuesto
    return {
      key: `srv-${s.id}`,
      concepto: s.nombre,
      cantidad: s.cantidad,
      precio: incluida ? null : s.cantidad * (num(s.precioUnitario) ?? 0),
      costo: null,
      incluida,
    }
  })
  if (servicios.length > 0) grupos.push({ titulo: "Servicios", filas: servicios })

  const repuestos = (input.repuestos || []).map((r): FilaDetalleCobro => {
    const incluida = hayPresupuesto && !!r.incluidoEnPresupuesto
    const costoUnit = num(r.precioUnitario)
    const cuentaCosto = !incluida || !cotizacionTraeCostos
    return {
      key: `rep-${r.id}`,
      concepto: r.inventario?.nombre || r.nombre || "Repuesto",
      cantidad: r.cantidad,
      precio: incluida ? null : r.cantidad * (precioVentaRepuesto(r) ?? 0),
      costo: costoUnit === null || !cuentaCosto ? null : r.cantidad * costoUnit,
      incluida,
    }
  })
  if (repuestos.length > 0) grupos.push({ titulo: "Repuestos", filas: repuestos })

  const filas = grupos.flatMap((g) => g.filas)
  const total = redondear(filas.reduce((s, f) => s + (f.precio ?? 0), 0))
  const costo = redondear(filas.reduce((s, f) => s + (f.costo ?? 0), 0))
  const ganancia = redondear(total - costo)
  return {
    grupos,
    total,
    costo,
    ganancia,
    margen: total > 0 ? Math.round((ganancia / total) * 1000) / 10 : null,
  }
}
