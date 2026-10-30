-- Verification of comisiones_definicion (migration 377): v_comisiones_filas / v_comisiones_devengadas.
--
-- Run AFTER 376 and 377 are applied, in the SQL editor of Supabase Studio or with
--   node scripts/db-run.mjs supabase/migrations/verify/377_probes.sql
-- (no --apply: the file opens its own transaction and always ends in ROLLBACK).
--
-- Without RLS, as in verify/README.md. It uses REAL rows of the base (it creates no
-- organization): one COMPLETADA sale with a seller, total > 0, exactly one effective return, no
-- live invoice / remito (the ventas_proteger_anulacion trigger) and no payout items, for the
-- adjustment chain. Everything it writes (payouts, items, the sale annulment) is rolled back. A
-- probe that finds no fitting row skips itself and says so in `obtenido` (SALTEADO: ...).
--
-- What it proves, against the real schema:
--   * both views are security_invoker and only service_role can read them;
--   * unpaid parity: for unpaid documents the definition reproduces today's screens, ORDEN
--     (v_comisiones_ordenes with the route filters) and VENTA (v_comisiones_ventas), in both
--     directions: 0 differences each;
--   * the adjustment branches, with the payouts inserted directly (the pay RPC is not needed):
--       - a paid ORIGINAL (P1, backdated one day before the sale's return) plus the later return
--         gives a live AJUSTE_DEVOLUCION of the expected amount, keyed by the return's id;
--       - paying it (P2) removes its live twin;
--       - annulling the sale gives an AJUSTE_ANULACION of -(P1 + P2) that is devengada, with a
--         date, and the document nets to 0.
--
-- Results accumulate in _r and come out in ONE select. Green = esperado equals obtenido, or
-- obtenido starts with 'OK:'.

BEGIN;

CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);

-- Return fixture (as in verify/379_probes.sql, without the accrual view: payouts are inserted by hand).
CREATE TEMP TABLE _cw (
  org TEXT, doc_id TEXT, benef TEXT, base NUMERIC, dev_id TEXT, dev_at TIMESTAMPTZ, aj_esperado NUMERIC
);

INSERT INTO _cw (org, doc_id, benef, base, dev_id, dev_at, aj_esperado)
SELECT v.organization_id, v.id, v.vendedor_id, COALESCE(v.iva_neto, v.total), d.id, d.created_at,
       -ROUND(COALESCE(v.iva_neto, v.total) * d.monto_devolucion / v.total * 5 / 100, 2)
  FROM ventas v
  JOIN devoluciones_venta d ON d.venta_id = v.id
 WHERE v.estado = 'COMPLETADA' AND v.vendedor_id IS NOT NULL AND v.total > 0
   AND d.estado = 'COMPLETADA' AND NOT d.anulada
   AND (SELECT COUNT(*) FROM devoluciones_venta d2 WHERE d2.venta_id = v.id) = 1
   AND ROUND(COALESCE(v.iva_neto, v.total) * d.monto_devolucion / v.total * 5 / 100, 2) > 0
   AND NOT EXISTS (SELECT 1 FROM comprobantes_fiscales cf WHERE cf.venta_id = v.id AND cf.estado IN ('pendiente', 'emitido'))
   AND NOT EXISTS (SELECT 1 FROM facturas fa WHERE fa.venta_id = v.id AND fa.estado_pago::text <> 'ANULADA')
   AND NOT EXISTS (SELECT 1 FROM comisiones_pagos_items i WHERE i.organization_id = v.organization_id AND i.documento_tipo = 'VENTA' AND i.documento_id = v.id)
 ORDER BY EXISTS (SELECT 1 FROM items_venta iv WHERE iv.venta_id = v.id AND iv.inventario_id IS NOT NULL), d.created_at DESC
 LIMIT 1;

-- ── 1. Shape and privileges (always runs) ──────────────────────────────────
INSERT INTO _r SELECT 1, 'vistas: invoker / anon / authenticated / service_role / cuantas',
  'true / false / false / true / 2',
  COALESCE(bool_and(COALESCE(c.reloptions @> ARRAY['security_invoker=true'], false))::TEXT, '-') || ' / ' ||
  COALESCE(bool_or(has_table_privilege('anon', c.oid, 'SELECT'))::TEXT, '-') || ' / ' ||
  COALESCE(bool_or(has_table_privilege('authenticated', c.oid, 'SELECT'))::TEXT, '-') || ' / ' ||
  COALESCE(bool_and(has_table_privilege('service_role', c.oid, 'SELECT'))::TEXT, '-') || ' / ' ||
  COUNT(*)::TEXT
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname IN ('v_comisiones_filas', 'v_comisiones_devengadas');

-- ── 2-3. Unpaid parity with today's screens (both directions, FULL JOIN) ───
INSERT INTO _r
WITH hoy AS (
  SELECT c.orden_id AS documento_id, c.monto_comision AS monto
    FROM v_comisiones_ordenes c
    JOIN organizations org ON org.id = c.organization_id
   WHERE NOT c.comision_pagada AND c.estado_cobro = 'COBRADO'
     AND (c.estado IN ('REPARADO', 'ENTREGADO')
          OR (c.estado = 'ENTREGADO_SIN_REPARACION' AND org.comision_aplica_sin_reparacion))
), nuevo AS (
  SELECT d.documento_id, SUM(d.monto) AS monto
    FROM v_comisiones_devengadas d
    JOIN ordenes_servicio o ON o.id = d.documento_id AND NOT o.comision_pagada
   WHERE d.documento_tipo = 'ORDEN' AND d.rol = 'TECNICO'
   GROUP BY d.documento_id
)
SELECT 2, 'paridad ORDEN sin pagar: diferencias contra v_comisiones_ordenes', '0', COUNT(*)::TEXT
  FROM hoy h FULL JOIN nuevo n ON n.documento_id = h.documento_id
 WHERE COALESCE(h.monto, 0) <> COALESCE(n.monto, 0);

INSERT INTO _r
WITH hoy AS (
  SELECT c.venta_id AS documento_id, c.monto_comision AS monto
    FROM v_comisiones_ventas c
   WHERE NOT c.comision_pagada AND c.vendedor_id IS NOT NULL
), nuevo AS (
  SELECT d.documento_id, SUM(d.monto) AS monto
    FROM v_comisiones_devengadas d
    JOIN ventas v ON v.id = d.documento_id AND NOT v.comision_pagada
   WHERE d.documento_tipo = 'VENTA' AND d.rol = 'VENDEDOR'
   GROUP BY d.documento_id
)
SELECT 3, 'paridad VENTA sin pagar: diferencias contra v_comisiones_ventas', '0', COUNT(*)::TEXT
  FROM hoy h FULL JOIN nuevo n ON n.documento_id = h.documento_id
 WHERE COALESCE(h.monto, 0) <> COALESCE(n.monto, 0);

-- ── 4-7. The adjustment branches ───────────────────────────────────────────
-- 4: P1 = ORIGINAL 100 paid directly, backdated before the return: live AJUSTE_DEVOLUCION.
-- 5: P2 = that adjustment paid directly: its live twin is gone.
-- 6: the sale is annulled: AJUSTE_ANULACION of -(P1 + P2).
-- 7: the document nets to 0 and carries one AJUSTE_DEVOLUCION row.
DO $$
DECLARE
  c RECORD; v_stage INT := 4; v_p1 TEXT; v_p2 TEXT; v_msg TEXT; v_got TEXT;
  -- Buffered: the handler rolls this block back, and the lines of the steps that did run must survive it.
  v_rows JSONB := '[]'::jsonb;
BEGIN
  SELECT * INTO c FROM _cw;
  IF NOT FOUND THEN
    INSERT INTO _r VALUES (4, 'ORIGINAL pagado + devolucion posterior: AJUSTE_DEVOLUCION vivo', 'OK', 'SALTEADO: la base no tiene una venta con una sola devolucion, sin comprobantes ni pagos');
    INSERT INTO _r VALUES (5, 'AJUSTE_DEVOLUCION pagado: su gemelo vivo desaparece', 'OK', 'SALTEADO: sin venta que sirva');
    INSERT INTO _r VALUES (6, 'venta anulada: AJUSTE_ANULACION de -(P1+P2)', 'OK', 'SALTEADO: sin venta que sirva');
    INSERT INTO _r VALUES (7, 'la venta neta a 0 con un solo AJUSTE_DEVOLUCION', 'OK', 'SALTEADO: sin venta que sirva');
    RETURN;
  END IF;

  INSERT INTO comisiones_pagos (organization_id, beneficiario_id, fecha_pago, total, origen)
  VALUES (c.org, c.benef, c.dev_at - interval '1 day', 100, 'APP')
  RETURNING id INTO v_p1;
  INSERT INTO comisiones_pagos_items (pago_id, organization_id, documento_tipo, documento_id, rol, tipo, base, porcentaje, monto)
  VALUES (v_p1, c.org, 'VENTA', c.doc_id, 'VENDEDOR', 'ORIGINAL', c.base, 5, 100);

  SELECT format('original=%s / ajuste=%s / ref=%s / devengada=%s',
      (SELECT (f.pagado AND f.pago_id = v_p1 AND f.monto = 100) FROM v_comisiones_filas f
        WHERE f.organization_id = c.org AND f.documento_id = c.doc_id AND f.tipo = 'ORIGINAL')::text,
      (SELECT (f.monto = c.aj_esperado AND NOT f.pagado) FROM v_comisiones_filas f
        WHERE f.organization_id = c.org AND f.documento_id = c.doc_id AND f.tipo = 'AJUSTE_DEVOLUCION')::text,
      (SELECT (f.ajuste_ref = c.dev_id) FROM v_comisiones_filas f
        WHERE f.organization_id = c.org AND f.documento_id = c.doc_id AND f.tipo = 'AJUSTE_DEVOLUCION')::text,
      (SELECT (f.devengada AND f.fecha_devengo = c.dev_at) FROM v_comisiones_filas f
        WHERE f.organization_id = c.org AND f.documento_id = c.doc_id AND f.tipo = 'AJUSTE_DEVOLUCION')::text)
    INTO v_got;
  v_rows := v_rows || jsonb_build_array(jsonb_build_array(4, 'ORIGINAL pagado + devolucion posterior: AJUSTE_DEVOLUCION vivo',
    'original=true / ajuste=true / ref=true / devengada=true', v_got));

  v_stage := 5;
  INSERT INTO comisiones_pagos (organization_id, beneficiario_id, fecha_pago, total, origen)
  VALUES (c.org, c.benef, now(), c.aj_esperado, 'APP')
  RETURNING id INTO v_p2;
  INSERT INTO comisiones_pagos_items (pago_id, organization_id, documento_tipo, documento_id, rol, tipo, ajuste_ref, base, porcentaje, monto)
  SELECT v_p2, f.organization_id, f.documento_tipo, f.documento_id, f.rol, f.tipo, f.ajuste_ref, f.base, f.porcentaje, f.monto
    FROM v_comisiones_filas f
   WHERE f.organization_id = c.org AND f.documento_id = c.doc_id AND f.tipo = 'AJUSTE_DEVOLUCION' AND NOT f.pagado;
  SELECT format('pagado=%s / vivos=%s / pago=%s',
      (SELECT f.pagado FROM v_comisiones_filas f WHERE f.organization_id = c.org AND f.documento_id = c.doc_id AND f.tipo = 'AJUSTE_DEVOLUCION')::text,
      (SELECT COUNT(*) FROM v_comisiones_filas f WHERE f.organization_id = c.org AND f.documento_id = c.doc_id AND f.tipo = 'AJUSTE_DEVOLUCION' AND NOT f.pagado),
      (SELECT (f.pago_id = v_p2) FROM v_comisiones_filas f WHERE f.organization_id = c.org AND f.documento_id = c.doc_id AND f.tipo = 'AJUSTE_DEVOLUCION')::text)
    INTO v_got;
  v_rows := v_rows || jsonb_build_array(jsonb_build_array(5, 'AJUSTE_DEVOLUCION pagado: su gemelo vivo desaparece',
    'pagado=true / vivos=0 / pago=true', v_got));

  v_stage := 6;
  UPDATE ventas SET estado = 'ANULADA' WHERE id = c.doc_id AND organization_id = c.org;
  SELECT format('fila=%s / monto=%s / fecha=%s / devengada=%s / pagado=%s',
      (SELECT COUNT(*) FROM v_comisiones_filas f WHERE f.organization_id = c.org AND f.documento_id = c.doc_id AND f.tipo = 'AJUSTE_ANULACION'),
      (SELECT (f.monto = -(100 + c.aj_esperado)) FROM v_comisiones_filas f WHERE f.organization_id = c.org AND f.documento_id = c.doc_id AND f.tipo = 'AJUSTE_ANULACION')::text,
      (SELECT (f.fecha_devengo IS NOT NULL) FROM v_comisiones_filas f WHERE f.organization_id = c.org AND f.documento_id = c.doc_id AND f.tipo = 'AJUSTE_ANULACION')::text,
      (SELECT f.devengada FROM v_comisiones_filas f WHERE f.organization_id = c.org AND f.documento_id = c.doc_id AND f.tipo = 'AJUSTE_ANULACION')::text,
      (SELECT f.pagado FROM v_comisiones_filas f WHERE f.organization_id = c.org AND f.documento_id = c.doc_id AND f.tipo = 'AJUSTE_ANULACION')::text)
    INTO v_got;
  v_rows := v_rows || jsonb_build_array(jsonb_build_array(6, 'venta anulada: AJUSTE_ANULACION de -(P1+P2)',
    'fila=1 / monto=true / fecha=true / devengada=true / pagado=false', v_got));

  v_stage := 7;
  SELECT format('neto=%s / ajustes devolucion=%s',
      (SELECT (SUM(f.monto) = 0) FROM v_comisiones_filas f WHERE f.organization_id = c.org AND f.documento_id = c.doc_id)::text,
      (SELECT COUNT(*) FROM v_comisiones_filas f WHERE f.organization_id = c.org AND f.documento_id = c.doc_id AND f.tipo = 'AJUSTE_DEVOLUCION'))
    INTO v_got;
  v_rows := v_rows || jsonb_build_array(jsonb_build_array(7, 'la venta neta a 0 con un solo AJUSTE_DEVOLUCION',
    'neto=true / ajustes devolucion=1', v_got));

  INSERT INTO _r SELECT (r->>0)::int, r->>1, r->>2, r->>3 FROM jsonb_array_elements(v_rows) AS t(r);
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  INSERT INTO _r SELECT (r->>0)::int, r->>1, r->>2, r->>3 FROM jsonb_array_elements(v_rows) AS t(r);
  INSERT INTO _r VALUES (v_stage, 'cadena de ajustes: paso ' || v_stage, 'OK', 'FALLO: ' || SQLSTATE || ' ' || v_msg);
  INSERT INTO _r SELECT g, 'cadena de ajustes: paso ' || g, 'OK', 'SALTEADO: la cadena se interrumpio en el paso ' || v_stage
    FROM generate_series(v_stage + 1, 7) AS g;
END $$;

-- 8. No probe lost its row or inserted two.
INSERT INTO _r SELECT 8, 'filas de los probes 1 a 7: total / distintas', '7 / 7',
  COUNT(*)::TEXT || ' / ' || COUNT(DISTINCT orden)::TEXT FROM _r WHERE orden BETWEEN 1 AND 7;

SELECT orden, probe, esperado, obtenido,
       CASE WHEN esperado = obtenido OR obtenido LIKE 'OK:%' THEN 'OK'
            WHEN obtenido LIKE 'SALTEADO:%' THEN 'SALTEADO' ELSE 'FALLA' END AS resultado
  FROM _r ORDER BY orden;

ROLLBACK;
