-- Verification of comisiones_anular_pago_rpc (migration 379): anular_pago_comisiones.
--
-- Run AFTER 376, 377, 378 and 379 are applied, in the SQL editor of Supabase Studio or with
--   node scripts/db-run.mjs supabase/migrations/verify/379_probes.sql
-- (no --apply: the file opens its own transaction and always ends in ROLLBACK).
--
-- Without RLS, as in verify/README.md. It uses REAL rows of the base (it creates no
-- organization): one accrued, unpaid order commission (ORDEN / TECNICO / ORIGINAL, amount > 0)
-- for the basic cases, and one COMPLETADA sale with a seller, total > 0, an accrued unpaid
-- commission, no live invoice, no remito, no returns and no payout items for the adjustment
-- chain. Everything it writes (payouts, items, flags, the sale annulment, audit rows) is rolled
-- back. A probe that finds no fitting row skips itself and says so in `obtenido` (SALTEADO: ...).
--
-- What it proves, against the real schema:
--   * anular_pago_comisiones is not SECURITY DEFINER and only service_role can execute it;
--   * NO_AUTORIZADO for a non-admin, MOTIVO_REQUERIDO for a blank reason, PAGO_NO_ENCONTRADO when
--     an admin of ANOTHER organization names the payout;
--   * a successful annulment: payout and items annulled, the row is pending again, the legacy flag
--     is false, and one audit_logs row carries the reason;
--   * annulling the same payout again is PAGO_YA_ANULADO;
--   * a sale annulled after its commission was paid gets fecha_anulacion from the trigger and an
--     AJUSTE_ANULACION row of -P1.monto; once that row is paid (P2), annulling P1 is AJUSTES_PAGADOS
--     and annulling P2 and then P1 both succeed;
--   * the second dependency (probes 12-16): ORIGINAL paid (P1, inserted directly and backdated so a
--     later return lands after it), the return's AJUSTE_DEVOLUCION paid (P2), the sale annulled and
--     its AJUSTE_ANULACION (-(P1 + P2)) paid (P3). Annulling P2 is then AJUSTES_PAGADOS:<P3>;
--     annulling P3, P2 and P1 in that order all succeed.
--   * every RPC call runs as service_role (SET LOCAL ROLE ... RESET ROLE), as the app calls them,
--     so the privilege path (invoker views, INSERT audit_logs, UPDATE ventas) is proven. Fixture
--     setup stays as postgres.
--
-- Results accumulate in _r and come out in ONE select. Green = esperado equals obtenido, or
-- obtenido starts with 'OK:'.

BEGIN;

CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);

CREATE TEMP TABLE _ctx (
  org TEXT, benef TEXT, clave TEXT, doc_id TEXT, monto NUMERIC,
  admin TEXT, no_admin TEXT, admin_ajeno TEXT, ajeno_org TEXT,
  pago_id TEXT, setup_err TEXT
);

-- Sale fixture, independent of the order fixture (any org with an active admin).
CREATE TEMP TABLE _cv (org TEXT, clave TEXT, doc_id TEXT, benef TEXT, monto NUMERIC, admin TEXT);

-- Return fixture, independent of the seller's real rate and of the live commission row (as in
-- verify/377_probes.sql): COMPLETADA sale with a seller (a non-deleted user of the org) and an org
-- with a non-deleted ADMIN, total > 0, exactly one effective return whose 5% adjustment is non-zero,
-- no live invoice / remito, no payout items. P1 is inserted by hand at a fixed 5%.
CREATE TEMP TABLE _cw (
  org TEXT, doc_id TEXT, benef TEXT, base NUMERIC, pct NUMERIC, monto NUMERIC,
  admin TEXT, dev_id TEXT, dev_at TIMESTAMPTZ, aj_esperado NUMERIC
);

-- Expects anular_pago_comisiones to fail with COMISION_ERROR:<code>; records OK: <message> when it does.
CREATE FUNCTION pg_temp.probe_err(p_orden INT, p_probe TEXT, p_code TEXT, p_org TEXT, p_usr TEXT, p_pago TEXT, p_motivo TEXT) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_msg TEXT;
BEGIN
  IF p_org IS NULL OR p_usr IS NULL OR p_pago IS NULL THEN
    INSERT INTO _r VALUES (p_orden, p_probe, 'COMISION_ERROR:' || p_code, 'SALTEADO: sin fila que sirva');
    RETURN;
  END IF;
  BEGIN
    SET LOCAL ROLE service_role;
    PERFORM anular_pago_comisiones(p_org, p_usr, p_pago, p_motivo);
    RESET ROLE;
    INSERT INTO _r VALUES (p_orden, p_probe, 'COMISION_ERROR:' || p_code, 'FALLO: no levanto excepcion');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    INSERT INTO _r VALUES (p_orden, p_probe, 'COMISION_ERROR:' || p_code,
      CASE WHEN v_msg LIKE '%COMISION_ERROR:' || p_code || '%' THEN 'OK: ' || v_msg ELSE 'FALLO: ' || SQLSTATE || ' ' || v_msg END);
  END;
END $$;

-- ── Fixture: real rows ─────────────────────────────────────────────────────
INSERT INTO _ctx (org, benef, clave, doc_id, monto)
SELECT f.organization_id, f.beneficiario_id, f.clave, f.documento_id, f.monto
  FROM v_comisiones_devengadas f
  JOIN ordenes_servicio o ON o.id = f.documento_id AND o.organization_id = f.organization_id
 WHERE f.documento_tipo = 'ORDEN' AND f.rol = 'TECNICO' AND f.tipo = 'ORIGINAL'
   AND NOT f.pagado AND f.monto > 0 AND NOT COALESCE(o.comision_pagada, false)
   AND EXISTS (SELECT 1 FROM users u WHERE u.organization_id = f.organization_id AND u.rol = 'ADMIN' AND u.deleted_at IS NULL)
   AND EXISTS (SELECT 1 FROM users u WHERE u.organization_id = f.organization_id AND u.id <> f.beneficiario_id)
 ORDER BY f.clave
 LIMIT 1;

UPDATE _ctx c SET
  admin = (SELECT u.id FROM users u WHERE u.organization_id = c.org AND u.rol = 'ADMIN' AND u.deleted_at IS NULL ORDER BY u.id LIMIT 1),
  no_admin = (SELECT u.id FROM users u WHERE u.organization_id = c.org AND u.rol <> 'ADMIN' ORDER BY u.id LIMIT 1),
  admin_ajeno = (SELECT u.id FROM users u WHERE u.organization_id <> c.org AND u.rol = 'ADMIN' AND u.deleted_at IS NULL ORDER BY u.id LIMIT 1),
  ajeno_org = (SELECT u.organization_id FROM users u WHERE u.organization_id <> c.org AND u.rol = 'ADMIN' AND u.deleted_at IS NULL ORDER BY u.id LIMIT 1);

-- Pay the order row: the payout the basic probes annul.
DO $$
DECLARE c RECORD; v_res JSONB;
BEGIN
  SELECT * INTO c FROM _ctx;
  IF NOT FOUND THEN RETURN; END IF;
  SET LOCAL ROLE service_role;
  v_res := pagar_comisiones(c.org, c.admin, c.benef, jsonb_build_array(jsonb_build_object('clave', c.clave, 'monto', c.monto)), 'probe 379');
  RESET ROLE;
  UPDATE _ctx SET pago_id = v_res->>'pagoId';
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  UPDATE _ctx SET setup_err = SQLSTATE || ' ' || SQLERRM;
END $$;

-- A sale: COMPLETADA, seller, total > 0, accrued unpaid commission > 0, no live invoice, no live
-- remito, no returns, no payout items. Sales without inventory items first (stock restore on annul).
INSERT INTO _cv (org, clave, doc_id, benef, monto, admin)
SELECT f.organization_id, f.clave, f.documento_id, f.beneficiario_id, f.monto,
       (SELECT u.id FROM users u WHERE u.organization_id = f.organization_id AND u.rol = 'ADMIN' AND u.deleted_at IS NULL ORDER BY u.id LIMIT 1)
  FROM v_comisiones_devengadas f
  JOIN ventas v ON v.id = f.documento_id AND v.organization_id = f.organization_id
 WHERE f.documento_tipo = 'VENTA' AND f.rol = 'VENDEDOR' AND f.tipo = 'ORIGINAL'
   AND NOT f.pagado AND f.monto > 0 AND NOT COALESCE(v.comision_pagada, false)
   AND v.estado = 'COMPLETADA' AND v.vendedor_id IS NOT NULL AND v.total > 0
   AND NOT EXISTS (SELECT 1 FROM comprobantes_fiscales cf WHERE cf.venta_id = v.id AND cf.estado IN ('pendiente', 'emitido'))
   AND NOT EXISTS (SELECT 1 FROM facturas fa WHERE fa.venta_id = v.id AND fa.estado_pago::text <> 'ANULADA')
   AND NOT EXISTS (SELECT 1 FROM devoluciones_venta d WHERE d.venta_id = v.id)
   AND NOT EXISTS (SELECT 1 FROM comisiones_pagos_items i WHERE i.organization_id = v.organization_id AND i.documento_tipo = 'VENTA' AND i.documento_id = v.id)
   AND EXISTS (SELECT 1 FROM users u WHERE u.organization_id = f.organization_id AND u.rol = 'ADMIN' AND u.deleted_at IS NULL)
 ORDER BY EXISTS (SELECT 1 FROM items_venta iv WHERE iv.venta_id = v.id AND iv.inventario_id IS NOT NULL), f.clave
 LIMIT 1;

INSERT INTO _cw (org, doc_id, benef, base, pct, monto, admin, dev_id, dev_at, aj_esperado)
SELECT v.organization_id, v.id, v.vendedor_id, COALESCE(v.iva_neto, v.total), 5,
       ROUND(COALESCE(v.iva_neto, v.total) * 5 / 100, 2),
       (SELECT u.id FROM users u WHERE u.organization_id = v.organization_id AND u.rol = 'ADMIN' AND u.deleted_at IS NULL ORDER BY u.id LIMIT 1),
       d.id, d.created_at,
       -ROUND(COALESCE(v.iva_neto, v.total) * d.monto_devolucion / v.total * 5 / 100, 2)
  FROM ventas v
  JOIN devoluciones_venta d ON d.venta_id = v.id
 WHERE v.estado = 'COMPLETADA' AND v.vendedor_id IS NOT NULL AND v.total > 0
   AND d.estado = 'COMPLETADA' AND NOT d.anulada
   AND (SELECT COUNT(*) FROM devoluciones_venta d2 WHERE d2.venta_id = v.id) = 1
   AND ROUND(COALESCE(v.iva_neto, v.total) * d.monto_devolucion / v.total * 5 / 100, 2) > 0
   AND ROUND(COALESCE(v.iva_neto, v.total) * 5 / 100, 2) > 0
   AND EXISTS (SELECT 1 FROM users u WHERE u.id = v.vendedor_id AND u.organization_id = v.organization_id AND u.deleted_at IS NULL)
   AND EXISTS (SELECT 1 FROM users u WHERE u.organization_id = v.organization_id AND u.rol = 'ADMIN' AND u.deleted_at IS NULL)
   AND v.id NOT IN (SELECT doc_id FROM _cv)
   AND NOT EXISTS (SELECT 1 FROM comprobantes_fiscales cf WHERE cf.venta_id = v.id AND cf.estado IN ('pendiente', 'emitido'))
   AND NOT EXISTS (SELECT 1 FROM facturas fa WHERE fa.venta_id = v.id AND fa.estado_pago::text <> 'ANULADA')
   AND NOT EXISTS (SELECT 1 FROM comisiones_pagos_items i WHERE i.organization_id = v.organization_id AND i.documento_tipo = 'VENTA' AND i.documento_id = v.id)
 ORDER BY EXISTS (SELECT 1 FROM items_venta iv WHERE iv.venta_id = v.id AND iv.inventario_id IS NOT NULL), d.created_at DESC
 LIMIT 1;

-- ── 1. Shape and privileges (always runs) ──────────────────────────────────
INSERT INTO _r SELECT 1, 'anular_pago_comisiones: prosecdef / anon / authenticated / service_role',
  'false / false / false / true',
  COALESCE(bool_or(p.prosecdef)::TEXT, '-') || ' / ' ||
  COALESCE(bool_or(has_function_privilege('anon', p.oid, 'EXECUTE'))::TEXT, '-') || ' / ' ||
  COALESCE(bool_or(has_function_privilege('authenticated', p.oid, 'EXECUTE'))::TEXT, '-') || ' / ' ||
  COALESCE(bool_and(has_function_privilege('service_role', p.oid, 'EXECUTE'))::TEXT, '-')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'anular_pago_comisiones';

INSERT INTO _r SELECT 2, 'fixture: fila ORDEN devengada, pagada en el setup', 'true',
  CASE WHEN NOT EXISTS (SELECT 1 FROM _ctx) THEN 'SALTEADO: la base no tiene una orden devengada sin pagar con admin'
       WHEN (SELECT pago_id FROM _ctx) IS NULL THEN 'FALLO: el pago de setup fallo: ' || COALESCE((SELECT setup_err FROM _ctx), '?')
       ELSE 'true' END;

-- ── 3-5. Refusals ──────────────────────────────────────────────────────────
SELECT pg_temp.probe_err(3, 'NO_AUTORIZADO: usuario no admin de la org', 'NO_AUTORIZADO',
  (SELECT org FROM _ctx), (SELECT no_admin FROM _ctx), (SELECT pago_id FROM _ctx), 'probe 379');

SELECT pg_temp.probe_err(4, 'MOTIVO_REQUERIDO: motivo en blanco', 'MOTIVO_REQUERIDO',
  (SELECT org FROM _ctx), (SELECT admin FROM _ctx), (SELECT pago_id FROM _ctx), '   ');

SELECT pg_temp.probe_err(5, 'PAGO_NO_ENCONTRADO: admin de otra organizacion nombra el pago', 'PAGO_NO_ENCONTRADO',
  (SELECT ajeno_org FROM _ctx), (SELECT admin_ajeno FROM _ctx), (SELECT pago_id FROM _ctx), 'probe 379');

-- ── 6. Success: payout + item annulled, row pending again, flag false, audit row ──
DO $$
DECLARE c RECORD; v_res JSONB; v_got TEXT;
BEGIN
  SELECT * INTO c FROM _ctx WHERE pago_id IS NOT NULL;
  IF NOT FOUND THEN
    INSERT INTO _r VALUES (6, 'anular el pago de una orden: anulado, fila pendiente, flag, audit_logs', 'OK', 'SALTEADO: no hubo pago');
    RETURN;
  END IF;
  SET LOCAL ROLE service_role;
  v_res := anular_pago_comisiones(c.org, c.admin, c.pago_id, '  probe 379  ');
  RESET ROLE;
  SELECT format('filas=%s / pago=%s / items=%s / pagado=%s / flag=%s / audit=%s',
      v_res->>'filas',
      (SELECT (p.anulado AND p.anulado_por = c.admin AND p.anulado_at IS NOT NULL AND p.motivo_anulacion = 'probe 379') FROM comisiones_pagos p WHERE p.id = c.pago_id)::text,
      (SELECT COUNT(*) FROM comisiones_pagos_items i WHERE i.pago_id = c.pago_id AND NOT i.anulado),
      (SELECT f.pagado FROM v_comisiones_filas f WHERE f.clave = c.clave AND f.organization_id = c.org)::text,
      (SELECT o.comision_pagada FROM ordenes_servicio o WHERE o.id = c.doc_id AND o.organization_id = c.org)::text,
      (SELECT COUNT(*) FROM audit_logs a WHERE a.organization_id = c.org AND a.entity = 'comisiones_pagos' AND a.entity_id = c.pago_id
          AND a.action = 'UPDATE' AND a.user_id = c.admin AND a.description = 'Anuló un pago de comisiones: probe 379'
          AND a.changes->'after'->>'anulado' = 'true' AND a.changes->'before'->>'anulado' = 'false'
          AND (a.changes->'after'->>'total')::numeric = c.monto AND a.changes->'after'->>'beneficiario_id' = c.benef))
    INTO v_got;
  INSERT INTO _r VALUES (6, 'anular el pago de una orden: anulado, fila pendiente, flag, audit_logs',
    'filas=1 / pago=true / items=0 / pagado=false / flag=false / audit=1', v_got);
END $$;

SELECT pg_temp.probe_err(7, 'PAGO_YA_ANULADO: anular el mismo pago otra vez', 'PAGO_YA_ANULADO',
  (SELECT org FROM _ctx WHERE pago_id IS NOT NULL), (SELECT admin FROM _ctx), (SELECT pago_id FROM _ctx), 'probe 379');

-- ── 8-11. Sale annulled after its commission was paid ──────────────────────
-- 8: pay the ORIGINAL (P1), annul the sale: fecha_anulacion set by the trigger, AJUSTE_ANULACION of -P1.monto.
-- 9: pay that adjustment (P2); annulling P1 is AJUSTES_PAGADOS:<P2>.
-- 10: annul P2 (nothing points at it). 11: annul P1; flag false.
DO $$
DECLARE
  c RECORD; v_stage INT := 8; v_p1 TEXT; v_p2 TEXT; v_res JSONB; v_got TEXT; v_msg TEXT;
  v_clave_aj TEXT; v_monto_aj NUMERIC;
  -- Results are buffered: the EXCEPTION handler below rolls this block back, and the lines of the
  -- steps that did run must survive it.
  v_rows JSONB := '[]'::jsonb;
BEGIN
  SELECT * INTO c FROM _cv;
  IF NOT FOUND THEN
    INSERT INTO _r VALUES (8,  'venta anulada tras el pago: fecha_anulacion y AJUSTE_ANULACION', 'OK', 'SALTEADO: la base no tiene una venta sin comprobantes, devoluciones ni pagos con comision devengada');
    INSERT INTO _r VALUES (9,  'AJUSTES_PAGADOS: anular P1 con el ajuste pagado en P2', 'OK', 'SALTEADO: sin venta que sirva');
    INSERT INTO _r VALUES (10, 'anular P2 (el ajuste) primero: OK', 'OK', 'SALTEADO: sin venta que sirva');
    INSERT INTO _r VALUES (11, 'anular P1 despues: OK y flag de la venta en false', 'OK', 'SALTEADO: sin venta que sirva');
    RETURN;
  END IF;

  SET LOCAL ROLE service_role;
  v_res := pagar_comisiones(c.org, c.admin, c.benef, jsonb_build_array(jsonb_build_object('clave', c.clave, 'monto', c.monto)), 'probe 379 P1');
  RESET ROLE;
  v_p1 := v_res->>'pagoId';
  UPDATE ventas SET estado = 'ANULADA' WHERE id = c.doc_id AND organization_id = c.org;

  v_clave_aj := 'VENTA:' || c.doc_id || ':VENDEDOR:AJUSTE_ANULACION:-';
  SELECT d.monto INTO v_monto_aj FROM v_comisiones_devengadas d WHERE d.organization_id = c.org AND d.clave = v_clave_aj AND NOT d.pagado;
  SELECT format('fecha_anulacion=%s / ajuste=%s / monto=%s',
      (SELECT (v.fecha_anulacion IS NOT NULL)::text FROM ventas v WHERE v.id = c.doc_id AND v.organization_id = c.org),
      (v_monto_aj IS NOT NULL)::text,
      (v_monto_aj = -c.monto)::text)
    INTO v_got;
  v_rows := v_rows || jsonb_build_array(jsonb_build_array(8, 'venta anulada tras el pago: fecha_anulacion y AJUSTE_ANULACION',
    'fecha_anulacion=true / ajuste=true / monto=true', v_got));

  v_stage := 9;
  SET LOCAL ROLE service_role;
  v_res := pagar_comisiones(c.org, c.admin, c.benef, jsonb_build_array(jsonb_build_object('clave', v_clave_aj, 'monto', v_monto_aj)), 'probe 379 P2');
  RESET ROLE;
  v_p2 := v_res->>'pagoId';
  BEGIN
    SET LOCAL ROLE service_role;
    PERFORM anular_pago_comisiones(c.org, c.admin, v_p1, 'probe 379 P1');
    RESET ROLE;
    v_got := 'FALLO: no levanto excepcion';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    v_got := CASE WHEN v_msg LIKE '%COMISION_ERROR:AJUSTES_PAGADOS:' || v_p2 THEN 'OK: ' || v_msg ELSE 'FALLO: ' || SQLSTATE || ' ' || v_msg END;
  END;
  v_rows := v_rows || jsonb_build_array(jsonb_build_array(9, 'AJUSTES_PAGADOS: anular P1 con el ajuste pagado en P2',
    'COMISION_ERROR:AJUSTES_PAGADOS:' || v_p2, v_got));

  v_stage := 10;
  SET LOCAL ROLE service_role;
  v_res := anular_pago_comisiones(c.org, c.admin, v_p2, 'probe 379 P2');
  RESET ROLE;
  v_rows := v_rows || jsonb_build_array(jsonb_build_array(10, 'anular P2 (el ajuste) primero: OK', 'filas=1 / anulado=true',
    format('filas=%s / anulado=%s', v_res->>'filas', (SELECT p.anulado FROM comisiones_pagos p WHERE p.id = v_p2)::text)));

  v_stage := 11;
  SET LOCAL ROLE service_role;
  v_res := anular_pago_comisiones(c.org, c.admin, v_p1, 'probe 379 P1');
  RESET ROLE;
  v_rows := v_rows || jsonb_build_array(jsonb_build_array(11, 'anular P1 despues: OK y flag de la venta en false', 'filas=1 / anulado=true / flag=false',
    format('filas=%s / anulado=%s / flag=%s', v_res->>'filas',
      (SELECT p.anulado FROM comisiones_pagos p WHERE p.id = v_p1)::text,
      (SELECT v.comision_pagada FROM ventas v WHERE v.id = c.doc_id AND v.organization_id = c.org)::text)));

  INSERT INTO _r SELECT (r->>0)::int, r->>1, r->>2, r->>3 FROM jsonb_array_elements(v_rows) AS t(r);
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  INSERT INTO _r SELECT (r->>0)::int, r->>1, r->>2, r->>3 FROM jsonb_array_elements(v_rows) AS t(r);
  INSERT INTO _r VALUES (v_stage, 'cadena de la venta anulada: paso ' || v_stage, 'OK', 'FALLO: ' || SQLSTATE || ' ' || v_msg);
  INSERT INTO _r SELECT g, 'cadena de la venta anulada: paso ' || g, 'OK', 'SALTEADO: la cadena se interrumpio en el paso ' || v_stage
    FROM generate_series(v_stage + 1, 11) AS g;
END $$;

-- ── 12-16. A paid AJUSTE_DEVOLUCION that a paid AJUSTE_ANULACION nets ─────
-- 12: P1 = ORIGINAL paid directly, backdated before the return; the return yields a live AJUSTE_DEVOLUCION.
-- 13: pay it (P2); the live twin disappears.
-- 14: annul the sale; the AJUSTE_ANULACION is -(P1 + P2); pay it (P3).
-- 15: annulling P2 is AJUSTES_PAGADOS:<P3>.
-- 16: annul P3, then P2, then P1: all succeed.
DO $$
DECLARE
  c RECORD; v_stage INT := 12; v_p1 TEXT; v_p2 TEXT; v_p3 TEXT; v_res JSONB; v_got TEXT; v_msg TEXT;
  v_clave_dev TEXT; v_monto_dev NUMERIC; v_clave_an TEXT; v_monto_an NUMERIC;
  v_f3 TEXT; v_f2 TEXT; v_f1 TEXT;
  -- Buffered like the block above: the handler rolls this block back, and the lines of the steps
  -- that did run must survive it.
  v_rows JSONB := '[]'::jsonb;
BEGIN
  SELECT * INTO c FROM _cw;
  IF NOT FOUND THEN
    INSERT INTO _r VALUES (12, 'devolucion tras el pago: AJUSTE_DEVOLUCION vivo', 'OK', 'SALTEADO: la base no tiene una venta con una sola devolucion, sin comprobantes ni pagos y con comision devengada');
    INSERT INTO _r VALUES (13, 'pagar el AJUSTE_DEVOLUCION (P2): su gemelo vivo desaparece', 'OK', 'SALTEADO: sin venta que sirva');
    INSERT INTO _r VALUES (14, 'venta anulada: AJUSTE_ANULACION de -(P1+P2), pagado (P3)', 'OK', 'SALTEADO: sin venta que sirva');
    INSERT INTO _r VALUES (15, 'AJUSTES_PAGADOS: anular P2 con el AJUSTE_ANULACION pagado en P3', 'OK', 'SALTEADO: sin venta que sirva');
    INSERT INTO _r VALUES (16, 'anular P3, P2 y P1 en ese orden: OK', 'OK', 'SALTEADO: sin venta que sirva');
    RETURN;
  END IF;

  -- P1 directly (not through the RPC): backdated one day before the return, the only way to make
  -- the return land after the payment.
  INSERT INTO comisiones_pagos (organization_id, beneficiario_id, fecha_pago, pagado_por, total, origen)
  VALUES (c.org, c.benef, c.dev_at - interval '1 day', c.admin, c.monto, 'APP')
  RETURNING id INTO v_p1;
  INSERT INTO comisiones_pagos_items (pago_id, organization_id, documento_tipo, documento_id, rol, tipo, base, porcentaje, monto, fecha_devengo)
  VALUES (v_p1, c.org, 'VENTA', c.doc_id, 'VENDEDOR', 'ORIGINAL', c.base, c.pct, c.monto, c.dev_at - interval '1 day');
  PERFORM comisiones_sincronizar_flags(c.org, 'VENTA', ARRAY[c.doc_id]);

  SELECT d.clave, d.monto INTO v_clave_dev, v_monto_dev
    FROM v_comisiones_devengadas d
   WHERE d.organization_id = c.org AND d.documento_id = c.doc_id AND d.tipo = 'AJUSTE_DEVOLUCION' AND NOT d.pagado;
  v_rows := v_rows || jsonb_build_array(jsonb_build_array(12, 'devolucion tras el pago: AJUSTE_DEVOLUCION vivo',
    'ajuste=true / monto=true / ref=true',
    format('ajuste=%s / monto=%s / ref=%s', (v_clave_dev IS NOT NULL)::text, (v_monto_dev = c.aj_esperado)::text,
      (v_clave_dev = 'VENTA:' || c.doc_id || ':VENDEDOR:AJUSTE_DEVOLUCION:' || c.dev_id)::text)));

  v_stage := 13;
  SET LOCAL ROLE service_role;
  v_res := pagar_comisiones(c.org, c.admin, c.benef, jsonb_build_array(jsonb_build_object('clave', v_clave_dev, 'monto', v_monto_dev)), 'probe 379 P2');
  RESET ROLE;
  v_p2 := v_res->>'pagoId';
  v_rows := v_rows || jsonb_build_array(jsonb_build_array(13, 'pagar el AJUSTE_DEVOLUCION (P2): su gemelo vivo desaparece',
    'pagado=true / vivos=0',
    format('pagado=%s / vivos=%s',
      (SELECT f.pagado FROM v_comisiones_filas f WHERE f.organization_id = c.org AND f.clave = v_clave_dev)::text,
      (SELECT COUNT(*) FROM v_comisiones_filas f WHERE f.organization_id = c.org AND f.documento_id = c.doc_id
          AND f.tipo = 'AJUSTE_DEVOLUCION' AND NOT f.pagado))));

  v_stage := 14;
  UPDATE ventas SET estado = 'ANULADA' WHERE id = c.doc_id AND organization_id = c.org;
  v_clave_an := 'VENTA:' || c.doc_id || ':VENDEDOR:AJUSTE_ANULACION:-';
  SELECT d.monto INTO v_monto_an FROM v_comisiones_devengadas d WHERE d.organization_id = c.org AND d.clave = v_clave_an AND NOT d.pagado;
  SET LOCAL ROLE service_role;
  v_res := pagar_comisiones(c.org, c.admin, c.benef, jsonb_build_array(jsonb_build_object('clave', v_clave_an, 'monto', v_monto_an)), 'probe 379 P3');
  RESET ROLE;
  v_p3 := v_res->>'pagoId';
  v_rows := v_rows || jsonb_build_array(jsonb_build_array(14, 'venta anulada: AJUSTE_ANULACION de -(P1+P2), pagado (P3)',
    'ajuste=true / monto=true / pagado=true',
    format('ajuste=%s / monto=%s / pagado=%s', (v_monto_an IS NOT NULL)::text,
      (v_monto_an = -(c.monto + v_monto_dev))::text,
      (SELECT f.pagado FROM v_comisiones_filas f WHERE f.organization_id = c.org AND f.clave = v_clave_an)::text)));

  v_stage := 15;
  BEGIN
    SET LOCAL ROLE service_role;
    PERFORM anular_pago_comisiones(c.org, c.admin, v_p2, 'probe 379 P2');
    RESET ROLE;
    v_got := 'FALLO: no levanto excepcion';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    v_got := CASE WHEN v_msg LIKE '%COMISION_ERROR:AJUSTES_PAGADOS:' || v_p3 THEN 'OK: ' || v_msg ELSE 'FALLO: ' || SQLSTATE || ' ' || v_msg END;
  END;
  v_rows := v_rows || jsonb_build_array(jsonb_build_array(15, 'AJUSTES_PAGADOS: anular P2 con el AJUSTE_ANULACION pagado en P3',
    'COMISION_ERROR:AJUSTES_PAGADOS:' || v_p3, v_got));

  v_stage := 16;
  SET LOCAL ROLE service_role;
  v_res := anular_pago_comisiones(c.org, c.admin, v_p3, 'probe 379 P3');
  v_f3 := v_res->>'filas';
  v_res := anular_pago_comisiones(c.org, c.admin, v_p2, 'probe 379 P2');
  v_f2 := v_res->>'filas';
  v_res := anular_pago_comisiones(c.org, c.admin, v_p1, 'probe 379 P1');
  v_f1 := v_res->>'filas';
  RESET ROLE;
  v_rows := v_rows || jsonb_build_array(jsonb_build_array(16, 'anular P3, P2 y P1 en ese orden: OK', 'filas=1/1/1 / anulados=3',
    format('filas=%s/%s/%s / anulados=%s', v_f3, v_f2, v_f1,
      (SELECT COUNT(*) FROM comisiones_pagos p WHERE p.id IN (v_p1, v_p2, v_p3) AND p.anulado))));

  INSERT INTO _r SELECT (r->>0)::int, r->>1, r->>2, r->>3 FROM jsonb_array_elements(v_rows) AS t(r);
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  INSERT INTO _r SELECT (r->>0)::int, r->>1, r->>2, r->>3 FROM jsonb_array_elements(v_rows) AS t(r);
  INSERT INTO _r VALUES (v_stage, 'cadena de la devolucion y la anulacion: paso ' || v_stage, 'OK', 'FALLO: ' || SQLSTATE || ' ' || v_msg);
  INSERT INTO _r SELECT g, 'cadena de la devolucion y la anulacion: paso ' || g, 'OK', 'SALTEADO: la cadena se interrumpio en el paso ' || v_stage
    FROM generate_series(v_stage + 1, 16) AS g;
END $$;

-- 17. No probe lost its row or inserted two.
INSERT INTO _r SELECT 17, 'filas de los probes 1 a 16: total / distintas', '16 / 16',
  COUNT(*)::TEXT || ' / ' || COUNT(DISTINCT orden)::TEXT FROM _r WHERE orden BETWEEN 1 AND 16;

SELECT orden, probe, esperado, obtenido,
       CASE WHEN esperado = obtenido OR obtenido LIKE 'OK:%' THEN 'OK'
            WHEN obtenido LIKE 'SALTEADO:%' THEN 'SALTEADO' ELSE 'FALLA' END AS resultado
  FROM _r ORDER BY orden;

ROLLBACK;
