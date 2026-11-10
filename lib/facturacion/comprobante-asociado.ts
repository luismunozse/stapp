/**
 * La factura que una nota de crédito electrónica anula, en lo que el PDF de la
 * NC necesita imprimir. Sin imports: lo usan la ruta del PDF, el generador y el
 * armado de la NC.
 */

/** Factura asociada a una nota de crédito, tal como se imprime en su PDF. */
export interface ComprobanteAsociado {
  tipo: "B" | "C"
  /** `PPPP-NNNNNNNN` de la factura. */
  numero: string
  /** `YYYY-MM-DD`, o `null` si no se pudo saber (la línea se imprime sin fecha). */
  fecha: string | null
}

/**
 * Descripción de la única línea de una NC sin detalle propio. Una sola fuente
 * para el armado del voucher y para el PDF: lo que se envió a ARCA y lo que se
 * imprime dicen lo mismo.
 */
export function descripcionAnulacion(tipo: "B" | "C", numero: string): string {
  return `Anulación de la factura ${tipo} ${numero}`
}

function esObjeto(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null
}

/**
 * Fecha (`YYYY-MM-DD`) de una factura emitida, leída de la respuesta de ARCA que
 * se guardó al emitirla (`provider_response`). Las facturas anteriores a la foto
 * fiscal no tienen `fecha_emision`, pero sí esta respuesta: el `CbteFch` de su
 * primer `FECAEDetResponse`. Cualquier forma inesperada da `null`.
 */
export function fechaDeRespuestaEmision(respuesta: unknown): string | null {
  if (!esObjeto(respuesta) || !esObjeto(respuesta.FeDetResp)) return null

  const detalles = respuesta.FeDetResp.FECAEDetResponse
  const primero = Array.isArray(detalles) ? detalles[0] : detalles
  if (!esObjeto(primero)) return null

  const cbteFch = primero.CbteFch
  const texto = typeof cbteFch === "number" ? String(cbteFch) : cbteFch
  const partes = typeof texto === "string" ? /^(\d{4})(\d{2})(\d{2})$/.exec(texto) : null
  if (!partes) return null

  const mes = Number(partes[2])
  const dia = Number(partes[3])
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null

  return `${partes[1]}-${partes[2]}-${partes[3]}`
}
