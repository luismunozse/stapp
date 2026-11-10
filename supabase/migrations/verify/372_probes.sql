-- Verification of editar_venta_factura_anulada (migration 372): editing a venta whose factura was annulled.
--
-- Run AFTER 371 and 372 are applied:  node scripts/db-run.mjs supabase/migrations/verify/372_probes.sql
-- (no --apply: the file opens its own transaction and always ends in ROLLBACK; db-run.mjs sees the
-- BEGIN and refuses --apply). Against a database without 371 it stops at the first fixture row that
-- uses a 371 column; against one without 372 the annulled-factura probes fail, which is the point.
--
-- Without RLS, as in verify/README.md. The only data it creates is one scratch organization
-- (org-probe-372) with twelve ventas and a handful of facturas and credit notes, all rolled back.
-- The CUIT is made up (20000000001).
--
-- What it proves, against the real schema:
--   * editar_venta_atomica still has ONE signature of 15 parameters, is not SECURITY DEFINER, has no
--     function-level settings and stays executable by service_role (372 does not touch grants);
--   * a venta whose factura is annulled and whose credit note is emitida CAN be edited (and the edit
--     really lands: observaciones is read back); so can a venta with only rechazado attempts, an
--     annulled factura with a rechazada NC, or no comprobante at all;
--   * a venta with an emitida or pendiente factura, a legacy tusfacturas factura, or an annulled
--     factura that was re-invoiced (emitida or pendiente) is still refused with P0021 and the SAME
--     text as lib/ventas/bloqueos.ts; an emitida factura with a pendiente NC is refused too;
--   * the other blockers keep working (comision liquidada: P0021; annulled venta).
--
-- Results accumulate in _r and come out in ONE select. Green = esperado equals obtenido.
-- For the editar probes obtenido is 'ok' or the SQLSTATE plus message, then ' / ' and the
-- observaciones of the venta afterwards ('-' when still NULL), so an "ok" proves the edit landed and
-- a refusal proves nothing changed.

BEGIN;

CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);

-- Edits a venta with no items and the same total, and records the outcome PLUS the observaciones
-- afterwards.
CREATE PROCEDURE pg_temp.probe_editar(p_orden INT, p_probe TEXT, p_esperado TEXT, p_venta TEXT)
LANGUAGE plpgsql AS $$
DECLARE v_got TEXT := 'ok'; v_msg TEXT;
BEGIN
  BEGIN
    PERFORM editar_venta_atomica('org-probe-372', 'usr-probe-372', p_venta, NULL, 'Probe 372', NULL,
                                 1000, 0, 'MONTO', 0, 1000, 'EFECTIVO', 'editada-372', '[]'::JSONB, NULL);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    v_got := SQLSTATE || ' ' || v_msg;
  END;
  INSERT INTO _r VALUES (p_orden, p_probe, p_esperado,
    v_got || ' / ' || COALESCE((SELECT COALESCE(observaciones, '-') FROM ventas WHERE id = p_venta), 'sin venta'));
END $$;

-- A factura B of org-probe-372. CAE only when it was authorized.
CREATE FUNCTION pg_temp.fac(
  p_id TEXT, p_venta TEXT, p_estado TEXT DEFAULT 'emitido', p_pv INTEGER DEFAULT 3,
  p_numero TEXT DEFAULT NULL, p_anulado TIMESTAMPTZ DEFAULT NULL,
  p_provider TEXT DEFAULT 'arca', p_cbte_tipo INTEGER DEFAULT 6, p_cuit TEXT DEFAULT '20000000001'
) RETURNS VOID LANGUAGE sql AS $$
  INSERT INTO comprobantes_fiscales (id, organization_id, venta_id, tipo, punto_venta, numero, cae, cae_vencimiento,
                                     estado, total, provider, cbte_tipo, cuit_emisor, anulado_at)
  VALUES (p_id, 'org-probe-372', p_venta, 'B', p_pv, p_numero,
          CASE WHEN p_estado IN ('emitido', 'anulado') THEN 'CAE-' || p_id END,
          CASE WHEN p_estado IN ('emitido', 'anulado') THEN '20261030' END,
          p_estado, 1000, p_provider, p_cbte_tipo, p_cuit, p_anulado)
$$;

-- A credit note B for a factura of org-probe-372 (same point of sale as the factura).
CREATE FUNCTION pg_temp.nc(
  p_id TEXT, p_factura TEXT, p_venta TEXT, p_estado TEXT, p_pv INTEGER, p_nro INTEGER
) RETURNS VOID LANGUAGE sql AS $$
  INSERT INTO comprobantes_fiscales (id, organization_id, venta_id, tipo, punto_venta, numero, cae, cae_vencimiento,
                                     estado, total, provider, cbte_tipo, cuit_emisor, comprobante_asociado_id,
                                     cbte_nro_solicitado, motivo)
  VALUES (p_id, 'org-probe-372', p_venta, 'B', p_pv,
          CASE WHEN p_estado = 'emitido' THEN lpad(p_pv::TEXT, 4, '0') || '-' || lpad(p_nro::TEXT, 8, '0') END,
          CASE WHEN p_estado = 'emitido' THEN 'CAE-' || p_id END,
          CASE WHEN p_estado = 'emitido' THEN '20261030' END,
          p_estado, 1000, 'arca', 8, '20000000001', p_factura, p_nro, 'error_factura')
$$;

-- ── Fixture ────────────────────────────────────────────────────────────────
INSERT INTO organizations (id, nombre, nombre_mostrar, slug)
VALUES ('org-probe-372', 'Probe 372', 'Probe 372', 'probe-372-' || substr(md5(random()::text), 1, 8));

INSERT INTO users (id, organization_id, sucursal_id, email, nombre, password, rol)
VALUES ('usr-probe-372', 'org-probe-372',
        (SELECT id FROM sucursales WHERE organization_id = 'org-probe-372' AND principal),
        'admin@probe-372.invalid', 'Probe 372', 'x', 'ADMIN');

INSERT INTO ventas (id, numero_venta, cliente_nombre, vendedor_id, subtotal, total,
                    metodo_pago, estado, organization_id, sucursal_id, monto_abonado, estado_pago)
SELECT 'vta-probe-372-' || v.n, v.n, 'Probe 372', 'usr-probe-372', 1000, 1000,
       'EFECTIVO'::metodo_pago_venta, 'COMPLETADA'::estado_venta, 'org-probe-372',
       (SELECT id FROM sucursales WHERE organization_id = 'org-probe-372' AND principal), 1000, 'PAGADO'
FROM generate_series(1, 12) AS v(n);

-- One venta per scenario (a venta holds at most one active factura), each on its own point of sale.
--   1  factura emitida                              2  factura pendiente
--   3  factura anulada + NC emitida                 4  factura rechazada sola
--   5  factura anulada + NC rechazada               6  sin comprobantes
--   7  factura emitida + NC pendiente               8  factura legada (tusfacturas, sin cbte_tipo)
--   9  anulada + NC emitida + factura nueva emitida
--  10  anulada + NC emitida + factura nueva pendiente
--  11  anulada + NC emitida, comision ya liquidada  12  anulada + NC emitida, la venta esta ANULADA
DO $$
BEGIN
  PERFORM pg_temp.fac('fac-p372-1', 'vta-probe-372-1', 'emitido', 1, '0001-00000001');
  PERFORM pg_temp.fac('fac-p372-2', 'vta-probe-372-2', 'pendiente', 2);
  PERFORM pg_temp.fac('fac-p372-3', 'vta-probe-372-3', 'anulado', 3, '0003-00000001', now());
  PERFORM pg_temp.nc('nc-p372-3', 'fac-p372-3', 'vta-probe-372-3', 'emitido', 3, 2);
  PERFORM pg_temp.fac('fac-p372-4', 'vta-probe-372-4', 'rechazado', 4);
  PERFORM pg_temp.fac('fac-p372-5', 'vta-probe-372-5', 'anulado', 5, '0005-00000001', now());
  PERFORM pg_temp.nc('nc-p372-5', 'fac-p372-5', 'vta-probe-372-5', 'rechazado', 5, 2);
  PERFORM pg_temp.fac('fac-p372-7', 'vta-probe-372-7', 'emitido', 7, '0007-00000001');
  PERFORM pg_temp.nc('nc-p372-7', 'fac-p372-7', 'vta-probe-372-7', 'pendiente', 7, 2);
  PERFORM pg_temp.fac('fac-p372-8', 'vta-probe-372-8', 'emitido', 8, '0008-00000001',
                      p_provider => 'tusfacturas', p_cbte_tipo => NULL, p_cuit => NULL);
  PERFORM pg_temp.fac('fac-p372-9a', 'vta-probe-372-9', 'anulado', 9, '0009-00000001', now());
  PERFORM pg_temp.nc('nc-p372-9', 'fac-p372-9a', 'vta-probe-372-9', 'emitido', 9, 2);
  PERFORM pg_temp.fac('fac-p372-9b', 'vta-probe-372-9', 'emitido', 9, '0009-00000003');
  PERFORM pg_temp.fac('fac-p372-10a', 'vta-probe-372-10', 'anulado', 10, '0010-00000001', now());
  PERFORM pg_temp.nc('nc-p372-10', 'fac-p372-10a', 'vta-probe-372-10', 'emitido', 10, 2);
  PERFORM pg_temp.fac('fac-p372-10b', 'vta-probe-372-10', 'pendiente', 10);
  PERFORM pg_temp.fac('fac-p372-11', 'vta-probe-372-11', 'anulado', 11, '0011-00000001', now());
  PERFORM pg_temp.nc('nc-p372-11', 'fac-p372-11', 'vta-probe-372-11', 'emitido', 11, 2);
  PERFORM pg_temp.fac('fac-p372-12', 'vta-probe-372-12', 'anulado', 12, '0012-00000001', now());
  PERFORM pg_temp.nc('nc-p372-12', 'fac-p372-12', 'vta-probe-372-12', 'emitido', 12, 2);
END $$;

UPDATE ventas SET comision_pagada = true WHERE id = 'vta-probe-372-11';
UPDATE ventas SET estado = 'ANULADA'::estado_venta WHERE id = 'vta-probe-372-12';

-- ── Shape ──────────────────────────────────────────────────────────────────
INSERT INTO _r SELECT 1, 'editar_venta_atomica: una sola firma de 15 / prosecdef / sin settings / EXECUTE service_role',
  '1 / 15 / false / true / true',
  COUNT(*)::TEXT || ' / ' || COALESCE(MAX(p.pronargs)::TEXT, '-') || ' / ' ||
  COALESCE(bool_or(p.prosecdef)::TEXT, '-') || ' / ' ||
  COALESCE(bool_and(p.proconfig IS NULL)::TEXT, '-') || ' / ' ||
  COALESCE(bool_and(has_function_privilege('service_role', p.oid, 'EXECUTE'))::TEXT, '-')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'editar_venta_atomica';

-- ── Editable ───────────────────────────────────────────────────────────────
CALL pg_temp.probe_editar(2, 'editar una venta con factura anulada y NC emitida', 'ok / editada-372',
  'vta-probe-372-3');

CALL pg_temp.probe_editar(3, 'editar una venta con una sola factura rechazada', 'ok / editada-372',
  'vta-probe-372-4');

CALL pg_temp.probe_editar(4, 'editar una venta con factura anulada y su NC rechazada', 'ok / editada-372',
  'vta-probe-372-5');

CALL pg_temp.probe_editar(5, 'editar una venta sin comprobantes', 'ok / editada-372',
  'vta-probe-372-6');

-- ── Still refused: a vigente FACTURA ───────────────────────────────────────
CALL pg_temp.probe_editar(6, 'editar una venta con factura emitida',
  'P0021 VENTA_NO_EDITABLE: La venta tiene una factura electrónica emitida. / -',
  'vta-probe-372-1');

CALL pg_temp.probe_editar(7, 'editar una venta con factura pendiente',
  'P0021 VENTA_NO_EDITABLE: La venta tiene una factura electrónica emitida. / -',
  'vta-probe-372-2');

CALL pg_temp.probe_editar(8, 'editar una venta con factura emitida y una NC pendiente',
  'P0021 VENTA_NO_EDITABLE: La venta tiene una factura electrónica emitida. / -',
  'vta-probe-372-7');

CALL pg_temp.probe_editar(9, 'editar una venta con una factura legada (tusfacturas, sin cbte_tipo) emitida',
  'P0021 VENTA_NO_EDITABLE: La venta tiene una factura electrónica emitida. / -',
  'vta-probe-372-8');

CALL pg_temp.probe_editar(10, 'editar una venta con la factura anulada, su NC emitida y una factura nueva emitida',
  'P0021 VENTA_NO_EDITABLE: La venta tiene una factura electrónica emitida. / -',
  'vta-probe-372-9');

CALL pg_temp.probe_editar(11, 'editar una venta con la factura anulada, su NC emitida y una factura nueva pendiente',
  'P0021 VENTA_NO_EDITABLE: La venta tiene una factura electrónica emitida. / -',
  'vta-probe-372-10');

-- ── The rest of the blockers is untouched ──────────────────────────────────
CALL pg_temp.probe_editar(12, 'editar una venta con factura anulada y NC emitida pero comision ya liquidada',
  'P0021 VENTA_NO_EDITABLE: La comisión de esta venta ya se liquidó al vendedor. / -',
  'vta-probe-372-11');

CALL pg_temp.probe_editar(13, 'editar una venta ANULADA con factura anulada y NC emitida',
  'P0001 No se puede editar una venta anulada / -',
  'vta-probe-372-12');

-- 14. Ningun probe se quedo sin fila ni inserto dos.
INSERT INTO _r SELECT 14, 'filas de los probes 1 a 13: total / distintas', '13 / 13',
  COUNT(*)::TEXT || ' / ' || COUNT(DISTINCT orden)::TEXT FROM _r WHERE orden BETWEEN 1 AND 13;

SELECT orden, probe, esperado, obtenido,
       CASE WHEN esperado = obtenido THEN 'OK' ELSE 'FALLA' END AS resultado
  FROM _r ORDER BY orden;

ROLLBACK;
