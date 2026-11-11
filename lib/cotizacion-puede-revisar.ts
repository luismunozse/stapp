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

/**
 * Por qué una ACEPTADA no admite edición en el lugar (null = se puede).
 * La usan el PUT de /api/cotizaciones/[id] y la UI para mostrar "Editar".
 */
export function motivoNoEditableAceptada(c: {
  venta_id?: string | null
  convertida_a_orden_id?: string | null
  reemplazada_por?: string | null
  origen?: string | null
}): string | null {
  if (c.venta_id) return "Esta cotización ya se convirtió en una venta; no se puede modificar"
  if (c.convertida_a_orden_id) return "Este presupuesto ya se convirtió en una orden; no se puede modificar"
  if (c.reemplazada_por) return "Esta cotización ya fue reemplazada por una revisión; modificá la vigente"
  // Las del catálogo público reservan por su propio libro (migración 315);
  // conciliarlas con reservar_items_cotizacion reservaría dos veces.
  if (c.origen === "CATALOGO_PUBLICO") {
    return "Una solicitud del catálogo aceptada no se puede modificar; creá una cotización nueva"
  }
  return null
}

/**
 * ¿Se muestra "Editar"? Toda cotización salvo las RECHAZADAS; una ACEPTADA
 * solo si el PUT la acepta (ver motivoNoEditableAceptada).
 */
export function puedeEditar(c: {
  estado: string
  ventaId?: string | null
  convertidaAOrdenId?: string | null
  reemplazadaPor?: string | null
  origen?: string | null
}): boolean {
  if (c.estado === "RECHAZADA") return false
  if (c.estado !== "ACEPTADA") return true
  return (
    motivoNoEditableAceptada({
      venta_id: c.ventaId,
      convertida_a_orden_id: c.convertidaAOrdenId,
      reemplazada_por: c.reemplazadaPor,
      origen: c.origen,
    }) === null
  )
}
