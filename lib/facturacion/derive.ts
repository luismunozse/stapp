import type { CondicionFiscalEmisor, TipoComprobante } from "./types"

// Slice 1: B/C only. Monotributo → C; Responsable Inscripto → B (Factura A out of scope).
export function deriveTipo(condicion: CondicionFiscalEmisor): TipoComprobante {
  return condicion === "MONOTRIBUTO" ? "C" : "B"
}

/**
 * `condicion_fiscal` de una fila de `facturacion_credenciales`. Sin dato se
 * emite como Monotributo: es lo que siempre hizo la emisión.
 */
export function condicionFiscalDeFila(valor: string | null | undefined): CondicionFiscalEmisor {
  return (valor ?? "MONOTRIBUTO") as CondicionFiscalEmisor
}

/**
 * Letra con la que sale la factura para esa fila de credenciales. Es la misma
 * cuenta que hace la emisión (`resolverCredenciales` + `deriveTipo`): lo que la
 * ficha anuncia antes de emitir no puede diferir de lo que se emite.
 */
export function tipoEmisionDeFila(row: { condicion_fiscal?: string | null }): TipoComprobante {
  return deriveTipo(condicionFiscalDeFila(row.condicion_fiscal))
}
