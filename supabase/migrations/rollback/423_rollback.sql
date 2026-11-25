-- Rollback de la 423: borra el registro central de errores. El codigo tolera
-- que la tabla no exista (lib/error-log.ts nunca lanza).
DROP TABLE IF EXISTS error_logs;
