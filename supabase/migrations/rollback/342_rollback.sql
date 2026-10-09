-- Rollback de la 342.
--
-- PIERDE DATOS de las columnas nuevas. Exportar antes:
--   SELECT id, modo, motivo_nc, anulada, anulada_at, anulada_por, anulada_motivo
--     FROM devoluciones_venta WHERE modo <> 'ITEMS' OR motivo_nc IS NOT NULL OR anulada;
--   SELECT id, modo, monto_aplicado_deuda, idempotency_key, motivo
--     FROM notas_credito WHERE monto_aplicado_deuda <> 0 OR idempotency_key IS NOT NULL
--        OR motivo = 'TRABAJO_NO_REALIZADO';
--   SELECT id, repuesto_orden_id, deposito_id
--     FROM items_nota_credito WHERE repuesto_orden_id IS NOT NULL OR deposito_id IS NOT NULL;
--
-- Falla a proposito si hay NC con motivo TRABAJO_NO_REALIZADO (el CHECK de la
-- 186 no lo admite): reasignarles un motivo antes.
--
-- Revertir ANTES las migraciones posteriores de este plan (v_notas_credito y
-- pendiente_orden leen estas columnas) y el codigo que las lee (PR1e).

ALTER TABLE notas_credito DROP CONSTRAINT notas_credito_orden_id_fkey;
ALTER TABLE notas_credito ADD CONSTRAINT notas_credito_orden_id_fkey
  FOREIGN KEY (orden_id) REFERENCES ordenes_servicio(id) ON DELETE SET NULL;

ALTER TABLE notas_credito DROP CONSTRAINT notas_credito_solo_ordenes;
ALTER TABLE notas_credito ADD CONSTRAINT notas_credito_check CHECK (
  (venta_id IS NOT NULL AND orden_id IS NULL) OR
  (venta_id IS NULL AND orden_id IS NOT NULL)
);

ALTER TABLE notas_credito DROP CONSTRAINT notas_credito_motivo_check;
ALTER TABLE notas_credito ADD CONSTRAINT notas_credito_motivo_check CHECK (motivo IN (
  'DEVOLUCION', 'AJUSTE_PRECIO', 'GARANTIA', 'ERROR_FACTURACION', 'DESCUENTO_RETRO', 'OTRO'
));

DROP INDEX IF EXISTS notas_credito_idempotency_key_unique;
ALTER TABLE notas_credito
  DROP CONSTRAINT IF EXISTS notas_credito_aplicado_check,
  DROP CONSTRAINT IF EXISTS notas_credito_modo_check;
-- monto_reembolso primero: es generada a partir de monto_aplicado_deuda.
ALTER TABLE notas_credito
  DROP COLUMN IF EXISTS monto_reembolso,
  DROP COLUMN IF EXISTS idempotency_key,
  DROP COLUMN IF EXISTS monto_aplicado_deuda,
  DROP COLUMN IF EXISTS modo;

ALTER TABLE items_nota_credito
  DROP COLUMN IF EXISTS deposito_id,
  DROP COLUMN IF EXISTS repuesto_orden_id;

DROP INDEX IF EXISTS devoluciones_venta_venta_activa_idx;
ALTER TABLE devoluciones_venta
  DROP CONSTRAINT IF EXISTS devoluciones_venta_motivo_nc_check,
  DROP CONSTRAINT IF EXISTS devoluciones_venta_modo_check;
ALTER TABLE devoluciones_venta
  DROP COLUMN IF EXISTS anulada_motivo,
  DROP COLUMN IF EXISTS anulada_por,
  DROP COLUMN IF EXISTS anulada_at,
  DROP COLUMN IF EXISTS anulada,
  DROP COLUMN IF EXISTS motivo_nc,
  DROP COLUMN IF EXISTS modo;
