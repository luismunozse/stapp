// Decides what the client detail screen shows for debt / credit.
// saldo_cuenta < 0 means the client owes fiado (CARGO movements), so it must
// never be presented as "saldo a favor". Debt comes from deuda-sucursal
// (fiado + unpaid orders for the active sucursal).

export type DeudaTone = "destructive" | "info" | "muted"

export interface ResumenDeudaCliente {
  // null while deudaTotal is still loading
  debe: number | null
  aFavor: number
  debeTone: "destructive" | "muted"
  aFavorTone: "info" | "muted"
}

export function resumenDeudaCliente(input: {
  saldo: number | undefined
  deudaTotal: number | undefined
}): ResumenDeudaCliente {
  const aFavor = Math.max(input.saldo ?? 0, 0)
  const debe = input.deudaTotal === undefined ? null : Math.max(input.deudaTotal, 0)
  return {
    debe,
    aFavor,
    debeTone: debe !== null && debe > 0 ? "destructive" : "muted",
    aFavorTone: aFavor > 0 ? "info" : "muted",
  }
}

export function saldoCuentaDisplay(saldo: number): {
  label: string
  amount: number
  tone: DeudaTone
} {
  if (saldo < 0) return { label: "Debe (fiado)", amount: Math.abs(saldo), tone: "destructive" }
  return { label: "Saldo disponible", amount: saldo, tone: saldo > 0 ? "info" : "muted" }
}
