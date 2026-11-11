-- Rollback de garantias_configuracion_avisos (402): saca las columnas de
-- configuración de garantías de organizations y la marca de aviso de
-- garantias y garantias_venta.
--
-- Revertir el deploy ANTES de correr este rollback: la app de la fase 3 lee y
-- escribe estas columnas (la lectura tolera que falten, la escritura no).
--
-- OJO, pierde datos:
--   - Los términos de garantía que cada org haya cargado.
--   - La ventana y el aviso configurados (vuelven a 7 días y sin aviso).
--   - Qué garantías ya recibieron el aviso: si se vuelve a aplicar la 402 con
--     el aviso prendido, esas garantías se avisan de nuevo.
--
-- NO saca los valores GARANTIA_POR_VENCER ni REINGRESO_GARANTIA de
-- tipo_notificacion: Postgres no borra valores de un enum, y las filas de
-- notification_logs que los usan quedan como están.

SET LOCAL lock_timeout = '3s';

ALTER TABLE garantias_venta DROP COLUMN IF EXISTS aviso_vencimiento_enviado_at;
ALTER TABLE garantias DROP COLUMN IF EXISTS aviso_vencimiento_enviado_at;

ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_garantia_ventana_rango;
ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_garantia_terminos_largo;
ALTER TABLE organizations DROP COLUMN IF EXISTS garantia_aviso_vencimiento;
ALTER TABLE organizations DROP COLUMN IF EXISTS garantia_ventana_por_vencer_dias;
ALTER TABLE organizations DROP COLUMN IF EXISTS garantia_terminos;
