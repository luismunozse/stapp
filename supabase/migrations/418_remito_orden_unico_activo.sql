-- ============================================================================
-- 418: una orden puede volver a tener remito si el anterior se anulo
-- ============================================================================
-- ORDEN DE DESPLIEGUE: aplicar ANTES de mergear el codigo. El codigo nuevo
-- trata el embed facturas de una orden como lista; sin la migracion sigue
-- funcionando igual que hoy (un remito por orden, anulado o no).
-- Un archivo por vez: node scripts/db-run.mjs supabase/migrations/418_...sql
-- (dry-run por defecto, --apply para confirmar). Sin BEGIN/COMMIT a proposito.
--
-- PROBLEMA
-- facturas.orden_id es UNIQUE desde la 001. Un remito ANULADA sigue ocupando
-- el lugar: la orden nunca puede generar otro ("Ya existe un remito para esta
-- orden"). En prod (2026-11-19) hay 2 ordenes ENTREGADO en esa situacion.
--
-- CAMBIO
-- El UNIQUE pasa a ser parcial: un solo remito NO anulado por orden. Los
-- anulados quedan como historial.
--
-- EFECTO EN POSTGREST
-- Sin el UNIQUE, el embed `facturas (...)` desde ordenes_servicio deja de ser
-- uno-a-uno y vuelve como lista. El codigo ya normaliza con toArray (o
-- Array.isArray) en todos los lugares que lo leen; este PR ademas filtra los
-- anulados donde importa (generar, candidatos, detalle de la orden).
-- Al final se pide a PostgREST que recargue el esquema.
--
-- QUE NO CAMBIA
-- - Ventas: facturas.venta_id sigue UNIQUE (fuera de alcance).
-- - Plata: el remito anulado ya no cuenta (total_cobrado_orden excluye sus
--   pagos; los reportes de ingresos solo suman PAGADO). El remito nuevo nace
--   con lo cobrado en la orden (trigger de la 417).
--
-- VERIFICACION POSTERIOR:
--   SELECT conname FROM pg_constraint WHERE conname = 'facturas_orden_id_key';   -- 0 filas
--   SELECT indexname FROM pg_indexes WHERE indexname = 'facturas_orden_id_activa_uniq'; -- 1 fila
-- ----------------------------------------------------------------------------

-- Precondicion: hoy no hay dos remitos activos de la misma orden (el UNIQUE lo
-- garantizaba). El indice nuevo fallaria si los hubiera.
CREATE UNIQUE INDEX IF NOT EXISTS facturas_orden_id_activa_uniq
  ON facturas (orden_id)
  WHERE orden_id IS NOT NULL AND estado_pago <> 'ANULADA';

ALTER TABLE facturas DROP CONSTRAINT IF EXISTS facturas_orden_id_key;

-- Las busquedas por orden_id siguen teniendo indice (el UNIQUE lo daba).
CREATE INDEX IF NOT EXISTS facturas_orden_id_idx ON facturas (orden_id);

NOTIFY pgrst, 'reload schema';
