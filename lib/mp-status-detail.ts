/**
 * Traduce el `status_detail` de un pago de MercadoPago a un mensaje accionable
 * para el usuario final. Basado en los status_detail documentados por MP.
 *
 * El objetivo es recuperar ventas: en vez de un "pago rechazado" genérico, le
 * decimos al cliente QUÉ pasó y QUÉ hacer (revisar datos, llamar al banco,
 * usar otra tarjeta, etc.).
 */
export interface MpRejectionInfo {
  title: string
  message: string
  /**
   * true si reintentar con la MISMA tarjeta puede funcionar (ej. corregir un
   * dato, autorizar con el banco). false si conviene cambiar de tarjeta/medio.
   */
  canRetrySameCard: boolean
}

export function getMpRejectionInfo(
  statusDetail?: string | null
): MpRejectionInfo {
  switch (statusDetail) {
    case "cc_rejected_insufficient_amount":
      return {
        title: "Fondos insuficientes",
        message:
          "La tarjeta no tiene fondos suficientes. Probá con otra tarjeta o medio de pago.",
        canRetrySameCard: false,
      }
    case "cc_rejected_bad_filled_card_number":
      return {
        title: "Número de tarjeta incorrecto",
        message: "Revisá el número de la tarjeta e intentá de nuevo.",
        canRetrySameCard: true,
      }
    case "cc_rejected_bad_filled_date":
      return {
        title: "Fecha de vencimiento incorrecta",
        message: "Revisá la fecha de vencimiento de la tarjeta e intentá de nuevo.",
        canRetrySameCard: true,
      }
    case "cc_rejected_bad_filled_security_code":
      return {
        title: "Código de seguridad incorrecto",
        message: "Revisá el código de seguridad (CVV) e intentá de nuevo.",
        canRetrySameCard: true,
      }
    case "cc_rejected_bad_filled_other":
      return {
        title: "Datos incorrectos",
        message: "Revisá los datos de la tarjeta e intentá de nuevo.",
        canRetrySameCard: true,
      }
    case "cc_rejected_call_for_authorize":
      return {
        title: "Autorización requerida",
        message:
          "Tu banco necesita que autorices este pago. Llamá al banco o autorizalo desde su app, y volvé a intentar.",
        canRetrySameCard: true,
      }
    case "cc_rejected_card_disabled":
      return {
        title: "Tarjeta inhabilitada",
        message:
          "Llamá a tu banco para habilitar la tarjeta para compras online, o usá otra tarjeta.",
        canRetrySameCard: true,
      }
    case "cc_rejected_card_error":
      return {
        title: "Error con la tarjeta",
        message: "No pudimos procesar la tarjeta. Intentá de nuevo o usá otra.",
        canRetrySameCard: true,
      }
    case "cc_rejected_duplicated_payment":
      return {
        title: "Pago duplicado",
        message:
          "Ya registramos un pago por ese monto. Si necesitás pagar de nuevo, usá otra tarjeta o medio de pago.",
        canRetrySameCard: false,
      }
    case "cc_rejected_high_risk":
      return {
        title: "Pago rechazado por seguridad",
        message:
          "El pago fue rechazado por los controles de seguridad. Probá con otro medio de pago, preferentemente otra tarjeta de crédito.",
        canRetrySameCard: false,
      }
    case "cc_rejected_invalid_installments":
      return {
        title: "Cuotas no disponibles",
        message:
          "La tarjeta no permite esa cantidad de cuotas. Elegí otra opción de cuotas.",
        canRetrySameCard: true,
      }
    case "cc_rejected_max_attempts":
      return {
        title: "Demasiados intentos",
        message:
          "Llegaste al límite de intentos con esta tarjeta. Esperá un rato o probá con otra.",
        canRetrySameCard: false,
      }
    case "cc_rejected_blacklist":
      return {
        title: "Pago rechazado",
        message:
          "No pudimos procesar este pago. Probá con otra tarjeta o medio de pago.",
        canRetrySameCard: false,
      }
    case "cc_rejected_other_reason":
      return {
        title: "Rechazado por el banco",
        message:
          "El banco no procesó el pago. Intentá de nuevo o usá otra tarjeta.",
        canRetrySameCard: true,
      }
    default:
      return {
        title: "No pudimos procesar el pago",
        message:
          "El pago no se completó. Intentá de nuevo o usá otro medio de pago.",
        canRetrySameCard: true,
      }
  }
}
