-- Rollback of 416 (tecnicos_ven_telefono_clientes): drops the org preference.
--
-- WHAT IS LOST: which organizations had turned the permission off. After the rollback every
-- technician sees client phones again, which is the behaviour before 416.
--
-- Run it only after the code that reads the column is reverted.

SET LOCAL lock_timeout = '3s';

ALTER TABLE organizations DROP COLUMN IF EXISTS tecnicos_ven_telefono_clientes;
