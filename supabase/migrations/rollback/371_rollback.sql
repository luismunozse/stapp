-- Rollback of anular_factura_arca (migration 371): removes everything 371 added.
--
-- ORDER: redeploy the code from before the annulment PRs first. While the anular / verificar routes
-- are live, dropping the function and the columns makes them answer 503.
--
-- IT REFUSES TO RUN once any NC or annulled factura exists. A fiscal NC lives in ARCA and cannot be
-- undone from here, and the old schema cannot even represent it: its estado CHECK has no 'anulado',
-- and its one-active-comprobante-per-venta index would reject the factura + NC pair. A wrong
-- annulment is fixed with a new factura, not with a rollback. To see what is in the way:
--
--   SELECT id, venta_id, estado, cbte_tipo, numero, comprobante_asociado_id, anulado_at
--   FROM comprobantes_fiscales WHERE comprobante_asociado_id IS NOT NULL OR estado = 'anulado';
--
-- Before any NC or annulment exists nothing is lost: the five columns are empty.
--
-- LOCKS (held until the transaction ends): ACCESS EXCLUSIVE on comprobantes_fiscales.
-- lock_timeout bounds the wait, not the hold; if it aborts, nothing was applied: re-run it.

SET LOCAL lock_timeout = '3s';

-- The inner IF keeps this runnable on a database where 371 was only partly applied.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'comprobantes_fiscales'
               AND column_name = 'comprobante_asociado_id') THEN
    IF EXISTS (SELECT 1 FROM comprobantes_fiscales
               WHERE comprobante_asociado_id IS NOT NULL OR estado = 'anulado') THEN
      RAISE EXCEPTION 'Abort: ya existen notas de credito o facturas anuladas. No se pueden deshacer desde un rollback.';
    END IF;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.confirmar_nota_credito_fiscal(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB);

-- Body of 329, verbatim.
CREATE OR REPLACE FUNCTION proteger_anulacion_venta()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.estado::text = 'COMPLETADA' AND NEW.estado::text = 'ANULADA' THEN
    IF EXISTS (SELECT 1 FROM comprobantes_fiscales
               WHERE venta_id = NEW.id AND estado IN ('pendiente', 'emitido')) THEN
      RAISE EXCEPTION 'VENTA_NO_ANULABLE: La venta tiene una factura electrónica emitida: para anularla hay que emitir una nota de crédito en ARCA. Registrá la devolución de los productos.'
        USING ERRCODE = 'P0022';
    END IF;
    IF EXISTS (SELECT 1 FROM facturas
               WHERE venta_id = NEW.id AND estado_pago::text <> 'ANULADA') THEN
      RAISE EXCEPTION 'VENTA_NO_ANULABLE: La venta tiene un remito vigente: anulalo primero desde Facturación.'
        USING ERRCODE = 'P0022';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP INDEX IF EXISTS uq_comprobante_nc_en_vuelo;
DROP INDEX IF EXISTS uq_comprobante_nc_activa;
DROP INDEX IF EXISTS uq_comprobante_venta_activo;
CREATE UNIQUE INDEX uq_comprobante_venta_activo
  ON comprobantes_fiscales(venta_id) WHERE estado IN ('pendiente', 'emitido');

ALTER TABLE comprobantes_fiscales DROP CONSTRAINT IF EXISTS comprobantes_fiscales_nc_check;
ALTER TABLE comprobantes_fiscales DROP CONSTRAINT IF EXISTS comprobantes_fiscales_anulado_check;

-- estado CHECK back to the three values of 296 (whatever the current one is called).
DO $$
DECLARE
  v_attnum SMALLINT;
  c RECORD;
BEGIN
  SELECT attnum INTO v_attnum FROM pg_attribute
  WHERE attrelid = 'public.comprobantes_fiscales'::regclass AND attname = 'estado' AND NOT attisdropped;
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.comprobantes_fiscales'::regclass AND contype = 'c'
      AND conkey = ARRAY[v_attnum]
  LOOP
    EXECUTE format('ALTER TABLE public.comprobantes_fiscales DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE comprobantes_fiscales
  ADD CONSTRAINT comprobantes_fiscales_estado_check
  CHECK (estado IN ('pendiente', 'emitido', 'rechazado'));

-- The self reference goes with comprobante_asociado_id.
ALTER TABLE comprobantes_fiscales
  DROP COLUMN IF EXISTS anulado_at,
  DROP COLUMN IF EXISTS motivo_detalle,
  DROP COLUMN IF EXISTS motivo,
  DROP COLUMN IF EXISTS cbte_nro_solicitado,
  DROP COLUMN IF EXISTS comprobante_asociado_id;
