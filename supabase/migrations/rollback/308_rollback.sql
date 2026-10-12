-- Rollback de la migracion 308.
--
-- Se pierde el texto libre que escribieron los usuarios del rubro generico.
-- No afecta el funcionamiento: los tipos y el vocabulario ya quedaron sembrados
-- en tipos_dispositivo y organizations.terminologia cuando se registraron.
-- Lo unico que se pierde es la trazabilidad y el insumo de producto para
-- decidir que pack curar despues.

DROP INDEX IF EXISTS organizations_rubro_detalle_idx;

ALTER TABLE organizations DROP COLUMN IF EXISTS rubro_detalle;
