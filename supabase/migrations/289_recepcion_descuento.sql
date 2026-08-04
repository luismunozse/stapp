-- 289_recepcion_descuento.sql
-- Batch discount negotiated for a multi-device reception.
-- Totals are always derived from member orders; only the discount is stored.
BEGIN;

ALTER TABLE recepciones
  ADD COLUMN IF NOT EXISTS descuento_tipo TEXT,
  ADD COLUMN IF NOT EXISTS descuento_valor NUMERIC(10,2);

ALTER TABLE recepciones DROP CONSTRAINT IF EXISTS recepciones_descuento_check;
-- NULL-safe: every clause is guarded so no branch can evaluate to NULL (CHECK only rejects FALSE).
ALTER TABLE recepciones ADD CONSTRAINT recepciones_descuento_check CHECK (
  (descuento_tipo IS NULL) = (descuento_valor IS NULL)
  AND (descuento_tipo IS NULL OR descuento_tipo IN ('monto', 'porcentaje'))
  AND (descuento_valor IS NULL OR descuento_valor > 0)
  AND (descuento_tipo IS DISTINCT FROM 'porcentaje' OR descuento_valor <= 100)
);

COMMENT ON COLUMN recepciones.descuento_tipo IS 'porcentaje | monto. NULL = sin descuento de lote';

COMMIT;
