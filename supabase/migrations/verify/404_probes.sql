-- Verificación de 404: la columna existe y es jsonb. Debe devolver 1 fila.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'asistente_mensajes' AND column_name = 'herramientas' AND data_type = 'jsonb';
