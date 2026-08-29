-- Rollback de la migracion 320.
--
-- Elimina la funcion crear_reparaciones_express, la columna
-- pago_idempotency.cliente_id y la clave "reparaciones_express" de
-- plans.feature_flags.
--
-- PERDIDA DE DATOS: la columna cliente_id de pago_idempotency es hoy la unica
-- forma de distinguir, entre las filas de esa tabla, cuales corresponden a un
-- lote de reparaciones express (vienen con venta_id, orden_id y factura_id en
-- NULL, y solo cliente_id lleno). Al borrar la columna se pierde ese dato: las
-- filas en si NO se borran (idempotency_key, organization_id, response,
-- created_at quedan intactos), pero después del rollback quedan indistinguibles
-- de una fila "huerfana" con las cuatro referencias en NULL.
--
-- Las ordenes ya creadas por crear_reparaciones_express (y sus CARGO en
-- cuenta_corriente) NO se tocan: son filas comunes de ordenes_servicio /
-- cuenta_corriente, ajenas a que la función siga existiendo o no. Nada de eso
-- se pierde con este rollback.
--
-- Quitar la feature flag no borra datos: solo deja de ofrecerse la funcionalidad
-- a los planes Profesional y Pro hacia adelante.
--
-- Antes de correr este rollback, exportar el estado con:
--
--   SELECT organization_id, idempotency_key, cliente_id, response, created_at
--   FROM pago_idempotency
--   WHERE cliente_id IS NOT NULL;

DROP FUNCTION IF EXISTS crear_reparaciones_express(TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT);

ALTER TABLE pago_idempotency
  DROP COLUMN IF EXISTS cliente_id;

UPDATE plans SET
  feature_flags = feature_flags - 'reparaciones_express',
  updated_at = NOW()
WHERE slug IN ('profesional', 'pro');
