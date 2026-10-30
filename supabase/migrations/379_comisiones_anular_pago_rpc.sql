-- ============================================================================
-- Comisiones, slice 1 (anular): audited soft annulment of a payout. Function only, re-runnable.
-- ============================================================================
-- Adds anular_pago_comisiones(org, usuario, pago, motivo) (plpgsql, SECURITY INVOKER,
-- service_role only, as in 354). It soft-annuls one payout and its items (nothing is deleted),
-- so the rows it paid become pending again in v_comisiones_filas, resyncs the legacy flags of
-- the documents involved and writes one audit_logs row, all in the caller's transaction.
--
-- Order: ADMIN of the org (users.deleted_at IS NULL) -> non-blank reason -> per-org advisory
-- lock (same key as pagar_comisiones, 378) -> payout read FOR UPDATE by id AND organization
-- (another org's payout is PAGO_NO_ENCONTRADO) -> already annulled? -> adjustment guard ->
-- soft annulment of payout and items -> legacy flag sync -> audit row -> result.
--
-- Adjustment guard: annulling a payout whose ORIGINAL rows were later corrected by an
-- AJUSTE_DEVOLUCION / AJUSTE_ANULACION that sits in ANOTHER live payout would leave that
-- adjustment paid against a row that is pending again. It is refused with
-- AJUSTES_PAGADOS:<that pago_id>; annul the adjustment payout first.
--
-- The flag sync is not optional: the legacy backfill reads comision_pagada, so a stale true
-- flag would re-create the annulled payout on a re-run.
--
-- Errors are raised as 'COMISION_ERROR:<CODE>[:<detail>]'. Requires 376, 377 and 378.
-- No reader calls this function until the routes land.
--
-- No BEGIN/COMMIT: scripts/db-run.mjs wraps the file (dry-run by default).
-- Rollback: rollback/379_rollback.sql. Verify: verify/379_probes.sql.
-- ============================================================================

SET LOCAL lock_timeout = '3s';

DO $$
BEGIN
  IF to_regclass('public.comisiones_pagos_items') IS NULL
     OR to_regprocedure('public.comisiones_sincronizar_flags(text, text, text[])') IS NULL THEN
    RAISE EXCEPTION 'Abort: aplicar 376, 377 y 378 antes de 379';
  END IF;
END $$;

-- Returns {"pagoId": text, "filas": int} (filas = items annulled).
CREATE OR REPLACE FUNCTION anular_pago_comisiones(
  p_organization_id TEXT,
  p_usuario_id      TEXT,
  p_pago_id         TEXT,
  p_motivo          TEXT
) RETURNS JSONB AS $$
DECLARE
  v_pago     comisiones_pagos%ROWTYPE;
  v_bloqueo  TEXT;
  v_filas    INTEGER;
  v_ventas   TEXT[];
  v_ordenes  TEXT[];
BEGIN
  -- 1. The caller is an active ADMIN of this organization.
  IF NOT EXISTS (
    SELECT 1 FROM users
     WHERE id = p_usuario_id AND organization_id = p_organization_id
       AND rol = 'ADMIN' AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'COMISION_ERROR:NO_AUTORIZADO';
  END IF;

  -- 2. A reason is mandatory (the audit trail needs it).
  IF btrim(COALESCE(p_motivo, '')) = '' THEN
    RAISE EXCEPTION 'COMISION_ERROR:MOTIVO_REQUERIDO';
  END IF;

  -- 3. One payer at a time per organization (same key as pagar_comisiones).
  PERFORM pg_advisory_xact_lock(hashtext('comisiones:' || p_organization_id));

  -- 4. The payout belongs to the organization and is still live.
  SELECT * INTO v_pago
    FROM comisiones_pagos
   WHERE id = p_pago_id AND organization_id = p_organization_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMISION_ERROR:PAGO_NO_ENCONTRADO';
  END IF;
  IF v_pago.anulado THEN
    RAISE EXCEPTION 'COMISION_ERROR:PAGO_YA_ANULADO';
  END IF;

  -- 5. No live adjustment in another payout may point at an ORIGINAL row of this one.
  SELECT a.pago_id INTO v_bloqueo
    FROM comisiones_pagos_items a
   WHERE a.organization_id = p_organization_id
     AND a.pago_id <> p_pago_id
     AND NOT a.anulado
     AND a.tipo IN ('AJUSTE_DEVOLUCION', 'AJUSTE_ANULACION')
     AND EXISTS (
       SELECT 1 FROM comisiones_pagos_items o
        WHERE o.pago_id = p_pago_id AND o.organization_id = p_organization_id
          AND o.tipo = 'ORIGINAL' AND NOT o.anulado
          AND o.documento_tipo = a.documento_tipo
          AND o.documento_id = a.documento_id
          AND o.rol = a.rol)
   ORDER BY a.pago_id
   LIMIT 1;
  IF v_bloqueo IS NOT NULL THEN
    RAISE EXCEPTION 'COMISION_ERROR:AJUSTES_PAGADOS:%', v_bloqueo;
  END IF;

  -- 6. Soft annulment: payout first, then its items.
  UPDATE comisiones_pagos SET anulado = true, anulado_por = p_usuario_id, anulado_at = now(), motivo_anulacion = btrim(p_motivo)
   WHERE id = p_pago_id AND organization_id = p_organization_id;
  UPDATE comisiones_pagos_items SET anulado = true WHERE pago_id = p_pago_id AND organization_id = p_organization_id;
  GET DIAGNOSTICS v_filas = ROW_COUNT;

  -- 7. Legacy flags of every document of this payout (NULL ids skipped).
  SELECT array_agg(DISTINCT i.documento_id) INTO v_ventas
    FROM comisiones_pagos_items i
   WHERE i.pago_id = p_pago_id AND i.organization_id = p_organization_id
     AND i.documento_tipo = 'VENTA' AND i.documento_id IS NOT NULL;
  SELECT array_agg(DISTINCT i.documento_id) INTO v_ordenes
    FROM comisiones_pagos_items i
   WHERE i.pago_id = p_pago_id AND i.organization_id = p_organization_id
     AND i.documento_tipo = 'ORDEN' AND i.documento_id IS NOT NULL;
  PERFORM comisiones_sincronizar_flags(p_organization_id, 'VENTA', v_ventas);
  PERFORM comisiones_sincronizar_flags(p_organization_id, 'ORDEN', v_ordenes);

  -- 8. Audit, in the same transaction.
  INSERT INTO audit_logs (organization_id, user_id, action, entity, entity_id, changes, description)
  VALUES (
    p_organization_id, p_usuario_id, 'UPDATE', 'comisiones_pagos', p_pago_id,
    jsonb_build_object(
      'before', jsonb_build_object('anulado', false),
      'after', jsonb_build_object(
        'anulado', true,
        'motivo_anulacion', btrim(p_motivo),
        'beneficiario_id', v_pago.beneficiario_id,
        'total', v_pago.total)),
    'Anuló un pago de comisiones: ' || btrim(p_motivo));

  -- 9.
  RETURN jsonb_build_object('pagoId', p_pago_id, 'filas', v_filas);
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION anular_pago_comisiones(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION anular_pago_comisiones(TEXT, TEXT, TEXT, TEXT) TO service_role;
