-- Rollback de la migracion 338.
--
-- OJO: descarta los pedidos de eliminacion en curso (deletion_requested_at y
-- users.deleted_at). Las organizaciones ya archivadas por pedido del usuario
-- siguen archivadas (deleted_at de organizations no se toca), pero el cron
-- deja de saber cuales vencen. Correr solo si no hay pedidos vigentes.

DROP FUNCTION IF EXISTS solicitar_baja_usuario(TEXT);

DROP INDEX IF EXISTS users_deleted_at_idx;
DROP INDEX IF EXISTS organizations_deletion_requested_at_idx;

ALTER TABLE users DROP COLUMN IF EXISTS deleted_at;
ALTER TABLE organizations DROP COLUMN IF EXISTS deletion_requested_at;
