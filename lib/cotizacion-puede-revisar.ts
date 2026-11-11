/**
 * ¿Se ofrece "Modificar" (crear una revisión) para esta cotización?
 *
 * Espeja los guards de POST /api/cotizaciones/[id]/revisar: solo una ACEPTADA
 * vigente (no reemplazada) que todavía no se convirtió en venta ni en orden.
 * El servidor es el que manda; esto solo evita mostrar un botón que va a fallar.
 */
export function puedeRevisar(c: {
  estado: string
  reemplazadaPor?: string | null
  ventaId?: string | null
  convertidaAOrdenId?: string | null
}): boolean {
  return c.estado === "ACEPTADA" && !c.reemplazadaPor && !c.ventaId && !c.convertidaAOrdenId
}
