/**
 * Elegibilidad "por fila" que el listado de comprobantes le informa a la UI: si
 * una factura se puede anular y si una nota de crédito se puede verificar.
 *
 * Espeja lo que la ruta de anulación y la de verificación revisan sobre la fila
 * misma (antes de llamar a ARCA). Lo que NO puede ver es que haya otra nota de
 * crédito en curso para la factura: eso depende de las filas hermanas, y lo
 * combina la ficha de la venta. El servidor vuelve a validar todo igual.
 *
 * Client-safe: solo importa módulos sin dependencias de servidor.
 */
import { esNotaCreditoFiscal } from "./cbte-tipo"
import { parsearNumeroComprobante } from "./numero-comprobante"

export interface FilaAnulable {
  tipo?: string | null
  provider?: string | null
  estado?: string | null
  numero?: string | null
  cae?: string | null
  cbte_tipo?: number | null
}

/** Una factura B/C emitida directo con ARCA, con número y CAE legibles. */
export function esFacturaAnulable(fila: FilaAnulable): boolean {
  return (
    !esNotaCreditoFiscal(fila.cbte_tipo) &&
    (fila.provider === "arca" || fila.provider === "arca_delegado") &&
    (fila.tipo === "B" || fila.tipo === "C") &&
    fila.estado === "emitido" &&
    Boolean(fila.cae) &&
    parsearNumeroComprobante(fila.numero) !== null
  )
}

export interface FilaVerificable {
  cbte_tipo?: number | null
  estado?: string | null
  cbte_nro_solicitado?: number | null
}

/** Una nota de crédito pendiente que ya tiene el número que se pidió a ARCA. */
export function esNotaCreditoVerificable(fila: FilaVerificable): boolean {
  return (
    esNotaCreditoFiscal(fila.cbte_tipo) &&
    fila.estado === "pendiente" &&
    typeof fila.cbte_nro_solicitado === "number" &&
    Number.isInteger(fila.cbte_nro_solicitado) &&
    fila.cbte_nro_solicitado >= 1
  )
}
