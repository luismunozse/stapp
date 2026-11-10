-- Migration 371: annul an electronic factura (ARCA) with a fiscal credit note (nota de credito).
--
-- Change anular-factura-arca, PR1 (SQL only). An admin annuls an emitted factura B/C by issuing ONE
-- electronic NC for its full authorized amount. The NC is a comprobantes_fiscales row that points at
-- its factura (comprobante_asociado_id). It is written as 'pendiente' BEFORE the voucher goes to
-- ARCA, so a send whose outcome is unknown can always be reconciled afterwards. When ARCA
-- authorizes it, confirmar_nota_credito_fiscal flips the NC to 'emitido' and the factura to
-- 'anulado' in ONE transaction.
--
-- Added here:
--   comprobante_asociado_id  the factura this NC annuls (NULL on facturas). Self FK with NO ACTION,
--                            like 329's FKs: factura and NC die in the same org-delete cascade.
--   cbte_nro_solicitado      the number asked from ARCA (last authorized + 1). The reconcile key.
--   motivo, motivo_detalle   why: error_factura | devolucion_total | otro (detalle required for
--                            otro, up to 500 chars). Stored on the NC at request time, even if ARCA
--                            then rejects it. Facturas never carry them.
--   anulado_at               when the factura was annulled; set together with estado = 'anulado'.
--   estado 'anulado'         a factura with an emitted NC. An NC itself is never 'anulado'.
--   nc_check                 an NC has an 11-digit cuit_emisor: ARCA numbers by CUIT + point of sale
--                            + type, so that is the key of the two NC indexes below.
--   unique indexes           one active factura per venta (NC rows no longer count); one active NC
--                            per factura; one in-flight NC per CUIT / PV / type (while an NC is
--                            pendiente, the number it asked for can only be its own, in whichever
--                            organization); one emitted NC per CUIT / PV / type / number.
--   idx_comprobantes_asociado  plain index for the self-FK lookups.
--   proteger_anulacion_venta only a factura in pendiente/emitido blocks annulling the venta. Same
--                            body as 329, plus the NC filter and a message that points at
--                            "Anular factura" instead of asking for a manual NC in ARCA.
--   confirmar_nota_credito_fiscal  the atomic success transition (service_role only). It takes an
--                            NC in 'pendiente' or 'rechazado': an NC we gave up on may turn out to
--                            have been authorized by ARCA, and verifying later must still be able to
--                            confirm it. If a newer active NC exists for the factura, or another
--                            emitted NC owns that number, the unique indexes raise 23505.
--
-- The "Anular factura" action does not exist in the UI yet, and lib/ventas/bloqueos.ts and the
-- Factura electronica block still use the old wording: PR4/PR5 of this change align them with the
-- text above. Until then only the DB message changes.
--
-- Safe to apply BEFORE the code that uses it: existing rows satisfy every new CHECK, the unique
-- index is equivalent while comprobante_asociado_id is NULL everywhere, the trigger behaves as
-- before for facturas, and nothing calls the function. NC rows are told apart in TypeScript by
-- cbte_tipo IN (8, 13) (a 370 column), which the CHECK ties to comprobante_asociado_id.
--
-- RUNBOOK - release an NC stuck in 'pendiente' (support only)
-- A pendiente NC holds the in-flight key (cuit_emisor, punto_venta, cbte_tipo): nobody can annul on
-- that point of sale until it is resolved. The app resolves it with "Verificar con ARCA". When
-- support must release one by hand:
--   1. In ARCA (Mis Comprobantes > Emitidos) confirm that number N (the row's cbte_nro_solicitado)
--      was NOT authorized for that CUIT, point of sale and NC type. If it WAS authorized, do not
--      release it: verify it, or a second NC could be issued for the same factura.
--   2. Then release it:
--        UPDATE comprobantes_fiscales
--           SET estado = 'rechazado', error_msg = '<why it is safe, e.g. checked in ARCA on 2026-10-25>'
--         WHERE id = '<nc id>' AND estado = 'pendiente' AND comprobante_asociado_id IS NOT NULL;
--   A rechazado NC can still be confirmed later by confirmar_nota_credito_fiscal if ARCA does have
--   it and no other active NC exists for the factura.
--
-- No BEGIN/COMMIT: scripts/db-run.mjs wraps the file (dry-run by default).
--
-- LOCKS (held until the transaction ends): ACCESS EXCLUSIVE on comprobantes_fiscales only (columns,
-- CHECKs and indexes on a small table). Replacing the trigger function does not lock ventas.
-- lock_timeout bounds the WAIT for the lock, not the hold; if it aborts, nothing was applied:
-- re-run it.
--
-- Re-runnable. Rollback: rollback/371_rollback.sql (refuses once any live NC or annulled factura exists).

SET LOCAL lock_timeout = '3s';

-- 0. Preconditions.
DO $$
DECLARE
  v_attnum SMALLINT;
  v_otras  TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'comprobantes_fiscales'
                   AND column_name = 'cbte_tipo') THEN
    RAISE EXCEPTION 'Abort: falta comprobantes_fiscales.cbte_tipo. Aplicar la 370 antes de la 371.';
  END IF;
  -- First application only: until now every row is a factura, so none may look like an NC.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'comprobantes_fiscales'
                   AND column_name = 'comprobante_asociado_id')
     AND EXISTS (SELECT 1 FROM comprobantes_fiscales WHERE cbte_tipo IN (8, 13)) THEN
    RAISE EXCEPTION 'Abort: hay comprobantes con cbte_tipo 8 o 13 y todavia no existen las notas de credito asociadas.';
  END IF;
  -- Step 2 drops the CHECK(s) on estado alone. A CHECK on several columns that also mentions estado
  -- would be left saying 'pendiente'/'emitido'/'rechazado' only: stop and look at it.
  SELECT attnum INTO v_attnum FROM pg_attribute
  WHERE attrelid = 'public.comprobantes_fiscales'::regclass AND attname = 'estado' AND NOT attisdropped;
  SELECT string_agg(conname, ', ') INTO v_otras FROM pg_constraint
  WHERE conrelid = 'public.comprobantes_fiscales'::regclass AND contype = 'c'
    AND conkey IS DISTINCT FROM ARRAY[v_attnum]
    AND conname NOT IN ('comprobantes_fiscales_nc_check', 'comprobantes_fiscales_anulado_check')
    AND pg_get_constraintdef(oid) ~ '\mestado\M';
  IF v_otras IS NOT NULL THEN
    RAISE EXCEPTION 'Abort: otra CHECK de comprobantes_fiscales menciona estado (%): revisarla antes de aplicar la 371.', v_otras;
  END IF;
END $$;

-- 1. Columns. All nullable and without DEFAULT: a catalog change, no table rewrite.
ALTER TABLE comprobantes_fiscales
  ADD COLUMN IF NOT EXISTS comprobante_asociado_id TEXT REFERENCES comprobantes_fiscales(id),
  ADD COLUMN IF NOT EXISTS cbte_nro_solicitado INTEGER,
  ADD COLUMN IF NOT EXISTS motivo TEXT,
  ADD COLUMN IF NOT EXISTS motivo_detalle TEXT,
  ADD COLUMN IF NOT EXISTS anulado_at TIMESTAMPTZ;

COMMENT ON COLUMN comprobantes_fiscales.comprobante_asociado_id IS
  'Nota de credito: la factura que anula. NULL en las facturas.';
COMMENT ON COLUMN comprobantes_fiscales.cbte_nro_solicitado IS
  'Nota de credito: numero pedido a ARCA (ultimo autorizado + 1). Sirve para verificar un envio incierto.';
COMMENT ON COLUMN comprobantes_fiscales.anulado_at IS
  'Factura anulada por una nota de credito emitida. Va junto con estado = anulado.';

-- 2. estado CHECK: drop whichever CHECK constrains only estado (whatever its name) and add 'anulado'.
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
  CHECK (estado IN ('pendiente', 'emitido', 'rechazado', 'anulado'));

-- 3. An NC is a row with comprobante_asociado_id, cbte_tipo 8 (B) / 13 (C) following its own letter,
--    the issuer CUIT, a requested number and a valid motivo. A factura has none of that. A CHECK
--    passes on NULL, so every nullable comparison on the NC side carries its own IS NOT NULL.
ALTER TABLE comprobantes_fiscales DROP CONSTRAINT IF EXISTS comprobantes_fiscales_nc_check;
ALTER TABLE comprobantes_fiscales
  ADD CONSTRAINT comprobantes_fiscales_nc_check CHECK (
    (
      comprobante_asociado_id IS NULL
      AND (cbte_tipo IS NULL OR cbte_tipo NOT IN (8, 13))
      AND motivo IS NULL
      AND motivo_detalle IS NULL
      AND cbte_nro_solicitado IS NULL
    ) OR (
      comprobante_asociado_id IS NOT NULL
      AND comprobante_asociado_id <> id
      AND cuit_emisor IS NOT NULL AND cuit_emisor ~ '^[0-9]{11}$'
      AND cbte_tipo IS NOT NULL AND cbte_tipo = CASE tipo WHEN 'B' THEN 8 WHEN 'C' THEN 13 END
      AND cbte_nro_solicitado IS NOT NULL AND cbte_nro_solicitado > 0
      AND estado <> 'anulado'
      AND motivo IS NOT NULL AND motivo IN ('error_factura', 'devolucion_total', 'otro')
      AND (motivo <> 'otro' OR length(btrim(COALESCE(motivo_detalle, ''))) > 0)
      AND (motivo_detalle IS NULL OR length(motivo_detalle) <= 500)
    )
  );

ALTER TABLE comprobantes_fiscales DROP CONSTRAINT IF EXISTS comprobantes_fiscales_anulado_check;
ALTER TABLE comprobantes_fiscales
  ADD CONSTRAINT comprobantes_fiscales_anulado_check
  CHECK ((estado = 'anulado') = (anulado_at IS NOT NULL));

-- 4. Indexes. The venta index loses the NC rows (an NC and its factura share the venta); the others
--    are new.
DROP INDEX IF EXISTS uq_comprobante_venta_activo;
CREATE UNIQUE INDEX uq_comprobante_venta_activo
  ON comprobantes_fiscales(venta_id)
  WHERE estado IN ('pendiente', 'emitido') AND comprobante_asociado_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_comprobante_nc_activa
  ON comprobantes_fiscales(comprobante_asociado_id)
  WHERE comprobante_asociado_id IS NOT NULL AND estado IN ('pendiente', 'emitido');

-- ARCA numbers per CUIT + point of sale + type, whichever organization (or delegation) sends. A
-- web-service point of sale is only used through web services, so while an NC is pendiente the
-- number it asked for can only be its own: reconciling never adopts someone else's NC.
CREATE UNIQUE INDEX IF NOT EXISTS uq_comprobante_nc_en_vuelo
  ON comprobantes_fiscales(cuit_emisor, punto_venta, cbte_tipo)
  WHERE comprobante_asociado_id IS NOT NULL AND estado = 'pendiente';

-- An emitted number belongs to one NC. Adopting an NC that ARCA numbered for someone else fails here.
CREATE UNIQUE INDEX IF NOT EXISTS uq_comprobante_nc_numero
  ON comprobantes_fiscales(cuit_emisor, punto_venta, cbte_tipo, numero)
  WHERE comprobante_asociado_id IS NOT NULL AND estado = 'emitido';

-- The self-FK looks a factura up by comprobante_asociado_id when a row is deleted.
CREATE INDEX IF NOT EXISTS idx_comprobantes_asociado
  ON comprobantes_fiscales(comprobante_asociado_id);

-- 5. COMPLETADA -> ANULADA. This is the body of 329 with two changes: only a FACTURA in
--    pendiente/emitido blocks (an NC never does), and the message sends the user to "Anular
--    factura". PR4/PR5 of this change repeat the text in lib/ventas/bloqueos.ts and add the action.
--    The trigger itself is untouched.
CREATE OR REPLACE FUNCTION proteger_anulacion_venta()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.estado::text = 'COMPLETADA' AND NEW.estado::text = 'ANULADA' THEN
    IF EXISTS (SELECT 1 FROM comprobantes_fiscales
               WHERE venta_id = NEW.id AND estado IN ('pendiente', 'emitido')
                 AND comprobante_asociado_id IS NULL) THEN
      RAISE EXCEPTION 'VENTA_NO_ANULABLE: La venta tiene una factura electrónica emitida: anulala primero con "Anular factura" en el bloque Factura electrónica.'
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

-- 6. The success transition. Called by the anular route when ARCA authorized the NC, and by verificar
--    when ARCA already has it. Locks the NC and then its factura (always that order), org scoped.
--    The NC may be pendiente or rechazado (see the header). Replaying the same CAE changes nothing;
--    if the factura is somehow still emitido it completes the annulment. Another CAE, another org, a
--    number that is not the one requested, a factura that is not emitido or does not match the NC's
--    venta and letter all raise. A newer active NC for the factura, or another emitted NC with the
--    same number, raise 23505 from the unique indexes. Never touches stock, caja or cuenta
--    corriente. SECURITY INVOKER: only service_role can call it.
CREATE OR REPLACE FUNCTION public.confirmar_nota_credito_fiscal(
  p_org_id            TEXT,
  p_nc_id             TEXT,
  p_numero            TEXT,
  p_cae               TEXT,
  p_cae_vencimiento   TEXT,
  p_provider_response JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_nc       comprobantes_fiscales%ROWTYPE;
  v_fa       comprobantes_fiscales%ROWTYPE;
  v_replayed BOOLEAN := false;
  v_numero_ok BOOLEAN;
BEGIN
  IF NULLIF(btrim(COALESCE(p_numero, '')), '') IS NULL
     OR NULLIF(btrim(COALESCE(p_cae, '')), '') IS NULL
     OR NULLIF(btrim(COALESCE(p_cae_vencimiento, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Faltan el número, el CAE o su vencimiento';
  END IF;

  SELECT * INTO v_nc FROM comprobantes_fiscales
  WHERE id = p_nc_id AND organization_id = p_org_id
  FOR UPDATE;
  IF NOT FOUND OR v_nc.comprobante_asociado_id IS NULL THEN
    RAISE EXCEPTION 'Nota de crédito no encontrada';
  END IF;

  -- PPPP-NNNNNNNN, with this NC's point of sale and the number it asked ARCA for. The regex goes
  -- first and alone: the casts below cannot overflow or fail on a malformed string.
  v_numero_ok := p_numero ~ '^[0-9]{1,5}-[0-9]{1,8}$';
  IF v_numero_ok THEN
    v_numero_ok := split_part(p_numero, '-', 1)::INTEGER = v_nc.punto_venta
               AND split_part(p_numero, '-', 2)::INTEGER = v_nc.cbte_nro_solicitado;
  END IF;
  IF NOT v_numero_ok THEN
    RAISE EXCEPTION 'El número de la nota de crédito no coincide con el pedido a ARCA';
  END IF;

  -- Only 'emitido' is special (a replay). pendiente and rechazado both confirm.
  IF v_nc.estado = 'emitido' THEN
    IF v_nc.cae IS DISTINCT FROM p_cae THEN
      RAISE EXCEPTION 'La nota de crédito ya está emitida con otro CAE';
    END IF;
    v_replayed := true;
  END IF;

  SELECT * INTO v_fa FROM comprobantes_fiscales
  WHERE id = v_nc.comprobante_asociado_id AND organization_id = p_org_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La factura asociada no está emitida';
  END IF;

  IF v_replayed AND v_fa.estado = 'anulado' THEN
    RETURN jsonb_build_object('id', v_nc.id, 'asociadoId', v_fa.id, 'replayed', true);
  END IF;

  IF v_fa.comprobante_asociado_id IS NOT NULL OR v_fa.estado <> 'emitido' THEN
    RAISE EXCEPTION 'La factura asociada no está emitida';
  END IF;
  IF v_fa.venta_id <> v_nc.venta_id OR v_fa.tipo <> v_nc.tipo THEN
    RAISE EXCEPTION 'La factura asociada no corresponde a la venta o al tipo de la nota de crédito';
  END IF;

  IF NOT v_replayed THEN
    UPDATE comprobantes_fiscales
    SET estado = 'emitido', numero = p_numero, cae = p_cae, cae_vencimiento = p_cae_vencimiento,
        provider_response = p_provider_response, error_msg = NULL
    WHERE id = v_nc.id;
  END IF;

  UPDATE comprobantes_fiscales
  SET estado = 'anulado', anulado_at = now()
  WHERE id = v_fa.id;

  RETURN jsonb_build_object('id', v_nc.id, 'asociadoId', v_fa.id, 'replayed', v_replayed);
END;
$function$;

COMMENT ON FUNCTION public.confirmar_nota_credito_fiscal(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) IS
  'Confirma una nota de credito fiscal (ARCA): la NC pendiente (o rechazada que ARCA si autorizo) pasa a emitida '
  'y su factura a anulada, en una sola transaccion. Reintento con el mismo CAE idempotente. Solo service_role; '
  'la llaman POST /api/facturacion-electronica/comprobantes/[id]/anular y .../verificar. Migracion 371.';

REVOKE EXECUTE ON FUNCTION public.confirmar_nota_credito_fiscal(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirmar_nota_credito_fiscal(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB)
  TO service_role;
