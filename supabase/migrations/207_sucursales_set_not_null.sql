-- ========================================
-- 207: SUCURSALES — SET NOT NULL (diferido de Fase 1)
-- ========================================
-- Aplicar SOLO después de desplegar el código de Fase 2 (app-layer), que ya
-- escribe sucursal_id en órdenes/ventas/caja. users.sucursal_id queda nullable
-- (ADMIN = NULL = ve todas).
-- Pre-chequeo defensivo: abortar si quedó alguna fila con sucursal_id NULL.

DO $$
DECLARE
  v_nulos INTEGER;
BEGIN
  SELECT
    (SELECT COUNT(*) FROM ordenes_servicio WHERE sucursal_id IS NULL)
    + (SELECT COUNT(*) FROM ventas WHERE sucursal_id IS NULL)
    + (SELECT COUNT(*) FROM sesiones_caja WHERE sucursal_id IS NULL)
    + (SELECT COUNT(*) FROM movimientos_caja WHERE sucursal_id IS NULL)
    + (SELECT COUNT(*) FROM depositos WHERE sucursal_id IS NULL)
  INTO v_nulos;
  IF v_nulos > 0 THEN
    RAISE EXCEPTION 'Abort: % fila(s) con sucursal_id NULL. Backfillear antes de SET NOT NULL.', v_nulos;
  END IF;
END $$;

ALTER TABLE ordenes_servicio ALTER COLUMN sucursal_id SET NOT NULL;
ALTER TABLE ventas           ALTER COLUMN sucursal_id SET NOT NULL;
ALTER TABLE sesiones_caja    ALTER COLUMN sucursal_id SET NOT NULL;
ALTER TABLE movimientos_caja ALTER COLUMN sucursal_id SET NOT NULL;
ALTER TABLE depositos        ALTER COLUMN sucursal_id SET NOT NULL;
