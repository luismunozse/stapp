// Orden de los comprobantes de UNA venta para la ficha. El listado
// (`GET /api/facturacion-electronica/comprobantes?ventaId=...`) trae facturas y
// notas de credito electronicas mezcladas, la mas nueva primero; la ficha necesita
// cada factura con sus notas, la vigente aparte y el resto como historial.
// Puro y sin dependencias del servidor: lo usa el componente.

import type { ComprobanteFiscalDTO } from "@/lib/facturacion/comprobante-ui"

export interface FacturaConNotas {
  factura: ComprobanteFiscalDTO
  /**
   * Notas de credito electronicas de esta factura, la mas nueva primero. Solo las que
   * cuentan: la pendiente (anulacion en curso) y la emitida. Una rechazada no cambio
   * nada y se pierde de vista; el motivo del rechazo ya se mostro al intentar.
   */
  notasCredito: ComprobanteFiscalDTO[]
}

export interface ComprobantesDeVenta {
  /** La factura mas nueva: la que dice como esta facturada la venta hoy. */
  vigente: FacturaConNotas | null
  /** Facturas anteriores que quedaron anuladas, con su nota; la mas nueva primero. */
  historial: FacturaConNotas[]
}

const esNota = (fila: ComprobanteFiscalDTO) => fila.esNotaCredito === true
const cuenta = (nota: ComprobanteFiscalDTO) => nota.estado === "pendiente" || nota.estado === "emitido"

export function agruparComprobantesVenta(items: readonly ComprobanteFiscalDTO[]): ComprobantesDeVenta {
  const notas = items.filter((fila) => esNota(fila) && cuenta(fila))
  const conNotas = (factura: ComprobanteFiscalDTO): FacturaConNotas => ({
    factura,
    notasCredito: notas.filter((nota) => nota.comprobanteAsociadoId === factura.id),
  })

  const [vigente, ...anteriores] = items.filter((fila) => !esNota(fila))
  return {
    vigente: vigente ? conNotas(vigente) : null,
    // Un intento de emitir que ARCA rechazo hace tiempo no es historia: solo las anuladas lo son.
    historial: anteriores.filter((factura) => factura.estado === "anulado").map(conNotas),
  }
}

/**
 * Si la ficha ofrece "Anular factura". `anulable` es solo de la fila (proveedor ARCA,
 * emitida, con CAE y numero); a eso la ficha suma el permiso para facturar y que no
 * haya ya una nota en curso o emitida para esa factura.
 */
export function puedeAnularFactura({ factura, notasCredito }: FacturaConNotas, puedeFacturar: boolean): boolean {
  return puedeFacturar && factura.anulable === true && notasCredito.length === 0
}

/** La nota pendiente que se puede consultar a ARCA (el servidor dice cuales con `verificable`). */
export function notaCreditoPorVerificar({ notasCredito }: FacturaConNotas): ComprobanteFiscalDTO | null {
  return notasCredito.find((nota) => nota.estado === "pendiente" && nota.verificable === true) ?? null
}
