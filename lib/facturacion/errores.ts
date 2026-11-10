/**
 * Los `error_msg` de `comprobantes_fiscales` los lee el ADMIN en la ficha de la
 * venta y en el listado. Distinguimos dos familias:
 *
 *  - Rechazos de negocio (Errores/Observaciones de WSFE, alícuota no soportada):
 *    son accionables y se muestran tal cual.
 *  - Excepciones (red, SOAP, SDK, WSAA, timeouts): exponen detalles internos y
 *    no le sirven al taller. Se guarda un mensaje genérico y el detalle va al log.
 */
export const MENSAJE_ERROR_TECNICO =
  "No pudimos comunicarnos con ARCA. Probá de nuevo en unos minutos."

/** Error cuyo mensaje es seguro y útil para mostrarle al taller. */
export class ErrorDeNegocioFacturacion extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ErrorDeNegocioFacturacion"
  }
}

/** Mensaje persistible/mostrable para una excepción; loguea el detalle crudo. */
export function mensajeSeguroDeError(e: unknown, contexto: string): string {
  if (e instanceof ErrorDeNegocioFacturacion) return e.message
  console.error(`[facturacion] ${contexto}`, e)
  return MENSAJE_ERROR_TECNICO
}
