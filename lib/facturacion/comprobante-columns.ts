// Columnas de `comprobantes_fiscales` que las rutas de lectura/emision exponen.

import type { DatosFiscales, EmitirInput } from "@/lib/facturacion/types"

/**
 * Columnas seguras para devolver un comprobante al cliente. NUNCA incluir
 * provider_response: es la respuesta cruda del proveedor y puede traer datos
 * internos que no corresponde exponer.
 */
export const SAFE_COLUMNS =
  "id, venta_id, tipo, punto_venta, numero, cae, cae_vencimiento, estado, pdf_url, receptor_doc_tipo, receptor_doc_nro, receptor_condicion_iva, total, provider, error_msg, created_at, updated_at"

/**
 * Foto fiscal de lo que ARCA autorizo (migracion comprobantes_fiscales_datos_qr).
 * Antes de aplicar esa migracion estas columnas no existen: el SELECT falla con
 * 42703 y las rutas reintentan solo con SAFE_COLUMNS.
 */
export const SNAPSHOT_COLUMNS =
  "fecha_emision, cuit_emisor, cbte_tipo, moneda, cotizacion, importe_neto, importe_iva, importe_total, receptor_doc_tipo_cod, receptor_doc_nro_cod, detalle"

/**
 * Nota de credito / anulacion (migracion 371): a que factura anula, el numero
 * pedido a ARCA, el motivo y cuando quedo anulada la factura. Sin la migracion
 * estas columnas no existen: la anulacion responde 503 y NO hay escalon de
 * respaldo, porque sin ellas no se puede anular nada.
 */
export const NC_COLUMNS = "comprobante_asociado_id, cbte_nro_solicitado, motivo, motivo_detalle, anulado_at"

/**
 * Foto fiscal (`DatosFiscales`) en las columnas de `comprobantes_fiscales`. La
 * escriben la UPDATE de exito de la emision y el INSERT de la nota de credito,
 * asi que los dos comprobantes quedan con la misma forma.
 */
export function columnasFiscales(fiscal: DatosFiscales, detalle: EmitirInput["items"]) {
  return {
    fecha_emision: fiscal.fechaEmision,
    cuit_emisor: fiscal.cuitEmisor,
    cbte_tipo: fiscal.cbteTipo,
    concepto: fiscal.concepto,
    moneda: fiscal.moneda,
    cotizacion: fiscal.cotizacion,
    importe_neto: fiscal.importeNeto,
    importe_iva: fiscal.importeIva,
    importe_total: fiscal.importeTotal,
    receptor_doc_tipo_cod: fiscal.receptorDocTipoCod,
    receptor_doc_nro_cod: fiscal.receptorDocNro,
    detalle,
  }
}
