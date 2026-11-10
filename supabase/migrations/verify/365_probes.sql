-- Verification of M1 (multimoneda-inventario-servicios): multi-currency foundation.
--
-- Run AFTER the migration is applied:  node scripts/db-run.mjs <this file>
-- (no --apply: the file opens its own transaction and always ends in ROLLBACK).
-- Without RLS, as in verify/README.md. The only data it creates is one scratch organization
-- ('probe-mm-org') and one scratch cash session, rolled back with everything else. The rollback
-- rehearsal at the end takes ACCESS EXCLUSIVE locks until that ROLLBACK, so it runs last.
--
-- Results accumulate in _r and come out in ONE select. Green = esperado equals obtenido, or
-- obtenido starts with 'OK:' for the probes that expect an error.

BEGIN;

CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);

-- Runs one statement and records the SQLSTATE it raised ('ok' = no error).
CREATE FUNCTION pg_temp.probe(p_orden INT, p_probe TEXT, p_esperado TEXT, p_sql TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_got TEXT := 'ok'; v_msg TEXT := '';
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    v_got := SQLSTATE; v_msg := ' ' || SQLERRM;
  END;
  INSERT INTO _r VALUES (p_orden, p_probe, p_esperado,
    CASE WHEN v_got = p_esperado THEN 'OK: ' || v_got ELSE 'FALLO: ' || v_got || v_msg END);
END $$;

-- Empty temp copy of a table keeping only its CHECK constraints (NOT NULL dropped), so a CHECK
-- can be exercised without building a valid sale/payment/order row.
CREATE FUNCTION pg_temp.shadow(p_tabla TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_sh TEXT := '_sh_' || p_tabla; c RECORD;
BEGIN
  EXECUTE format('CREATE TEMP TABLE %I (LIKE public.%I INCLUDING CONSTRAINTS)', v_sh, p_tabla);
  FOR c IN SELECT attname FROM pg_attribute
            WHERE attrelid = ('pg_temp.' || quote_ident(v_sh))::regclass
              AND attnum > 0 AND NOT attisdropped AND attnotnull LOOP
    EXECUTE format('ALTER TABLE pg_temp.%I ALTER COLUMN %I DROP NOT NULL', v_sh, c.attname);
  END LOOP;
END $$;

INSERT INTO organizations (nombre, slug) VALUES ('Probe MM Org', 'probe-mm-org');

-- 10-13: the moneda columns exist, nullable, with no default, on every catalog/cash table.
INSERT INTO _r SELECT 10, 'moneda is CHAR(3) nullable with no default on inventario, servicios, movimientos_caja', '3',
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'moneda'
      AND table_name IN ('inventario', 'servicios', 'movimientos_caja')
      AND data_type = 'character' AND character_maximum_length = 3
      AND is_nullable = 'YES' AND column_default IS NULL)::TEXT;
INSERT INTO _r SELECT 11, 'origin columns exist on the four line tables (3 each)', '12',
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('items_venta', 'servicios_orden', 'repuestos_orden', 'items_cotizacion')
      AND column_name IN ('moneda_origen', 'precio_origen', 'tipo_cambio'))::TEXT;
INSERT INTO _r SELECT 12, 'rate snapshot columns exist on ventas and ordenes_servicio (2 each)', '4',
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name IN ('ventas', 'ordenes_servicio')
      AND column_name IN ('tipo_cambio', 'tipo_cambio_fuente'))::TEXT;
INSERT INTO _r SELECT 13, 'pagos_venta carries the five currency columns', '5',
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pagos_venta'
      AND column_name IN ('moneda', 'monto_moneda', 'tipo_cambio', 'vuelto_monto', 'vuelto_moneda'))::TEXT;

-- 14-15: existing rows were not rewritten (no backfill): nobody carries a currency yet.
INSERT INTO _r SELECT 14, 'real inventory exists (so probe 15 is not vacuous)', 'true',
  (SELECT count(*) > 0 FROM inventario)::TEXT;
INSERT INTO _r SELECT 15, 'no existing inventario row got a moneda', '0',
  (SELECT count(*) FROM inventario WHERE moneda IS NOT NULL)::TEXT;

-- 16-17: the CHECKs reject anything but NULL or USD. They run on scratch rows of the scratch
-- organization (never "the first row of the table": that is empty on a fresh database).
INSERT INTO inventario (organization_id, codigo, categoria, precio_compra, nombre, stock, stock_reservado, precio_venta)
  SELECT id, 'PRB-MM-INV', 'PROBE', 0, 'Probe MM producto', 0, 0, 0 FROM organizations WHERE slug = 'probe-mm-org';
INSERT INTO servicios (organization_id, codigo, nombre, precio)
  SELECT id, 'PRB-MM-SRV', 'Probe MM servicio', 0 FROM organizations WHERE slug = 'probe-mm-org';
DO $$ BEGIN
  PERFORM pg_temp.probe(16, 'inventario.moneda rejects EUR', '23514',
    'UPDATE inventario SET moneda = ''EUR'' WHERE codigo = ''PRB-MM-INV'' AND organization_id = (SELECT id FROM organizations WHERE slug = ''probe-mm-org'')');
  PERFORM pg_temp.probe(17, 'servicios.moneda rejects ARS (local is NULL, never a code)', '23514',
    'UPDATE servicios SET moneda = ''ARS'' WHERE codigo = ''PRB-MM-SRV'' AND organization_id = (SELECT id FROM organizations WHERE slug = ''probe-mm-org'')');
END $$;

-- 19-24: organizacion_moneda shape and defaults (scratch org inserted without the columns).
INSERT INTO organizacion_moneda (organization_id)
  SELECT id FROM organizations WHERE slug = 'probe-mm-org';
INSERT INTO _r SELECT 19, 'defaults: flag off, USD cash off, rounding 0, change in local', 'false|false|0.00|LOCAL',
  COALESCE((SELECT multimoneda_habilitada::TEXT || '|' || acepta_usd_efectivo::TEXT || '|' ||
                   redondeo_conversion::TEXT || '|' || vuelto_moneda_default
              FROM organizacion_moneda m JOIN organizations o ON o.id = m.organization_id
             WHERE o.slug = 'probe-mm-org'), 'MISSING');
DO $$ BEGIN
  PERFORM pg_temp.probe(20, 'rate source outside MANUAL/OFICIAL/BLUE/MEP is refused', '23514',
    'UPDATE organizacion_moneda SET tipo_cambio_fuente = ''XYZ'' WHERE organization_id = (SELECT id FROM organizations WHERE slug = ''probe-mm-org'')');
  PERFORM pg_temp.probe(21, 'a zero rate is refused', '23514',
    'UPDATE organizacion_moneda SET tipo_cambio_manual = 0 WHERE organization_id = (SELECT id FROM organizations WHERE slug = ''probe-mm-org'')');
  PERFORM pg_temp.probe(22, 'a negative rate is refused', '23514',
    'UPDATE organizacion_moneda SET tipo_cambio_referencia = -5 WHERE organization_id = (SELECT id FROM organizations WHERE slug = ''probe-mm-org'')');
  PERFORM pg_temp.probe(23, 'change currency other than LOCAL/USD is refused', '23514',
    'UPDATE organizacion_moneda SET vuelto_moneda_default = ''EUR'' WHERE organization_id = (SELECT id FROM organizations WHERE slug = ''probe-mm-org'')');
END $$;
INSERT INTO _r SELECT 24, 'organizations did not gain any multi-currency column', '0',
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'organizations'
      AND column_name LIKE ANY (ARRAY['%multimoneda%', 'tipo_cambio%', 'acepta_usd%']))::TEXT;

-- 25-27: sesion_caja_saldos: one row per (session, currency), USD only.
INSERT INTO sesiones_caja (organization_id, usuario_apertura_id)
  SELECT o.id, u.id FROM organizations o, users u WHERE o.slug = 'probe-mm-org' LIMIT 1;
INSERT INTO sesion_caja_saldos (sesion_id, organization_id, moneda, saldo_inicial)
  SELECT s.id, s.organization_id, 'USD', 100
    FROM sesiones_caja s JOIN organizations o ON o.id = s.organization_id WHERE o.slug = 'probe-mm-org';
INSERT INTO _r SELECT 25, 'a USD balance row was stored for the scratch session', '1',
  (SELECT count(*) FROM sesion_caja_saldos c JOIN organizations o ON o.id = c.organization_id
    WHERE o.slug = 'probe-mm-org')::TEXT;
DO $$ BEGIN
  PERFORM pg_temp.probe(26, 'a second USD row for the same session violates UNIQUE (sesion_id, moneda)', '23505',
    'INSERT INTO sesion_caja_saldos (sesion_id, organization_id, moneda) SELECT sesion_id, organization_id, ''USD'' FROM sesion_caja_saldos LIMIT 1');
  PERFORM pg_temp.probe(27, 'a EUR balance row is refused', '23514',
    'INSERT INTO sesion_caja_saldos (sesion_id, organization_id, moneda) SELECT sesion_id, organization_id, ''EUR'' FROM sesion_caja_saldos LIMIT 1');
END $$;

-- 28-31: RLS on both new tables, anon has no privileges.
INSERT INTO _r SELECT 28, 'RLS enabled on both new tables', '2',
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname IN ('organizacion_moneda', 'sesion_caja_saldos')
      AND c.relrowsecurity)::TEXT;
INSERT INTO _r SELECT 29, 'the service_role policy exists on each', '2',
  (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN ('organizacion_moneda', 'sesion_caja_saldos')
      AND policyname LIKE '%_all_service' AND 'service_role' = ANY (roles))::TEXT;
INSERT INTO _r SELECT 30, 'the only other policy is a SELECT for authenticated scoped to the own organization', '2',
  (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN ('organizacion_moneda', 'sesion_caja_saldos')
      AND policyname LIKE '%_select' AND cmd = 'SELECT' AND roles = '{authenticated}'
      AND qual LIKE '%get_current_organization_id()%')::TEXT;
INSERT INTO _r SELECT 31, 'no other policy exists on them', '0',
  (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN ('organizacion_moneda', 'sesion_caja_saldos')
      AND policyname NOT LIKE '%_all_service' AND policyname NOT LIKE '%_select')::TEXT;
INSERT INTO _r SELECT 32, 'anon holds no privilege; authenticated holds SELECT only', 'false|true|false',
  (SELECT bool_or(has_table_privilege('anon', t, 'SELECT,INSERT,UPDATE,DELETE'))::TEXT || '|' ||
          bool_and(has_table_privilege('authenticated', t, 'SELECT'))::TEXT || '|' ||
          bool_or(has_table_privilege('authenticated', t, 'INSERT,UPDATE,DELETE'))::TEXT
     FROM unnest(ARRAY['public.organizacion_moneda', 'public.sesion_caja_saldos']) t);

-- 33-: named CHECKs exist, rate columns are NUMERIC(14,6), a zero rate / foreign code is refused
-- on every table that carries one (exercised on empty shadow copies: same CHECKs, no data needed).
INSERT INTO _r SELECT 33, 'all 16 named *_chk constraints exist', '16',
  (SELECT count(*) FROM pg_constraint WHERE conname IN ('inventario_moneda_chk', 'servicios_moneda_chk', 'movimientos_caja_moneda_chk', 'items_venta_moneda_origen_chk', 'items_venta_tipo_cambio_chk', 'servicios_orden_moneda_origen_chk', 'servicios_orden_tipo_cambio_chk', 'repuestos_orden_moneda_origen_chk', 'repuestos_orden_tipo_cambio_chk', 'items_cotizacion_moneda_origen_chk', 'items_cotizacion_tipo_cambio_chk', 'ventas_tipo_cambio_chk', 'ordenes_servicio_tipo_cambio_chk', 'pagos_venta_moneda_chk', 'pagos_venta_tipo_cambio_chk', 'pagos_venta_vuelto_moneda_chk'))::TEXT;
INSERT INTO _r SELECT 34, 'rate columns are NUMERIC(14,6) (4 line tables + ventas + ordenes_servicio + pagos_venta + 2 settings)', '9',
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND data_type = 'numeric' AND numeric_precision = 14 AND numeric_scale = 6
      AND ((column_name = 'tipo_cambio' AND table_name IN ('items_venta', 'servicios_orden', 'repuestos_orden', 'items_cotizacion', 'ventas', 'ordenes_servicio', 'pagos_venta'))
        OR (table_name = 'organizacion_moneda' AND column_name IN ('tipo_cambio_manual', 'tipo_cambio_referencia'))))::TEXT;
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['ventas', 'ordenes_servicio', 'pagos_venta', 'items_venta', 'servicios_orden', 'repuestos_orden', 'items_cotizacion', 'movimientos_caja'] LOOP
    PERFORM pg_temp.shadow(t);
  END LOOP;
END $$;
DO $$ BEGIN
  PERFORM pg_temp.probe(35, 'ventas.tipo_cambio = 0 is refused', '23514', 'INSERT INTO _sh_ventas (tipo_cambio) VALUES (0)');
  PERFORM pg_temp.probe(36, 'ordenes_servicio.tipo_cambio = 0 is refused', '23514', 'INSERT INTO _sh_ordenes_servicio (tipo_cambio) VALUES (0)');
  PERFORM pg_temp.probe(37, 'pagos_venta.tipo_cambio = 0 is refused', '23514', 'INSERT INTO _sh_pagos_venta (tipo_cambio) VALUES (0)');
  PERFORM pg_temp.probe(38, 'items_venta.tipo_cambio = 0 is refused', '23514', 'INSERT INTO _sh_items_venta (tipo_cambio) VALUES (0)');
  PERFORM pg_temp.probe(39, 'servicios_orden.tipo_cambio = 0 is refused', '23514', 'INSERT INTO _sh_servicios_orden (tipo_cambio) VALUES (0)');
  PERFORM pg_temp.probe(40, 'repuestos_orden.tipo_cambio = 0 is refused', '23514', 'INSERT INTO _sh_repuestos_orden (tipo_cambio) VALUES (0)');
  PERFORM pg_temp.probe(41, 'items_cotizacion.tipo_cambio = 0 is refused', '23514', 'INSERT INTO _sh_items_cotizacion (tipo_cambio) VALUES (0)');
  PERFORM pg_temp.probe(42, 'pagos_venta.moneda rejects EUR', '23514', 'INSERT INTO _sh_pagos_venta (moneda) VALUES (''EUR'')');
  PERFORM pg_temp.probe(43, 'pagos_venta.vuelto_moneda rejects EUR', '23514', 'INSERT INTO _sh_pagos_venta (vuelto_moneda) VALUES (''EUR'')');
  PERFORM pg_temp.probe(44, 'items_venta.moneda_origen rejects EUR', '23514', 'INSERT INTO _sh_items_venta (moneda_origen) VALUES (''EUR'')');
  PERFORM pg_temp.probe(45, 'movimientos_caja.moneda rejects EUR', '23514', 'INSERT INTO _sh_movimientos_caja (moneda) VALUES (''EUR'')');
  PERFORM pg_temp.probe(46, 'a valid USD rate is accepted', 'ok', 'INSERT INTO _sh_ventas (tipo_cambio) VALUES (1250.123456)');
END $$;

-- ROLLBACK REHEARSAL. Capture what must survive, run the rollback inline (verbatim), check.
CREATE TEMP TABLE _antes AS
  SELECT (SELECT count(*) FROM inventario) AS inv,
         (SELECT count(*) FROM ventas) AS ventas,
         (SELECT count(*) FROM pagos_venta) AS pagos;
-- ROLLBACK:BEGIN
SET LOCAL lock_timeout = '3s';

DROP TABLE IF EXISTS sesion_caja_saldos;
DROP TABLE IF EXISTS organizacion_moneda;

ALTER TABLE inventario DROP CONSTRAINT IF EXISTS inventario_moneda_chk;
ALTER TABLE servicios DROP CONSTRAINT IF EXISTS servicios_moneda_chk;
ALTER TABLE movimientos_caja DROP CONSTRAINT IF EXISTS movimientos_caja_moneda_chk;
ALTER TABLE items_venta DROP CONSTRAINT IF EXISTS items_venta_moneda_origen_chk;
ALTER TABLE items_venta DROP CONSTRAINT IF EXISTS items_venta_tipo_cambio_chk;
ALTER TABLE servicios_orden DROP CONSTRAINT IF EXISTS servicios_orden_moneda_origen_chk;
ALTER TABLE servicios_orden DROP CONSTRAINT IF EXISTS servicios_orden_tipo_cambio_chk;
ALTER TABLE repuestos_orden DROP CONSTRAINT IF EXISTS repuestos_orden_moneda_origen_chk;
ALTER TABLE repuestos_orden DROP CONSTRAINT IF EXISTS repuestos_orden_tipo_cambio_chk;
ALTER TABLE items_cotizacion DROP CONSTRAINT IF EXISTS items_cotizacion_moneda_origen_chk;
ALTER TABLE items_cotizacion DROP CONSTRAINT IF EXISTS items_cotizacion_tipo_cambio_chk;
ALTER TABLE ventas DROP CONSTRAINT IF EXISTS ventas_tipo_cambio_chk;
ALTER TABLE ordenes_servicio DROP CONSTRAINT IF EXISTS ordenes_servicio_tipo_cambio_chk;
ALTER TABLE pagos_venta DROP CONSTRAINT IF EXISTS pagos_venta_moneda_chk;
ALTER TABLE pagos_venta DROP CONSTRAINT IF EXISTS pagos_venta_tipo_cambio_chk;
ALTER TABLE pagos_venta DROP CONSTRAINT IF EXISTS pagos_venta_vuelto_moneda_chk;

ALTER TABLE pagos_venta
  DROP COLUMN IF EXISTS vuelto_moneda,
  DROP COLUMN IF EXISTS vuelto_monto,
  DROP COLUMN IF EXISTS tipo_cambio,
  DROP COLUMN IF EXISTS monto_moneda,
  DROP COLUMN IF EXISTS moneda;

ALTER TABLE ordenes_servicio
  DROP COLUMN IF EXISTS tipo_cambio_fuente,
  DROP COLUMN IF EXISTS tipo_cambio;
ALTER TABLE ventas
  DROP COLUMN IF EXISTS tipo_cambio_fuente,
  DROP COLUMN IF EXISTS tipo_cambio;

ALTER TABLE items_cotizacion
  DROP COLUMN IF EXISTS tipo_cambio,
  DROP COLUMN IF EXISTS precio_origen,
  DROP COLUMN IF EXISTS moneda_origen;
ALTER TABLE repuestos_orden
  DROP COLUMN IF EXISTS tipo_cambio,
  DROP COLUMN IF EXISTS precio_origen,
  DROP COLUMN IF EXISTS moneda_origen;
ALTER TABLE servicios_orden
  DROP COLUMN IF EXISTS tipo_cambio,
  DROP COLUMN IF EXISTS precio_origen,
  DROP COLUMN IF EXISTS moneda_origen;
ALTER TABLE items_venta
  DROP COLUMN IF EXISTS tipo_cambio,
  DROP COLUMN IF EXISTS precio_origen,
  DROP COLUMN IF EXISTS moneda_origen;

ALTER TABLE movimientos_caja DROP COLUMN IF EXISTS moneda;
ALTER TABLE servicios DROP COLUMN IF EXISTS moneda;
ALTER TABLE inventario DROP COLUMN IF EXISTS moneda;
-- ROLLBACK:END
INSERT INTO _r SELECT 80, 'rehearsal: the new tables and columns are gone', '0',
  ((SELECT count(*) FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name IN ('organizacion_moneda', 'sesion_caja_saldos')) +
   (SELECT count(*) FROM information_schema.columns
     WHERE table_schema = 'public' AND column_name IN ('moneda', 'moneda_origen', 'precio_origen', 'monto_moneda', 'vuelto_monto', 'vuelto_moneda', 'tipo_cambio_fuente')
       AND table_name IN ('inventario', 'servicios', 'movimientos_caja', 'items_venta', 'servicios_orden', 'repuestos_orden', 'items_cotizacion', 'ventas', 'ordenes_servicio', 'pagos_venta')))::TEXT;
INSERT INTO _r SELECT 82, 'rehearsal: no named *_chk constraint is left', '0',
  (SELECT count(*) FROM pg_constraint WHERE conname IN ('inventario_moneda_chk', 'servicios_moneda_chk', 'movimientos_caja_moneda_chk', 'items_venta_moneda_origen_chk', 'items_venta_tipo_cambio_chk', 'servicios_orden_moneda_origen_chk', 'servicios_orden_tipo_cambio_chk', 'repuestos_orden_moneda_origen_chk', 'repuestos_orden_tipo_cambio_chk', 'items_cotizacion_moneda_origen_chk', 'items_cotizacion_tipo_cambio_chk', 'ventas_tipo_cambio_chk', 'ordenes_servicio_tipo_cambio_chk', 'pagos_venta_moneda_chk', 'pagos_venta_tipo_cambio_chk', 'pagos_venta_vuelto_moneda_chk'))::TEXT;
INSERT INTO _r SELECT 81, 'rehearsal: no inventory, sale or payment row was lost', a.inv::TEXT || '|' || a.ventas::TEXT || '|' || a.pagos::TEXT,
  (SELECT count(*) FROM inventario)::TEXT || '|' || (SELECT count(*) FROM ventas)::TEXT || '|' || (SELECT count(*) FROM pagos_venta)::TEXT
  FROM _antes a;

SELECT orden, probe, esperado, obtenido FROM _r ORDER BY orden, probe;

ROLLBACK;
