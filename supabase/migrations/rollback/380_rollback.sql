-- Rollback of comisiones_recepcion (migration 380).
--
-- WARNING: this loses every order's frozen reception rate and the shop commission rules
-- (comisiones_config) recorded since 380 was applied. Run 381_rollback first: the
-- definition 381 creates reads these objects.
--
-- Export before removing anything:
--   SELECT * FROM comisiones_config;
--   SELECT id, organization_id, recibido_por, porcentaje_comision_recepcion FROM ordenes_servicio
--    WHERE porcentaje_comision_recepcion IS NOT NULL;
--   SELECT id, organization_id, porcentaje_comision_recepcion FROM users
--    WHERE porcentaje_comision_recepcion IS NOT NULL;

-- DROP COLUMN takes ACCESS EXCLUSIVE: do not queue behind a long transaction.
SET LOCAL lock_timeout = '3s';

DROP TRIGGER IF EXISTS trigger_ordenes_porcentaje_recepcion ON ordenes_servicio;
DROP FUNCTION IF EXISTS set_porcentaje_comision_recepcion();
DROP INDEX IF EXISTS reclamos_garantia_orden_reparacion_idx;
DROP TABLE IF EXISTS comisiones_config;

ALTER TABLE ordenes_servicio DROP CONSTRAINT IF EXISTS ordenes_servicio_porcentaje_recepcion_check;
ALTER TABLE ordenes_servicio DROP COLUMN IF EXISTS porcentaje_comision_recepcion;
ALTER TABLE users DROP COLUMN IF EXISTS porcentaje_comision_recepcion;
