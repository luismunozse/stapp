-- Rollback de la migracion 349.
--
-- Elimina la funcion crear_reparaciones_express, la tabla
-- reparaciones_express_idempotencia y la clave "reparaciones_express" de
-- plans.feature_flags. No toca pago_idempotency.
--
-- PERDIDA DE DATOS: se borran las claves de idempotencia de los lotes express
-- (organization_id, idempotency_key, cliente_id, response, created_at). Solo
-- sirven para reintentos en curso, no son un registro contable.
--
-- Las ordenes ya creadas por crear_reparaciones_express (y sus CARGO en
-- cuenta_corriente) NO se tocan: son filas comunes de ordenes_servicio /
-- cuenta_corriente, ajenas a que la función siga existiendo o no.
--
-- Quitar la feature flag no borra datos: solo deja de ofrecerse la funcionalidad
-- a los planes Profesional y Pro hacia adelante.
--
-- Antes de correr este rollback, exportar el estado con:
--
--   SELECT * FROM reparaciones_express_idempotencia;

DROP FUNCTION IF EXISTS crear_reparaciones_express(TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT);

DROP TABLE IF EXISTS reparaciones_express_idempotencia;

UPDATE plans SET
  feature_flags = feature_flags - 'reparaciones_express',
  updated_at = NOW()
WHERE slug IN ('profesional', 'pro');
