-- Rollback de tecnicos_ven_deuda_clientes (405). El código tolera la columna
-- ausente (fail-closed y escalonado en /api/configuracion), así que puede quedar.
SET LOCAL lock_timeout = '3s';

ALTER TABLE organizations DROP COLUMN IF EXISTS tecnicos_ven_deuda_clientes;
