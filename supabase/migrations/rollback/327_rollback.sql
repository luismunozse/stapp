-- Rollback de la 327. Seguro mientras el codigo desplegado no lea las columnas.
-- OJO: borra el rastro de las anulaciones hechas mientras estuvo aplicada; los
-- movimientos anulados vuelven a contar como vigentes.

DROP INDEX IF EXISTS idx_ventas_comision_pago_mov;
DROP INDEX IF EXISTS idx_ordenes_comision_pago_mov;
DROP INDEX IF EXISTS idx_movimientos_caja_origen;
DROP INDEX IF EXISTS idx_movimientos_caja_org_fecha_vigentes;

ALTER TABLE ventas DROP COLUMN IF EXISTS comision_pago_movimiento_id;
ALTER TABLE ordenes_servicio DROP COLUMN IF EXISTS comision_pago_movimiento_id;

ALTER TABLE movimientos_caja
  DROP COLUMN IF EXISTS origen_id,
  DROP COLUMN IF EXISTS origen_tipo,
  DROP COLUMN IF EXISTS anulado_motivo,
  DROP COLUMN IF EXISTS anulado_por,
  DROP COLUMN IF EXISTS anulado_at,
  DROP COLUMN IF EXISTS anulado;
