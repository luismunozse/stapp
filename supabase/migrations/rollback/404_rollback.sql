-- Rollback de asistente_mensajes_herramientas (404). Antes de correrlo, volver
-- el código a la versión sin herramientas: el insert de la ruta escribe la columna.
SET LOCAL lock_timeout = '3s';

ALTER TABLE asistente_mensajes DROP COLUMN IF EXISTS herramientas;
