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

-- 16-18: CHECKs reject anything but NULL or USD.
DO $$ BEGIN
  PERFORM pg_temp.probe(16, 'inventario.moneda rejects EUR', '23514',
    'UPDATE inventario SET moneda = ''EUR'' WHERE id = (SELECT id FROM inventario LIMIT 1)');
  PERFORM pg_temp.probe(17, 'servicios.moneda rejects ARS (local is NULL, never a code)', '23514',
    'UPDATE servicios SET moneda = ''ARS'' WHERE id = (SELECT id FROM servicios LIMIT 1)');
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
INSERT INTO _r SELECT 29, 'only the service_role policy exists on each', '2',
  (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN ('organizacion_moneda', 'sesion_caja_saldos')
      AND policyname LIKE '%_all_service' AND 'service_role' = ANY (roles))::TEXT;
INSERT INTO _r SELECT 30, 'no other policy exists on them', '0',
  (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN ('organizacion_moneda', 'sesion_caja_saldos')
      AND policyname NOT LIKE '%_all_service')::TEXT;
INSERT INTO _r SELECT 31, 'anon and authenticated hold no privilege on the new tables', 'false',
  (SELECT bool_or(has_table_privilege(r, t, 'SELECT'))
     FROM unnest(ARRAY['anon', 'authenticated']) r,
          unnest(ARRAY['public.organizacion_moneda', 'public.sesion_caja_saldos']) t)::TEXT;

-- ROLLBACK REHEARSAL. Capture what must survive, run the rollback inline (verbatim), check.
CREATE TEMP TABLE _antes AS
  SELECT (SELECT count(*) FROM inventario) AS inv,
         (SELECT count(*) FROM ventas) AS ventas,
         (SELECT count(*) FROM pagos_venta) AS pagos;
-- ROLLBACK:BEGIN
SET LOCAL lock_timeout = '3s';

DROP TABLE IF EXISTS sesion_caja_saldos;
DROP TABLE IF EXISTS organizacion_moneda;

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
INSERT INTO _r SELECT 81, 'rehearsal: no inventory, sale or payment row was lost', a.inv::TEXT || '|' || a.ventas::TEXT || '|' || a.pagos::TEXT,
  (SELECT count(*) FROM inventario)::TEXT || '|' || (SELECT count(*) FROM ventas)::TEXT || '|' || (SELECT count(*) FROM pagos_venta)::TEXT
  FROM _antes a;

SELECT orden, probe, esperado, obtenido FROM _r ORDER BY orden, probe;

ROLLBACK;
