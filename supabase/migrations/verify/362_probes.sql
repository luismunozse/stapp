-- Verification of M3 (variantes-inventario-venta): organizations.pos_agrupa_variantes.
--
-- Run AFTER M3 is applied:  node scripts/db-run.mjs <this file>
-- (no --apply: the file opens its own transaction and always ends in ROLLBACK).
-- Without RLS, as in verify/README.md. The only data it creates is one scratch organization
-- ('probe-m3-org'), rolled back with everything else. The rollback rehearsal at the end takes
-- ACCESS EXCLUSIVE on `organizations` until that ROLLBACK, which is why it runs last.
--
-- Results accumulate in _r and come out in ONE select. Green = esperado equals obtenido, or
-- obtenido starts with 'OK:' for the probe that expects an error.
--
-- Run it right after applying, before the POS toggle ships: probe 14 expects NO organization
-- to be off yet. Once admins can turn the preference off, a non-zero number there is simply
-- how many did, not a failure of M3.
--
-- Every probe can fail on its own: a missing column makes the shape probe read MISSING and the
-- error probe return 42703; a column without NOT NULL makes the NULL write succeed; a column
-- with another default makes the shape probe and the scratch-organization probe disagree.
-- The count probes cannot pass vacuously: probe 13 records that real organizations exist.
-- Checked on a local Postgres 16 engine (PGlite), including a mutation sweep (nullable column,
-- default false, column added to a second table, no comment, rollback that drops nothing).
-- Nothing was written to production: the first real run is after M3 is applied.

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
INSERT INTO organizations (nombre, slug) VALUES ('Probe M3 Org', 'probe-m3-org');

-- 10-12: the column exists once, in organizations, with the intended shape and a comment.
INSERT INTO _r SELECT 10, 'column is BOOLEAN NOT NULL DEFAULT true', 'boolean|NO|true',
  COALESCE((SELECT data_type || '|' || is_nullable || '|' || column_default
              FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'organizations'
               AND column_name = 'pos_agrupa_variantes'), 'MISSING');
INSERT INTO _r SELECT 11, 'no other table or view carries a column with that name', '0',
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'pos_agrupa_variantes'
      AND table_name <> 'organizations')::TEXT;
INSERT INTO _r SELECT 12, 'column has a real comment', 'true',
  COALESCE((SELECT length(col_description(a.attrelid, a.attnum)) > 40
              FROM pg_attribute a
             WHERE a.attrelid = 'public.organizations'::regclass
               AND a.attname = 'pos_agrupa_variantes' AND NOT a.attisdropped), false)::TEXT;

-- 13-15: the DEFAULT. 13 guards 14 against passing on an empty table.
INSERT INTO _r SELECT 13, 'real organizations exist (so probe 14 is not vacuous)', 'true',
  (SELECT count(*) > 0 FROM organizations WHERE slug NOT LIKE 'probe-m3-%')::TEXT;
INSERT INTO _r SELECT 14, 'every existing organization reads true (nobody is off yet)', '0',
  (SELECT count(*) FROM organizations
    WHERE slug NOT LIKE 'probe-m3-%' AND pos_agrupa_variantes IS NOT TRUE)::TEXT;
INSERT INTO _r SELECT 15, 'a new organization inserted without the column reads true', 'true',
  COALESCE((SELECT pos_agrupa_variantes::TEXT FROM organizations WHERE slug = 'probe-m3-org'), 'MISSING');

-- 16: NOT NULL is enforced (a NULL write is refused with not_null_violation).
DO $$ BEGIN
  PERFORM pg_temp.probe(16, 'writing NULL is refused', '23502',
    'UPDATE organizations SET pos_agrupa_variantes = NULL WHERE slug = ''probe-m3-org''');
END $$;

-- 17-18: an organization can turn it off and back on, and the value sticks.
UPDATE organizations SET pos_agrupa_variantes = false WHERE slug = 'probe-m3-org';
INSERT INTO _r SELECT 17, 'turned off, the scratch organization reads false', 'false',
  COALESCE((SELECT pos_agrupa_variantes::TEXT FROM organizations WHERE slug = 'probe-m3-org'), 'MISSING');
UPDATE organizations SET pos_agrupa_variantes = true WHERE slug = 'probe-m3-org';
INSERT INTO _r SELECT 18, 'turned back on, the scratch organization reads true', 'true',
  COALESCE((SELECT pos_agrupa_variantes::TEXT FROM organizations WHERE slug = 'probe-m3-org'), 'MISSING');

-- 19: the sibling setting this one stacks on in the configuration cascades is still there.
INSERT INTO _r SELECT 19, 'sibling setting vendedores_ven_ingresos still BOOLEAN NOT NULL DEFAULT true', 'boolean|NO|true',
  COALESCE((SELECT data_type || '|' || is_nullable || '|' || column_default
              FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'organizations'
               AND column_name = 'vendedores_ven_ingresos'), 'MISSING');

-- ROLLBACK REHEARSAL. Capture what must survive, run the rollback inline (verbatim), check.
CREATE TEMP TABLE _antes AS
  SELECT (SELECT count(*) FROM organizations) AS orgs,
         (SELECT count(*) FROM organizations WHERE vendedores_ven_ingresos IS NOT TRUE) AS sibling_off;
-- ROLLBACK:BEGIN
SET LOCAL lock_timeout = '3s';

ALTER TABLE organizations
  DROP COLUMN IF EXISTS pos_agrupa_variantes;
-- ROLLBACK:END
INSERT INTO _r SELECT 80, 'rehearsal: the column is gone', 'true',
  (NOT EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'organizations'
                  AND column_name = 'pos_agrupa_variantes'))::TEXT;
INSERT INTO _r SELECT 81, 'rehearsal: no organization was lost (scratch one included)', a.orgs::TEXT,
  (SELECT count(*) FROM organizations)::TEXT FROM _antes a;
INSERT INTO _r SELECT 82, 'rehearsal: the sibling setting is untouched', a.sibling_off::TEXT,
  (SELECT count(*) FROM organizations WHERE vendedores_ven_ingresos IS NOT TRUE)::TEXT FROM _antes a;

SELECT orden, probe, esperado, obtenido FROM _r ORDER BY orden, probe;

ROLLBACK;
