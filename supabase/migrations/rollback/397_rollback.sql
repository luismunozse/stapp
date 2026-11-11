-- Rollback de superadmin_identidad_y_bloqueo (397). Volver primero al código
-- anterior: el actual lee estas columnas y sin ellas falla el login.
SET LOCAL lock_timeout = '3s';
DROP TRIGGER IF EXISTS users_es_superadmin_protegido ON users;
DROP FUNCTION IF EXISTS users_es_superadmin_protegido();
ALTER TABLE users DROP COLUMN IF EXISTS acceso_bloqueado_por;
ALTER TABLE users DROP COLUMN IF EXISTS acceso_bloqueado_at;
ALTER TABLE users DROP COLUMN IF EXISTS es_superadmin;
