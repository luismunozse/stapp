-- ============================================================================
-- 404: asistente con datos (fase 1) — registro de herramientas por mensaje
-- ============================================================================
-- Cada respuesta del asistente puede consultar datos del taller con
-- herramientas de solo lectura. Se guarda qué consultó (nombre, parámetros,
-- filas devueltas, ms y error si hubo) para auditar qué datos se leyeron,
-- medir el costo real y depurar respuestas. NULL = no usó herramientas.
-- Aditiva y sin backfill: el código nuevo escribe la columna; el viejo la ignora.
-- ============================================================================
SET LOCAL lock_timeout = '3s';

ALTER TABLE asistente_mensajes
  ADD COLUMN IF NOT EXISTS herramientas JSONB;

COMMENT ON COLUMN asistente_mensajes.herramientas IS
  'Llamadas a herramientas de la respuesta: [{nombre, input, filas, ms, error?}]. NULL si no hubo.';
