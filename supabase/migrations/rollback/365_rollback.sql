-- Rollback of M1 (multimoneda-inventario-servicios): removes everything 365 added.
--
-- WHAT IS LOST: organizacion_moneda (every organization's multi-currency settings and the
-- flag), sesion_caja_saldos (foreign-currency cash balances), and every value written in the
-- added columns (item currency, origin snapshots, rates, payment currency, change given).
-- If any organization already used the feature, export first:
--
--   SELECT * FROM organizacion_moneda;
--   SELECT * FROM sesion_caja_saldos;
--   SELECT id, organization_id, moneda FROM inventario WHERE moneda IS NOT NULL;
--
-- Local-currency money columns are never touched, so totals, costo_final and caja keep
-- their meaning. Run it only after the code that reads these columns is reverted, or while
-- the flag is off for everyone (no USD data yet).
--
-- LOCKS (held until the transaction ends): ACCESS EXCLUSIVE on every table below.
-- lock_timeout bounds the wait, not the hold; if it aborts, nothing was applied: re-run it.
-- Run it off-peak.

SET LOCAL lock_timeout = '3s';

DROP TABLE IF EXISTS sesion_caja_saldos;
DROP TABLE IF EXISTS organizacion_moneda;

-- Named CHECKs go with their columns; dropped explicitly first so a partial state also cleans up.
ALTER TABLE inventario DROP CONSTRAINT IF EXISTS inventario_moneda_chk;
ALTER TABLE servicios DROP CONSTRAINT IF EXISTS servicios_moneda_chk;
ALTER TABLE movimientos_caja DROP CONSTRAINT IF EXISTS movimientos_caja_moneda_chk;
ALTER TABLE items_venta DROP CONSTRAINT IF EXISTS items_venta_moneda_origen_chk;
ALTER TABLE items_venta DROP CONSTRAINT IF EXISTS items_venta_tipo_cambio_chk;
ALTER TABLE servicios_orden DROP CONSTRAINT IF EXISTS servicios_orden_moneda_origen_chk;
ALTER TABLE servicios_orden DROP CONSTRAINT IF EXISTS servicios_orden_tipo_cambio_chk;
ALTER TABLE repuestos_orden DROP CONSTRAINT IF EXISTS repuestos_orden_moneda_origen_chk;
ALTER TABLE repuestos_orden DROP CONSTRAINT IF EXISTS repuestos_orden_tipo_cambio_chk;
ALTER TABLE items_cotizacion DROP CONSTRAINT IF EXISTS items_cotizacion_moneda_origen_chk;
ALTER TABLE items_cotizacion DROP CONSTRAINT IF EXISTS items_cotizacion_tipo_cambio_chk;
ALTER TABLE ventas DROP CONSTRAINT IF EXISTS ventas_tipo_cambio_chk;
ALTER TABLE ordenes_servicio DROP CONSTRAINT IF EXISTS ordenes_servicio_tipo_cambio_chk;
ALTER TABLE pagos_venta DROP CONSTRAINT IF EXISTS pagos_venta_moneda_chk;
ALTER TABLE pagos_venta DROP CONSTRAINT IF EXISTS pagos_venta_tipo_cambio_chk;
ALTER TABLE pagos_venta DROP CONSTRAINT IF EXISTS pagos_venta_vuelto_moneda_chk;

ALTER TABLE pagos_venta
  DROP COLUMN IF EXISTS vuelto_moneda,
  DROP COLUMN IF EXISTS vuelto_monto,
  DROP COLUMN IF EXISTS tipo_cambio,
  DROP COLUMN IF EXISTS monto_moneda,
  DROP COLUMN IF EXISTS moneda;

ALTER TABLE ordenes_servicio
  DROP COLUMN IF EXISTS tipo_cambio_fuente,
  DROP COLUMN IF EXISTS tipo_cambio;
ALTER TABLE ventas
  DROP COLUMN IF EXISTS tipo_cambio_fuente,
  DROP COLUMN IF EXISTS tipo_cambio;

ALTER TABLE items_cotizacion
  DROP COLUMN IF EXISTS tipo_cambio,
  DROP COLUMN IF EXISTS precio_origen,
  DROP COLUMN IF EXISTS moneda_origen;
ALTER TABLE repuestos_orden
  DROP COLUMN IF EXISTS tipo_cambio,
  DROP COLUMN IF EXISTS precio_origen,
  DROP COLUMN IF EXISTS moneda_origen;
ALTER TABLE servicios_orden
  DROP COLUMN IF EXISTS tipo_cambio,
  DROP COLUMN IF EXISTS precio_origen,
  DROP COLUMN IF EXISTS moneda_origen;
ALTER TABLE items_venta
  DROP COLUMN IF EXISTS tipo_cambio,
  DROP COLUMN IF EXISTS precio_origen,
  DROP COLUMN IF EXISTS moneda_origen;

ALTER TABLE movimientos_caja DROP COLUMN IF EXISTS moneda;
ALTER TABLE servicios DROP COLUMN IF EXISTS moneda;
ALTER TABLE inventario DROP COLUMN IF EXISTS moneda;
