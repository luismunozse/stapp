-- Rollback de 302_items_cotizacion_servicio.sql
-- Pierde el vínculo con el catálogo. `descripcion` y `precio_unitario` de cada
-- línea quedan intactos, así que ninguna cotización cambia de contenido.

DROP INDEX IF EXISTS items_cotizacion_servicio_idx;

ALTER TABLE items_cotizacion DROP COLUMN IF EXISTS servicio_id;
