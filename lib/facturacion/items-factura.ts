/**
 * Detalle de la factura de una orden.
 *
 * Cuatro fuentes en orden de precedencia estricta:
 *
 *   1. Cotización aprobada — es el documento que el cliente acepto y firmó, así
 *      que gana sobre cualquier otro numero de la orden. El subtotal sale de
 *      `cotizacion.total` y NO de la suma de los items: la cotizacion puede
 *      llevar descuento global, que vive en el total y no en las lineas.
 *   2. costo_final — se desglosa en las lineas cargadas (repuestos + servicios)
 *      y lo que sobra va a un renglon "Mano de obra".
 *   3. Sin costo_final pero con lineas cargadas — se facturan esas lineas.
 *   4. presupuesto — un unico renglon generico.
 *
 * POR QUE EXISTE EL RENGLON RESIDUAL
 *
 * costo_final es un campo manual: el operador puede escribir un numero mayor
 * que la suma de las lineas. Ese excedente es trabajo real que hay que facturar,
 * y sin el renglon residual el total de la factura no cerraria con el de la
 * orden. Cuando las lineas explican todo, el residual no se emite.
 *
 * NOTA SOBRE EL PRECIO DEL REPUESTO
 *
 * Se factura `repuestos_orden.precio_unitario`, que es el COSTO. Es el
 * comportamiento historico y no se cambia aca: el TOTAL de la factura es
 * correcto igual, porque la diferencia hasta costo_final cae en el renglon
 * residual. Corregirlo a `precio_venta_unitario` (migracion 286) mueve importes
 * por renglon de un documento fiscal y merece su propio cambio.
 */

interface LineaRepuesto {
  nombre?: string | null
  cantidad?: number | null
  precio_unitario?: number | string | null
}

interface LineaServicio {
  nombre?: string | null
  cantidad?: number | null
  precio_unitario?: number | string | null
}

interface ItemCotizacion {
  id: string
  descripcion: string
  cantidad: number
  precio_unitario: number | string
  subtotal: number | string
}

export interface ItemFactura {
  cotizacionItemId?: string
  descripcion: string
  cantidad: number
  precioUnitario: number
  subtotal: number
  tipo: "REPUESTO" | "SERVICIO" | "MANO_DE_OBRA"
}

function numero(valor: unknown): number {
  const n = typeof valor === "string" ? parseFloat(valor) : Number(valor)
  return Number.isFinite(n) ? n : 0
}

export function construirItemsFactura(input: {
  cotizacion?: { total: number | string; items?: ItemCotizacion[] | null } | null
  costoFinal?: number | string | null
  presupuesto?: number | string | null
  repuestos?: LineaRepuesto[] | null
  servicios?: LineaServicio[] | null
}): { items: ItemFactura[]; subtotal: number } {
  const cotizacionItems = input.cotizacion?.items || []

  if (cotizacionItems.length > 0) {
    return {
      items: cotizacionItems.map((item) => ({
        cotizacionItemId: item.id,
        descripcion: item.descripcion,
        cantidad: item.cantidad,
        precioUnitario: numero(item.precio_unitario),
        subtotal: numero(item.subtotal),
        tipo: "SERVICIO" as const,
      })),
      subtotal: numero(input.cotizacion?.total),
    }
  }

  const lineas: ItemFactura[] = [
    ...(input.repuestos || []).map((r) => {
      const cantidad = numero(r.cantidad)
      const precioUnitario = numero(r.precio_unitario)
      return {
        descripcion: r.nombre || "Repuesto",
        cantidad,
        precioUnitario,
        subtotal: cantidad * precioUnitario,
        tipo: "REPUESTO" as const,
      }
    }),
    ...(input.servicios || []).map((s) => {
      const cantidad = numero(s.cantidad)
      const precioUnitario = numero(s.precio_unitario)
      return {
        descripcion: s.nombre || "Servicio",
        cantidad,
        precioUnitario,
        subtotal: cantidad * precioUnitario,
        tipo: "SERVICIO" as const,
      }
    }),
  ]

  const totalLineas = lineas.reduce((sum, i) => sum + i.subtotal, 0)

  if (input.costoFinal != null && numero(input.costoFinal) > 0) {
    const subtotal = numero(input.costoFinal)
    const residual = Math.round((subtotal - totalLineas) * 100) / 100

    if (residual > 0) {
      lineas.push({
        descripcion: "Mano de obra",
        cantidad: 1,
        precioUnitario: residual,
        subtotal: residual,
        tipo: "MANO_DE_OBRA",
      })
    }

    return { items: lineas, subtotal }
  }

  if (lineas.length > 0) {
    return { items: lineas, subtotal: totalLineas }
  }

  if (input.presupuesto != null && numero(input.presupuesto) > 0) {
    const monto = numero(input.presupuesto)
    return {
      items: [
        {
          descripcion: "Servicio de reparación",
          cantidad: 1,
          precioUnitario: monto,
          subtotal: monto,
          tipo: "SERVICIO",
        },
      ],
      subtotal: monto,
    }
  }

  return { items: [], subtotal: 0 }
}
