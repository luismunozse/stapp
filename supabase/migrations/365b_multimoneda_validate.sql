-- OPTIONAL, run later (any time after 365): validates the CHECKs that 365 added NOT VALID.
-- Run it as its OWN transaction, never inside 365.
--
-- Why a separate file: VALIDATE CONSTRAINT scans the whole table. Inside 365 the ACCESS
-- EXCLUSIVE lock of the ALTER would be held until commit, so the scan would block every read
-- and write. VALIDATE alone takes only SHARE UPDATE EXCLUSIVE (reads and writes keep working).
-- The columns were added all-NULL, so the constraints already hold for existing rows and every
-- new write is checked from the moment 365 commits; this file only flips convalidated.

SET LOCAL lock_timeout = '3s';

ALTER TABLE inventario VALIDATE CONSTRAINT inventario_moneda_chk;
ALTER TABLE servicios VALIDATE CONSTRAINT servicios_moneda_chk;
ALTER TABLE movimientos_caja VALIDATE CONSTRAINT movimientos_caja_moneda_chk;
ALTER TABLE items_venta VALIDATE CONSTRAINT items_venta_moneda_origen_chk;
ALTER TABLE items_venta VALIDATE CONSTRAINT items_venta_tipo_cambio_chk;
ALTER TABLE servicios_orden VALIDATE CONSTRAINT servicios_orden_moneda_origen_chk;
ALTER TABLE servicios_orden VALIDATE CONSTRAINT servicios_orden_tipo_cambio_chk;
ALTER TABLE repuestos_orden VALIDATE CONSTRAINT repuestos_orden_moneda_origen_chk;
ALTER TABLE repuestos_orden VALIDATE CONSTRAINT repuestos_orden_tipo_cambio_chk;
ALTER TABLE items_cotizacion VALIDATE CONSTRAINT items_cotizacion_moneda_origen_chk;
ALTER TABLE items_cotizacion VALIDATE CONSTRAINT items_cotizacion_tipo_cambio_chk;
ALTER TABLE ventas VALIDATE CONSTRAINT ventas_tipo_cambio_chk;
ALTER TABLE ordenes_servicio VALIDATE CONSTRAINT ordenes_servicio_tipo_cambio_chk;
ALTER TABLE pagos_venta VALIDATE CONSTRAINT pagos_venta_moneda_chk;
ALTER TABLE pagos_venta VALIDATE CONSTRAINT pagos_venta_tipo_cambio_chk;
ALTER TABLE pagos_venta VALIDATE CONSTRAINT pagos_venta_vuelto_moneda_chk;
