/**
 * Las reglas del barrido diario de suscripciones, puras y testeables.
 *
 * Viven fuera del cron porque son decisiones sobre plata: bloquear a un taller
 * que si esta pagando, o regalarle el plan a uno que no. Adentro de la ruta no
 * se pueden probar sin levantar medio Supabase.
 */

/**
 * MercadoPago reintenta un cobro rechazado durante 10 dias, con un maximo de 4
 * intentos. Los 2 dias extra son margen para que llegue el webhook.
 *
 * NO se espera la cancelacion que reporta MercadoPago: recien cancela tras 3
 * cuotas rechazadas, que son unos tres meses de servicio regalado.
 */
export const DIAS_GRACIA_PREAPPROVAL = 12

const MS_POR_DIA = 24 * 60 * 60 * 1000

function diasDesde(iso: string, ahora: Date): number {
  return (ahora.getTime() - new Date(iso).getTime()) / MS_POR_DIA
}

/**
 * Una adhesion al debito automatico cuyo primer cobro nunca llego.
 *
 * Queda ACTIVE con current_period_end en NULL, y el cron filtra los NULL: sin
 * esta regla no la barre nadie y la organizacion se queda con el plan pago para
 * siempre sin haber pagado nunca. Es la misma familia del bug de la migracion
 * 304: una regla que se aplica por fecha, sobre una fila donde la fecha no
 * existe.
 */
export function esAdhesionSinCobro(input: {
  tienePreapproval: boolean
  currentPeriodEnd: string | null
  /**
   * Desde cuándo corre la gracia: el momento en que se autorizó la adhesión
   * vigente (subscriptions.mercadopago_preapproval_at). En filas anteriores a
   * esa columna, la creación de la suscripción.
   */
  adhesionDesde: string
  /**
   * Pagos exitosos desde `adhesionDesde`. Un pago viejo (de un plan anterior,
   * de otra adhesión) no prueba que esta adhesión haya cobrado.
   */
  pagosExitosos: number
  ahora: Date
}): boolean {
  if (!input.tienePreapproval) return false
  if (input.currentPeriodEnd !== null) return false
  if (input.pagosExitosos > 0) return false

  return diasDesde(input.adhesionDesde, input.ahora) > DIAS_GRACIA_PREAPPROVAL
}

/** Desde cuándo se mide una adhesión: su autorización, o la creación de la fila si es vieja. */
export function inicioAdhesion(sub: {
  mercadopago_preapproval_at?: string | null
  created_at: string
}): string {
  return sub.mercadopago_preapproval_at ?? sub.created_at
}

/**
 * Si corresponde marcar PAST_DUE a una suscripcion con la fecha vencida.
 *
 * Con pago manual la fecha vencida significa exactamente eso: no pago. Con
 * debito automatico no, porque MercadoPago puede estar reintentando un cobro
 * que va a prosperar — y el 80% de los pagos salen de saldo, asi que el rebote
 * no es la excepcion. Bloquear ahi es cortarle el sistema a alguien que si te
 * va a pagar.
 */
export function venceLaGracia(input: {
  tienePreapproval: boolean
  currentPeriodEnd: string | null
  ahora: Date
}): boolean {
  if (input.currentPeriodEnd === null) return false
  if (!input.tienePreapproval) return true

  return diasDesde(input.currentPeriodEnd, input.ahora) > DIAS_GRACIA_PREAPPROVAL
}
