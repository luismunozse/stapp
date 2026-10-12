import type { CondicionFiscalEmisor, TipoComprobante } from "./types"

// Slice 1: B/C only. Monotributo → C; Responsable Inscripto → B (Factura A out of scope).
export function deriveTipo(condicion: CondicionFiscalEmisor): TipoComprobante {
  return condicion === "MONOTRIBUTO" ? "C" : "B"
}
