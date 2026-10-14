import { formatDateTimeValue, formatDateValue } from "@/lib/timezone"
import type { NotaCreditoTicketData } from "@/lib/escpos"
import { ORIGEN_NC_LABELS, etiquetaMotivo, etiquetaReintegro, numeroOperacion } from "./catalogo"
import type { NotaCreditoDocumento } from "./documento"

/**
 * Del documento al ticket: códigos traducidos y fechas en la zona de la
 * organización (nunca la del navegador ni la del servidor). `ahora` existe
 * para que los tests no dependan del reloj.
 */
export function ticketDesdeDocumento(doc: NotaCreditoDocumento, ahora: Date = new Date()): NotaCreditoTicketData {
  const tz = doc.emisor.zonaHoraria
  return {
    numero: doc.numero,
    fecha: formatDateTimeValue(doc.fecha, tz),
    hoy: formatDateValue(ahora, tz),
    origen: doc.origen,
    operacion: `${ORIGEN_NC_LABELS[doc.origen]} ${numeroOperacion(doc.origen, doc.origenNumero)}`,
    cliente: doc.cliente.nombre,
    motivo: etiquetaMotivo(doc.motivoNc, doc.detalle),
    items: doc.items.map((i) => ({ descripcion: i.descripcion, cantidad: i.cantidad, subtotal: i.subtotal })),
    monto: doc.monto,
    montoAplicadoDeuda: doc.montoAplicadoDeuda,
    montoReembolso: doc.montoReembolso,
    etiquetaReintegro: etiquetaReintegro(doc.metodo),
    pendienteActual: doc.pendienteActual,
    anulada: doc.anulada,
    moneda: doc.emisor.moneda,
    nombreEmpresa: doc.emisor.nombreEmpresa,
    telefonoEmpresa: doc.emisor.telefonoEmpresa,
    direccionEmpresa: doc.emisor.direccionEmpresa,
  }
}
