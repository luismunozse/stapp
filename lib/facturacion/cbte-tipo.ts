/**
 * Códigos de `FEParamGetTiposCbte` que STApp emite y cómo distinguir una nota de
 * crédito fiscal de una factura.
 *
 * Módulo client-safe a propósito (sin imports): lo usan la ruta de emisión, los
 * lectores del listado y la UI. Las filas se distinguen por `cbte_tipo` y no por
 * `comprobante_asociado_id` para que el código que lee no dependa de la
 * migración 371: `cbte_tipo` existe desde la 370 y un CHECK de la 371 deja a
 * ambos criterios equivalentes.
 */

/** Facturas: B = 6, C = 11. */
export const CBTE_TIPO_FACTURA = { B: 6, C: 11 } as const

/** Notas de crédito: B = 8, C = 13. */
export const CBTE_TIPO_NOTA_CREDITO = { B: 8, C: 13 } as const

const CODIGOS_NOTA_CREDITO: readonly number[] = Object.values(CBTE_TIPO_NOTA_CREDITO)

/**
 * `true` si el `cbte_tipo` es una nota de crédito fiscal. Una fila legada sin
 * `cbte_tipo` (anterior a la migración 370) es siempre una factura.
 */
export function esNotaCreditoFiscal(cbteTipo: number | null | undefined): boolean {
  return cbteTipo != null && CODIGOS_NOTA_CREDITO.includes(cbteTipo)
}

/**
 * Filtro de PostgREST (`.or(FILTRO_SIN_NC)`) que deja solo facturas, incluidas
 * las filas legadas con `cbte_tipo` NULL. Un `NOT IN` pelado las descartaría,
 * porque en SQL `NULL NOT IN (...)` no es verdadero.
 */
export const FILTRO_SIN_NC = `cbte_tipo.is.null,cbte_tipo.not.in.(${CODIGOS_NOTA_CREDITO.join(",")})`
