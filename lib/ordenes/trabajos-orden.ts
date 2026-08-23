/**
 * Detalle de "Trabajo realizado" del comprobante de la orden.
 *
 * Junta las dos clases de línea que el cliente paga, con la advertencia de que
 * cada una guarda su precio en una columna distinta y con semántica opuesta:
 *
 *   repuestos_orden.precio_unitario        -> COSTO (lo leen los reportes de
 *                                             rentabilidad). NUNCA va acá.
 *   repuestos_orden.precio_venta_unitario  -> lo que se le cobra al cliente
 *                                             (migración 286).
 *   servicios_orden.precio_unitario        -> lo que se le cobra al cliente
 *                                             (un servicio es ingreso puro).
 *
 * Un repuesto anterior a la migración 286 tiene `precio_venta_unitario` en NULL
 * y aporta importe 0. Se lo lista igual: el cliente tiene que ver la pieza que
 * le pusieron aunque el importe viejo no se haya podido reconstruir.
 */

interface RepuestoLinea {
  nombre?: string | null
  cantidad?: number | null
  precio_venta_unitario?: number | string | null
  /** COSTO. Declarado solo para que el tipo refleje la fila real de
   *  repuestos_orden: construirTrabajos NUNCA lo lee. */
  precio_unitario?: number | string | null
  inventario?: { nombre?: string | null } | null
}

interface ServicioLinea {
  nombre?: string | null
  cantidad?: number | null
  precio_unitario?: number | string | null
}

export interface TrabajoRealizado {
  nombre: string
  cantidad: number
  importe: number
}

function texto(valor: unknown): string {
  if (valor === null || valor === undefined) return ""
  return String(valor).replace(/[\r\n]+/g, " ").trim()
}

function numero(valor: unknown): number {
  const n = typeof valor === "string" ? parseFloat(valor) : Number(valor)
  return Number.isFinite(n) ? n : 0
}

export function construirTrabajos(input: {
  repuestos?: RepuestoLinea[] | null
  servicios?: ServicioLinea[] | null
}): TrabajoRealizado[] | null {
  const repuestos = input.repuestos || []
  const servicios = input.servicios || []

  const trabajos: TrabajoRealizado[] = [
    ...repuestos.map((r) => {
      const cantidad = numero(r.cantidad)
      return {
        nombre: texto(r.nombre) || texto(r.inventario?.nombre),
        cantidad,
        importe: cantidad * numero(r.precio_venta_unitario),
      }
    }),
    ...servicios.map((s) => {
      const cantidad = numero(s.cantidad)
      return {
        nombre: texto(s.nombre),
        cantidad,
        importe: cantidad * numero(s.precio_unitario),
      }
    }),
  ]

  return trabajos.length > 0 ? trabajos : null
}
