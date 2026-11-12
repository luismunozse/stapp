-- Rollback of 406 (multimoneda S3): removes the re-quote audit trail and the quote rate metadata.
--
-- WHAT IS LOST: every recotizaciones row and the values in cotizaciones.tipo_cambio_fuente /
-- tipo_cambio_en. cotizaciones.tipo_cambio (082) is never touched. Export first if used:
--
--   SELECT * FROM recotizaciones;
--   SELECT id, tipo_cambio, tipo_cambio_fuente, tipo_cambio_en FROM cotizaciones WHERE tipo_cambio_fuente IS NOT NULL;
--
-- Run it only after the code that reads these is reverted.
-- LOCKS: ACCESS EXCLUSIVE on cotizaciones until the transaction ends; run it off-peak.

SET LOCAL lock_timeout = '3s';

DROP TABLE IF EXISTS recotizaciones;

ALTER TABLE cotizaciones
  DROP COLUMN IF EXISTS tipo_cambio_en,
  DROP COLUMN IF EXISTS tipo_cambio_fuente;
