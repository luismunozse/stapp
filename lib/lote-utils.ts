export type DescuentoTipo = "porcentaje" | "monto"

export const round2 = (n: number) => Math.round(n * 100) / 100

export function calcularTotalLote(
  subtotal: number,
  tipo: DescuentoTipo | null,
  valor: number | null
): number {
  if (!tipo || !valor || valor <= 0) return round2(subtotal)
  const descuento = tipo === "porcentaje" ? subtotal * (valor / 100) : valor
  return Math.max(0, round2(subtotal - descuento))
}

export function prorratearLote(montos: number[], totalCobrado: number): number[] {
  const subtotal = montos.reduce((a, b) => a + b, 0)
  if (subtotal <= 0 || montos.length === 0) return montos.map(() => 0)
  const shares = montos.map((m) => round2((m * totalCobrado) / subtotal))
  const acumulado = shares.reduce((a, b) => a + b, 0)
  const resto = round2(totalCobrado - acumulado)
  // The rounding residual must land on the largest underlying monto (first
  // occurrence on ties), not blindly on the last index: a small negative
  // residual applied to a small (or zero) last share can push it below zero,
  // which is nonsensical for a montoCobro. The largest share has the most
  // room to absorb a one-cent adjustment without going negative.
  let maxIndex = 0
  for (let i = 1; i < montos.length; i++) {
    if (montos[i] > montos[maxIndex]) maxIndex = i
  }
  shares[maxIndex] = round2(shares[maxIndex] + resto)
  return shares
}
