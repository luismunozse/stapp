// Columnas de `comprobantes_fiscales` que las rutas de lectura/emision exponen.

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
