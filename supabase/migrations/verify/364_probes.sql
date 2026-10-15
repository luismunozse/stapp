-- Verification of orden_formato_papel: organizations.orden_formato_papel.
--
-- Run AFTER the migration is applied:  node scripts/db-run.mjs <this file>
-- (no --apply: the file opens its own transaction and always ends in ROLLBACK).
-- Without RLS, as in verify/README.md. The only data it creates is one scratch organization
-- ('probe-ofp-org'), rolled back with everything else. The rollback rehearsal at the end takes
-- ACCESS EXCLUSIVE on `organizations` until that ROLLBACK, which is why it runs last.
--
-- Results accumulate in _r and come out in ONE select. Green = esperado equals obtenido, or
-- obtenido starts with 'OK:' for the probes that expect an error.
--
-- Run it right after applying, before the Configuracion selector ships: probe 14 expects NO
-- organization to be on a small size yet. Once admins can pick A5/A6, a non-zero number there
-- is simply how many did, not a failure of the migration.
--
-- Every probe can fail on its own: a missing column makes the shape probe read MISSING and the
-- error probes return 42703; a column without NOT NULL makes the NULL write succeed; a column
-- without the CHECK lets 'A3' in; a column with another default makes the shape probe and the
-- scratch-organization probe disagree. The count probes cannot pass vacuously: probe 13 records
-- that real organizations exist.

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

-- Scratch organization created WITHOUT naming the column: its value is the column DEFAULT.
INSERT INTO organizations (nombre, slug) VALUES ('Probe OFP Org', 'probe-ofp-org');

-- 10-12: the column exists once, in organizations, with the intended shape and a comment.
INSERT INTO _r SELECT 10, 'column is TEXT NOT NULL DEFAULT ''A4''', 'text|NO|''A4''::text',
  COALESCE((SELECT data_type || '|' || is_nullable || '|' || column_default
              FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'organizations'
               AND column_name = 'orden_formato_papel'), 'MISSING');
INSERT INTO _r SELECT 11, 'no other table or view carries a column with that name', '0',
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'orden_formato_papel'
      AND table_name <> 'organizations')::TEXT;
INSERT INTO _r SELECT 12, 'column has a real comment', 'true',
  COALESCE((SELECT length(col_description(a.attrelid, a.attnum)) > 40
              FROM pg_attribute a
             WHERE a.attrelid = 'public.organizations'::regclass
               AND a.attname = 'orden_formato_papel' AND NOT a.attisdropped), false)::TEXT;

-- 13-15: the DEFAULT. 13 guards 14 against passing on an empty table.
INSERT INTO _r SELECT 13, 'real organizations exist (so probe 14 is not vacuous)', 'true',
  (SELECT count(*) > 0 FROM organizations WHERE slug NOT LIKE 'probe-ofp-%')::TEXT;
INSERT INTO _r SELECT 14, 'every existing organization reads A4 (nobody is on a small size yet)', '0',
  (SELECT count(*) FROM organizations
    WHERE slug NOT LIKE 'probe-ofp-%' AND orden_formato_papel IS DISTINCT FROM 'A4')::TEXT;
INSERT INTO _r SELECT 15, 'a new organization inserted without the column reads A4', 'A4',
  COALESCE((SELECT orden_formato_papel FROM organizations WHERE slug = 'probe-ofp-org'), 'MISSING');

-- 16-17: NOT NULL and the CHECK are enforced.
DO $$ BEGIN
  PERFORM pg_temp.probe(16, 'writing NULL is refused', '23502',
    'UPDATE organizations SET orden_formato_papel = NULL WHERE slug = ''probe-ofp-org''');
  PERFORM pg_temp.probe(17, 'writing a size that is not A4/A5/A6 is refused', '23514',
    'UPDATE organizations SET orden_formato_papel = ''A3'' WHERE slug = ''probe-ofp-org''');
  PERFORM pg_temp.probe(18, 'lowercase is refused too (the app normalizes before it writes)', '23514',
    'UPDATE organizations SET orden_formato_papel = ''a6'' WHERE slug = ''probe-ofp-org''');
END $$;

-- 19-21: an organization can pick each size and the value sticks.
UPDATE organizations SET orden_formato_papel = 'A6' WHERE slug = 'probe-ofp-org';
INSERT INTO _r SELECT 19, 'set to A6, the scratch organization reads A6', 'A6',
  COALESCE((SELECT orden_formato_papel FROM organizations WHERE slug = 'probe-ofp-org'), 'MISSING');
UPDATE organizations SET orden_formato_papel = 'A5' WHERE slug = 'probe-ofp-org';
INSERT INTO _r SELECT 20, 'set to A5, the scratch organization reads A5', 'A5',
  COALESCE((SELECT orden_formato_papel FROM organizations WHERE slug = 'probe-ofp-org'), 'MISSING');
UPDATE organizations SET orden_formato_papel = 'A4' WHERE slug = 'probe-ofp-org';
INSERT INTO _r SELECT 21, 'back to A4, the scratch organization reads A4', 'A4',
  COALESCE((SELECT orden_formato_papel FROM organizations WHERE slug = 'probe-ofp-org'), 'MISSING');

-- 22: the sibling setting this one stacks on in the configuration cascades is still there.
INSERT INTO _r SELECT 22, 'sibling setting pos_agrupa_variantes still BOOLEAN NOT NULL DEFAULT true', 'boolean|NO|true',
  COALESCE((SELECT data_type || '|' || is_nullable || '|' || column_default
              FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'organizations'
               AND column_name = 'pos_agrupa_variantes'), 'MISSING');

-- ROLLBACK REHEARSAL. Capture what must survive, run the rollback inline (verbatim), check.
CREATE TEMP TABLE _antes AS
  SELECT (SELECT count(*) FROM organizations) AS orgs,
         (SELECT count(*) FROM organizations WHERE pos_agrupa_variantes IS NOT TRUE) AS sibling_off;
-- ROLLBACK:BEGIN
SET LOCAL lock_timeout = '3s';

ALTER TABLE organizations
  DROP COLUMN IF EXISTS orden_formato_papel;
-- ROLLBACK:END
INSERT INTO _r SELECT 80, 'rehearsal: the column is gone', 'true',
  (NOT EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'organizations'
                  AND column_name = 'orden_formato_papel'))::TEXT;
INSERT INTO _r SELECT 81, 'rehearsal: no organization was lost (scratch one included)', a.orgs::TEXT,
  (SELECT count(*) FROM organizations)::TEXT FROM _antes a;
INSERT INTO _r SELECT 82, 'rehearsal: the sibling setting is untouched', a.sibling_off::TEXT,
  (SELECT count(*) FROM organizations WHERE pos_agrupa_variantes IS NOT TRUE)::TEXT FROM _antes a;

SELECT orden, probe, esperado, obtenido FROM _r ORDER BY orden, probe;

ROLLBACK;
