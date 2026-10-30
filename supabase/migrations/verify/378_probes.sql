-- Verification of comisiones_pagar_rpc (migration 378): pagar_comisiones + comisiones_sincronizar_flags.
--
-- Run AFTER 376, 377 and 378 are applied, in the SQL editor of Supabase Studio or with
--   node scripts/db-run.mjs supabase/migrations/verify/378_probes.sql
-- (no --apply: the file opens its own transaction and always ends in ROLLBACK).
--
-- Without RLS, as in verify/README.md. It uses REAL rows of the base (it creates no
-- organization): it picks one accrued, unpaid order commission (ORDEN / TECNICO / ORIGINAL,
-- amount > 0) and, when there is one, an accrued, unpaid sale commission. Everything it writes
-- (payouts, items, flags, the tecnico reassignment, the costo_final change) is rolled back.
-- A probe that finds no fitting row skips itself and says so in `obtenido` (SALTEADO: ...).
--
-- What it proves, against the real schema:
--   * both functions are not SECURITY DEFINER and only service_role can execute them;
--   * NO_AUTORIZADO for a non-admin and for an admin of another organization;
--   * SIN_FILAS, FILA_DUPLICADA, MONTO_DISTINTO (and no payout written), OTRO_BENEFICIARIO,
--     FILA_NO_DISPONIBLE for an order commission that is not accrued;
--   * a successful payment: the item equals the definition row, the row is now pagado, the
--     legacy flag is true and fecha_pago_comision equals the payout's fecha_pago;
--   * the same row again is FILA_YA_PAGADA;
--   * after the payment, a reassignment of tecnico_id keeps the row with the old beneficiary and
--     amount (no row for the new one), and a costo_final change leaves the paid amount unchanged.
--
-- Results accumulate in _r and come out in ONE select. Green = esperado equals obtenido, or
-- obtenido starts with 'OK:'.

BEGIN;

CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);

CREATE TEMP TABLE _ctx (
  org TEXT, benef TEXT, clave TEXT, doc_id TEXT, monto NUMERIC,
  admin TEXT, otro TEXT, no_admin TEXT, admin_ajeno TEXT,
  clave_no_dev TEXT,
  pagos_antes INT, pago_id TEXT, fecha_pago TIMESTAMPTZ
);

-- Sale fixture, independent of the order fixture (any org with an active admin).
CREATE TEMP TABLE _cv (org TEXT, clave TEXT, doc_id TEXT, benef TEXT, monto NUMERIC, admin TEXT);

-- Expects pagar_comisiones to fail with COMISION_ERROR:<code>; records OK: <message> when it does.
CREATE FUNCTION pg_temp.probe_err(p_orden INT, p_probe TEXT, p_code TEXT, p_org TEXT, p_usr TEXT, p_benef TEXT, p_filas JSONB) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_msg TEXT;
BEGIN
  IF p_org IS NULL OR p_usr IS NULL OR p_benef IS NULL OR p_filas IS NULL THEN
    INSERT INTO _r VALUES (p_orden, p_probe, 'COMISION_ERROR:' || p_code, 'SALTEADO: sin fila que sirva');
    RETURN;
  END IF;
  BEGIN
    PERFORM pagar_comisiones(p_org, p_usr, p_benef, p_filas);
    INSERT INTO _r VALUES (p_orden, p_probe, 'COMISION_ERROR:' || p_code, 'FALLO: no levanto excepcion');
  EXCEPTION WHEN OTHERS THEN
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
  otro = (SELECT u.id FROM users u WHERE u.organization_id = c.org AND u.id <> c.benef ORDER BY u.id LIMIT 1),
  no_admin = (SELECT u.id FROM users u WHERE u.organization_id = c.org AND u.rol <> 'ADMIN' ORDER BY u.id LIMIT 1),
  admin_ajeno = (SELECT u.id FROM users u WHERE u.organization_id <> c.org AND u.rol = 'ADMIN' AND u.deleted_at IS NULL ORDER BY u.id LIMIT 1),
  clave_no_dev = (SELECT f.clave FROM v_comisiones_filas f
                   WHERE f.organization_id = c.org AND f.documento_tipo = 'ORDEN' AND f.rol = 'TECNICO'
                     AND NOT f.devengada AND NOT f.pagado ORDER BY f.clave LIMIT 1),
  pagos_antes = (SELECT COUNT(*) FROM comisiones_pagos p WHERE p.organization_id = c.org);

-- A sale commission: accrued, unpaid, amount > 0, in any org with an active admin.
INSERT INTO _cv (org, clave, doc_id, benef, monto, admin)
SELECT f.organization_id, f.clave, f.documento_id, f.beneficiario_id, f.monto,
       (SELECT u.id FROM users u WHERE u.organization_id = f.organization_id AND u.rol = 'ADMIN' AND u.deleted_at IS NULL ORDER BY u.id LIMIT 1)
  FROM v_comisiones_devengadas f
  JOIN ventas v ON v.id = f.documento_id AND v.organization_id = f.organization_id
 WHERE f.documento_tipo = 'VENTA' AND f.rol = 'VENDEDOR' AND f.tipo = 'ORIGINAL'
   AND NOT f.pagado AND f.monto > 0 AND NOT COALESCE(v.comision_pagada, false)
   AND EXISTS (SELECT 1 FROM users u WHERE u.organization_id = f.organization_id AND u.rol = 'ADMIN' AND u.deleted_at IS NULL)
 ORDER BY f.clave LIMIT 1;

-- ── 1. Shape and privileges (always runs) ──────────────────────────────────
INSERT INTO _r SELECT 1, 'pagar_comisiones y comisiones_sincronizar_flags: prosecdef / anon / authenticated / service_role',
  'false / false / false / true',
  COALESCE(bool_or(p.prosecdef)::TEXT, '-') || ' / ' ||
  COALESCE(bool_or(has_function_privilege('anon', p.oid, 'EXECUTE'))::TEXT, '-') || ' / ' ||
  COALESCE(bool_or(has_function_privilege('authenticated', p.oid, 'EXECUTE'))::TEXT, '-') || ' / ' ||
  COALESCE(bool_and(has_function_privilege('service_role', p.oid, 'EXECUTE'))::TEXT, '-')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname IN ('pagar_comisiones', 'comisiones_sincronizar_flags');

INSERT INTO _r SELECT 2, 'fixture: fila ORDEN devengada y sin pagar encontrada', 'true',
  CASE WHEN EXISTS (SELECT 1 FROM _ctx) THEN 'true' ELSE 'SALTEADO: la base no tiene una orden devengada sin pagar con admin' END;

-- ── 3-8. Refusals ──────────────────────────────────────────────────────────
SELECT pg_temp.probe_err(3, 'NO_AUTORIZADO: usuario no admin de la org', 'NO_AUTORIZADO',
  (SELECT org FROM _ctx), (SELECT no_admin FROM _ctx), (SELECT benef FROM _ctx),
  (SELECT jsonb_build_array(jsonb_build_object('clave', clave, 'monto', monto)) FROM _ctx));

SELECT pg_temp.probe_err(4, 'NO_AUTORIZADO: admin de otra organizacion', 'NO_AUTORIZADO',
  (SELECT org FROM _ctx), (SELECT admin_ajeno FROM _ctx), (SELECT benef FROM _ctx),
  (SELECT jsonb_build_array(jsonb_build_object('clave', clave, 'monto', monto)) FROM _ctx));

SELECT pg_temp.probe_err(5, 'SIN_FILAS: arreglo vacio', 'SIN_FILAS',
  (SELECT org FROM _ctx), (SELECT admin FROM _ctx), (SELECT benef FROM _ctx), '[]'::jsonb);

SELECT pg_temp.probe_err(6, 'FILA_DUPLICADA: la misma clave dos veces', 'FILA_DUPLICADA',
  (SELECT org FROM _ctx), (SELECT admin FROM _ctx), (SELECT benef FROM _ctx),
  (SELECT jsonb_build_array(jsonb_build_object('clave', clave, 'monto', monto), jsonb_build_object('clave', clave, 'monto', monto)) FROM _ctx));

SELECT pg_temp.probe_err(7, 'MONTO_DISTINTO: monto pedido distinto al de la definicion', 'MONTO_DISTINTO',
  (SELECT org FROM _ctx), (SELECT admin FROM _ctx), (SELECT benef FROM _ctx),
  (SELECT jsonb_build_array(jsonb_build_object('clave', clave, 'monto', monto + 0.01)) FROM _ctx));

INSERT INTO _r SELECT 8, 'MONTO_DISTINTO no escribio ningun pago', '0',
  CASE WHEN EXISTS (SELECT 1 FROM _ctx)
       THEN (SELECT (COUNT(*) - (SELECT pagos_antes FROM _ctx))::TEXT FROM comisiones_pagos WHERE organization_id = (SELECT org FROM _ctx))
       ELSE 'SALTEADO: sin fila que sirva' END;

SELECT pg_temp.probe_err(9, 'OTRO_BENEFICIARIO: la fila es de otro usuario', 'OTRO_BENEFICIARIO',
  (SELECT org FROM _ctx), (SELECT admin FROM _ctx), (SELECT otro FROM _ctx),
  (SELECT jsonb_build_array(jsonb_build_object('clave', clave, 'monto', monto)) FROM _ctx));

SELECT pg_temp.probe_err(10, 'FILA_NO_DISPONIBLE: orden que no esta devengada', 'FILA_NO_DISPONIBLE',
  (SELECT org FROM _ctx), (SELECT admin FROM _ctx), (SELECT benef FROM _ctx),
  (SELECT jsonb_build_array(jsonb_build_object('clave', clave_no_dev, 'monto', 1)) FROM _ctx WHERE clave_no_dev IS NOT NULL));

-- ── 11. Success: item = definition row, row pagado, flag true, fecha_pago_comision = payout ──
DO $$
DECLARE c RECORD; v_res JSONB; v_ok TEXT;
BEGIN
  SELECT * INTO c FROM _ctx;
  IF NOT FOUND THEN
    INSERT INTO _r VALUES (11, 'pago de una orden: item = fila, pagado, flag, fecha', 'OK', 'SALTEADO: sin fila que sirva');
    RETURN;
  END IF;
  v_res := pagar_comisiones(c.org, c.admin, c.benef, jsonb_build_array(jsonb_build_object('clave', c.clave, 'monto', c.monto)), '  probe 378  ');
  UPDATE _ctx SET pago_id = v_res->>'pagoId';
  UPDATE _ctx SET fecha_pago = (SELECT p.fecha_pago FROM comisiones_pagos p WHERE p.id = pago_id);
  SELECT format('total=%s / filas=%s / item=%s / pagado=%s / flag=%s / fecha=%s / notas=%s',
      ((v_res->>'total')::numeric = c.monto)::text,
      v_res->>'filas',
      (SELECT COUNT(*) FROM comisiones_pagos_items i WHERE i.pago_id = v_res->>'pagoId' AND i.organization_id = c.org
          AND i.documento_id = c.doc_id AND i.rol = 'TECNICO' AND i.tipo = 'ORIGINAL' AND i.monto = c.monto AND NOT i.anulado),
      (SELECT f.pagado AND f.pago_id = v_res->>'pagoId' FROM v_comisiones_filas f WHERE f.clave = c.clave AND f.organization_id = c.org)::text,
      (SELECT o.comision_pagada FROM ordenes_servicio o WHERE o.id = c.doc_id AND o.organization_id = c.org)::text,
      (SELECT o.fecha_pago_comision = p.fecha_pago FROM ordenes_servicio o, comisiones_pagos p WHERE o.id = c.doc_id AND o.organization_id = c.org AND p.id = v_res->>'pagoId')::text,
      (SELECT p.notas FROM comisiones_pagos p WHERE p.id = v_res->>'pagoId'))
    INTO v_ok;
  INSERT INTO _r VALUES (11, 'pago de una orden: item = fila, pagado, flag, fecha', 'total=true / filas=1 / item=1 / pagado=true / flag=true / fecha=true / notas=probe 378', v_ok);
END $$;

SELECT pg_temp.probe_err(12, 'FILA_YA_PAGADA: la misma fila otra vez', 'FILA_YA_PAGADA',
  (SELECT org FROM _ctx WHERE pago_id IS NOT NULL), (SELECT admin FROM _ctx), (SELECT benef FROM _ctx),
  (SELECT jsonb_build_array(jsonb_build_object('clave', clave, 'monto', monto)) FROM _ctx));

-- ── 13. Reasign tecnico_id after the payment: the paid row keeps the old beneficiary and amount ──
DO $$
DECLARE c RECORD; v_got TEXT;
BEGIN
  SELECT * INTO c FROM _ctx WHERE pago_id IS NOT NULL;
  IF NOT FOUND THEN
    INSERT INTO _r VALUES (13, 'reasignar tecnico_id de la orden pagada: la fila no se mueve', 'OK', 'SALTEADO: no hubo pago');
    RETURN;
  END IF;
  UPDATE ordenes_servicio SET tecnico_id = c.otro WHERE id = c.doc_id AND organization_id = c.org;
  SELECT format('beneficiario=%s / monto=%s / pagado=%s / filas del nuevo=%s',
      (SELECT f.beneficiario_id = c.benef FROM v_comisiones_filas f WHERE f.clave = c.clave AND f.organization_id = c.org)::text,
      (SELECT f.monto = c.monto FROM v_comisiones_filas f WHERE f.clave = c.clave AND f.organization_id = c.org)::text,
      (SELECT f.pagado FROM v_comisiones_filas f WHERE f.clave = c.clave AND f.organization_id = c.org)::text,
      (SELECT COUNT(*) FROM v_comisiones_filas f WHERE f.organization_id = c.org AND f.documento_id = c.doc_id
          AND f.rol = 'TECNICO' AND f.tipo = 'ORIGINAL' AND f.beneficiario_id = c.otro))
    INTO v_got;
  INSERT INTO _r VALUES (13, 'reasignar tecnico_id de la orden pagada: la fila no se mueve',
    'beneficiario=true / monto=true / pagado=true / filas del nuevo=0', v_got);
END $$;

-- ── 14. costo_final changes after the payment: the paid amount is frozen ───
DO $$
DECLARE c RECORD; v_got TEXT;
BEGIN
  SELECT * INTO c FROM _ctx WHERE pago_id IS NOT NULL;
  IF NOT FOUND THEN
    INSERT INTO _r VALUES (14, 'cambiar costo_final de la orden pagada: el monto pagado no cambia', 'OK', 'SALTEADO: no hubo pago');
    RETURN;
  END IF;
  UPDATE ordenes_servicio SET costo_final = COALESCE(costo_final, 0) + 100000 WHERE id = c.doc_id AND organization_id = c.org;
  SELECT format('monto=%s / pendiente=%s',
      (SELECT f.monto = c.monto FROM v_comisiones_filas f WHERE f.clave = c.clave AND f.organization_id = c.org)::text,
      (SELECT f.pendiente FROM v_comisiones_filas f WHERE f.clave = c.clave AND f.organization_id = c.org))
    INTO v_got;
  INSERT INTO _r VALUES (14, 'cambiar costo_final de la orden pagada: el monto pagado no cambia', 'monto=true / pendiente=0.00', v_got);
END $$;

-- ── 15. Success on a sale: item = row, flag true, fecha_pago_comision = payout ──
DO $$
DECLARE c RECORD; v_res JSONB; v_got TEXT;
BEGIN
  SELECT * INTO c FROM _cv;
  IF NOT FOUND THEN
    INSERT INTO _r VALUES (15, 'pago de una venta: item = fila, pagado, flag, fecha', 'OK', 'SALTEADO: la base no tiene una venta devengada sin pagar con admin');
    RETURN;
  END IF;
  v_res := pagar_comisiones(c.org, c.admin, c.benef, jsonb_build_array(jsonb_build_object('clave', c.clave, 'monto', c.monto)));
  SELECT format('item=%s / pagado=%s / flag=%s / fecha=%s',
      (SELECT COUNT(*) FROM comisiones_pagos_items i WHERE i.pago_id = v_res->>'pagoId' AND i.documento_id = c.doc_id
          AND i.rol = 'VENDEDOR' AND i.tipo = 'ORIGINAL' AND i.monto = c.monto),
      (SELECT f.pagado FROM v_comisiones_filas f WHERE f.clave = c.clave AND f.organization_id = c.org)::text,
      (SELECT v.comision_pagada FROM ventas v WHERE v.id = c.doc_id AND v.organization_id = c.org)::text,
      (SELECT v.fecha_pago_comision = p.fecha_pago FROM ventas v, comisiones_pagos p WHERE v.id = c.doc_id AND v.organization_id = c.org AND p.id = v_res->>'pagoId')::text)
    INTO v_got;
  INSERT INTO _r VALUES (15, 'pago de una venta: item = fila, pagado, flag, fecha', 'item=1 / pagado=true / flag=true / fecha=true', v_got);
END $$;

-- 16. No probe lost its row or inserted two.
INSERT INTO _r SELECT 16, 'filas de los probes 1 a 15: total / distintas', '15 / 15',
  COUNT(*)::TEXT || ' / ' || COUNT(DISTINCT orden)::TEXT FROM _r WHERE orden BETWEEN 1 AND 15;

SELECT orden, probe, esperado, obtenido,
       CASE WHEN esperado = obtenido OR obtenido LIKE 'OK:%' THEN 'OK'
            WHEN obtenido LIKE 'SALTEADO:%' THEN 'SALTEADO' ELSE 'FALLA' END AS resultado
  FROM _r ORDER BY orden;

ROLLBACK;
