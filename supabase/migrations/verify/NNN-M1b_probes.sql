-- Verification of M1b (variantes-inventario-venta): guardar_grupo_variantes.
--
-- Run AFTER M1b is applied:  node scripts/db-run.mjs <this file>
-- (no --apply: the file opens its own transaction and always ends in ROLLBACK).
-- Everything is scratch data (orgs 'probe-m1b-org' and 'probe-m1b-other') and is rolled back. There is
-- no DDL except the rollback rehearsal at the end, which drops the function until that ROLLBACK.
--
-- Results accumulate in _r and come out in ONE select. Green = esperado equals obtenido, or obtenido
-- starts with 'OK:' for the probes that expect an error. Every error probe checks the SQLSTATE AND the
-- message prefix of the guard it claims to test, because the database already has overlapping guards
-- (23514 from M1a and 177, 23505 from the unique indexes, 54000 from the btree): a probe that only
-- checked the code could pass with its own guard deleted.
-- Checked on a local Postgres 16 engine (PGlite) with the real stock functions of 206, 221 and 291,
-- under both orders of the RI cascade triggers, and each guard was deleted in turn to prove its probe
-- goes red. Nothing of this file has run on production: it ran on the local engine only, so the
-- first real run is after M1b is applied.

BEGIN;

CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);

-- Runs one statement and records the SQLSTATE it raised ('ok' = no error). When p_msg is given the
-- message must match it too (LIKE).
CREATE FUNCTION pg_temp.probe(p_orden INT, p_probe TEXT, p_esperado TEXT, p_sql TEXT, p_msg TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_got TEXT := 'ok'; v_msg TEXT := '';
BEGIN
  IF p_esperado <> 'ok' AND p_msg IS NULL THEN
    RAISE EXCEPTION 'probe % expects an error but names no message pattern: a bare SQLSTATE can be raised by an overlapping guard', p_orden;
  END IF;
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    v_got := SQLSTATE; v_msg := SQLERRM;
  END;
  INSERT INTO _r VALUES (p_orden, p_probe, p_esperado,
    CASE WHEN v_got = p_esperado AND (p_msg IS NULL OR v_msg LIKE p_msg) THEN 'OK: ' || v_got
         ELSE 'FALLO: ' || v_got || ' ' || v_msg END);
END $$;

CREATE TEMP TABLE _s (org TEXT, usr TEXT, principal TEXT, norte TEXT, inactivo TEXT, suelto TEXT);
CREATE TEMP TABLE _o (org TEXT, deposito TEXT, grupo TEXT, hijo TEXT, proveedor TEXT);

-- Client-style ids: c + 24 hex characters.
CREATE FUNCTION pg_temp.cid(n INT) RETURNS TEXT LANGUAGE sql AS $$ SELECT 'cdead' || lpad(n::text, 20, '0') $$;
-- ["Rojo","M"] -> [{"opcion":"Color","valor":"Rojo"},{"opcion":"Talle","valor":"M"}]
CREATE FUNCTION pg_temp.atr(p JSONB) RETURNS JSONB LANGUAGE sql AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('opcion', (ARRAY['Color', 'Talle', 'Modelo'])[o], 'valor', v) ORDER BY o), '[]'::jsonb)
    FROM jsonb_array_elements(p) WITH ORDINALITY t(v, o) $$;
-- A variante row: id n, option values p, code c; x overrides or adds keys.
CREATE FUNCTION pg_temp.fila(n INT, p JSONB, c TEXT, x JSONB DEFAULT '{}') RETURNS JSONB LANGUAGE sql AS $$
  SELECT jsonb_build_object('id', pg_temp.cid(n), 'atributos', pg_temp.atr(p), 'codigo', c) || x $$;
CREATE FUNCTION pg_temp.grupo(n INT, nombre TEXT, x JSONB DEFAULT '{}') RETURNS JSONB LANGUAGE sql AS $$
  SELECT jsonb_build_object('id', pg_temp.cid(n), 'nombre', nombre,
           'opciones', '[{"nombre":"Color","valores":["Rojo","Azul","Verde","Negro"]}]'::jsonb) || x $$;
CREATE FUNCTION pg_temp.guardar(g JSONB, v JSONB, c JSONB DEFAULT '{"categoria":"Fundas"}', a JSONB DEFAULT '[]', d TEXT DEFAULT NULL, o TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql AS $$
BEGIN
  RETURN guardar_grupo_variantes(COALESCE(o, (SELECT org FROM _s)), (SELECT usr FROM _s), g, c, v, a, d);
END $$;
CREATE TEMP TABLE _res (k TEXT PRIMARY KEY, r JSONB);
-- Records the result of a call that must succeed; an error is stored as {"error": ...} so the checks go red instead of aborting the file.
CREATE FUNCTION pg_temp.run(p_k TEXT, g JSONB, v JSONB, c JSONB DEFAULT '{"categoria":"Fundas"}', a JSONB DEFAULT '[]', d TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO _res VALUES (p_k, pg_temp.guardar(g, v, c, a, d));
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _res VALUES (p_k, jsonb_build_object('error', SQLSTATE || ' ' || SQLERRM));
END $$;
CREATE FUNCTION pg_temp.ck(p_orden INT, p_probe TEXT, p_esperado TEXT, p_obtenido TEXT) RETURNS VOID LANGUAGE sql AS $$
  INSERT INTO _r VALUES (p_orden, p_probe, p_esperado, p_obtenido) $$;

-- Scratch org with the depots the probes use, an UNGROUPED control row, and a second org with its
-- own depot, group, child and supplier (the target of the cross-org probes).
DO $$
DECLARE v_org TEXT; v_oth TEXT; v_usr TEXT; v_pr TEXT; v_no TEXT; v_in TEXT; v_su TEXT; v_dep TEXT; v_g TEXT; v_h TEXT; v_pv TEXT;
BEGIN
  SELECT id INTO v_usr FROM users LIMIT 1;
  INSERT INTO organizations (nombre, slug) VALUES ('Probe M1b Org', 'probe-m1b-org') RETURNING id INTO v_org;
  SELECT id INTO v_pr FROM depositos WHERE organization_id = v_org AND principal AND deleted_at IS NULL LIMIT 1;
  INSERT INTO depositos (organization_id, nombre, principal, activo) VALUES (v_org, 'Probe Norte', false, true) RETURNING id INTO v_no;
  INSERT INTO depositos (organization_id, nombre, principal, activo) VALUES (v_org, 'Probe Viejo', false, false) RETURNING id INTO v_in;
  INSERT INTO inventario (organization_id, codigo, nombre, categoria, precio_compra, precio_venta)
    VALUES (v_org, 'PRB-PL', 'Probe Plain', 'PlainCat', 1, 1) RETURNING id INTO v_su;
  INSERT INTO _s VALUES (v_org, v_usr, v_pr, v_no, v_in, v_su);
  INSERT INTO organizations (nombre, slug) VALUES ('Probe M1b Other', 'probe-m1b-other') RETURNING id INTO v_oth;
  SELECT id INTO v_dep FROM depositos WHERE organization_id = v_oth AND principal AND deleted_at IS NULL LIMIT 1;
  INSERT INTO proveedores (nombre, organization_id) VALUES ('Probe Prov Other', v_oth) RETURNING id INTO v_pv;
  INSERT INTO inventario_grupos (id, organization_id, nombre, opciones)
    VALUES (pg_temp.cid(900), v_oth, 'Probe Other Group', '[{"nombre":"Color","valores":["Rojo"]}]') RETURNING id INTO v_g;
  INSERT INTO inventario (organization_id, codigo, nombre, categoria, precio_compra, precio_venta, grupo_id, atributos)
    VALUES (v_oth, 'PRB-OT', 'Probe Other - Rojo', 'OtherCat', 1, 1, v_g, '[{"opcion":"Color","valor":"Rojo"}]') RETURNING id INTO v_h;
  INSERT INTO _o VALUES (v_oth, v_dep, v_g, v_h, v_pv);
END $$;

-- PROBE 0: the function, its identity and who may run it.
INSERT INTO _r SELECT 0, k, 'true', v FROM (VALUES
  ('both scratch orgs have a principal depot', ((SELECT principal FROM _s) IS NOT NULL AND (SELECT deposito FROM _o) IS NOT NULL)::TEXT),
  ('the function exists with the 7-argument signature',
    (to_regprocedure('public.guardar_grupo_variantes(text,text,jsonb,jsonb,jsonb,jsonb,text)') IS NOT NULL)::TEXT),
  ('SECURITY INVOKER with a fixed search_path',
    (SELECT (NOT prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp'])::TEXT FROM pg_proc
      WHERE oid = to_regprocedure('public.guardar_grupo_variantes(text,text,jsonb,jsonb,jsonb,jsonb,text)'))),
  ('service_role can execute it',
    has_function_privilege('service_role', to_regprocedure('public.guardar_grupo_variantes(text,text,jsonb,jsonb,jsonb,jsonb,text)'), 'EXECUTE')::TEXT),
  ('anon and authenticated cannot',
    (NOT has_function_privilege('anon', to_regprocedure('public.guardar_grupo_variantes(text,text,jsonb,jsonb,jsonb,jsonb,text)'), 'EXECUTE')
     AND NOT has_function_privilege('authenticated', to_regprocedure('public.guardar_grupo_variantes(text,text,jsonb,jsonb,jsonb,jsonb,text)'), 'EXECUTE'))::TEXT),
  ('PUBLIC holds no EXECUTE (a new function is executable by PUBLIC unless revoked)',
    (NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
      WHERE p.oid = to_regprocedure('public.guardar_grupo_variantes(text,text,jsonb,jsonb,jsonb,jsonb,text)') AND a.grantee = 0))::TEXT)
) AS t(k, v);

-- PROBE 1 (VG-1, VG-13): a group of 3 rows, initial stock into the NON-principal depot Norte. Rojo and Azul
-- carry stock, Negro none; Azul sends no precio_compra.
SELECT pg_temp.run('g1', pg_temp.grupo(1, 'Probe Funda'),
  jsonb_build_array(pg_temp.fila(11, '["Rojo"]', 'PB1-RO', '{"precio_venta":10000,"precio_compra":6000,"stock_inicial":5}'),
                    pg_temp.fila(12, '["Azul"]', 'PB1-AZ', '{"precio_venta":12000,"stock_inicial":3,"barcode":"BC-2"}'),
                    pg_temp.fila(13, '["Negro"]', 'PB1-NE')),
  '{"categoria":"Fundas","proveedor":"ProbeProv"}', '[]', (SELECT norte FROM _s));
SELECT pg_temp.ck(10, 'create: creados lists the 3 rows in payload order and nothing else', 'true',
  ((r -> 'creados') = to_jsonb(ARRAY[pg_temp.cid(11), pg_temp.cid(12), pg_temp.cid(13)]) AND (r -> 'actualizados') = '[]'
   AND (r -> 'promovidos') = '[]' AND (r -> 'restaurados') = '[]' AND (r -> 'archivados') = '[]' AND (r ->> 'error') IS NULL)::TEXT
  || COALESCE(' ' || (r ->> 'error'), '')) FROM _res WHERE k = 'g1';
SELECT pg_temp.ck(11, 'create: the group row carries name, options and creator', 'Probe Funda/1/true',
  nombre || '/' || jsonb_array_length(opciones) || '/' || (created_by IS NOT DISTINCT FROM (SELECT usr FROM _s))::TEXT)
  FROM inventario_grupos WHERE id = pg_temp.cid(1);
SELECT pg_temp.ck(12, 'create: names are derived from the base and the values', 'Probe Funda - Azul|Probe Funda - Negro|Probe Funda - Rojo',
  string_agg(nombre, '|' ORDER BY codigo)) FROM inventario WHERE grupo_id = pg_temp.cid(1);
SELECT pg_temp.ck(13, 'create: stock is Azul 3, Negro 0, Rojo 5 and equals the sum of the depots', '3|0|5/true',
  string_agg(stock::TEXT, '|' ORDER BY codigo) || '/' ||
  bool_and(stock = COALESCE((SELECT sum(d.stock) FROM inventario_depositos d WHERE d.inventario_id = i.id), 0))::TEXT)
  FROM inventario i WHERE grupo_id = pg_temp.cid(1);
SELECT pg_temp.ck(14, 'create: the initial stock sits in Norte only (0 rows in the principal, 8 units in Norte)', '0/8',
  (SELECT count(*) FROM inventario_depositos WHERE inventario_id IN (pg_temp.cid(11), pg_temp.cid(12)) AND deposito_id = (SELECT principal FROM _s))::TEXT
  || '/' || (SELECT COALESCE(sum(stock), 0) FROM inventario_depositos WHERE inventario_id IN (pg_temp.cid(11), pg_temp.cid(12)) AND deposito_id = (SELECT norte FROM _s))::TEXT);
SELECT pg_temp.ck(15, 'create: one ENTRADA / STOCK_INICIAL movement per stocked row, in Norte', '2/2',
  count(*)::TEXT || '/' || (count(*) FILTER (WHERE tipo = 'ENTRADA' AND referencia_tipo = 'STOCK_INICIAL' AND deposito_id = (SELECT norte FROM _s)))::TEXT)
  FROM movimientos_inventario WHERE inventario_id IN (pg_temp.cid(11), pg_temp.cid(12), pg_temp.cid(13));
SELECT pg_temp.ck(16, 'create: new rows start with no photo (imagen_url and imagen_path NULL, no gallery row)', 'true/0',
  bool_and(imagen_url IS NULL AND imagen_path IS NULL)::TEXT || '/' ||
  (SELECT count(*) FROM inventario_imagenes WHERE inventario_id IN (pg_temp.cid(11), pg_temp.cid(12), pg_temp.cid(13)))::TEXT)
  FROM inventario WHERE grupo_id = pg_temp.cid(1);
SELECT pg_temp.ck(17, 'create: every row got the shared values of p_compartidos', '1/Fundas/ProbeProv',
  count(DISTINCT (categoria, proveedor))::TEXT || '/' || min(categoria) || '/' || min(proveedor)) FROM inventario WHERE grupo_id = pg_temp.cid(1);
SELECT pg_temp.ck(18, 'create: Rojo keeps the cost sent (6000) and Azul gets 0 (absent on a NEW row)', 'true/true',
  (SELECT precio_compra = 6000 FROM inventario WHERE id = pg_temp.cid(11))::TEXT || '/' || (SELECT precio_compra = 0 FROM inventario WHERE id = pg_temp.cid(12))::TEXT);
SELECT pg_temp.ck(19, 'create: the sync GUC is off again after the call', 'off', current_setting('stapp.sync_grupo', true));

-- PROBE 2 (VG-11): the same call again converges: nothing created, nothing doubled.
SELECT pg_temp.run('g1b', pg_temp.grupo(1, 'Probe Funda'),
  jsonb_build_array(pg_temp.fila(11, '["Rojo"]', 'PB1-RO', '{"precio_venta":10000,"precio_compra":6000,"stock_inicial":5}'),
                    pg_temp.fila(12, '["Azul"]', 'PB1-AZ', '{"precio_venta":12000,"stock_inicial":3,"barcode":"BC-2"}'),
                    pg_temp.fila(13, '["Negro"]', 'PB1-NE')),
  '{"categoria":"Fundas","proveedor":"ProbeProv"}', '[]', (SELECT norte FROM _s));
SELECT pg_temp.ck(20, 'retry: nothing is created, the 3 rows are updated in place', 'true',
  ((r -> 'creados') = '[]' AND jsonb_array_length(r -> 'actualizados') = 3 AND (r ->> 'error') IS NULL)::TEXT || COALESCE(' ' || (r ->> 'error'), '')) FROM _res WHERE k = 'g1b';
SELECT pg_temp.ck(21, 'retry: still 1 group and 3 children', '1/3',
  (SELECT count(*) FROM inventario_grupos WHERE id = pg_temp.cid(1))::TEXT || '/' || (SELECT count(*) FROM inventario WHERE grupo_id = pg_temp.cid(1))::TEXT);
SELECT pg_temp.ck(22, 'retry: the initial stock is not applied twice (3|0|5), still 2 movements and 2 depot rows', '3|0|5/2/2',
  (SELECT string_agg(stock::TEXT, '|' ORDER BY codigo) FROM inventario WHERE grupo_id = pg_temp.cid(1)) || '/' ||
  (SELECT count(*) FROM movimientos_inventario WHERE inventario_id IN (SELECT id FROM inventario WHERE grupo_id = pg_temp.cid(1)))::TEXT || '/' ||
  (SELECT count(*) FROM inventario_depositos WHERE inventario_id IN (SELECT id FROM inventario WHERE grupo_id = pg_temp.cid(1)))::TEXT);

-- PROBE 3 (VG-5, VG-7, VG-8, VG-12): shared fields, independent per-variant fields, absent keys, archive.
-- Rojo: new price and barcode, NO precio_compra key. Negro is archived. Shared categoria/descripcion change.
SELECT pg_temp.run('g3', pg_temp.grupo(1, 'Probe Funda'),
  jsonb_build_array(pg_temp.fila(11, '["Rojo"]', 'PB1-RO', '{"precio_venta":10500,"barcode":"  BC-1 "}'),
                    pg_temp.fila(12, '["Azul"]', 'PB1-AZ')),
  '{"categoria":"NuevaCat","descripcion":"D1"}', jsonb_build_array(pg_temp.cid(13)));
SELECT pg_temp.ck(30, 'archive: archivados lists the row', 'true',
  ((r -> 'archivados') = to_jsonb(ARRAY[pg_temp.cid(13)]) AND (r ->> 'error') IS NULL)::TEXT || COALESCE(' ' || (r ->> 'error'), '')) FROM _res WHERE k = 'g3';
SELECT pg_temp.ck(31, 'shared: categoria and descripcion reach Azul AND the archived Negro', '3',
  count(*) FILTER (WHERE categoria = 'NuevaCat' AND descripcion = 'D1')::TEXT) FROM inventario WHERE grupo_id = pg_temp.cid(1);
SELECT pg_temp.ck(32, 'shared: an ungrouped row of the same org keeps its categoria', 'PlainCat', categoria) FROM inventario WHERE id = (SELECT suelto FROM _s);
SELECT pg_temp.ck(33, 'shared: the group of another org keeps its categoria', 'OtherCat', categoria) FROM inventario WHERE id = (SELECT hijo FROM _o);
SELECT pg_temp.ck(34, 'per-variant: Rojo price changed, Azul price untouched', 'true/true',
  (SELECT precio_venta = 10500 FROM inventario WHERE id = pg_temp.cid(11))::TEXT || '/' || (SELECT precio_venta = 12000 FROM inventario WHERE id = pg_temp.cid(12))::TEXT);
SELECT pg_temp.ck(35, 'absent precio_compra leaves the stored cost (Rojo still 6000)', 'true', (precio_compra = 6000)::TEXT) FROM inventario WHERE id = pg_temp.cid(11);
SELECT pg_temp.ck(36, 'barcode is trimmed', 'BC-1', barcode) FROM inventario WHERE id = pg_temp.cid(11);
SELECT pg_temp.ck(37, 'archived Negro: deleted_at and deleted_by set, nothing hard-deleted', 'true',
  (deleted_at IS NOT NULL AND deleted_by IS NOT DISTINCT FROM (SELECT usr FROM _s))::TEXT) FROM inventario WHERE id = pg_temp.cid(13);
SELECT pg_temp.ck(38, 'the sync GUC is off again', 'off', current_setting('stapp.sync_grupo', true));
-- A new row inherits the group values when p_compartidos is empty; Rojo's cost changes only when sent;
-- barcode null clears Rojo's while Azul (key absent) keeps BC-2.
SELECT pg_temp.run('g3b', pg_temp.grupo(1, 'Probe Funda'),
  jsonb_build_array(pg_temp.fila(11, '["Rojo"]', 'PB1-RO', '{"precio_compra":6100,"barcode":null}'),
                    pg_temp.fila(12, '["Azul"]', 'PB1-AZ'),
                    pg_temp.fila(14, '["Verde"]', 'PB1-VE')), '{}');
SELECT pg_temp.ck(39, 'a new row inherits the group shared values (NuevaCat, ProbeProv)', 'NuevaCat/ProbeProv', categoria || '/' || proveedor) FROM inventario WHERE id = pg_temp.cid(14);
SELECT pg_temp.ck(40, 'precio_compra sent is written (Rojo 6100), Azul keeps 0', 'true/true',
  (SELECT precio_compra = 6100 FROM inventario WHERE id = pg_temp.cid(11))::TEXT || '/' || (SELECT precio_compra = 0 FROM inventario WHERE id = pg_temp.cid(12))::TEXT);
SELECT pg_temp.ck(41, 'barcode null clears it, an absent barcode key keeps it', '/BC-2',
  COALESCE((SELECT barcode FROM inventario WHERE id = pg_temp.cid(11)), '') || '/' || (SELECT barcode FROM inventario WHERE id = pg_temp.cid(12)));

-- PROBE 4 (VG-3): naming. Azul is renamed by hand (a custom name) before the base changes.
SELECT pg_temp.run('n1', pg_temp.grupo(4, 'Probe Name'), jsonb_build_array(pg_temp.fila(41, '["Rojo"]', 'PB4-RO'), pg_temp.fila(42, '["Azul"]', 'PB4-AZ')));
UPDATE inventario SET nombre = 'Azul custom' WHERE id = pg_temp.cid(42);
SELECT pg_temp.run('n2', pg_temp.grupo(4, 'Probe Name'), jsonb_build_array(pg_temp.fila(41, '["Rojo"]', 'PB4-RO'), pg_temp.fila(42, '["Azul"]', 'PB4-AZ')));
SELECT pg_temp.ck(50, 'a no-op save renames nothing (managed stays, custom stays)', 'Probe Name - Rojo|Azul custom',
  string_agg(nombre, '|' ORDER BY codigo DESC)) FROM inventario WHERE grupo_id = pg_temp.cid(4);
SELECT pg_temp.run('n3', pg_temp.grupo(4, 'Probe Name 2'), jsonb_build_array(pg_temp.fila(41, '["Rojo"]', 'PB4-RO'), pg_temp.fila(42, '["Azul"]', 'PB4-AZ')));
SELECT pg_temp.ck(51, 'a base rename re-derives the managed name and keeps the custom one', 'Probe Name 2 - Rojo|Azul custom',
  string_agg(nombre, '|' ORDER BY codigo DESC)) FROM inventario WHERE grupo_id = pg_temp.cid(4);
-- Rojo becomes "Rojo claro" in the SAME save that renames the base: the managed test uses the PREVIOUS base and values.
SELECT pg_temp.run('n4', pg_temp.grupo(4, 'Probe Name 3', '{"opciones":[{"nombre":"Color","valores":["Rojo claro","Azul"]}]}'),
  jsonb_build_array(pg_temp.fila(41, '["Rojo claro"]', 'PB4-RO'), pg_temp.fila(42, '["Azul"]', 'PB4-AZ')));
SELECT pg_temp.ck(52, 'renaming base and value together re-derives the managed name', 'Probe Name 3 - Rojo claro', nombre) FROM inventario WHERE id = pg_temp.cid(41);
SELECT pg_temp.ck(53, 'renaming a value keeps the id and the code (rows are edited in place)', 'PB4-RO/true',
  codigo || '/' || (id = pg_temp.cid(41) AND grupo_id = pg_temp.cid(4))::TEXT) FROM inventario WHERE id = pg_temp.cid(41);

-- PROBE 5 (VG-6, PI-4): promotion. P is a standalone item with 7 units in the principal, 3 in Norte,
-- 2 reserved, a barcode, a principal photo and one more gallery image; Azul is generated.
DO $$
DECLARE v_org TEXT; v_pr TEXT; v_no TEXT; v_p TEXT;
BEGIN
  SELECT org, principal, norte INTO v_org, v_pr, v_no FROM _s;
  INSERT INTO inventario (organization_id, codigo, nombre, categoria, precio_compra, precio_venta, stock, stock_reservado, barcode)
    VALUES (v_org, 'PB5-P', 'Funda P', 'PCat', 50, 100, 10, 2, 'PB5-BC') RETURNING id INTO v_p;
  UPDATE inventario_depositos SET stock = 7 WHERE inventario_id = v_p AND deposito_id = v_pr;
  INSERT INTO inventario_depositos (inventario_id, deposito_id, stock, organization_id) VALUES (v_p, v_no, 3, v_org);
  INSERT INTO inventario_imagenes (inventario_id, url, path, orden, es_principal, organization_id) VALUES
    (v_p, 'https://probe.invalid/p1.jpg', 'probe/p1.jpg', 0, true, v_org),
    (v_p, 'https://probe.invalid/p2.jpg', 'probe/p2.jpg', 1, false, v_org);
  CREATE TEMP TABLE _p0 AS SELECT id, stock, stock_reservado, codigo, barcode, imagen_url, imagen_path,
    (SELECT count(*) FROM inventario_imagenes WHERE inventario_id = i.id) AS galeria,
    (SELECT count(*) FROM movimientos_inventario WHERE inventario_id = i.id) AS movs FROM inventario i WHERE id = v_p;
END $$;
SELECT pg_temp.run('p1', pg_temp.grupo(5, 'Probe Promo'),
  jsonb_build_array(jsonb_build_object('id', (SELECT id FROM _p0), 'atributos', pg_temp.atr('["Rojo"]')),
                    pg_temp.fila(52, '["Azul"]', 'PB5-AZ')), '{}');
SELECT pg_temp.ck(60, 'promotion: the item is in promovidos, the generated one in creados', 'true',
  ((r -> 'promovidos') = to_jsonb(ARRAY[(SELECT id FROM _p0)]) AND (r -> 'creados') = to_jsonb(ARRAY[pg_temp.cid(52)]) AND (r -> 'actualizados') = '[]'
   AND (r ->> 'error') IS NULL)::TEXT || COALESCE(' ' || (r ->> 'error'), '')) FROM _res WHERE k = 'p1';
SELECT pg_temp.ck(61, 'promotion keeps total stock, reserved units, code and barcode', 'true',
  (i.stock = p.stock AND i.stock_reservado = p.stock_reservado AND i.codigo = p.codigo AND i.barcode = p.barcode)::TEXT) FROM inventario i JOIN _p0 p ON p.id = i.id;
SELECT pg_temp.ck(62, 'promotion keeps the per-depot stock (7 principal, 3 Norte)', '7/3',
  (SELECT stock FROM inventario_depositos WHERE inventario_id = (SELECT id FROM _p0) AND deposito_id = (SELECT principal FROM _s))::TEXT || '/' ||
  (SELECT stock FROM inventario_depositos WHERE inventario_id = (SELECT id FROM _p0) AND deposito_id = (SELECT norte FROM _s))::TEXT);
SELECT pg_temp.ck(63, 'promotion writes no stock movement', '0',
  ((SELECT count(*) FROM movimientos_inventario WHERE inventario_id = (SELECT id FROM _p0)) - (SELECT movs FROM _p0))::TEXT);
SELECT pg_temp.ck(64, 'promotion keeps imagen_url, imagen_path and both gallery rows', 'true',
  (i.imagen_url IS NOT DISTINCT FROM p.imagen_url AND i.imagen_path IS NOT DISTINCT FROM p.imagen_path AND p.imagen_url IS NOT NULL
   AND (SELECT count(*) FROM inventario_imagenes WHERE inventario_id = i.id) = p.galeria AND p.galeria = 2)::TEXT) FROM inventario i JOIN _p0 p ON p.id = i.id;
SELECT pg_temp.ck(65, 'promotion makes it a child with a derived name', 'Probe Promo - Rojo/true',
  nombre || '/' || (grupo_id = pg_temp.cid(5) AND atributos IS NOT NULL)::TEXT) FROM inventario WHERE id = (SELECT id FROM _p0);
SELECT pg_temp.ck(66, 'the generated sibling has no photo of its own and inherits the promoted item''s categoria', 'true/0/PCat',
  (imagen_url IS NULL AND imagen_path IS NULL)::TEXT || '/' || (SELECT count(*) FROM inventario_imagenes WHERE inventario_id = pg_temp.cid(52))::TEXT || '/' || categoria)
  FROM inventario WHERE id = pg_temp.cid(52);
-- Promotion with renombrar = false: names stay, and stay through a later base rename (custom names).
DO $$
DECLARE v_org TEXT;
BEGIN
  SELECT org INTO v_org FROM _s;
  INSERT INTO inventario (organization_id, codigo, nombre, categoria, precio_compra, precio_venta, stock) VALUES
    (v_org, 'PB6-Q', 'Funda Q verde', 'QCat', 1, 1, 4), (v_org, 'PB6-R', 'Funda Q azul', 'RCat', 1, 1, 2),
    (v_org, 'PB6-S1', 'Silla uno', 'S1Cat', 1, 1, 0), (v_org, 'PB6-S2', 'Silla dos', 'S2Cat', 1, 1, 0);
END $$;
SELECT pg_temp.run('k1', pg_temp.grupo(6, 'Probe Keep', '{"renombrar":false}'),
  jsonb_build_array(jsonb_build_object('id', (SELECT id FROM inventario WHERE codigo = 'PB6-Q' AND organization_id = (SELECT org FROM _s)), 'atributos', pg_temp.atr('["Verde"]')),
                    jsonb_build_object('id', (SELECT id FROM inventario WHERE codigo = 'PB6-R' AND organization_id = (SELECT org FROM _s)), 'atributos', pg_temp.atr('["Azul"]'))),
  '{"categoria":"KeepCat"}');
SELECT pg_temp.ck(70, 'renombrar=false keeps both names and promotes both', 'Funda Q azul|Funda Q verde/2',
  string_agg(nombre, '|' ORDER BY codigo DESC) || '/' || count(*) FILTER (WHERE grupo_id = pg_temp.cid(6))::TEXT) FROM inventario WHERE codigo IN ('PB6-Q', 'PB6-R') AND organization_id = (SELECT org FROM _s);
SELECT pg_temp.ck(71, 'the chosen source values apply to every promoted item', '1/KeepCat', count(DISTINCT categoria)::TEXT || '/' || min(categoria)) FROM inventario WHERE grupo_id = pg_temp.cid(6);
SELECT pg_temp.run('k2', pg_temp.grupo(6, 'Probe Keep 2', '{"renombrar":false}'),
  jsonb_build_array(jsonb_build_object('id', (SELECT id FROM inventario WHERE codigo = 'PB6-Q' AND organization_id = (SELECT org FROM _s)), 'atributos', pg_temp.atr('["Verde"]')),
                    jsonb_build_object('id', (SELECT id FROM inventario WHERE codigo = 'PB6-R' AND organization_id = (SELECT org FROM _s)), 'atributos', pg_temp.atr('["Azul"]'))), '{}');
SELECT pg_temp.ck(72, 'a later base rename leaves those custom names alone', 'Funda Q azul|Funda Q verde',
  string_agg(nombre, '|' ORDER BY codigo DESC)) FROM inventario WHERE grupo_id = pg_temp.cid(6);
-- Items that differ in a shared field and no source given: the group still ends identical.
SELECT pg_temp.run('k3', pg_temp.grupo(7, 'Probe Silla', '{"opciones":[{"nombre":"Color","valores":["Rojo","Azul"]}]}'),
  jsonb_build_array(jsonb_build_object('id', (SELECT id FROM inventario WHERE codigo = 'PB6-S1' AND organization_id = (SELECT org FROM _s)), 'atributos', pg_temp.atr('["Rojo"]')),
                    jsonb_build_object('id', (SELECT id FROM inventario WHERE codigo = 'PB6-S2' AND organization_id = (SELECT org FROM _s)), 'atributos', pg_temp.atr('["Azul"]'))), '{}');
SELECT pg_temp.ck(73, 'promoting rows that differ without a source still leaves identical shared fields', '1',
  count(DISTINCT categoria)::TEXT) FROM inventario WHERE grupo_id = pg_temp.cid(7);

-- PROBE 7 (VG-8, VG-9): archive keeps everything, a freed slot is reusable, restore reuses the row and has
-- two 409 paths, reserved stock blocks the whole save.
SELECT pg_temp.run('a1', pg_temp.grupo(8, 'Probe Archivo'),
  jsonb_build_array(pg_temp.fila(81, '["Rojo"]', 'PB7-RO', '{"stock_inicial":4}'), pg_temp.fila(82, '["Azul"]', 'PB7-AZ'), pg_temp.fila(83, '["Verde"]', 'PB7-VE')),
  '{"categoria":"Fundas"}', '[]', (SELECT norte FROM _s));
INSERT INTO inventario_imagenes (inventario_id, url, path, orden, es_principal, organization_id)
  SELECT pg_temp.cid(81), 'https://probe.invalid/rojo.jpg', 'probe/rojo.jpg', 0, true, org FROM _s
   WHERE EXISTS (SELECT 1 FROM inventario WHERE id = pg_temp.cid(81)); -- absent only when the save above failed: the checks then go red
CREATE TEMP TABLE _a0 AS SELECT id, stock, imagen_url, imagen_path,
  (SELECT count(*) FROM inventario_imagenes WHERE inventario_id = i.id) AS galeria,
  (SELECT count(*) FROM movimientos_inventario WHERE inventario_id = i.id) AS movs,
  (SELECT sum(stock) FROM inventario_depositos WHERE inventario_id = i.id) AS en_depositos FROM inventario i WHERE id = pg_temp.cid(81);
SELECT pg_temp.run('a2', pg_temp.grupo(8, 'Probe Archivo'),
  jsonb_build_array(pg_temp.fila(82, '["Azul"]', 'PB7-AZ'), pg_temp.fila(83, '["Verde"]', 'PB7-VE')), '{}', jsonb_build_array(pg_temp.cid(81)));
SELECT pg_temp.ck(80, 'archive: archivados lists Rojo and its row is archived, not deleted', 'true',
  ((r -> 'archivados') = to_jsonb(ARRAY[pg_temp.cid(81)]) AND (SELECT deleted_at IS NOT NULL FROM inventario WHERE id = pg_temp.cid(81)))::TEXT
  || COALESCE(' ' || (r ->> 'error'), '')) FROM _res WHERE k = 'a2';
SELECT pg_temp.ck(81, 'archive keeps stock, depot rows, photo, gallery and writes no movement', 'true',
  (i.stock = p.stock AND p.stock = 4 AND i.imagen_url IS NOT DISTINCT FROM p.imagen_url AND p.imagen_url IS NOT NULL
   AND (SELECT count(*) FROM inventario_imagenes WHERE inventario_id = i.id) = p.galeria
   AND (SELECT count(*) FROM movimientos_inventario WHERE inventario_id = i.id) = p.movs
   AND (SELECT sum(stock) FROM inventario_depositos WHERE inventario_id = i.id) = p.en_depositos)::TEXT) FROM inventario i JOIN _a0 p ON p.id = i.id;
SELECT pg_temp.run('a3', pg_temp.grupo(8, 'Probe Archivo'),
  jsonb_build_array(pg_temp.fila(82, '["Azul"]', 'PB7-AZ'), pg_temp.fila(83, '["Verde"]', 'PB7-VE'), pg_temp.fila(84, '["Rojo"]', 'PB7-RO2')), '{}');
SELECT pg_temp.ck(82, 'a freed slot accepts a new active row (no unique violation)', 'true',
  ((r -> 'creados') = to_jsonb(ARRAY[pg_temp.cid(84)]) AND (r ->> 'error') IS NULL)::TEXT || COALESCE(' ' || (r ->> 'error'), '')) FROM _res WHERE k = 'a3';
DO $$ BEGIN
  PERFORM pg_temp.probe(83, 'restore into an occupied slot is P0030 (409)', 'P0030',
    $q$SELECT pg_temp.guardar(pg_temp.grupo(8, 'Probe Archivo'), jsonb_build_array(pg_temp.fila(81, '["Rojo"]', 'PB7-RO'), pg_temp.fila(82, '["Azul"]', 'PB7-AZ'), pg_temp.fila(83, '["Verde"]', 'PB7-VE')), '{}')$q$,
    'COMBINACION_DUPLICADA%');
END $$;
-- free the slot again and give another ACTIVE item Rojo's old code
SELECT pg_temp.run('a4', pg_temp.grupo(8, 'Probe Archivo'),
  jsonb_build_array(pg_temp.fila(82, '["Azul"]', 'PB7-AZ'), pg_temp.fila(83, '["Verde"]', 'PB7-VE')), '{}', jsonb_build_array(pg_temp.cid(84)));
INSERT INTO inventario (organization_id, codigo, nombre, categoria, precio_compra, precio_venta)
  SELECT org, 'PB7-RO', 'Code taker', 'Fundas', 1, 1 FROM _s
   WHERE NOT EXISTS (SELECT 1 FROM inventario WHERE organization_id = _s.org AND codigo = 'PB7-RO' AND deleted_at IS NULL); -- taken only when the archive above worked
DO $$ BEGIN
  PERFORM pg_temp.probe(84, 'restore with a code now used by another active item is P0035 (409)', 'P0035',
    $q$SELECT pg_temp.guardar(pg_temp.grupo(8, 'Probe Archivo'), jsonb_build_array(pg_temp.fila(81, '["Rojo"]', 'PB7-RO'), pg_temp.fila(82, '["Azul"]', 'PB7-AZ'), pg_temp.fila(83, '["Verde"]', 'PB7-VE')), '{}')$q$,
    'CODIGO_DUPLICADO:PB7-RO');
END $$;
UPDATE inventario SET codigo = 'PB7-TAKEN' WHERE codigo = 'PB7-RO' AND grupo_id IS NULL AND organization_id = (SELECT org FROM _s);
SELECT pg_temp.run('a5', pg_temp.grupo(8, 'Probe Archivo'),
  jsonb_build_array(pg_temp.fila(81, '["Rojo"]', 'PB7-RO'), pg_temp.fila(82, '["Azul"]', 'PB7-AZ'), pg_temp.fila(83, '["Verde"]', 'PB7-VE')), '{}');
SELECT pg_temp.ck(85, 'restore reactivates the SAME row (restaurados) with its stock, photo and history', 'true',
  ((x.r -> 'restaurados') = to_jsonb(ARRAY[pg_temp.cid(81)]) AND (x.r -> 'creados') = '[]' AND i.deleted_at IS NULL AND i.deleted_by IS NULL AND i.stock = p.stock
   AND i.imagen_url IS NOT DISTINCT FROM p.imagen_url AND (SELECT count(*) FROM movimientos_inventario WHERE inventario_id = i.id) = p.movs AND (x.r ->> 'error') IS NULL)::TEXT
  || COALESCE(' ' || (x.r ->> 'error'), '')) FROM _res x, inventario i, _a0 p WHERE x.k = 'a5' AND i.id = pg_temp.cid(81) AND p.id = i.id;
-- reserved stock on Azul: the call renames the group, creates a row AND archives Azul; everything must roll back
UPDATE inventario SET stock = 3, stock_reservado = 2 WHERE id = pg_temp.cid(82);
DO $$ BEGIN
  PERFORM pg_temp.probe(86, 'archiving a row with reserved stock is P0033 and names the row and the units', 'P0033',
    $q$SELECT pg_temp.guardar(pg_temp.grupo(8, 'Probe Archivo RENAMED'), jsonb_build_array(pg_temp.fila(81, '["Rojo"]', 'PB7-RO'), pg_temp.fila(83, '["Verde"]', 'PB7-VE'), pg_temp.fila(85, '["Negro"]', 'PB7-NEW')), '{}', jsonb_build_array(pg_temp.cid(82)))$q$,
    'STOCK_RESERVADO:' || pg_temp.cid(82) || ':2');
END $$;
SELECT pg_temp.ck(87, 'the P0033 save rolled back whole: the new row does not exist and the earlier name stands', 'Probe Archivo/0/true',
  (SELECT nombre FROM inventario_grupos WHERE id = pg_temp.cid(8)) || '/' || (SELECT count(*) FROM inventario WHERE id = pg_temp.cid(85))::TEXT || '/' ||
  (SELECT deleted_at IS NULL FROM inventario WHERE id = pg_temp.cid(82))::TEXT);
-- archiving a row that is already archived (84) is a no-op, not an error
SELECT pg_temp.run('a7', pg_temp.grupo(8, 'Probe Archivo'),
  jsonb_build_array(pg_temp.fila(81, '["Rojo"]', 'PB7-RO'), pg_temp.fila(82, '["Azul"]', 'PB7-AZ'), pg_temp.fila(83, '["Verde"]', 'PB7-VE')), '{}', jsonb_build_array(pg_temp.cid(84)));
SELECT pg_temp.ck(88, 'archiving an already archived row is a no-op', 'true',
  ((r -> 'archivados') = '[]' AND (r ->> 'error') IS NULL)::TEXT || COALESCE(' ' || (r ->> 'error'), '')) FROM _res WHERE k = 'a7';

-- PROBE 8: the error battery. Fresh ids and codes in every call (PB8-*), so a wrongly accepted call
-- cannot hide behind a later one; 199 checks that no call of the battery left a row behind.
INSERT INTO inventario (organization_id, codigo, nombre, categoria, precio_compra, precio_venta, es_kit, tipo_kit)
  SELECT org, 'PB8-KIT', 'Probe kit', 'Fundas', 1, 1, true, 'ENSAMBLADO' FROM _s;
INSERT INTO inventario (organization_id, codigo, nombre, categoria, precio_compra, precio_venta, deleted_at)
  SELECT org, 'PB8-OLD', 'Probe archived standalone', 'Fundas', 1, 1, NOW() FROM _s;
INSERT INTO inventario (organization_id, codigo, nombre, categoria, precio_compra, precio_venta)
  SELECT org, c, 'Probe taken ' || c, 'Fundas', 1, 1 FROM _s, (VALUES ('PB8-X1'), ('PB8-X2')) AS t(c);
DO $$
DECLARE
  v_big JSONB; v_many JSONB;
BEGIN
  -- shapes of p_grupo / p_compartidos / a variante
  PERFORM pg_temp.probe(100, 'p_grupo must be an object', '22023', $q$SELECT guardar_grupo_variantes((SELECT org FROM _s), NULL, '[]', '{}', '[]', '[]', NULL)$q$, 'PAYLOAD_INVALIDO: p_grupo and p_compartidos must be%');
  PERFORM pg_temp.probe(101, 'p_variantes must be an array', '22023', $q$SELECT guardar_grupo_variantes((SELECT org FROM _s), NULL, pg_temp.grupo(101, 'E'), '{}', '{}', '[]', NULL)$q$, 'PAYLOAD_INVALIDO: p_grupo and p_compartidos must be%');
  PERFORM pg_temp.probe(102, 'p_grupo carries only id, nombre, opciones, renombrar', '22023', $q$SELECT pg_temp.guardar(pg_temp.grupo(102, 'E', '{"imagen_url":"x"}'), jsonb_build_array(pg_temp.fila(801, '["Rojo"]', 'PB8-1')))$q$, 'PAYLOAD_INVALIDO: p_grupo accepts%');
  PERFORM pg_temp.probe(103, 'p_compartidos refuses a column outside the 9 shared ones (imagen_url)', '22023', $q$SELECT pg_temp.guardar(pg_temp.grupo(103, 'E'), jsonb_build_array(pg_temp.fila(802, '["Rojo"]', 'PB8-2')), '{"categoria":"X","imagen_url":"x"}')$q$, 'PAYLOAD_INVALIDO: p_compartidos accepts only%');
  PERFORM pg_temp.probe(104, 'a variante refuses imagen_url', '22023', $q$SELECT pg_temp.guardar(pg_temp.grupo(104, 'E'), jsonb_build_array(pg_temp.fila(803, '["Rojo"]', 'PB8-3', '{"imagen_url":"x"}')))$q$, 'PAYLOAD_INVALIDO: a variante carries a key%');
  PERFORM pg_temp.probe(105, 'a variante refuses nombre (names are derived)', '22023', $q$SELECT pg_temp.guardar(pg_temp.grupo(105, 'E'), jsonb_build_array(pg_temp.fila(804, '["Rojo"]', 'PB8-4', '{"nombre":"mine"}')))$q$, 'PAYLOAD_INVALIDO: a variante carries a key%');
  PERFORM pg_temp.probe(106, 'a blank categoria in p_compartidos', '22023', $q$SELECT pg_temp.guardar(pg_temp.grupo(106, 'E'), jsonb_build_array(pg_temp.fila(805, '["Rojo"]', 'PB8-5')), '{"categoria":"  "}')$q$, 'PAYLOAD_INVALIDO: categoria cannot be blank');
  PERFORM pg_temp.probe(107, 'a new group without any categoria cannot create rows', '22023', $q$SELECT pg_temp.guardar(pg_temp.grupo(107, 'E'), jsonb_build_array(pg_temp.fila(806, '["Rojo"]', 'PB8-6')), '{}')$q$, 'PAYLOAD_INVALIDO: categoria is required%');
  PERFORM pg_temp.probe(108, 'a new group needs at least one row', '22023', $q$SELECT pg_temp.guardar(pg_temp.grupo(108, 'E'), '[]')$q$, 'PAYLOAD_INVALIDO: a new group needs at least one variante');
  PERFORM pg_temp.probe(109, 'a value repeated inside an option (Rojo vs rojo with an accent)', '22023', $q$SELECT pg_temp.guardar(pg_temp.grupo(109, 'E', ('{"opciones":[{"nombre":"Color","valores":["Rojo","Roj' || chr(243) || '"]}]}')::jsonb), jsonb_build_array(pg_temp.fila(807, '["Rojo"]', 'PB8-7')))$q$, 'PAYLOAD_INVALIDO: a value is repeated inside an option');
  PERFORM pg_temp.probe(110, 'a new variante id must look like c + 24 hex', '22023', $q$SELECT pg_temp.guardar(pg_temp.grupo(110, 'E'), jsonb_build_array(pg_temp.fila(808, '["Rojo"]', 'PB8-8', '{"id":"abc"}')))$q$, 'PAYLOAD_INVALIDO: a new variante needs an id like%');
  PERFORM pg_temp.probe(111, 'a new variante needs a codigo', '22023', $q$SELECT pg_temp.guardar(pg_temp.grupo(111, 'E'), jsonb_build_array(pg_temp.fila(809, '["Rojo"]', 'x') - 'codigo'))$q$, 'PAYLOAD_INVALIDO: a new variante needs an id like%');
  PERFORM pg_temp.probe(112, 'a new group id must look like c + 24 hex', '22023', $q$SELECT pg_temp.guardar(pg_temp.grupo(112, 'E', '{"id":"not-a-cuid"}'), jsonb_build_array(pg_temp.fila(810, '["Rojo"]', 'PB8-10')))$q$, 'PAYLOAD_INVALIDO: a new group id looks like%');
  PERFORM pg_temp.probe(113, 'a repeated variante id', '22023', $q$SELECT pg_temp.guardar(pg_temp.grupo(113, 'E'), jsonb_build_array(pg_temp.fila(811, '["Rojo"]', 'PB8-11'), pg_temp.fila(811, '["Azul"]', 'PB8-12')))$q$, 'PAYLOAD_INVALIDO: a variante id is repeated');
  PERFORM pg_temp.probe(114, 'duplicate barcodes in one save (22023, before any index could see them)', '22023', $q$SELECT pg_temp.guardar(pg_temp.grupo(114, 'E'), jsonb_build_array(pg_temp.fila(812, '["Rojo"]', 'PB8-13', '{"barcode":"DUP-BC"}'), pg_temp.fila(813, '["Azul"]', 'PB8-14', '{"barcode":" DUP-BC "}')))$q$, 'PAYLOAD_INVALIDO: a barcode is repeated inside the save');
  PERFORM pg_temp.probe(115, 'an id cannot be saved and archived in one call', '22023', $q$SELECT pg_temp.guardar(pg_temp.grupo(8, 'Probe Archivo'), jsonb_build_array(pg_temp.fila(81, '["Rojo"]', 'PB7-RO')), '{}', jsonb_build_array(pg_temp.cid(81)))$q$, 'PAYLOAD_INVALIDO: an id cannot be saved and archived%');
  -- numbers
  PERFORM pg_temp.probe(116, 'a negative price', '22023', $q$SELECT pg_temp.guardar(pg_temp.grupo(116, 'E'), jsonb_build_array(pg_temp.fila(814, '["Rojo"]', 'PB8-15', '{"precio_venta":-1}')))$q$, 'PAYLOAD_INVALIDO: prices must be numbers%');
  PERFORM pg_temp.probe(117, 'a price sent as text', '22023', $q$SELECT pg_temp.guardar(pg_temp.grupo(117, 'E'), jsonb_build_array(pg_temp.fila(815, '["Rojo"]', 'PB8-16', '{"precio_compra":"10"}')))$q$, 'PAYLOAD_INVALIDO: prices must be numbers%');
  PERFORM pg_temp.probe(118, 'a fractional initial stock', '22023', $q$SELECT pg_temp.guardar(pg_temp.grupo(118, 'E'), jsonb_build_array(pg_temp.fila(816, '["Rojo"]', 'PB8-17', '{"stock_inicial":1.5}')))$q$, 'PAYLOAD_INVALIDO: stock fields must be whole numbers%');
  PERFORM pg_temp.probe(119, 'a negative initial stock', '22023', $q$SELECT pg_temp.guardar(pg_temp.grupo(119, 'E'), jsonb_build_array(pg_temp.fila(817, '["Rojo"]', 'PB8-18', '{"stock_inicial":-2}')))$q$, 'PAYLOAD_INVALIDO: stock fields must be whole numbers%');
  -- atributos: every shape M1a refuses with a raw 23514 is a clean 22023 here, and the caps stop the btree limit
  PERFORM pg_temp.probe(120, 'atributos as text', '22023', $q$SELECT pg_temp.guardar(pg_temp.grupo(120, 'E'), jsonb_build_array(pg_temp.fila(820, '["Rojo"]', 'PB8-20', '{"atributos":"Rojo"}')))$q$, 'PAYLOAD_INVALIDO: atributos needs exactly one entry per option');
  PERFORM pg_temp.probe(121, 'atributos empty', '22023', $q$SELECT pg_temp.guardar(pg_temp.grupo(121, 'E'), jsonb_build_array(pg_temp.fila(821, '["Rojo"]', 'PB8-21', '{"atributos":[]}')))$q$, 'PAYLOAD_INVALIDO: atributos needs exactly one entry per option');
  PERFORM pg_temp.probe(122, 'atributos with more entries than options', '22023', $q$SELECT pg_temp.guardar(pg_temp.grupo(122, 'E'), jsonb_build_array(pg_temp.fila(822, '["Rojo","M","X","Y"]', 'PB8-22')))$q$, 'PAYLOAD_INVALIDO: atributos needs exactly one entry per option');
  PERFORM pg_temp.probe(123, 'an entry without valor', '22023', $q$SELECT pg_temp.guardar(pg_temp.grupo(123, 'E'), jsonb_build_array(pg_temp.fila(823, '["Rojo"]', 'PB8-23', '{"atributos":[{"opcion":"Color"}]}')))$q$, 'PAYLOAD_INVALIDO: atributos values must be non-blank text');
  PERFORM pg_temp.probe(124, 'a valor that is not text', '22023', $q$SELECT pg_temp.guardar(pg_temp.grupo(124, 'E'), jsonb_build_array(pg_temp.fila(824, '["Rojo"]', 'PB8-24', '{"atributos":[{"opcion":"Color","valor":1}]}')))$q$, 'PAYLOAD_INVALIDO: atributos values must be non-blank text');
  PERFORM pg_temp.probe(125, 'a blank valor (space, tab, NBSP)', '22023', format($q$SELECT pg_temp.guardar(pg_temp.grupo(125, 'E'), jsonb_build_array(pg_temp.fila(825, '["Rojo"]', 'PB8-25', jsonb_build_object('atributos', jsonb_build_array(jsonb_build_object('opcion', 'Color', 'valor', %L))))))$q$, ' ' || chr(9) || chr(160)), 'PAYLOAD_INVALIDO: atributos values must be non-blank text');
  PERFORM pg_temp.probe(126, 'a valor holding the key separator', '22023', format($q$SELECT pg_temp.guardar(pg_temp.grupo(126, 'E'), jsonb_build_array(pg_temp.fila(826, '["Rojo"]', 'PB8-26', jsonb_build_object('atributos', jsonb_build_array(jsonb_build_object('opcion', 'Color', 'valor', %L))))))$q$, 'a' || chr(31) || 'b'), 'PAYLOAD_INVALIDO: atributos values must be non-blank text');
  PERFORM pg_temp.probe(127, 'an entry that does not follow the option name', '22023', $q$SELECT pg_temp.guardar(pg_temp.grupo(127, 'E'), jsonb_build_array(pg_temp.fila(827, '["Rojo"]', 'PB8-27', '{"atributos":[{"opcion":"Talle","valor":"Rojo"}]}')))$q$, 'PAYLOAD_INVALIDO: atributos must follow the option names%');
  PERFORM pg_temp.probe(128, 'a valor of 101 characters', '22023', format($q$SELECT pg_temp.guardar(pg_temp.grupo(128, 'E'), jsonb_build_array(pg_temp.fila(828, '["Rojo"]', 'PB8-28', jsonb_build_object('atributos', jsonb_build_array(jsonb_build_object('opcion', 'Color', 'valor', %L))))))$q$, repeat('x', 101)), 'PAYLOAD_INVALIDO: atributos must follow the option names%');
  -- 3 options x 1000 characters would be a 3002-byte btree key (54000) if the cap were missing
  PERFORM pg_temp.probe(129, 'three oversized valores are refused before the btree limit', '22023', format($q$SELECT pg_temp.guardar(pg_temp.grupo(129, 'E', '{"opciones":[{"nombre":"Color","valores":["a"]},{"nombre":"Talle","valores":["b"]},{"nombre":"Modelo","valores":["c"]}]}'), jsonb_build_array(pg_temp.fila(829, '["a","b","c"]', 'PB8-29', jsonb_build_object('atributos', jsonb_build_array(jsonb_build_object('opcion', 'Color', 'valor', %1$L), jsonb_build_object('opcion', 'Talle', 'valor', %1$L), jsonb_build_object('opcion', 'Modelo', 'valor', %1$L))))))$q$, repeat('x', 1000)), 'PAYLOAD_INVALIDO: atributos must follow the option names%');
  PERFORM pg_temp.probe(130, 'an oversized codigo (btree)', '22023', format($q$SELECT pg_temp.guardar(pg_temp.grupo(130, 'E'), jsonb_build_array(pg_temp.fila(830, '["Rojo"]', %L)))$q$, repeat('c', 3000)), 'PAYLOAD_INVALIDO: codigo must be text%');
  -- limits
  SELECT jsonb_agg(pg_temp.fila(1000 + i, '["Rojo"]', 'PB8-L' || i)) INTO v_many FROM generate_series(1, 101) i;
  PERFORM pg_temp.probe(131, 'more than 100 rows in one save', 'P0034', format($q$SELECT pg_temp.guardar(pg_temp.grupo(131, 'E'), %L::jsonb)$q$, v_many::text), 'LIMITE_EXCEDIDO: at most 100%');
  PERFORM pg_temp.probe(132, 'more than 3 options', 'P0034', $q$SELECT pg_temp.guardar(pg_temp.grupo(132, 'E', '{"opciones":[{"nombre":"A","valores":["a"]},{"nombre":"B","valores":["b"]},{"nombre":"C","valores":["c"]},{"nombre":"D","valores":["d"]}]}'), jsonb_build_array(pg_temp.fila(831, '["a","b","c"]', 'PB8-31')))$q$, 'LIMITE_EXCEDIDO: a group has at most 3 options%');
  SELECT jsonb_build_array(jsonb_build_object('nombre', 'Color', 'valores', (SELECT to_jsonb(array_agg('c' || i)) FROM generate_series(1, 11) i)),
                           jsonb_build_object('nombre', 'Talle', 'valores', (SELECT to_jsonb(array_agg('t' || i)) FROM generate_series(1, 10) i))) INTO v_big;
  PERFORM pg_temp.probe(133, 'a product of value counts above 100 (11 x 10)', 'P0034', format($q$SELECT pg_temp.guardar(pg_temp.grupo(133, 'E', jsonb_build_object('opciones', %L::jsonb)), jsonb_build_array(pg_temp.fila(832, '["c1","t1"]', 'PB8-32')))$q$, v_big::text), 'LIMITE_EXCEDIDO: at most 100%');
  PERFORM pg_temp.probe(134, 'stock_minimo above stock_maximo', '22023', $q$SELECT pg_temp.guardar(pg_temp.grupo(134, 'E'), jsonb_build_array(pg_temp.fila(833, '["Rojo"]', 'PB8-33', '{"stock_minimo":5,"stock_maximo":2}')))$q$, 'PAYLOAD_INVALIDO: stock_minimo cannot exceed stock_maximo');
  -- conflicts and ownership
  PERFORM pg_temp.probe(140, 'Rojo and rojo with an accent in one save is P0030', 'P0030', $q$SELECT pg_temp.guardar(pg_temp.grupo(140, 'E'), jsonb_build_array(pg_temp.fila(840, '["Rojo"]', 'PB8-40'), pg_temp.fila(841, ('["Roj' || chr(243) || '"]')::jsonb, 'PB8-41')))$q$, 'COMBINACION_DUPLICADA');
  PERFORM pg_temp.probe(141, 'an item that belongs to another group is P0031', 'P0031', $q$SELECT pg_temp.guardar(pg_temp.grupo(141, 'E'), jsonb_build_array(pg_temp.fila(11, '["Rojo"]', 'PB1-RO')))$q$, 'ITEM_EN_OTRO_GRUPO: %');
  PERFORM pg_temp.probe(142, 'an archived id that belongs to another group is P0031', 'P0031', $q$SELECT pg_temp.guardar(pg_temp.grupo(8, 'Probe Archivo'), jsonb_build_array(pg_temp.fila(83, '["Verde"]', 'PB7-VE')), '{}', jsonb_build_array(pg_temp.cid(11)))$q$, 'ITEM_EN_OTRO_GRUPO: %');
  PERFORM pg_temp.probe(143, 'a kit cannot join a group (P0032, before the M1a CHECK)', 'P0032', $q$SELECT pg_temp.guardar(pg_temp.grupo(143, 'E'), jsonb_build_array(jsonb_build_object('id', (SELECT id FROM inventario WHERE codigo = 'PB8-KIT' AND organization_id = (SELECT org FROM _s)), 'atributos', pg_temp.atr('["Rojo"]'))))$q$, 'KIT_NO_PERMITIDO: %');
  PERFORM pg_temp.probe(144, 'every offending code is listed, sorted (P0035)', 'P0035', $q$SELECT pg_temp.guardar(pg_temp.grupo(144, 'E'), jsonb_build_array(pg_temp.fila(844, '["Rojo"]', 'PB8-S'), pg_temp.fila(845, '["Azul"]', 'PB8-S'), pg_temp.fila(846, '["Verde"]', 'PB8-X1'), pg_temp.fila(847, '["Negro"]', 'PB8-X2')))$q$, 'CODIGO_DUPLICADO:PB8-S,PB8-X1,PB8-X2');
  PERFORM pg_temp.probe(145, 'an item of another organization behaves like a missing one (P0002)', 'P0002', format($q$SELECT pg_temp.guardar(pg_temp.grupo(145, 'E'), jsonb_build_array(jsonb_build_object('id', %L, 'atributos', pg_temp.atr('["Rojo"]'))))$q$, (SELECT hijo FROM _o)), 'NO_ENCONTRADO: item %');
  PERFORM pg_temp.probe(146, 'a group id owned by another organization is P0002', 'P0002', format($q$SELECT pg_temp.guardar(%L::jsonb, jsonb_build_array(pg_temp.fila(846, '["Rojo"]', 'PB8-46')))$q$, jsonb_build_object('id', (SELECT grupo FROM _o), 'nombre', 'HIJACKED', 'opciones', jsonb_build_array(jsonb_build_object('nombre', 'Color', 'valores', jsonb_build_array('Rojo'))))::text), 'NO_ENCONTRADO: group %');
  PERFORM pg_temp.probe(147, 'the other org cannot use this org''s group either (P0002)', 'P0002', format($q$SELECT pg_temp.guardar(pg_temp.grupo(1, 'HIJACKED'), jsonb_build_array(pg_temp.fila(847, '["Rojo"]', 'PB8-47')), '{"categoria":"X"}', '[]', NULL, %L)$q$, (SELECT org FROM _o)), 'NO_ENCONTRADO: group %');
  PERFORM pg_temp.probe(148, 'a depot of another organization for the initial stock (P0002)', 'P0002', format($q$SELECT pg_temp.guardar(pg_temp.grupo(148, 'E'), jsonb_build_array(pg_temp.fila(848, '["Rojo"]', 'PB8-48', '{"stock_inicial":2}')), '{"categoria":"X"}', '[]', %L)$q$, (SELECT deposito FROM _o)), 'NO_ENCONTRADO: deposito %');
  PERFORM pg_temp.probe(149, 'an inactive depot for the initial stock (P0002)', 'P0002', format($q$SELECT pg_temp.guardar(pg_temp.grupo(149, 'E'), jsonb_build_array(pg_temp.fila(849, '["Rojo"]', 'PB8-49', '{"stock_inicial":2}')), '{"categoria":"X"}', '[]', %L)$q$, (SELECT inactivo FROM _s)), 'NO_ENCONTRADO: deposito %');
  PERFORM pg_temp.probe(150, 'an archived standalone item cannot be pulled into a group (P0002)', 'P0002', $q$SELECT pg_temp.guardar(pg_temp.grupo(150, 'E'), jsonb_build_array(jsonb_build_object('id', (SELECT id FROM inventario WHERE codigo = 'PB8-OLD' AND organization_id = (SELECT org FROM _s)), 'atributos', pg_temp.atr('["Rojo"]'))))$q$, 'NO_ENCONTRADO: item %');
  PERFORM pg_temp.probe(151, 'a supplier of another organization (P0002)', 'P0002', format($q$SELECT pg_temp.guardar(pg_temp.grupo(151, 'E'), jsonb_build_array(pg_temp.fila(851, '["Rojo"]', 'PB8-51')), jsonb_build_object('categoria', 'X', 'proveedor_id', %L))$q$, (SELECT proveedor FROM _o)), 'NO_ENCONTRADO: proveedor %');
  PERFORM pg_temp.probe(152, 'archiving a standalone (ungrouped) item is P0002', 'P0002', $q$SELECT pg_temp.guardar(pg_temp.grupo(8, 'Probe Archivo'), jsonb_build_array(pg_temp.fila(83, '["Verde"]', 'PB7-VE')), '{}', jsonb_build_array((SELECT suelto FROM _s)))$q$, 'NO_ENCONTRADO: an archived id%');
  PERFORM pg_temp.probe(153, 'archiving an item of another organization is P0002', 'P0002', format($q$SELECT pg_temp.guardar(pg_temp.grupo(8, 'Probe Archivo'), jsonb_build_array(pg_temp.fila(83, '["Verde"]', 'PB7-VE')), '{}', jsonb_build_array(%L::text))$q$, (SELECT hijo FROM _o)), 'NO_ENCONTRADO: an archived id%');
END $$;
SELECT pg_temp.ck(190, 'the other org''s group and child were not touched by the P0002 probes', 'Probe Other Group/OtherCat',
  (SELECT nombre FROM inventario_grupos WHERE id = (SELECT grupo FROM _o)) || '/' || (SELECT categoria FROM inventario WHERE id = (SELECT hijo FROM _o)));
SELECT pg_temp.ck(191, 'this org''s group kept its name through the cross-org probes', 'Probe Funda', nombre) FROM inventario_grupos WHERE id = pg_temp.cid(1);
SELECT pg_temp.ck(199, 'no call of the error battery left a row behind', '0', count(*)::TEXT) FROM inventario WHERE codigo LIKE 'PB8-%' AND codigo NOT IN ('PB8-KIT', 'PB8-OLD', 'PB8-X1', 'PB8-X2');

-- PROBE 9 (G3): the name vectors run through the RPC; the same rows as __tests__/helpers/variantes-vectores.ts.
-- NAMES:BEGIN
CREATE TEMP TABLE _v_nombre (n INT, base TEXT, valores JSONB, esperado TEXT);
INSERT INTO _v_nombre VALUES
  (1, 'Funda X', '["Azul","M"]', 'Funda X - Azul / M'),
  (2, 'Funda X', '["Azul"]', 'Funda X - Azul'),
  (3, 'Funda X', '["Azul","M","2"]', 'Funda X - Azul / M / 2'),
  (4, 'Funda - X', '["Azul","M"]', 'Funda - X - Azul / M'),
  (5, 'Cámara', '["Rojó"]', 'Cámara - Rojó'),
  (6, 'Funda X', '[]', 'Funda X');
-- NAMES:END
SELECT pg_temp.run('v' || n, jsonb_build_object('id', pg_temp.cid(500 + n), 'nombre', base,
    'opciones', (SELECT jsonb_agg(jsonb_build_object('nombre', (ARRAY['Color', 'Talle', 'Modelo'])[o], 'valores', jsonb_build_array(v)) ORDER BY o)
                   FROM jsonb_array_elements(valores) WITH ORDINALITY t(v, o))),
  jsonb_build_array(pg_temp.fila(600 + n, valores, 'PB9-' || n)))
  FROM _v_nombre WHERE jsonb_array_length(valores) > 0;
SELECT pg_temp.ck(200 + n, 'name vector ' || n || ': ' || base || ' ' || valores, esperado, COALESCE(i.nombre, 'missing: ' || (SELECT r ->> 'error' FROM _res WHERE k = 'v' || n)))
  FROM _v_nombre v LEFT JOIN inventario i ON i.id = pg_temp.cid(600 + v.n) WHERE jsonb_array_length(valores) > 0;

-- ROLLBACK REHEARSAL: run the rollback inline, then the function must be gone and the data untouched.
CREATE TEMP TABLE _antes AS SELECT id, nombre, stock, grupo_id, atributos, deleted_at FROM inventario WHERE grupo_id IN (pg_temp.cid(1), pg_temp.cid(8));
-- ROLLBACK:BEGIN
SET LOCAL lock_timeout = '3s';

DROP FUNCTION IF EXISTS guardar_grupo_variantes(TEXT, TEXT, JSONB, JSONB, JSONB, JSONB, TEXT);
-- ROLLBACK:END
INSERT INTO _r SELECT 900, 'rehearsal: the function is gone', 'true',
  (to_regprocedure('public.guardar_grupo_variantes(text,text,jsonb,jsonb,jsonb,jsonb,text)') IS NULL)::TEXT;
INSERT INTO _r SELECT 901, 'rehearsal: groups and children are untouched', 'true',
  ((SELECT count(*) FROM _antes) > 0 AND (SELECT count(*) FROM _antes a JOIN inventario i ON i.id = a.id
     WHERE i.nombre = a.nombre AND i.stock IS NOT DISTINCT FROM a.stock AND i.grupo_id IS NOT DISTINCT FROM a.grupo_id
       AND i.atributos IS NOT DISTINCT FROM a.atributos AND (i.deleted_at IS NULL) = (a.deleted_at IS NULL)) = (SELECT count(*) FROM _antes)
   AND (SELECT count(*) FROM inventario_grupos WHERE id IN (pg_temp.cid(1), pg_temp.cid(8))) = 2)::TEXT;

-- A check whose source query finds no row records nothing and could pass unseen: count the rows.
INSERT INTO _r SELECT 999, 'every check recorded its row (114 before this one)', '114', count(*)::TEXT FROM _r;

SELECT orden, probe, esperado, obtenido FROM _r ORDER BY orden, probe;

ROLLBACK;
