/**
 * Cuándo se puede anular una nota de crédito de orden (tabla notas_credito).
 *
 * Anular marca el documento (`anulada = true`) y nada más. No hay forma segura
 * de deshacer lo que la NC ya movió:
 *  - EFECTIVO: el egreso de caja ya salió del cajón (y puede ser de una sesión
 *    cerrada); un ingreso compensatorio supondría que el cliente devolvió la plata.
 *  - CUENTA_CORRIENTE: el crédito pudo haberse consumido ya.
 *  - TRANSFERENCIA / TARJETA / MERCADOPAGO / OTRO: la plata se devolvió por fuera
 *    del sistema; anular el documento no la trae de vuelta.
 *  - Ítems con reposición de stock: lo repuesto pudo haberse vendido.
 * Esas NC no se anulan: el movimiento inverso se registra a mano (ingreso de
 * caja, cargo en cuenta corriente, ajuste de stock). Se pueden anular las que
 * no reintegraron nada (sin método o NC interna) y no repusieron stock.
 */

/** Métodos que no mueven dinero: anular la NC no deja nada vivo. */
const METODOS_SIN_REINTEGRO = new Set(["NOTA_CREDITO_INTERNA"])

export interface NotaCreditoParaAnular {
  metodo_devolucion: string | null
  items_nota_credito?: { inventario_id: string | null; restock: boolean | null }[] | null
}

/** null si se puede anular; si no, el mensaje para el usuario. */
export function motivoBloqueoAnulacionNC(nc: NotaCreditoParaAnular): string | null {
  const repusoStock = (nc.items_nota_credito ?? []).some((i) => i.restock !== false && !!i.inventario_id)
  if (repusoStock) {
    return "No se puede anular: la nota de crédito repuso stock. Registrá el ajuste de stock a mano si corresponde."
  }
  const metodo = nc.metodo_devolucion
  if (metodo && !METODOS_SIN_REINTEGRO.has(metodo)) {
    return "No se puede anular: la nota de crédito ya devolvió dinero al cliente (caja, cuenta corriente u otro medio). Registrá el movimiento inverso a mano si corresponde."
  }
  return null
}
