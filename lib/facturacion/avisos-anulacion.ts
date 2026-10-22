import type { ResultadoAnulacion, ResultadoVerificacion } from "@/lib/facturacion/anular-comprobante-client"

/**
 * Como cuentan las pantallas (ficha de la venta y listado de /facturacion) un
 * desenlace de anular o verificar que no salio limpio. Lo limpio (`ok`) lo cuenta
 * cada pantalla a su manera, por eso aca devuelve `null`.
 *
 * Client-safe: solo importa tipos.
 */
/** Se suma al aviso de una anulacion hecha pasados los 15 dias que pide la RG 4540. */
export const AVISO_FUERA_DE_PLAZO = "Se emitió pasados los 15 días que pide la RG 4540. Consultalo con tu contador."

export type Aviso = { tono: "error" | "warning"; texto: string }

export function avisoDeAnulacion(resultado: ResultadoAnulacion): Aviso | null {
  switch (resultado.kind) {
    case "ok":
      return null
    case "autorizadaSinRegistrar":
    case "error":
      return { tono: "error", texto: resultado.message }
    default:
      // Envío incierto, otra pantalla ya la tocó o se cortó la conexión: hay que mirar, no es una falla.
      return { tono: "warning", texto: resultado.message }
  }
}

export function avisoDeVerificacion(resultado: ResultadoVerificacion): Aviso | null {
  switch (resultado.kind) {
    case "ok":
      return null
    case "soporte":
    case "autorizadaSinRegistrar":
    case "error":
      return { tono: "error", texto: resultado.message }
    default:
      // ARCA no la emitió, hay que esperar un rato o cambió mientras se verificaba.
      return { tono: "warning", texto: resultado.message }
  }
}
