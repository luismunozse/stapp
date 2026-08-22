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
  createdAt: string
  pagosExitosos: number
  ahora: Date
}): boolean {
  if (!input.tienePreapproval) return false
  if (input.currentPeriodEnd !== null) return false
  if (input.pagosExitosos > 0) return false

  return diasDesde(input.createdAt, input.ahora) > DIAS_GRACIA_PREAPPROVAL
}
