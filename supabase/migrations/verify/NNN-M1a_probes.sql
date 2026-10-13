-- Verification of M1a (variantes-inventario-venta): variant groups.
--
-- Run AFTER M1a is applied, off-peak:  node scripts/db-run.mjs <this file>
-- (no --apply: the file opens its own transaction and always ends in ROLLBACK).
-- Without RLS, as in verify/README.md. Everything is scratch data (orgs 'probe-m1a-org' and
-- 'probe-m1a-other') and is rolled back. The rollback rehearsal at the end takes ACCESS
-- EXCLUSIVE on `inventario` until that ROLLBACK, which is why it runs last.
--
-- Results accumulate in _r and come out in ONE select. Green = esperado equals obtenido,
-- or obtenido starts with 'OK:' for the probes that expect an error.
-- Checked on a local Postgres 16 engine, with the org purge run under BOTH orders of the
-- RI cascade triggers; its DML was also dry-run on production without the new objects.
-- Still to run for real: after M1a is applied.

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

-- ["Rojo","M"] -> [{"opcion":"Opcion1","valor":"Rojo"},{"opcion":"Opcion2","valor":"M"}]
CREATE FUNCTION pg_temp.attrs(p_valores JSONB) RETURNS JSONB LANGUAGE sql AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('opcion', 'Opcion' || o, 'valor', v) ORDER BY o), '[]'::jsonb)
    FROM jsonb_array_elements_text(p_valores) WITH ORDINALITY AS t(v, o)
$$;

-- Scratch org with a group of 3 children: Rojo (stock 7), Azul (stock 3), Verde (archived).
CREATE TEMP TABLE _s (org TEXT, grupo TEXT, rojo TEXT, azul TEXT, verde TEXT);
DO $$
DECLARE v_org TEXT; v_g TEXT; v_ro TEXT; v_az TEXT; v_ve TEXT;
BEGIN
  INSERT INTO organizations (nombre, slug) VALUES ('Probe M1a Org', 'probe-m1a-org') RETURNING id INTO v_org;
  INSERT INTO inventario_grupos (organization_id, nombre, opciones)
    VALUES (v_org, 'Probe Funda', '[{"nombre":"Color","valores":["Rojo","Azul","Verde"]}]') RETURNING id INTO v_g;
  INSERT INTO inventario (organization_id, codigo, nombre, categoria, precio_compra, precio_venta, stock, grupo_id, atributos)
    VALUES (v_org, 'PRB-RO', 'Probe Funda - Rojo', 'Fundas', 100, 200, 7, v_g, '[{"opcion":"Color","valor":"Rojo"}]') RETURNING id INTO v_ro;
  INSERT INTO inventario (organization_id, codigo, nombre, categoria, precio_compra, precio_venta, stock, grupo_id, atributos)
    VALUES (v_org, 'PRB-AZ', 'Probe Funda - Azul', 'Fundas', 100, 200, 3, v_g, '[{"opcion":"Color","valor":"Azul"}]') RETURNING id INTO v_az;
  INSERT INTO inventario (organization_id, codigo, nombre, categoria, precio_compra, precio_venta, stock, grupo_id, atributos, deleted_at)
    VALUES (v_org, 'PRB-VE', 'Probe Funda - Verde', 'Fundas', 100, 200, 1, v_g, '[{"opcion":"Color","valor":"Verde"}]', NOW()) RETURNING id INTO v_ve;
  INSERT INTO _s VALUES (v_org, v_g, v_ro, v_az, v_ve);
END $$;

-- Second scratch org with its own group and one child, all inserted in THIS transaction (the
-- worst case for FK rechecks). It is the target of the cross-org, isolation and purge probes.
CREATE TEMP TABLE _o (org TEXT, grupo TEXT, hijo TEXT);
DO $$
DECLARE v_org TEXT; v_g TEXT; v_h TEXT;
BEGIN
  INSERT INTO organizations (nombre, slug) VALUES ('Probe M1a Other', 'probe-m1a-other') RETURNING id INTO v_org;
  INSERT INTO inventario_grupos (organization_id, nombre, opciones)
    VALUES (v_org, 'Probe Other', '[{"nombre":"Color","valores":["Rojo"]}]') RETURNING id INTO v_g;
  INSERT INTO inventario (organization_id, codigo, nombre, categoria, precio_compra, precio_venta, grupo_id, atributos)
    VALUES (v_org, 'PRB-OT', 'Probe Other - Rojo', 'OtherCat', 1, 1, v_g, '[{"opcion":"Color","valor":"Rojo"}]') RETURNING id INTO v_h;
  INSERT INTO _o VALUES (v_org, v_g, v_h);
END $$;

-- PROBE 0: objects, privileges and the trigger definition.
INSERT INTO _r SELECT 0, k, 'true', v FROM (VALUES
  ('table inventario_grupos exists', (to_regclass('public.inventario_grupos') IS NOT NULL)::TEXT),
  ('inventario.grupo_id and atributos exist',
    (SELECT (count(*) = 2)::TEXT FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'inventario' AND column_name IN ('grupo_id', 'atributos'))),
  ('key, validity, name and both trigger functions exist',
    (SELECT (count(*) = 5)::TEXT FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN
      ('inventario_combinacion_clave', 'inventario_atributos_validos', 'inventario_nombre_variante',
       'inventario_sync_compartidos_grupo', 'inventario_grupos_limpiar_atributos'))),
  ('key, validity and name functions are IMMUTABLE',
    (SELECT (count(*) = 3 AND bool_and(provolatile = 'i'))::TEXT FROM pg_proc
      WHERE pronamespace = 'public'::regnamespace AND proname IN
        ('inventario_combinacion_clave', 'inventario_atributos_validos', 'inventario_nombre_variante'))),
  ('sync, ungroup and updated_at triggers exist',
    (SELECT (count(*) = 3)::TEXT FROM pg_trigger WHERE NOT tgisinternal AND tgname IN
      ('inventario_sync_compartidos_grupo', 'inventario_grupos_before_delete', 'inventario_grupos_updated_at'))),
  ('unique active-combination index and grupo index exist',
    (SELECT (count(*) = 2)::TEXT FROM pg_indexes WHERE indexname IN
      ('inventario_grupo_combinacion_activa_uniq', 'inventario_grupo_idx'))),
  ('kit check, atributos check and group FK exist',
    (SELECT (count(*) = 3)::TEXT FROM pg_constraint WHERE conrelid = 'public.inventario'::regclass AND conname IN
      ('inventario_grupo_no_kit', 'inventario_grupo_atributos', 'inventario_grupo_id_fkey'))),
  ('group FK is composite (organization_id, grupo_id) and nulls only grupo_id',
    (SELECT (pg_get_constraintdef(oid) ~ 'FOREIGN KEY \(organization_id, grupo_id\).*ON DELETE SET NULL \(grupo_id\)')::TEXT
       FROM pg_constraint WHERE conname = 'inventario_grupo_id_fkey' AND conrelid = 'public.inventario'::regclass)),
  ('RLS is on with 2 policies',
    ((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.inventario_grupos'::regclass)
      AND (SELECT count(*) = 2 FROM pg_policies WHERE tablename = 'inventario_grupos'))::TEXT),
  ('anon has no access', (NOT has_table_privilege('anon', 'public.inventario_grupos', 'SELECT,INSERT,UPDATE,DELETE'))::TEXT),
  ('sync trigger names no image column',
    (SELECT (pg_get_triggerdef(oid) !~ 'imagen_')::TEXT FROM pg_trigger WHERE tgname = 'inventario_sync_compartidos_grupo'))
) AS t(k, v);

-- PROBE 1: key and name vectors, shared with __tests__/helpers/variantes-vectores.ts.
-- The tab, newline and NBSP rows pin that the SQL trim matches String.prototype.trim().
-- VECTORS:BEGIN
CREATE TEMP TABLE _v_clave (n INT, a JSONB, b JSONB, igual BOOLEAN);
INSERT INTO _v_clave VALUES
  (1, '["Rojo"]', '["rojo"]', true),
  (2, '["Rojo"]', '["Rojó"]', true),
  (3, '["Rojo"]', '["ROJÓ"]', true),
  (4, '["ROJÓ"]', '["rojo"]', true),
  (5, '[" Rojo "]', '["rojo"]', true),
  (6, '["\tRojo\n"]', '["rojo"]', true),
  (7, '["\u00a0Rojo\u00a0"]', '["rojo"]', true),
  (8, '["Rojo","M"]', '["rojó","m"]', true),
  (9, '["Ñandú"]', '["ñandu"]', true),
  (10, '["ÑANDÚ"]', '["ñandu"]', true),
  (11, '["Año"]', '["Ano"]', false),
  (12, '["Rojo"]', '["Rosado"]', false),
  (13, '["Rojo","M"]', '["M","Rojo"]', false),
  (14, '["a b"]', '["a","b"]', false);
CREATE TEMP TABLE _v_nombre (n INT, base TEXT, valores JSONB, esperado TEXT);
INSERT INTO _v_nombre VALUES
  (1, 'Funda X', '["Azul","M"]', 'Funda X - Azul / M'),
  (2, 'Funda X', '["Azul"]', 'Funda X - Azul'),
  (3, 'Funda X', '["Azul","M","2"]', 'Funda X - Azul / M / 2'),
  (4, 'Funda - X', '["Azul","M"]', 'Funda - X - Azul / M'),
  (5, 'Cámara', '["Rojó"]', 'Cámara - Rojó'),
  (6, 'Funda X', '[]', 'Funda X');
-- VECTORS:END
INSERT INTO _r SELECT 10, 'key vector ' || n || ': ' || a || ' vs ' || b, igual::TEXT,
  (inventario_combinacion_clave(pg_temp.attrs(a)) = inventario_combinacion_clave(pg_temp.attrs(b)))::TEXT FROM _v_clave;
INSERT INTO _r SELECT 11, 'name vector ' || n || ': ' || base || ' ' || valores, esperado,
  COALESCE(inventario_nombre_variante(base, pg_temp.attrs(valores)), 'NULL') FROM _v_nombre;

-- PROBE 2: shared fields fan out to siblings, archived ones included; per-variant fields do not.
-- The group of the other org keeps its own value, and with the GUC 'on' (what the save RPC
-- sets) nothing fans out.
UPDATE inventario SET categoria = 'ProbeCat' WHERE id = (SELECT rojo FROM _s);
INSERT INTO _r SELECT 20, 'categoria on Rojo reaches Azul', 'ProbeCat', categoria FROM inventario WHERE id = (SELECT azul FROM _s);
INSERT INTO _r SELECT 21, 'categoria on Rojo reaches the archived Verde', 'ProbeCat', categoria FROM inventario WHERE id = (SELECT verde FROM _s);
UPDATE inventario SET precio_venta = 999 WHERE id = (SELECT rojo FROM _s);
INSERT INTO _r SELECT 22, 'price on Rojo does not reach Azul', 'true', (precio_venta = 200)::TEXT FROM inventario WHERE id = (SELECT azul FROM _s);
INSERT INTO _r SELECT 24, 'fan-out does not leave its group (the group of another org keeps its categoria)', 'OtherCat',
  categoria FROM inventario WHERE id = (SELECT hijo FROM _o);
DO $$
BEGIN
  PERFORM set_config('stapp.sync_grupo', 'on', true);
  UPDATE inventario SET categoria = 'GucCat' WHERE id = (SELECT rojo FROM _s);
  INSERT INTO _r SELECT 23, 'GUC on: the fan-out is suppressed (Azul keeps ProbeCat)', 'ProbeCat', categoria
    FROM inventario WHERE id = (SELECT azul FROM _s);
  UPDATE inventario SET categoria = 'ProbeCat' WHERE id = (SELECT rojo FROM _s); -- restore, still without fan-out
  PERFORM set_config('stapp.sync_grupo', 'off', true);
END $$;

-- PROBE 3 (PI-6): a photo on Rojo mirrors onto Rojo only; Azul keeps no image reference.
INSERT INTO inventario_imagenes (inventario_id, url, path, orden, es_principal, organization_id)
  SELECT rojo, 'https://probe.invalid/rojo.jpg', 'probe/rojo.jpg', 0, true, org FROM _s;
INSERT INTO _r SELECT 30, 'trigger 173 mirrors the photo onto Rojo', 'https://probe.invalid/rojo.jpg', imagen_url FROM inventario WHERE id = (SELECT rojo FROM _s);
INSERT INTO _r SELECT 31, 'Azul imagen_url and imagen_path stay NULL', 'true', (imagen_url IS NULL AND imagen_path IS NULL)::TEXT FROM inventario WHERE id = (SELECT azul FROM _s);
INSERT INTO inventario_imagenes (inventario_id, url, path, orden, es_principal, organization_id)
  SELECT azul, 'https://probe.invalid/azul.jpg', 'probe/azul.jpg', 0, true, org FROM _s;

-- PROBES 4-5: unique active combination, archived rows do not block, kits cannot be children.
DO $$ BEGIN
  PERFORM pg_temp.probe(40, 'active duplicate combination (Rojo vs rojó) is rejected', '23505',
    $q$INSERT INTO inventario (organization_id, codigo, nombre, categoria, precio_compra, precio_venta, grupo_id, atributos)
       SELECT org, 'PRB-RO2', 'dup', 'Fundas', 1, 1, grupo, '[{"opcion":"Color","valor":"rojó"}]' FROM _s$q$);
  PERFORM pg_temp.probe(41, 'an ARCHIVED combination does not block a new active row', 'ok',
    $q$INSERT INTO inventario (organization_id, codigo, nombre, categoria, precio_compra, precio_venta, grupo_id, atributos)
       SELECT org, 'PRB-VE2', 'again', 'Fundas', 1, 1, grupo, '[{"opcion":"Color","valor":"VERDE"}]' FROM _s$q$);
  PERFORM pg_temp.probe(50, 'a grouped row cannot become a kit', '23514',
    'UPDATE inventario SET es_kit = true WHERE id = (SELECT azul FROM _s)');
  PERFORM pg_temp.probe(51, 'a kit cannot be inserted into a group', '23514',
    $q$INSERT INTO inventario (organization_id, codigo, nombre, categoria, precio_compra, precio_venta, es_kit, grupo_id, atributos)
       SELECT org, 'PRB-KIT', 'kit', 'Fundas', 1, 1, true, grupo, '[{"opcion":"Color","valor":"Negro"}]' FROM _s$q$);
END $$;

-- PROBE 4b: shapes of atributos the database must refuse, so that no combination lacks a real
-- key (a NULL key would slip past the unique index) and grupo_id/atributos always travel together.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    (1, 'a grouped row with atributos NULL', NULL),
    (2, 'an empty array', '[]'),
    (3, 'an object instead of an array', '{"valor":"Rojo"}'),
    (4, 'an element without valor', '[{"opcion":"Color"}]'),
    (5, 'a valor that is not a string', '[{"opcion":"Color","valor":1}]'),
    (6, 'a blank valor (space, tab, NBSP)', '[{"opcion":"Color","valor":" \t\u00a0 "}]'),
    (7, 'a valor holding the key separator', '[{"opcion":"Color","valor":"a\u001fb"}]'),
    (8, 'a valid element plus one without valor', '[{"opcion":"Color","valor":"Rojo"},{"opcion":"Talle"}]')
  ) AS t(n, k, a) LOOP
    -- a distinct code per row: a wrongly accepted row must not hide the next one behind a code clash
    PERFORM pg_temp.probe(42, 'invalid atributos refused: ' || r.k, '23514',
      format($q$INSERT INTO inventario (organization_id, codigo, nombre, categoria, precio_compra, precio_venta, grupo_id, atributos)
                SELECT org, 'PRB-BAD%s', 'bad', 'Fundas', 1, 1, grupo, %L::jsonb FROM _s$q$, r.n, r.a));
  END LOOP;
  PERFORM pg_temp.probe(42, 'invalid atributos refused: an ungrouped row carrying atributos', '23514',
    $q$INSERT INTO inventario (organization_id, codigo, nombre, categoria, precio_compra, precio_venta, atributos)
       SELECT org, 'PRB-BAD0', 'bad', 'Fundas', 1, 1, '[{"opcion":"Color","valor":"Rojo"}]' FROM _s$q$);
  PERFORM pg_temp.probe(43, 'a child cannot join a group of another org', '23503',
    $q$INSERT INTO inventario (organization_id, codigo, nombre, categoria, precio_compra, precio_venta, grupo_id, atributos)
       SELECT _s.org, 'PRB-XO', 'x', 'Fundas', 1, 1, _o.grupo, '[{"opcion":"Color","valor":"Cruzado"}]' FROM _s, _o$q$);
END $$;

-- PROBE 5b (VG-7): a bulk UPDATE that gives every row a DIFFERENT value still leaves the
-- siblings identical (the last row processed wins for the whole group), and the GUC is back
-- to 'off' afterwards.
DO $$
DECLARE v_org TEXT; v_g TEXT; v_ids TEXT[];
BEGIN
  SELECT org INTO v_org FROM _s;
  INSERT INTO inventario_grupos (organization_id, nombre, opciones)
    VALUES (v_org, 'Probe Bulk', '[{"nombre":"Talle","valores":["S","M","L"]}]') RETURNING id INTO v_g;
  WITH ins AS (
    INSERT INTO inventario (organization_id, codigo, nombre, categoria, precio_compra, precio_venta, grupo_id, atributos)
    VALUES (v_org, 'PRB-B1', 'b1', 'Fundas', 1, 1, v_g, '[{"opcion":"Talle","valor":"S"}]'),
           (v_org, 'PRB-B2', 'b2', 'Fundas', 1, 1, v_g, '[{"opcion":"Talle","valor":"M"}]'),
           (v_org, 'PRB-B3', 'b3', 'Fundas', 1, 1, v_g, '[{"opcion":"Talle","valor":"L"}]')
    RETURNING id)
  SELECT array_agg(id) INTO v_ids FROM ins;
  UPDATE inventario SET categoria = 'Bulk-' || codigo, proveedor = 'Prov-' || codigo WHERE id = ANY (v_ids);
  INSERT INTO _r SELECT 25, 'bulk UPDATE with divergent values leaves identical siblings', '1',
    count(DISTINCT (categoria, proveedor))::TEXT FROM inventario WHERE id = ANY (v_ids);
  INSERT INTO _r VALUES (26, 'GUC is back to off after a fan-out', 'off', current_setting('stapp.sync_grupo', true));
END $$;

-- PROBE 6 (VG-10): deleting the group ungroups its children: grupo_id AND atributos NULL,
-- nothing archived, the archived child stays archived.
DO $$
DECLARE v_org TEXT; v_g TEXT; v_ids TEXT[];
BEGIN
  SELECT org INTO v_org FROM _s;
  INSERT INTO inventario_grupos (organization_id, nombre, opciones)
    VALUES (v_org, 'Probe Ungroup', '[{"nombre":"Talle","valores":["S","M","L"]}]') RETURNING id INTO v_g;
  WITH ins AS (
    INSERT INTO inventario (organization_id, codigo, nombre, categoria, precio_compra, precio_venta, grupo_id, atributos, deleted_at)
    VALUES (v_org, 'PRB-U1', 'u1', 'Fundas', 1, 1, v_g, '[{"opcion":"Talle","valor":"S"}]', NULL),
           (v_org, 'PRB-U2', 'u2', 'Fundas', 1, 1, v_g, '[{"opcion":"Talle","valor":"M"}]', NULL),
           (v_org, 'PRB-U3', 'u3', 'Fundas', 1, 1, v_g, '[{"opcion":"Talle","valor":"L"}]', NOW())
    RETURNING id)
  SELECT array_agg(id) INTO v_ids FROM ins;
  DELETE FROM inventario_grupos WHERE id = v_g;
  INSERT INTO _r SELECT 60, 'ungroup: the 3 children still exist', '3', count(*)::TEXT FROM inventario WHERE id = ANY (v_ids);
  INSERT INTO _r SELECT 61, 'ungroup: grupo_id and atributos are both NULL', '3',
    count(*)::TEXT FROM inventario WHERE id = ANY (v_ids) AND grupo_id IS NULL AND atributos IS NULL;
  INSERT INTO _r SELECT 62, 'ungroup: nothing archived (2 active, 1 still archived)', '2/1',
    (count(*) FILTER (WHERE deleted_at IS NULL))::TEXT || '/' || (count(*) FILTER (WHERE deleted_at IS NOT NULL))::TEXT
    FROM inventario WHERE id = ANY (v_ids);
END $$;

-- PROBE 7 (VI-3): purging an organization removes its groups and children with no FK
-- ordering error. The org owns a group and a child created in this very transaction, the
-- worst case for FK rechecks against the deleted org.
DO $$
DECLARE v_org TEXT;
BEGIN
  SELECT org INTO v_org FROM _o;
  PERFORM pg_temp.probe(70, 'DELETE FROM organizations succeeds with a group and a child', 'ok',
    format('DELETE FROM organizations WHERE id = %L', v_org));
  INSERT INTO _r SELECT 71, 'purge leaves no group and no child behind', '0/0',
    (SELECT count(*) FROM inventario_grupos WHERE organization_id = v_org)::TEXT || '/' ||
    (SELECT count(*) FROM inventario WHERE organization_id = v_org)::TEXT;
END $$;

-- ROLLBACK REHEARSAL (VG-17). Capture the children, give Rojo a sale line, run the rollback
-- inline, then check that the children, their names, stock, sale line, photo and gallery survive.
CREATE TEMP TABLE _antes AS
  SELECT i.id, i.nombre, i.stock, i.imagen_url, i.imagen_path, i.deleted_at IS NULL AS activo,
         (SELECT count(*) FROM inventario_imagenes ii WHERE ii.inventario_id = i.id) AS galeria
    FROM inventario i WHERE i.id IN (SELECT rojo FROM _s UNION SELECT azul FROM _s UNION SELECT verde FROM _s);
DO $$
DECLARE v_user TEXT; v_suc TEXT; v_venta TEXT;
BEGIN
  SELECT id INTO v_user FROM users LIMIT 1;
  IF v_user IS NULL THEN
    INSERT INTO _r VALUES (89, 'rehearsal sale line', 'skipped', 'skipped: no user exists to be the seller');
    RETURN;
  END IF;
  INSERT INTO sucursales (organization_id, nombre) SELECT org, 'Probe M1a Sucursal' FROM _s RETURNING id INTO v_suc;
  INSERT INTO ventas (numero_venta, cliente_nombre, vendedor_id, subtotal, total, metodo_pago, organization_id, sucursal_id)
    SELECT 1, 'Probe', v_user, 200, 200, 'EFECTIVO', org, v_suc FROM _s RETURNING id INTO v_venta;
  INSERT INTO items_venta (venta_id, inventario_id, descripcion, cantidad, precio_unitario, subtotal)
    SELECT v_venta, rojo, 'Probe Funda - Rojo', 1, 200, 200 FROM _s;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES (89, 'rehearsal sale line', 'skipped', 'skipped: ' || SQLERRM);
END $$;
-- ROLLBACK:BEGIN
SET LOCAL lock_timeout = '3s';

DROP TRIGGER IF EXISTS inventario_sync_compartidos_grupo ON inventario;
DROP TRIGGER IF EXISTS inventario_grupos_before_delete ON inventario_grupos;
DROP FUNCTION IF EXISTS inventario_sync_compartidos_grupo();
DROP FUNCTION IF EXISTS inventario_grupos_limpiar_atributos();
DROP INDEX IF EXISTS inventario_grupo_combinacion_activa_uniq;
DROP INDEX IF EXISTS inventario_grupo_idx;

ALTER TABLE inventario
  DROP CONSTRAINT IF EXISTS inventario_grupo_atributos,
  DROP CONSTRAINT IF EXISTS inventario_grupo_no_kit,
  DROP CONSTRAINT IF EXISTS inventario_grupo_id_fkey,
  DROP COLUMN IF EXISTS grupo_id,
  DROP COLUMN IF EXISTS atributos;

DROP FUNCTION IF EXISTS inventario_atributos_validos(JSONB);
DROP FUNCTION IF EXISTS inventario_combinacion_clave(JSONB);
DROP FUNCTION IF EXISTS inventario_nombre_variante(TEXT, JSONB);

DROP TABLE IF EXISTS inventario_grupos;
-- ROLLBACK:END
INSERT INTO _r SELECT 80, 'rehearsal: group table, both columns and all 5 functions are gone', 'true',
  (to_regclass('public.inventario_grupos') IS NULL
    AND NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'inventario' AND column_name IN ('grupo_id', 'atributos'))
    AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN
      ('inventario_combinacion_clave', 'inventario_atributos_validos', 'inventario_nombre_variante',
       'inventario_sync_compartidos_grupo', 'inventario_grupos_limpiar_atributos')))::TEXT;
INSERT INTO _r SELECT 81, 'rehearsal: 3 children survive with name, stock, state, photo and gallery unchanged', '3',
  count(*)::TEXT FROM _antes a JOIN inventario i ON i.id = a.id
  WHERE i.nombre = a.nombre AND i.stock IS NOT DISTINCT FROM a.stock AND (i.deleted_at IS NULL) = a.activo
    AND i.imagen_url IS NOT DISTINCT FROM a.imagen_url AND i.imagen_path IS NOT DISTINCT FROM a.imagen_path
    AND (SELECT count(*) FROM inventario_imagenes ii WHERE ii.inventario_id = i.id) = a.galeria;
INSERT INTO _r SELECT 82, 'rehearsal: Rojo and Azul still carry their own photo', '2',
  count(*)::TEXT FROM inventario WHERE id IN (SELECT rojo FROM _s UNION SELECT azul FROM _s) AND imagen_url IS NOT NULL;
INSERT INTO _r SELECT 83, 'rehearsal: the sale line still points at Rojo', '1', c::TEXT
  FROM (SELECT count(*) AS c FROM items_venta WHERE inventario_id = (SELECT rojo FROM _s)) x
  WHERE NOT EXISTS (SELECT 1 FROM _r WHERE orden = 89);

SELECT orden, probe, esperado, obtenido FROM _r ORDER BY orden, probe;

ROLLBACK;
