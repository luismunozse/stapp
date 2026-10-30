-- ============================================================================
-- Comisiones, slice 1 (pagar): legacy flag sync + atomic pay RPC. Functions only, re-runnable.
-- ============================================================================
-- Adds two functions (plpgsql, SECURITY INVOKER, service_role only, as in 354):
--   * comisiones_sincronizar_flags(org, tipo, ids): keeps the legacy columns
--     comision_pagada / fecha_pago_comision / comision_pago_notas of ventas (VENDEDOR role)
--     and ordenes_servicio (TECNICO role) equal to what the payout items say. The legacy
--     columns stay readable by every screen that has not moved to the definition yet.
--   * pagar_comisiones(org, usuario, beneficiario, filas, notas): pays accrued rows of ONE
--     beneficiary in one transaction. Each requested row (key + amount) is compared against
--     v_comisiones_devengadas (377), never against a total. Nothing is written until every
--     row passes.
--
-- Order inside pagar_comisiones: ADMIN of the org (users.deleted_at IS NULL) -> beneficiary
-- in the org -> non-empty array with distinct keys -> per-org advisory lock ->
-- the source documents of the rows (ventas, ordenes_servicio) locked FOR UPDATE in id order,
-- payment time = clock_timestamp() taken after those locks -> one read of the definition, rows
-- checked in request order (missing, already paid, an ORIGINAL row of a legacy-paid document with
-- no payout item yet = FILA_NO_DISPONIBLE, other beneficiary, different amount) ->
-- payout + items -> legacy flag sync for the documents of this payout.
--
-- Errors are raised as 'COMISION_ERROR:<CODE>[:<detail>]'. A concurrent duplicate that slips
-- past the lock surfaces as SQLSTATE 23505 from comisiones_pagos_items_fila_vigente_uq.
-- The advisory lock key hashtext('comisiones:' || organization_id) is shared with the
-- annulment RPC (379).
--
-- Requires 376 and 377. No reader calls these functions until the routes land.
--
-- No BEGIN/COMMIT: scripts/db-run.mjs wraps the file (dry-run by default).
-- Rollback: rollback/378_rollback.sql. Verify: verify/378_probes.sql.
-- ============================================================================

SET LOCAL lock_timeout = '3s';

DO $$
BEGIN
  IF to_regclass('public.comisiones_pagos_items') IS NULL
     OR to_regclass('public.v_comisiones_devengadas') IS NULL THEN
    RAISE EXCEPTION 'Abort: aplicar 376 y 377 antes de 378';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. comisiones_sincronizar_flags
-- ----------------------------------------------------------------------------
-- Per document: comision_pagada = a non-annulled item exists in the legacy role (any kind);
-- fecha_pago_comision / comision_pago_notas = the payout of the non-annulled ORIGINAL item,
-- else the payout of the latest non-annulled item, else NULL. Only rows whose values change
-- are updated.
CREATE OR REPLACE FUNCTION comisiones_sincronizar_flags(
  p_organization_id TEXT,
  p_documento_tipo  TEXT,
  p_documento_ids   TEXT[]
) RETURNS void AS $$
BEGIN
  IF p_documento_ids IS NULL OR cardinality(p_documento_ids) = 0 THEN
    RETURN;
  END IF;

  IF p_documento_tipo = 'VENTA' THEN
    UPDATE ventas v
       SET comision_pagada = (c.fecha_pago IS NOT NULL),
           fecha_pago_comision = c.fecha_pago,
           comision_pago_notas = c.notas
      FROM (
        SELECT d.id, x.fecha_pago, x.notas
          FROM ventas d
          LEFT JOIN LATERAL (
            SELECT p.fecha_pago, p.notas
              FROM comisiones_pagos_items i
              JOIN comisiones_pagos p ON p.id = i.pago_id AND p.organization_id = p_organization_id
             WHERE i.organization_id = p_organization_id
               AND i.documento_tipo = 'VENTA' AND i.documento_id = d.id
               AND i.rol = 'VENDEDOR' AND NOT i.anulado
             ORDER BY (i.tipo = 'ORIGINAL') DESC, p.fecha_pago DESC, p.id DESC
             LIMIT 1
          ) x ON true
         WHERE d.organization_id = p_organization_id AND d.id = ANY(p_documento_ids)
      ) c
     WHERE v.id = c.id AND v.organization_id = p_organization_id
       AND (v.comision_pagada IS DISTINCT FROM (c.fecha_pago IS NOT NULL)
         OR v.fecha_pago_comision IS DISTINCT FROM c.fecha_pago
         OR v.comision_pago_notas IS DISTINCT FROM c.notas);
  ELSIF p_documento_tipo = 'ORDEN' THEN
    UPDATE ordenes_servicio o
       SET comision_pagada = (c.fecha_pago IS NOT NULL),
           fecha_pago_comision = c.fecha_pago,
           comision_pago_notas = c.notas
      FROM (
        SELECT d.id, x.fecha_pago, x.notas
          FROM ordenes_servicio d
          LEFT JOIN LATERAL (
            SELECT p.fecha_pago, p.notas
              FROM comisiones_pagos_items i
              JOIN comisiones_pagos p ON p.id = i.pago_id AND p.organization_id = p_organization_id
             WHERE i.organization_id = p_organization_id
               AND i.documento_tipo = 'ORDEN' AND i.documento_id = d.id
               AND i.rol = 'TECNICO' AND NOT i.anulado
             ORDER BY (i.tipo = 'ORIGINAL') DESC, p.fecha_pago DESC, p.id DESC
             LIMIT 1
          ) x ON true
         WHERE d.organization_id = p_organization_id AND d.id = ANY(p_documento_ids)
      ) c
     WHERE o.id = c.id AND o.organization_id = p_organization_id
       AND (o.comision_pagada IS DISTINCT FROM (c.fecha_pago IS NOT NULL)
         OR o.fecha_pago_comision IS DISTINCT FROM c.fecha_pago
         OR o.comision_pago_notas IS DISTINCT FROM c.notas);
  ELSE
    RAISE EXCEPTION 'COMISION_ERROR:TIPO_INVALIDO:%', p_documento_tipo;
  END IF;
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION comisiones_sincronizar_flags(TEXT, TEXT, TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION comisiones_sincronizar_flags(TEXT, TEXT, TEXT[]) TO service_role;

-- ----------------------------------------------------------------------------
-- 2. pagar_comisiones
-- ----------------------------------------------------------------------------
-- p_filas = [{"clave": text, "monto": number}]. Returns {"pagoId", "total", "filas"}.
CREATE OR REPLACE FUNCTION pagar_comisiones(
  p_organization_id TEXT,
  p_usuario_id      TEXT,
  p_beneficiario_id TEXT,
  p_filas           JSONB,
  p_notas           TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_docs      TEXT[];
  v_ajustes   TEXT[];
  v_fila      RECORD;
  v_items     JSONB := '[]'::jsonb;
  v_total     NUMERIC(12,2) := 0;
  v_filas     INTEGER := 0;
  v_pago_id   TEXT;
  v_ventas    TEXT[];
  v_ordenes   TEXT[];
  v_lock_ventas   TEXT[];
  v_lock_ordenes  TEXT[];
  v_pagado_at TIMESTAMPTZ;
BEGIN
  -- 1. The caller is an active ADMIN of this organization.
  IF NOT EXISTS (
    SELECT 1 FROM users
     WHERE id = p_usuario_id AND organization_id = p_organization_id
       AND rol = 'ADMIN' AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'COMISION_ERROR:NO_AUTORIZADO';
  END IF;

  -- 2. The beneficiary belongs to the organization (a removed user can still be paid).
  IF NOT EXISTS (
    SELECT 1 FROM users WHERE id = p_beneficiario_id AND organization_id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'COMISION_ERROR:BENEFICIARIO_NO_ENCONTRADO';
  END IF;

  -- 3. Non-empty array of distinct keys.
  IF p_filas IS NULL OR jsonb_typeof(p_filas) <> 'array' OR jsonb_array_length(p_filas) = 0 THEN
    RAISE EXCEPTION 'COMISION_ERROR:SIN_FILAS';
  END IF;
  IF (SELECT COUNT(*) <> COUNT(DISTINCT COALESCE(f->>'clave', ''))
        FROM jsonb_array_elements(p_filas) AS t(f)) THEN
    RAISE EXCEPTION 'COMISION_ERROR:FILA_DUPLICADA';
  END IF;

  -- 4. One payer at a time per organization.
  PERFORM pg_advisory_xact_lock(hashtext('comisiones:' || p_organization_id));

  -- 4b. Lock the source documents of the requested rows (ids taken from the keys, in id order),
  -- so a return or an edit cannot commit between the check below and the insert. Then stamp the
  -- payment time once, after the locks: it is the real payment time, which the
  -- AJUSTE_DEVOLUCION branch of the definition (377) compares against a return's created_at.
  SELECT array_agg(DISTINCT split_part(f->>'clave', ':', 2))
           FILTER (WHERE split_part(f->>'clave', ':', 1) = 'VENTA' AND split_part(f->>'clave', ':', 2) NOT IN ('', '-')),
         array_agg(DISTINCT split_part(f->>'clave', ':', 2))
           FILTER (WHERE split_part(f->>'clave', ':', 1) = 'ORDEN' AND split_part(f->>'clave', ':', 2) NOT IN ('', '-'))
    INTO v_lock_ventas, v_lock_ordenes
    FROM jsonb_array_elements(p_filas) AS t(f);
  PERFORM 1 FROM ventas WHERE organization_id = p_organization_id AND id = ANY(v_lock_ventas) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM ordenes_servicio WHERE organization_id = p_organization_id AND id = ANY(v_lock_ordenes) ORDER BY id FOR UPDATE;
  v_pagado_at := clock_timestamp();

  -- 5. Check every row against the definition, in request order. Nothing is written yet.
  SELECT array_agg(split_part(f->>'clave', ':', 2)), array_agg(split_part(f->>'clave', ':', 5))
    INTO v_docs, v_ajustes
    FROM jsonb_array_elements(p_filas) AS t(f);

  FOR v_fila IN
    SELECT r.clave, r.monto_pedido, d.clave AS d_clave, d.pagado, d.beneficiario_id AS d_beneficiario,
           d.monto AS d_monto, d.documento_tipo, d.documento_id, d.rol, d.tipo, d.ajuste_ref,
           d.base, d.porcentaje, d.fecha_devengo
      FROM (
        SELECT t.ord, t.f->>'clave' AS clave,
               CASE WHEN jsonb_typeof(t.f->'monto') = 'number' THEN ROUND((t.f->>'monto')::numeric, 2) END AS monto_pedido
          FROM jsonb_array_elements(p_filas) WITH ORDINALITY AS t(f, ord)
      ) r
      LEFT JOIN (
        SELECT * FROM v_comisiones_devengadas
         WHERE organization_id = p_organization_id
           AND (documento_id = ANY(v_docs) OR ajuste_ref = ANY(v_ajustes))
      ) d ON d.clave = r.clave
     ORDER BY r.ord
  LOOP
    IF v_fila.d_clave IS NULL THEN
      RAISE EXCEPTION 'COMISION_ERROR:FILA_NO_DISPONIBLE:%', COALESCE(v_fila.clave, '');
    END IF;
    IF v_fila.pagado THEN
      RAISE EXCEPTION 'COMISION_ERROR:FILA_YA_PAGADA:%', v_fila.clave;
    END IF;
    -- A legacy-paid document (flag set by an old route, no payout item yet: not backfilled) must not
    -- be paid again. After slice 1 the RPCs re-derive the flag from the items, so this is consistent.
    IF v_fila.tipo = 'ORIGINAL' AND (
         (v_fila.documento_tipo = 'VENTA' AND v_fila.rol = 'VENDEDOR'
          AND EXISTS (SELECT 1 FROM ventas v WHERE v.id = v_fila.documento_id AND v.organization_id = p_organization_id AND v.comision_pagada)
          AND NOT EXISTS (SELECT 1 FROM comisiones_pagos_items i
                           WHERE i.organization_id = p_organization_id AND i.documento_tipo = 'VENTA'
                             AND i.documento_id = v_fila.documento_id AND i.rol = 'VENDEDOR' AND NOT i.anulado))
      OR (v_fila.documento_tipo = 'ORDEN' AND v_fila.rol = 'TECNICO'
          AND EXISTS (SELECT 1 FROM ordenes_servicio o WHERE o.id = v_fila.documento_id AND o.organization_id = p_organization_id AND o.comision_pagada)
          AND NOT EXISTS (SELECT 1 FROM comisiones_pagos_items i
                           WHERE i.organization_id = p_organization_id AND i.documento_tipo = 'ORDEN'
                             AND i.documento_id = v_fila.documento_id AND i.rol = 'TECNICO' AND NOT i.anulado))
    ) THEN
      RAISE EXCEPTION 'COMISION_ERROR:FILA_NO_DISPONIBLE:%', v_fila.clave;
    END IF;
    IF v_fila.d_beneficiario IS DISTINCT FROM p_beneficiario_id THEN
      RAISE EXCEPTION 'COMISION_ERROR:OTRO_BENEFICIARIO:%', v_fila.clave;
    END IF;
    IF v_fila.d_monto IS DISTINCT FROM v_fila.monto_pedido THEN
      RAISE EXCEPTION 'COMISION_ERROR:MONTO_DISTINTO:%', v_fila.clave;
    END IF;

    v_total := v_total + v_fila.d_monto;
    v_filas := v_filas + 1;
    v_items := v_items || jsonb_build_object(
      'documento_tipo', v_fila.documento_tipo, 'documento_id', v_fila.documento_id,
      'rol', v_fila.rol, 'tipo', v_fila.tipo, 'ajuste_ref', v_fila.ajuste_ref,
      'base', v_fila.base, 'porcentaje', v_fila.porcentaje, 'monto', v_fila.d_monto,
      'fecha_devengo', v_fila.fecha_devengo);
  END LOOP;

  -- 6. Payout + one frozen item per row, copied from the definition.
  INSERT INTO comisiones_pagos (organization_id, beneficiario_id, fecha_pago, pagado_por, notas, total)
  VALUES (p_organization_id, p_beneficiario_id, v_pagado_at, p_usuario_id, NULLIF(btrim(p_notas), ''), v_total)
  RETURNING id INTO v_pago_id;

  INSERT INTO comisiones_pagos_items (pago_id, organization_id, documento_tipo, documento_id, rol, tipo,
                                      ajuste_ref, base, porcentaje, monto, fecha_devengo)
  SELECT v_pago_id, p_organization_id, x.documento_tipo, x.documento_id, x.rol, x.tipo,
         x.ajuste_ref, x.base, x.porcentaje, x.monto, x.fecha_devengo
    FROM jsonb_to_recordset(v_items) AS x(
      documento_tipo TEXT, documento_id TEXT, rol TEXT, tipo TEXT, ajuste_ref TEXT,
      base NUMERIC, porcentaje NUMERIC, monto NUMERIC, fecha_devengo TIMESTAMPTZ);

  -- 7. Legacy flags, only for the documents of this payout.
  SELECT array_agg(DISTINCT x.documento_id) INTO v_ventas
    FROM jsonb_to_recordset(v_items) AS x(documento_tipo TEXT, documento_id TEXT, rol TEXT)
   WHERE x.documento_tipo = 'VENTA' AND x.rol = 'VENDEDOR';
  SELECT array_agg(DISTINCT x.documento_id) INTO v_ordenes
    FROM jsonb_to_recordset(v_items) AS x(documento_tipo TEXT, documento_id TEXT, rol TEXT)
   WHERE x.documento_tipo = 'ORDEN' AND x.rol = 'TECNICO';
  PERFORM comisiones_sincronizar_flags(p_organization_id, 'VENTA', v_ventas);
  PERFORM comisiones_sincronizar_flags(p_organization_id, 'ORDEN', v_ordenes);

  -- 8.
  RETURN jsonb_build_object('pagoId', v_pago_id, 'total', v_total, 'filas', v_filas);
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION pagar_comisiones(TEXT, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION pagar_comisiones(TEXT, TEXT, TEXT, JSONB, TEXT) TO service_role;
