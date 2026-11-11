/**
 * Lo que todavía se puede acreditar en notas de crédito sobre una orden: lo
 * cobrado menos las NC activas (no anuladas). Es el espejo del tope que
 * crear_nota_credito aplica en el servidor (migración 387).
 */
export function disponibleParaNotaCredito(
  totalCobrado: number,
  notas: readonly { monto: number; anulada: boolean | null }[]
): number {
  const previas = notas.reduce((acc, nc) => (nc.anulada ? acc : acc + (Number(nc.monto) || 0)), 0)
  return Math.max(0, Math.round(((Number(totalCobrado) || 0) - previas) * 100) / 100)
}
