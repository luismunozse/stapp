export type DescuentoTipo = "porcentaje" | "monto"

const round2 = (n: number) => Math.round(n * 100) / 100

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
  shares[shares.length - 1] = round2(shares[shares.length - 1] + resto)
  return shares
}
