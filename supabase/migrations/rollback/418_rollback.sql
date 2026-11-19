-- Rollback de la 418. Falla si alguna orden ya tiene un remito anulado y otro
-- nuevo (dos filas con el mismo orden_id): en ese caso hay que decidir a mano
-- que hacer con el anulado antes de volver al UNIQUE.
ALTER TABLE facturas ADD CONSTRAINT facturas_orden_id_key UNIQUE (orden_id);
DROP INDEX IF EXISTS facturas_orden_id_activa_uniq;
DROP INDEX IF EXISTS facturas_orden_id_idx;
NOTIFY pgrst, 'reload schema';
