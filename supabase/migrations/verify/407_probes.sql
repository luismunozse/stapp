-- Verification of 407 (multimoneda S3): quote rate metadata + recotizaciones.
--
-- Run AFTER 407 is applied:  node scripts/db-run.mjs <this file>
-- (no --apply: the file opens its own transaction and always ends in ROLLBACK).
-- Only data created: one scratch organization ('probe-407-org'), rolled back with everything.
-- The rollback rehearsal at the end takes ACCESS EXCLUSIVE locks until that ROLLBACK, so it runs last.
-- Green = esperado equals obtenido, or obtenido starts with 'OK:' for probes that expect an error.

BEGIN;

CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);

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

INSERT INTO organizations (nombre, slug) VALUES ('Probe 407 Org', 'probe-407-org');

-- 1-2: shape.
INSERT INTO _r SELECT 1, 'cotizaciones gained tipo_cambio_fuente and tipo_cambio_en', '2',
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cotizaciones'
      AND column_name IN ('tipo_cambio_fuente', 'tipo_cambio_en'))::TEXT;
INSERT INTO _r SELECT 2, 'cotizaciones.tipo_cambio was not converted (still unconstrained numeric)', 'numeric|',
  (SELECT data_type || '|' || COALESCE(numeric_precision::TEXT, '') FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cotizaciones' AND column_name = 'tipo_cambio');

-- 3-9 and 16-17: recotizaciones CHECKs. documento_id is free text, so no parent row is needed.
DO $$ BEGIN
  PERFORM pg_temp.probe(3, 'MANUAL without motivo (NULL) is refused', '23514',
    'INSERT INTO recotizaciones (organization_id, documento_tipo, documento_id, modo, tipo_cambio_nuevo) SELECT id, ''ORDEN'', ''x'', ''MANUAL'', 1000 FROM organizations WHERE slug = ''probe-407-org''');
  PERFORM pg_temp.probe(4, 'MANUAL with a spaces-only motivo is refused', '23514',
    'INSERT INTO recotizaciones (organization_id, documento_tipo, documento_id, modo, tipo_cambio_nuevo, motivo) SELECT id, ''ORDEN'', ''x'', ''MANUAL'', 1000, ''   '' FROM organizations WHERE slug = ''probe-407-org''');
  PERFORM pg_temp.probe(16, 'MANUAL with an empty motivo is refused', '23514',
    'INSERT INTO recotizaciones (organization_id, documento_tipo, documento_id, modo, tipo_cambio_nuevo, motivo) SELECT id, ''ORDEN'', ''x'', ''MANUAL'', 1000, '''' FROM organizations WHERE slug = ''probe-407-org''');
  PERFORM pg_temp.probe(17, 'MANUAL with a tab/newline-only motivo is refused', '23514',
    'INSERT INTO recotizaciones (organization_id, documento_tipo, documento_id, modo, tipo_cambio_nuevo, motivo) SELECT id, ''ORDEN'', ''x'', ''MANUAL'', 1000, E''\t\n'' FROM organizations WHERE slug = ''probe-407-org''');
  PERFORM pg_temp.probe(5, 'MANUAL with a motivo is accepted', 'ok',
    'INSERT INTO recotizaciones (organization_id, documento_tipo, documento_id, modo, tipo_cambio_nuevo, motivo) SELECT id, ''ORDEN'', ''x'', ''MANUAL'', 1000, ''cliente acordo'' FROM organizations WHERE slug = ''probe-407-org''');
  PERFORM pg_temp.probe(6, 'HOY without motivo is accepted', 'ok',
    'INSERT INTO recotizaciones (organization_id, documento_tipo, documento_id, modo, tipo_cambio_nuevo) SELECT id, ''COTIZACION'', ''y'', ''HOY'', 1250.123456 FROM organizations WHERE slug = ''probe-407-org''');
  PERFORM pg_temp.probe(7, 'documento_tipo outside ORDEN/COTIZACION is refused', '23514',
    'INSERT INTO recotizaciones (organization_id, documento_tipo, documento_id, modo, tipo_cambio_nuevo) SELECT id, ''VENTA'', ''x'', ''HOY'', 1000 FROM organizations WHERE slug = ''probe-407-org''');
  PERFORM pg_temp.probe(8, 'modo outside HOY/MANUAL is refused', '23514',
    'INSERT INTO recotizaciones (organization_id, documento_tipo, documento_id, modo, tipo_cambio_nuevo) SELECT id, ''ORDEN'', ''x'', ''AUTO'', 1000 FROM organizations WHERE slug = ''probe-407-org''');
  PERFORM pg_temp.probe(9, 'a zero new rate is refused', '23514',
    'INSERT INTO recotizaciones (organization_id, documento_tipo, documento_id, modo, tipo_cambio_nuevo) SELECT id, ''ORDEN'', ''x'', ''HOY'', 0 FROM organizations WHERE slug = ''probe-407-org''');
END $$;
INSERT INTO _r SELECT 10, 'the two accepted rows were stored', '2',
  (SELECT count(*) FROM recotizaciones r JOIN organizations o ON o.id = r.organization_id WHERE o.slug = 'probe-407-org')::TEXT;
INSERT INTO _r SELECT 11, 'rate columns are NUMERIC(14,6)', '2',
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'recotizaciones'
      AND column_name IN ('tipo_cambio_anterior', 'tipo_cambio_nuevo')
      AND numeric_precision = 14 AND numeric_scale = 6)::TEXT;

-- 12-15: RLS shape and the lookup index.
INSERT INTO _r SELECT 12, 'RLS enabled', 'true',
  (SELECT c.relrowsecurity::TEXT FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'recotizaciones');
INSERT INTO _r SELECT 13, 'service_role policy plus own-org SELECT for authenticated, nothing else', '1|1|0',
  (SELECT count(*) FILTER (WHERE policyname = 'recotizaciones_all_service' AND 'service_role' = ANY (roles))::TEXT || '|' ||
          count(*) FILTER (WHERE policyname = 'recotizaciones_select' AND cmd = 'SELECT' AND roles = '{authenticated}'
                             AND qual LIKE '%get_current_organization_id()%')::TEXT || '|' ||
          count(*) FILTER (WHERE policyname NOT IN ('recotizaciones_all_service', 'recotizaciones_select'))::TEXT
     FROM pg_policies WHERE schemaname = 'public' AND tablename = 'recotizaciones');
INSERT INTO _r SELECT 14, 'anon holds no privilege; authenticated holds SELECT only', 'false|true|false',
  has_table_privilege('anon', 'public.recotizaciones', 'SELECT,INSERT,UPDATE,DELETE')::TEXT || '|' ||
  has_table_privilege('authenticated', 'public.recotizaciones', 'SELECT')::TEXT || '|' ||
  has_table_privilege('authenticated', 'public.recotizaciones', 'INSERT,UPDATE,DELETE')::TEXT;
INSERT INTO _r SELECT 15, 'document lookup index exists', '1',
  (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'recotizaciones'
      AND indexname = 'recotizaciones_documento_idx')::TEXT;

-- ROLLBACK REHEARSAL (last: ACCESS EXCLUSIVE until the final ROLLBACK).
CREATE TEMP TABLE _antes AS SELECT (SELECT count(*) FROM cotizaciones) AS cotiz;
-- ROLLBACK:BEGIN
SET LOCAL lock_timeout = '3s';

DROP TABLE IF EXISTS recotizaciones;

ALTER TABLE cotizaciones
  DROP COLUMN IF EXISTS tipo_cambio_en,
  DROP COLUMN IF EXISTS tipo_cambio_fuente;
-- ROLLBACK:END
INSERT INTO _r SELECT 80, 'rehearsal: the new table and columns are gone', '0',
  ((SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'recotizaciones') +
   (SELECT count(*) FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'cotizaciones'
       AND column_name IN ('tipo_cambio_fuente', 'tipo_cambio_en')))::TEXT;
INSERT INTO _r SELECT 81, 'rehearsal: no quote row was lost and tipo_cambio survives', a.cotiz::TEXT || '|1',
  (SELECT count(*) FROM cotizaciones)::TEXT || '|' ||
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cotizaciones' AND column_name = 'tipo_cambio')::TEXT
  FROM _antes a;

SELECT orden, probe, esperado, obtenido FROM _r ORDER BY orden, probe;

ROLLBACK;
