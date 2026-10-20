-- Verification of anular_factura_arca (migration 371): annul an ARCA factura with a fiscal credit note.
--
-- Run AFTER 371 is applied:  node scripts/db-run.mjs supabase/migrations/verify/371_probes.sql
-- (no --apply: the file opens its own transaction and always ends in ROLLBACK; db-run.mjs sees the
-- BEGIN and refuses --apply). Against a database without 371 it stops at the first helper that
-- uses a new column.
--
-- Without RLS, as in verify/README.md. The only data it creates is two scratch organizations
-- (org-probe-371 and org-probe-371-x, the foreign one) with a handful of ventas, facturas and
-- credit notes, all rolled back. The CUITs are made up (20000000001 / 20000000002).
--
-- What it proves, against the real schema:
--   * the five columns, the estado CHECK rebuilt with 'anulado', the NC and annulment CHECKs
--     (an NC needs an 11-digit cuit_emisor);
--   * the unique indexes, each by NAME: one active factura per venta, one active NC per factura,
--     one in-flight NC per CUIT / point of sale / type (ARCA numbers by CUIT, not by organization),
--     one emitted NC per CUIT / PV / type / number;
--   * the anulacion trigger ignores NC rows (P0022 for an emitted factura, allowed once the factura
--     is annulled, a legacy tusfacturas factura still blocks) and keeps the remito rule; every
--     trigger probe also reads ventas.estado afterwards;
--   * confirmar_nota_credito_fiscal: flips NC and factura together, replays, accepts a late
--     confirmation of a rechazada NC, and refuses everything else (other CAE, other org, a link to
--     another org's factura, wrong state, wrong letter, wrong venta, wrong number or PV);
--   * a new factura can be issued after the annulment, and deleting the organization works with
--     factura + NC (the self reference is NO ACTION).
--
-- Results accumulate in _r and come out in ONE select. Green = esperado equals obtenido.
-- For the probes that expect an error, obtenido is the SQLSTATE plus the constraint name (or the
-- message when no constraint raised it).
-- Literals that go into enum columns carry their cast.

BEGIN;

CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);
CREATE TEMP TABLE _res (clave TEXT PRIMARY KEY, res JSONB);

-- Runs one statement and records 'ok' or the SQLSTATE plus constraint name / message it raised.
-- A procedure, so CALL prints no row per probe.
CREATE PROCEDURE pg_temp.probe(p_orden INT, p_probe TEXT, p_esperado TEXT, p_sql TEXT)
LANGUAGE plpgsql AS $$
DECLARE v_got TEXT := 'ok'; v_cn TEXT; v_msg TEXT;
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_cn = CONSTRAINT_NAME, v_msg = MESSAGE_TEXT;
    v_got := SQLSTATE || ' ' || COALESCE(NULLIF(v_cn, ''), v_msg);
  END;
  INSERT INTO _r VALUES (p_orden, p_probe, p_esperado, v_got);
END $$;

-- Annuls a venta (COMPLETADA -> ANULADA) and records the outcome PLUS the venta's estado afterwards,
-- so an "ok" proves the venta really changed and a refusal proves it did not.
CREATE PROCEDURE pg_temp.probe_anular(p_orden INT, p_probe TEXT, p_esperado TEXT, p_venta TEXT)
LANGUAGE plpgsql AS $$
DECLARE v_got TEXT := 'ok'; v_cn TEXT; v_msg TEXT;
BEGIN
  BEGIN
    UPDATE ventas SET estado = 'ANULADA'::estado_venta WHERE id = p_venta;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_cn = CONSTRAINT_NAME, v_msg = MESSAGE_TEXT;
    v_got := SQLSTATE || ' ' || COALESCE(NULLIF(v_cn, ''), v_msg);
  END;
  INSERT INTO _r VALUES (p_orden, p_probe, p_esperado,
    v_got || ' / ' || COALESCE((SELECT estado::TEXT FROM ventas WHERE id = p_venta), 'sin venta'));
END $$;

-- A factura B of org-probe-371 (override with p_org / p_cuit / p_provider / p_cbte_tipo). CAE only
-- when it was authorized.
CREATE FUNCTION pg_temp.fac(
  p_id TEXT, p_venta TEXT, p_estado TEXT DEFAULT 'emitido', p_pv INTEGER DEFAULT 3,
  p_numero TEXT DEFAULT NULL, p_anulado TIMESTAMPTZ DEFAULT NULL,
  p_org TEXT DEFAULT 'org-probe-371', p_cuit TEXT DEFAULT '20000000001',
  p_provider TEXT DEFAULT 'arca', p_cbte_tipo INTEGER DEFAULT 6
) RETURNS VOID LANGUAGE sql AS $$
  INSERT INTO comprobantes_fiscales (id, organization_id, venta_id, tipo, punto_venta, numero, cae, cae_vencimiento,
                                     estado, total, provider, cbte_tipo, cuit_emisor, anulado_at)
  VALUES (p_id, p_org, p_venta, 'B', p_pv, p_numero,
          CASE WHEN p_estado IN ('emitido', 'anulado') THEN 'CAE-' || p_id END,
          CASE WHEN p_estado IN ('emitido', 'anulado') THEN '20261030' END,
          p_estado, 1210, p_provider, p_cbte_tipo, p_cuit, p_anulado)
$$;

-- A credit note, by default a valid NC B in flight (pendiente, number 5, PV 3, CUIT 20000000001)
-- of org-probe-371.
CREATE FUNCTION pg_temp.nc(
  p_id TEXT, p_factura TEXT, p_venta TEXT, p_estado TEXT DEFAULT 'pendiente',
  p_pv INTEGER DEFAULT 3, p_nro INTEGER DEFAULT 5, p_motivo TEXT DEFAULT 'error_factura',
  p_detalle TEXT DEFAULT NULL, p_tipo TEXT DEFAULT 'B', p_cbte_tipo INTEGER DEFAULT 8,
  p_numero TEXT DEFAULT NULL, p_anulado TIMESTAMPTZ DEFAULT NULL,
  p_org TEXT DEFAULT 'org-probe-371', p_cuit TEXT DEFAULT '20000000001'
) RETURNS VOID LANGUAGE sql AS $$
  INSERT INTO comprobantes_fiscales (id, organization_id, venta_id, tipo, punto_venta, numero, cae, cae_vencimiento,
                                     estado, total, provider, cbte_tipo, cuit_emisor, comprobante_asociado_id,
                                     cbte_nro_solicitado, motivo, motivo_detalle, anulado_at)
  VALUES (p_id, p_org, p_venta, p_tipo, p_pv, p_numero,
          CASE WHEN p_estado = 'emitido' THEN 'CAE-' || p_id END,
          CASE WHEN p_estado = 'emitido' THEN '20261030' END,
          p_estado, 1210, 'arca', p_cbte_tipo, p_cuit, p_factura, p_nro, p_motivo, p_detalle, p_anulado)
$$;

-- ── Fixture ────────────────────────────────────────────────────────────────
INSERT INTO organizations (id, nombre, nombre_mostrar, slug)
VALUES ('org-probe-371', 'Probe 371', 'Probe 371', 'probe-371-' || substr(md5(random()::text), 1, 8)),
       ('org-probe-371-x', 'Probe 371 X', 'Probe 371 X', 'probe-371-x-' || substr(md5(random()::text), 1, 8));

INSERT INTO users (id, organization_id, sucursal_id, email, nombre, password, rol)
VALUES ('usr-probe-371', 'org-probe-371',
        (SELECT id FROM sucursales WHERE organization_id = 'org-probe-371' AND principal),
        'admin@probe-371.invalid', 'Probe 371', 'x', 'ADMIN'),
       ('usr-probe-371-x', 'org-probe-371-x',
        (SELECT id FROM sucursales WHERE organization_id = 'org-probe-371-x' AND principal),
        'admin@probe-371-x.invalid', 'Probe 371 X', 'x', 'ADMIN');

-- Fifteen ventas in the workshop, one per scenario (a venta holds at most one active factura), and
-- two in the foreign organization.
INSERT INTO ventas (id, numero_venta, cliente_nombre, vendedor_id, subtotal, total,
                    metodo_pago, estado, organization_id, sucursal_id, monto_abonado, estado_pago)
SELECT 'vta-probe-371-' || v.n, v.n, 'Probe 371', 'usr-probe-371', 1000, 1000,
       'EFECTIVO'::metodo_pago_venta, 'COMPLETADA'::estado_venta, 'org-probe-371',
       (SELECT id FROM sucursales WHERE organization_id = 'org-probe-371' AND principal), 1000, 'PAGADO'
FROM generate_series(1, 15) AS v(n);

INSERT INTO ventas (id, numero_venta, cliente_nombre, vendedor_id, subtotal, total,
                    metodo_pago, estado, organization_id, sucursal_id, monto_abonado, estado_pago)
SELECT 'vta-probe-371-x' || v.n, v.n, 'Probe 371 X', 'usr-probe-371-x', 1000, 1000,
       'EFECTIVO'::metodo_pago_venta, 'COMPLETADA'::estado_venta, 'org-probe-371-x',
       (SELECT id FROM sucursales WHERE organization_id = 'org-probe-371-x' AND principal), 1000, 'PAGADO'
FROM generate_series(1, 2) AS v(n);

-- Facturas and the credit notes that are NOT the subject of a probe. Each pending NC uses its own
-- point of sale, because only one NC per CUIT / PV / type can be in flight.
--   1  emitida; its NC (PV 3) is inserted by probe 10
--   2  emitida with an emitida NC (partial state, repaired by the replay; number 4-7)
--   3  emitida; a second in-flight NC on PV 3 must be refused
--   4  emitida; the happy RPC path (PV 5)           5  emitida; RPC refusals (PV 6)
--   6  B with an NC C (wrong letter, PV 7)          7  its NC belongs to another venta (PV 8)
--   9  rechazada with an NC in flight (PV 9)
--  10  annulled + a NEW emitida factura on the same venta
--  11  rechazada only                              12  annulled, then re-invoiced
--  13  emitida with a rechazada NC, then a newer active NC (probe 14)
--  14  emitida with a rechazada NC that ARCA actually authorized (late confirmation)
--  15  legacy tusfacturas factura (probe 38)
--  x1  another organization's factura, the target of a link from a workshop NC
--  x2  another organization's factura, to prove the in-flight key is the CUIT
DO $$
BEGIN
  PERFORM pg_temp.fac('fac-p371-1', 'vta-probe-371-1', 'emitido', 3, '0003-00000001');
  PERFORM pg_temp.fac('fac-p371-2', 'vta-probe-371-2', 'emitido', 4, '0004-00000001');
  PERFORM pg_temp.fac('fac-p371-3', 'vta-probe-371-3', 'emitido', 3, '0003-00000002');
  PERFORM pg_temp.fac('fac-p371-4', 'vta-probe-371-4', 'emitido', 5, '0005-00000001');
  PERFORM pg_temp.fac('fac-p371-5', 'vta-probe-371-5', 'emitido', 6, '0006-00000001');
  PERFORM pg_temp.fac('fac-p371-6', 'vta-probe-371-6', 'emitido', 7, '0007-00000001');
  PERFORM pg_temp.fac('fac-p371-7', 'vta-probe-371-7', 'emitido', 8, '0008-00000001');
  PERFORM pg_temp.fac('fac-p371-9', 'vta-probe-371-9', 'rechazado', 9);
  PERFORM pg_temp.fac('fac-p371-10a', 'vta-probe-371-10', 'anulado', 10, '0010-00000001', now());
  PERFORM pg_temp.fac('fac-p371-10b', 'vta-probe-371-10', 'emitido', 10, '0010-00000002');
  PERFORM pg_temp.fac('fac-p371-11', 'vta-probe-371-11', 'rechazado', 11);
  PERFORM pg_temp.fac('fac-p371-12a', 'vta-probe-371-12', 'anulado', 12, '0012-00000001', now());
  PERFORM pg_temp.fac('fac-p371-13', 'vta-probe-371-13', 'emitido', 13, '0013-00000001');
  PERFORM pg_temp.fac('fac-p371-14', 'vta-probe-371-14', 'emitido', 14, '0014-00000001');
  PERFORM pg_temp.fac('fac-p371-x1', 'vta-probe-371-x1', 'emitido', 15, '0015-00000001', p_org => 'org-probe-371-x');
  PERFORM pg_temp.fac('fac-p371-x2', 'vta-probe-371-x2', 'emitido', 3, '0003-00000001', p_org => 'org-probe-371-x');

  PERFORM pg_temp.nc('nc-p371-2', 'fac-p371-2', 'vta-probe-371-2', 'emitido', p_pv => 4, p_nro => 7, p_numero => '0004-00000007');
  PERFORM pg_temp.nc('nc-p371-6', 'fac-p371-6', 'vta-probe-371-6', p_pv => 7, p_nro => 3, p_tipo => 'C', p_cbte_tipo => 13);
  PERFORM pg_temp.nc('nc-p371-7', 'fac-p371-7', 'vta-probe-371-8', p_pv => 8, p_nro => 3);
  PERFORM pg_temp.nc('nc-p371-9', 'fac-p371-9', 'vta-probe-371-9', p_pv => 9, p_nro => 3);
  PERFORM pg_temp.nc('nc-p371-10a', 'fac-p371-10a', 'vta-probe-371-10', 'emitido', p_pv => 10, p_nro => 3, p_numero => '0010-00000003');
  PERFORM pg_temp.nc('nc-p371-12', 'fac-p371-12a', 'vta-probe-371-12', 'emitido', p_pv => 12, p_nro => 3, p_numero => '0012-00000003');
  PERFORM pg_temp.nc('nc-p371-13', 'fac-p371-13', 'vta-probe-371-13', 'rechazado', p_pv => 13, p_nro => 3);
  PERFORM pg_temp.nc('nc-p371-14', 'fac-p371-14', 'vta-probe-371-14', 'rechazado', p_pv => 14, p_nro => 3);
END $$;

-- ── Shape ──────────────────────────────────────────────────────────────────
INSERT INTO _r SELECT 1, 'confirmar_nota_credito_fiscal: una sola firma de 6 / EXECUTE anon / authenticated / service_role',
  '1 / 6 / false / false / true',
  COUNT(*)::TEXT || ' / ' || COALESCE(MAX(p.pronargs)::TEXT, '-') || ' / ' ||
  has_function_privilege('anon', 'public.confirmar_nota_credito_fiscal(text,text,text,text,text,jsonb)', 'EXECUTE')::TEXT || ' / ' ||
  has_function_privilege('authenticated', 'public.confirmar_nota_credito_fiscal(text,text,text,text,text,jsonb)', 'EXECUTE')::TEXT || ' / ' ||
  has_function_privilege('service_role', 'public.confirmar_nota_credito_fiscal(text,text,text,text,text,jsonb)', 'EXECUTE')::TEXT
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'confirmar_nota_credito_fiscal';

INSERT INTO _r SELECT 2, 'las 5 columnas nuevas existen, todas NULL y sin DEFAULT', '5 / true',
  COUNT(*)::TEXT || ' / ' || COALESCE(bool_and(is_nullable = 'YES' AND column_default IS NULL)::TEXT, '-')
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'comprobantes_fiscales'
    AND column_name IN ('comprobante_asociado_id', 'cbte_nro_solicitado', 'motivo', 'motivo_detalle', 'anulado_at');

INSERT INTO _r SELECT 3, 'el CHECK de estado: uno solo y admite anulado', '1 / true',
  COUNT(*)::TEXT || ' / ' || COALESCE(bool_and(pg_get_constraintdef(c.oid) LIKE '%anulado%')::TEXT, '-')
  FROM pg_constraint c
  WHERE c.conrelid = 'public.comprobantes_fiscales'::regclass AND c.contype = 'c'
    AND c.conkey = ARRAY[(SELECT a.attnum FROM pg_attribute a
                           WHERE a.attrelid = 'public.comprobantes_fiscales'::regclass AND a.attname = 'estado')];

INSERT INTO _r SELECT 4, 'los cinco indices existen',
  'idx_comprobantes_asociado, uq_comprobante_nc_activa, uq_comprobante_nc_en_vuelo, uq_comprobante_nc_numero, uq_comprobante_venta_activo',
  (SELECT string_agg(indexname, ', ' ORDER BY indexname) FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'comprobantes_fiscales'
      AND indexname IN ('idx_comprobantes_asociado', 'uq_comprobante_nc_activa', 'uq_comprobante_nc_en_vuelo',
                        'uq_comprobante_nc_numero', 'uq_comprobante_venta_activo'));

INSERT INTO _r SELECT 5, 'uq_comprobante_venta_activo: unico y solo para facturas (sin NC)', 'true / true',
  (SELECT (indexdef LIKE '%UNIQUE%')::TEXT || ' / ' || (indexdef LIKE '%comprobante_asociado_id IS NULL%')::TEXT
     FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'uq_comprobante_venta_activo');

INSERT INTO _r SELECT 6, 'las claves por CUIT: en vuelo (cuit, PV, tipo) sin organizacion / numero emitido (cuit, PV, tipo, numero)',
  'true / false / true',
  (SELECT (indexdef LIKE '%(cuit_emisor, punto_venta, cbte_tipo)%')::TEXT || ' / ' ||
          (indexdef LIKE '%organization_id%')::TEXT
     FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'uq_comprobante_nc_en_vuelo') || ' / ' ||
  (SELECT (indexdef LIKE '%(cuit_emisor, punto_venta, cbte_tipo, numero)%')::TEXT
     FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'uq_comprobante_nc_numero');

INSERT INTO _r SELECT 7, 'ventas_proteger_anulacion: un trigger / el cuerpo ignora NC / conserva la regla del remito',
  '1 / true / true',
  (SELECT COUNT(*)::TEXT FROM pg_trigger
    WHERE tgrelid = 'public.ventas'::regclass AND tgname = 'ventas_proteger_anulacion' AND NOT tgisinternal) || ' / ' ||
  (SELECT (prosrc LIKE '%comprobante_asociado_id IS NULL%')::TEXT FROM pg_proc WHERE proname = 'proteger_anulacion_venta') || ' / ' ||
  (SELECT (prosrc LIKE '%remito vigente%')::TEXT FROM pg_proc WHERE proname = 'proteger_anulacion_venta');

-- 8. The migration refuses to run when some other CHECK mentions estado (it would be left stale).
INSERT INTO _r SELECT 8, 'ningun otro CHECK de comprobantes_fiscales menciona estado', '0',
  COUNT(*)::TEXT FROM pg_constraint c
  WHERE c.conrelid = 'public.comprobantes_fiscales'::regclass AND c.contype = 'c'
    AND c.conname NOT IN ('comprobantes_fiscales_estado_check', 'comprobantes_fiscales_nc_check',
                          'comprobantes_fiscales_anulado_check')
    AND pg_get_constraintdef(c.oid) ~ '\mestado\M';

-- ── Indices unicos, cada uno por nombre ────────────────────────────────────
CALL pg_temp.probe(9, 'dos facturas activas en la misma venta', '23505 uq_comprobante_venta_activo',
  $q$SELECT pg_temp.fac('fac-p371-dup', 'vta-probe-371-1', 'pendiente', 3)$q$);

CALL pg_temp.probe(10, 'una NC pendiente de una factura emitida, en la misma venta, se puede insertar', 'ok',
  $q$SELECT pg_temp.nc('nc-p371-1', 'fac-p371-1', 'vta-probe-371-1')$q$);

CALL pg_temp.probe(11, 'una segunda NC activa de la misma factura', '23505 uq_comprobante_nc_activa',
  $q$SELECT pg_temp.nc('nc-p371-2b', 'fac-p371-2', 'vta-probe-371-2', p_pv => 4, p_nro => 8)$q$);

CALL pg_temp.probe(12, 'otra NC en vuelo del mismo CUIT, PV y tipo (de otra factura)', '23505 uq_comprobante_nc_en_vuelo',
  $q$SELECT pg_temp.nc('nc-p371-3', 'fac-p371-3', 'vta-probe-371-3')$q$);

CALL pg_temp.probe(13, 'una NC en vuelo en otro punto de venta convive con la del PV 3', 'ok',
  $q$SELECT pg_temp.nc('nc-p371-4', 'fac-p371-4', 'vta-probe-371-4', p_pv => 5, p_nro => 9)$q$);

CALL pg_temp.probe(14, 'una NC rechazada no cuenta: se puede intentar otra para la misma factura', 'ok',
  $q$SELECT pg_temp.nc('nc-p371-13b', 'fac-p371-13', 'vta-probe-371-13', p_pv => 13, p_nro => 4)$q$);

-- ARCA numbers per CUIT + PV + type, not per organization.
CALL pg_temp.probe(15, 'el mismo CUIT, PV y tipo en vuelo desde OTRA organizacion', '23505 uq_comprobante_nc_en_vuelo',
  $q$SELECT pg_temp.nc('nc-p371-x2', 'fac-p371-x2', 'vta-probe-371-x2', p_org => 'org-probe-371-x')$q$);

CALL pg_temp.probe(16, 'otro CUIT en el mismo PV y tipo: conviven aunque sea la misma organizacion', 'ok',
  $q$SELECT pg_temp.nc('nc-p371-x2', 'fac-p371-x2', 'vta-probe-371-x2', p_org => 'org-probe-371-x', p_cuit => '20000000002')$q$);

CALL pg_temp.probe(17, 'dos NC emitidas con el mismo CUIT, PV, tipo y numero', '23505 uq_comprobante_nc_numero',
  $q$SELECT pg_temp.nc('nc-p371-dupnum', 'fac-p371-3', 'vta-probe-371-3', 'emitido', p_pv => 4, p_nro => 7, p_numero => '0004-00000007')$q$);

-- ── CHECK de la NC (todas contra la factura 5, PV 6) ───────────────────────
CALL pg_temp.probe(18, 'motivo fuera de la lista', '23514 comprobantes_fiscales_nc_check',
  $q$SELECT pg_temp.nc('nc-p371-bad', 'fac-p371-5', 'vta-probe-371-5', p_pv => 6, p_motivo => 'zzz')$q$);

CALL pg_temp.probe(19, 'motivo otro sin detalle', '23514 comprobantes_fiscales_nc_check',
  $q$SELECT pg_temp.nc('nc-p371-bad', 'fac-p371-5', 'vta-probe-371-5', p_pv => 6, p_motivo => 'otro', p_detalle => NULL)$q$);

CALL pg_temp.probe(20, 'motivo otro con detalle en blanco', '23514 comprobantes_fiscales_nc_check',
  $q$SELECT pg_temp.nc('nc-p371-bad', 'fac-p371-5', 'vta-probe-371-5', p_pv => 6, p_motivo => 'otro', p_detalle => '   ')$q$);

CALL pg_temp.probe(21, 'detalle de 501 caracteres', '23514 comprobantes_fiscales_nc_check',
  $q$SELECT pg_temp.nc('nc-p371-bad', 'fac-p371-5', 'vta-probe-371-5', p_pv => 6, p_detalle => repeat('x', 501))$q$);

CALL pg_temp.probe(22, 'NC sin motivo (NULL no pasa por el CHECK)', '23514 comprobantes_fiscales_nc_check',
  $q$SELECT pg_temp.nc('nc-p371-bad', 'fac-p371-5', 'vta-probe-371-5', p_pv => 6, p_motivo => NULL)$q$);

CALL pg_temp.probe(23, 'NC sin numero solicitado', '23514 comprobantes_fiscales_nc_check',
  $q$SELECT pg_temp.nc('nc-p371-bad', 'fac-p371-5', 'vta-probe-371-5', p_pv => 6, p_nro => NULL)$q$);

CALL pg_temp.probe(24, 'NC con numero solicitado 0', '23514 comprobantes_fiscales_nc_check',
  $q$SELECT pg_temp.nc('nc-p371-bad', 'fac-p371-5', 'vta-probe-371-5', p_pv => 6, p_nro => 0)$q$);

CALL pg_temp.probe(25, 'NC con cbte_tipo 6 (una factura)', '23514 comprobantes_fiscales_nc_check',
  $q$SELECT pg_temp.nc('nc-p371-bad', 'fac-p371-5', 'vta-probe-371-5', p_pv => 6, p_cbte_tipo => 6)$q$);

CALL pg_temp.probe(26, 'NC B con cbte_tipo 13 (la letra no coincide)', '23514 comprobantes_fiscales_nc_check',
  $q$SELECT pg_temp.nc('nc-p371-bad', 'fac-p371-5', 'vta-probe-371-5', p_pv => 6, p_cbte_tipo => 13)$q$);

CALL pg_temp.probe(27, 'NC sin cbte_tipo', '23514 comprobantes_fiscales_nc_check',
  $q$SELECT pg_temp.nc('nc-p371-bad', 'fac-p371-5', 'vta-probe-371-5', p_pv => 6, p_cbte_tipo => NULL)$q$);

CALL pg_temp.probe(28, 'NC en estado anulado', '23514 comprobantes_fiscales_nc_check',
  $q$SELECT pg_temp.nc('nc-p371-bad', 'fac-p371-5', 'vta-probe-371-5', 'anulado', p_pv => 6, p_anulado => now())$q$);

CALL pg_temp.probe(29, 'cbte_tipo 8 sin factura asociada', '23514 comprobantes_fiscales_nc_check',
  $q$SELECT pg_temp.nc('nc-p371-bad', NULL, 'vta-probe-371-5', p_pv => 6, p_motivo => NULL, p_nro => NULL)$q$);

CALL pg_temp.probe(30, 'una factura con motivo de anulacion (el motivo vive en la NC)', '23514 comprobantes_fiscales_nc_check',
  $q$SELECT pg_temp.nc('nc-p371-bad', NULL, 'vta-probe-371-5', p_pv => 6, p_cbte_tipo => 6, p_nro => NULL)$q$);

CALL pg_temp.probe(31, 'una NC asociada a si misma', '23514 comprobantes_fiscales_nc_check',
  $q$SELECT pg_temp.nc('nc-p371-self', 'nc-p371-self', 'vta-probe-371-5', p_pv => 6)$q$);

CALL pg_temp.probe(32, 'NC sin cuit_emisor (la clave de numeracion de ARCA)', '23514 comprobantes_fiscales_nc_check',
  $q$SELECT pg_temp.nc('nc-p371-bad', 'fac-p371-5', 'vta-probe-371-5', p_pv => 6, p_cuit => NULL)$q$);

CALL pg_temp.probe(33, 'NC con cuit_emisor que no son 11 digitos', '23514 comprobantes_fiscales_nc_check',
  $q$SELECT pg_temp.nc('nc-p371-bad', 'fac-p371-5', 'vta-probe-371-5', p_pv => 6, p_cuit => '20-00000000-1')$q$);

CALL pg_temp.probe(34, 'motivo otro con detalle de 500 caracteres: se puede (la NC 5 queda pendiente)', 'ok',
  $q$SELECT pg_temp.nc('nc-p371-5', 'fac-p371-5', 'vta-probe-371-5', p_pv => 6, p_nro => 2, p_motivo => 'otro', p_detalle => repeat('x', 500))$q$);

CALL pg_temp.probe(35, 'factura anulada sin anulado_at', '23514 comprobantes_fiscales_anulado_check',
  $q$SELECT pg_temp.fac('fac-p371-bad', 'vta-probe-371-8', 'anulado', 14)$q$);

CALL pg_temp.probe(36, 'factura emitida con anulado_at', '23514 comprobantes_fiscales_anulado_check',
  $q$SELECT pg_temp.fac('fac-p371-bad', 'vta-probe-371-8', 'emitido', 14, NULL, now())$q$);

CALL pg_temp.probe(37, 'estado fuera de la lista', '23514 comprobantes_fiscales_estado_check',
  $q$SELECT pg_temp.fac('fac-p371-bad', 'vta-probe-371-8', 'zzz', 14)$q$);

-- ── Factura legada: tusfacturas, sin cbte_tipo ni CUIT ─────────────────────
CALL pg_temp.probe(38, 'una factura legada (tusfacturas, cbte_tipo y cuit_emisor NULL) cumple los CHECK', 'ok',
  $q$SELECT pg_temp.fac('fac-p371-15', 'vta-probe-371-15', 'emitido', 1, '0001-00000012',
                        p_provider => 'tusfacturas', p_cuit => NULL, p_cbte_tipo => NULL)$q$);

CALL pg_temp.probe(39, 'dos facturas activas en la venta de la factura legada', '23505 uq_comprobante_venta_activo',
  $q$SELECT pg_temp.fac('fac-p371-15b', 'vta-probe-371-15', 'pendiente', 1)$q$);

-- ── confirmar_nota_credito_fiscal ──────────────────────────────────────────
-- 40 a 42. La NC 4 pasa de pendiente a emitida y la factura 4 a anulada, juntas. La NC traia un
-- error_msg de un intento incierto: la confirmacion lo limpia.
UPDATE comprobantes_fiscales SET error_msg = 'timeout al enviar' WHERE id = 'nc-p371-4';
INSERT INTO _res SELECT 'nc4', public.confirmar_nota_credito_fiscal(
  'org-probe-371', 'nc-p371-4', '0005-00000009', 'CAE-NC-4', '20261030', '{"resultado": "A"}'::jsonb);

INSERT INTO _r SELECT 40, 'confirmar: id / factura asociada / replayed', 'nc-p371-4 / fac-p371-4 / false',
  (SELECT (res->>'id') || ' / ' || (res->>'asociadoId') || ' / ' || (res->>'replayed') FROM _res WHERE clave = 'nc4');

INSERT INTO _r SELECT 41, 'la NC: estado / numero / cae / vencimiento / error_msg limpio / provider_response',
  'emitido / 0005-00000009 / CAE-NC-4 / 20261030 / true / A',
  (SELECT estado || ' / ' || numero || ' / ' || cae || ' / ' || cae_vencimiento || ' / ' ||
          (error_msg IS NULL)::TEXT || ' / ' || (provider_response->>'resultado')
     FROM comprobantes_fiscales WHERE id = 'nc-p371-4');

INSERT INTO _r SELECT 42, 'la factura: estado / anulado_at / su CAE queda intacto', 'anulado / true / CAE-fac-p371-4',
  (SELECT estado || ' / ' || (anulado_at IS NOT NULL)::TEXT || ' / ' || cae
     FROM comprobantes_fiscales WHERE id = 'fac-p371-4');

-- 43. El mismo CAE otra vez (doble click, o verificar despues de anular): no cambia nada.
INSERT INTO _res SELECT 'nc4-replay', public.confirmar_nota_credito_fiscal(
  'org-probe-371', 'nc-p371-4', '0005-00000009', 'CAE-NC-4', '20261030', '{"resultado": "A"}'::jsonb);
INSERT INTO _r SELECT 43, 'repetir con el mismo CAE: replayed / NC / factura', 'true / emitido / anulado',
  (SELECT res->>'replayed' FROM _res WHERE clave = 'nc4-replay') || ' / ' ||
  (SELECT estado FROM comprobantes_fiscales WHERE id = 'nc-p371-4') || ' / ' ||
  (SELECT estado FROM comprobantes_fiscales WHERE id = 'fac-p371-4');

CALL pg_temp.probe(44, 'otro CAE sobre una NC ya emitida', 'P0001 La nota de crédito ya está emitida con otro CAE',
  $q$SELECT public.confirmar_nota_credito_fiscal('org-probe-371', 'nc-p371-4', '0005-00000009', 'OTRO-CAE', '20261030', NULL)$q$);

CALL pg_temp.probe(45, 'una NC de otro taller', 'P0001 Nota de crédito no encontrada',
  $q$SELECT public.confirmar_nota_credito_fiscal('org-probe-371-x', 'nc-p371-5', '0006-00000002', 'CAE-X', '20261030', NULL)$q$);

CALL pg_temp.probe(46, 'el id de una factura, no de una NC', 'P0001 Nota de crédito no encontrada',
  $q$SELECT public.confirmar_nota_credito_fiscal('org-probe-371', 'fac-p371-5', '0006-00000002', 'CAE-X', '20261030', NULL)$q$);

CALL pg_temp.probe(47, 'CAE en blanco', 'P0001 Faltan el número, el CAE o su vencimiento',
  $q$SELECT public.confirmar_nota_credito_fiscal('org-probe-371', 'nc-p371-5', '0006-00000002', '   ', '20261030', NULL)$q$);

-- La NC 5 pidio el numero 2 en el PV 6.
CALL pg_temp.probe(48, 'un numero distinto del que se pidio a ARCA', 'P0001 El número de la nota de crédito no coincide con el pedido a ARCA',
  $q$SELECT public.confirmar_nota_credito_fiscal('org-probe-371', 'nc-p371-5', '0006-00000009', 'CAE-X', '20261030', NULL)$q$);

CALL pg_temp.probe(49, 'el numero pedido pero de otro punto de venta', 'P0001 El número de la nota de crédito no coincide con el pedido a ARCA',
  $q$SELECT public.confirmar_nota_credito_fiscal('org-probe-371', 'nc-p371-5', '0007-00000002', 'CAE-X', '20261030', NULL)$q$);

CALL pg_temp.probe(50, 'un numero que no tiene la forma PPPP-NNNNNNNN', 'P0001 El número de la nota de crédito no coincide con el pedido a ARCA',
  $q$SELECT public.confirmar_nota_credito_fiscal('org-probe-371', 'nc-p371-5', 'dos', 'CAE-X', '20261030', NULL)$q$);

CALL pg_temp.probe(51, 'la factura asociada no esta emitida', 'P0001 La factura asociada no está emitida',
  $q$SELECT public.confirmar_nota_credito_fiscal('org-probe-371', 'nc-p371-9', '0009-00000003', 'CAE-X', '20261030', NULL)$q$);

CALL pg_temp.probe(52, 'NC C sobre una factura B', 'P0001 La factura asociada no corresponde a la venta o al tipo de la nota de crédito',
  $q$SELECT public.confirmar_nota_credito_fiscal('org-probe-371', 'nc-p371-6', '0007-00000003', 'CAE-X', '20261030', NULL)$q$);

CALL pg_temp.probe(53, 'NC de otra venta que la de la factura', 'P0001 La factura asociada no corresponde a la venta o al tipo de la nota de crédito',
  $q$SELECT public.confirmar_nota_credito_fiscal('org-probe-371', 'nc-p371-7', '0008-00000003', 'CAE-X', '20261030', NULL)$q$);

-- 54. Un vinculo entre talleres sembrado a mano: una NC del taller apunta a una factura EMITIDA del
-- taller ajeno. Ninguna ruta lo produce, pero ninguna constraint lo impide: el RPC es la barrera.
DO $$
BEGIN
  PERFORM pg_temp.nc('nc-p371-xlink', 'fac-p371-x1', 'vta-probe-371-8', p_pv => 15, p_nro => 3);
END $$;
CALL pg_temp.probe(54, 'una NC del taller apunta a la factura emitida de otro taller', 'P0001 La factura asociada no está emitida',
  $q$SELECT public.confirmar_nota_credito_fiscal('org-probe-371', 'nc-p371-xlink', '0015-00000003', 'CAE-X', '20261030', NULL)$q$);

-- 55. NC emitida pero factura todavia emitida (estado parcial): el mismo CAE completa la anulacion.
INSERT INTO _res SELECT 'nc2', public.confirmar_nota_credito_fiscal(
  'org-probe-371', 'nc-p371-2', '0004-00000007', 'CAE-nc-p371-2', '20261030', NULL);
INSERT INTO _r SELECT 55, 'estado parcial (NC emitida, factura emitida): el mismo CAE anula la factura: replayed / factura',
  'true / anulado',
  (SELECT res->>'replayed' FROM _res WHERE clave = 'nc2') || ' / ' ||
  (SELECT estado FROM comprobantes_fiscales WHERE id = 'fac-p371-2');

-- 56 y 57. Una NC que dimos por rechazada (el envio no contesto) y que ARCA si autorizo: la
-- verificacion posterior la confirma igual. Pasa a emitida y la factura a anulada.
INSERT INTO _res SELECT 'nc14', public.confirmar_nota_credito_fiscal(
  'org-probe-371', 'nc-p371-14', '0014-00000003', 'CAE-NC-14', '20261030', '{"resultado": "A"}'::jsonb);
INSERT INTO _r SELECT 56, 'NC rechazada confirmada tarde: replayed / estado / numero / cae / error_msg limpio',
  'false / emitido / 0014-00000003 / CAE-NC-14 / true',
  (SELECT res->>'replayed' FROM _res WHERE clave = 'nc14') || ' / ' ||
  (SELECT estado || ' / ' || numero || ' / ' || cae || ' / ' || (error_msg IS NULL)::TEXT
     FROM comprobantes_fiscales WHERE id = 'nc-p371-14');
INSERT INTO _r SELECT 57, 'NC rechazada confirmada tarde: la factura queda anulada con anulado_at', 'anulado / true',
  (SELECT estado || ' / ' || (anulado_at IS NOT NULL)::TEXT FROM comprobantes_fiscales WHERE id = 'fac-p371-14');

-- 58. Lo mismo con otra NC activa para la misma factura (la 13b, pendiente, del probe 14): no se puede.
CALL pg_temp.probe(58, 'NC rechazada confirmada tarde mientras hay otra NC activa de la factura', '23505 uq_comprobante_nc_activa',
  $q$SELECT public.confirmar_nota_credito_fiscal('org-probe-371', 'nc-p371-13', '0013-00000003', 'CAE-NC-13', '20261030', NULL)$q$);

-- 59. Adoptar el numero de otra NC ya emitida (misma clave CUIT, PV 4, tipo 8, numero 7): no se puede.
DO $$
BEGIN
  PERFORM pg_temp.nc('nc-p371-3b', 'fac-p371-3', 'vta-probe-371-3', p_pv => 4, p_nro => 7);
END $$;
CALL pg_temp.probe(59, 'confirmar una NC con el numero de otra NC emitida', '23505 uq_comprobante_nc_numero',
  $q$SELECT public.confirmar_nota_credito_fiscal('org-probe-371', 'nc-p371-3b', '0004-00000007', 'CAE-NC-3B', '20261030', NULL)$q$);

-- ── Trigger de anulacion de la venta (cada probe lee tambien ventas.estado) ─
CALL pg_temp.probe_anular(60, 'anular una venta con factura emitida (y NC pendiente)',
  'P0022 VENTA_NO_ANULABLE: La venta tiene una factura electrónica emitida: anulala primero con "Anular factura" en el bloque Factura electrónica. / COMPLETADA',
  'vta-probe-371-1');

CALL pg_temp.probe_anular(61, 'anular una venta con la factura 1 anulada y la factura 2 emitida',
  'P0022 VENTA_NO_ANULABLE: La venta tiene una factura electrónica emitida: anulala primero con "Anular factura" en el bloque Factura electrónica. / COMPLETADA',
  'vta-probe-371-10');

CALL pg_temp.probe_anular(62, 'anular una venta con factura anulada y NC emitida (confirmada por el RPC)', 'ok / ANULADA',
  'vta-probe-371-4');

CALL pg_temp.probe_anular(63, 'anular una venta con factura anulada y NC emitida (completada por el replay)', 'ok / ANULADA',
  'vta-probe-371-2');

CALL pg_temp.probe_anular(64, 'anular una venta con una sola factura rechazada', 'ok / ANULADA',
  'vta-probe-371-11');

CALL pg_temp.probe_anular(65, 'anular una venta con una factura legada (tusfacturas, sin cbte_tipo) emitida',
  'P0022 VENTA_NO_ANULABLE: La venta tiene una factura electrónica emitida: anulala primero con "Anular factura" en el bloque Factura electrónica. / COMPLETADA',
  'vta-probe-371-15');

CALL pg_temp.probe(66, 'factura nueva en una venta con la anterior anulada y su NC emitida', 'ok',
  $q$SELECT pg_temp.fac('fac-p371-12b', 'vta-probe-371-12', 'pendiente', 12)$q$);

CALL pg_temp.probe_anular(67, 'anular esa venta mientras la factura nueva esta pendiente',
  'P0022 VENTA_NO_ANULABLE: La venta tiene una factura electrónica emitida: anulala primero con "Anular factura" en el bloque Factura electrónica. / COMPLETADA',
  'vta-probe-371-12');

-- ── Purga de la organizacion ───────────────────────────────────────────────
-- Facturas, NC (la autorreferencia es NO ACTION), ventas y todo lo demas caen en la misma cascada.
-- Incluye el vinculo entre talleres sembrado en el probe 54.
CALL pg_temp.probe(68, 'borrar los talleres con facturas y NC no se traba', 'ok',
  $q$DELETE FROM organizations WHERE id IN ('org-probe-371', 'org-probe-371-x')$q$);

INSERT INTO _r SELECT 69, 'la cascada se llevo los comprobantes fiscales de los dos talleres', '0',
  (SELECT COUNT(*)::TEXT FROM comprobantes_fiscales WHERE organization_id IN ('org-probe-371', 'org-probe-371-x'));

-- 70. Ningun probe se quedo sin fila ni inserto dos.
INSERT INTO _r SELECT 70, 'filas de los probes 1 a 69: total / distintas', '69 / 69',
  COUNT(*)::TEXT || ' / ' || COUNT(DISTINCT orden)::TEXT FROM _r WHERE orden BETWEEN 1 AND 69;

SELECT orden, probe, esperado, obtenido,
       CASE WHEN obtenido LIKE 'SALTEADO%' THEN 'SALTEADO'
            WHEN esperado = obtenido THEN 'OK'
            ELSE 'FALLA' END AS resultado
  FROM _r ORDER BY orden;

ROLLBACK;
