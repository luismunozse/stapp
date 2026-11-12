-- Verification of 408 (multimoneda S4): currency of the variant group and converted kit cost.
--
-- Run AFTER 408 is applied:  node scripts/db-run.mjs <this file>
-- (no --apply: the file opens its own transaction and always ends in ROLLBACK).
-- Only data created: one scratch organization ('probe-408-org') with one variant group, a few items
-- and two kits, rolled back with everything. The rollback rehearsal at the end takes ACCESS
-- EXCLUSIVE on inventario (DROP TRIGGER) until that ROLLBACK, so it runs last.
-- Green = esperado equals obtenido, or obtenido starts with 'OK:' for probes run through
-- pg_temp.probe (they expect an SQLSTATE, 'ok' = no error).

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

-- Scratch org:
--   group G (USD): A (USD, active), C (USD, archived);
--   L: local, ungrouped (the item that may not join G); U: USD, ungrouped (it may join G);
--   X: USD, ungrouped control that no group write may touch;
--   kit K = P1 (local, 500) x1 + P2 (USD, 10) x2; kit K2 = P1 x3 + P3 (local, 7.5) x2; kit K0 empty.
CREATE TEMP TABLE _s (org TEXT, g TEXT, a TEXT, c TEXT, l TEXT, u TEXT, x TEXT,
                      p1 TEXT, p2 TEXT, p3 TEXT, k TEXT, k2 TEXT, k0 TEXT);
DO $$
DECLARE v_org TEXT; v_g TEXT; v_a TEXT; v_c TEXT; v_l TEXT; v_u TEXT; v_x TEXT;
        v_p1 TEXT; v_p2 TEXT; v_p3 TEXT; v_k TEXT; v_k2 TEXT; v_k0 TEXT;
BEGIN
  INSERT INTO organizations (nombre, slug) VALUES ('Probe 408 Org', 'probe-408-org') RETURNING id INTO v_org;
  INSERT INTO inventario_grupos (organization_id, nombre, opciones)
    VALUES (v_org, 'Probe 408 Funda', '[{"nombre":"Color","valores":["Rojo","Azul","Verde","Negro","Blanco","Gris"]}]')
    RETURNING id INTO v_g;
  -- First member of an empty group: keeps the currency it was inserted with.
  INSERT INTO inventario (organization_id, codigo, nombre, categoria, precio_compra, precio_venta, moneda, grupo_id, atributos)
    VALUES (v_org, 'P408-A', 'Probe 408 Funda - Rojo', 'P408Cat', 10, 20, 'USD', v_g, '[{"opcion":"Color","valor":"Rojo"}]')
    RETURNING id INTO v_a;
  INSERT INTO inventario (organization_id, codigo, nombre, categoria, precio_compra, precio_venta, moneda, grupo_id, atributos, deleted_at)
    VALUES (v_org, 'P408-C', 'Probe 408 Funda - Verde', 'P408Cat', 10, 20, 'USD', v_g, '[{"opcion":"Color","valor":"Verde"}]', NOW())
    RETURNING id INTO v_c;
  INSERT INTO inventario (organization_id, codigo, nombre, categoria, precio_compra, precio_venta)
    VALUES (v_org, 'P408-L', 'Probe 408 Local', 'P408Cat', 1, 2) RETURNING id INTO v_l;
  INSERT INTO inventario (organization_id, codigo, nombre, categoria, precio_compra, precio_venta, moneda)
    VALUES (v_org, 'P408-U', 'Probe 408 Dolar', 'P408Cat', 1, 2, 'USD') RETURNING id INTO v_u;
  INSERT INTO inventario (organization_id, codigo, nombre, categoria, precio_compra, precio_venta, moneda)
    VALUES (v_org, 'P408-X', 'Probe 408 Control', 'P408Cat', 1, 2, 'USD') RETURNING id INTO v_x;
  INSERT INTO inventario (organization_id, codigo, nombre, categoria, precio_compra, precio_venta)
    VALUES (v_org, 'P408-P1', 'Probe 408 Pieza local', 'P408Cat', 500, 900) RETURNING id INTO v_p1;
  INSERT INTO inventario (organization_id, codigo, nombre, categoria, precio_compra, precio_venta, moneda)
    VALUES (v_org, 'P408-P2', 'Probe 408 Pieza USD', 'P408Cat', 10, 20, 'USD') RETURNING id INTO v_p2;
  INSERT INTO inventario (organization_id, codigo, nombre, categoria, precio_compra, precio_venta)
    VALUES (v_org, 'P408-P3', 'Probe 408 Pieza local 2', 'P408Cat', 7.5, 15) RETURNING id INTO v_p3;
  INSERT INTO inventario (organization_id, codigo, nombre, categoria, precio_compra, precio_venta, es_kit, tipo_kit)
    VALUES (v_org, 'P408-K', 'Probe 408 Kit mixto', 'P408Cat', 0, 0, true, 'VIRTUAL') RETURNING id INTO v_k;
  INSERT INTO inventario (organization_id, codigo, nombre, categoria, precio_compra, precio_venta, es_kit, tipo_kit)
    VALUES (v_org, 'P408-K2', 'Probe 408 Kit local', 'P408Cat', 0, 0, true, 'VIRTUAL') RETURNING id INTO v_k2;
  INSERT INTO inventario (organization_id, codigo, nombre, categoria, precio_compra, precio_venta, es_kit, tipo_kit)
    VALUES (v_org, 'P408-K0', 'Probe 408 Kit vacio', 'P408Cat', 0, 0, true, 'VIRTUAL') RETURNING id INTO v_k0;
  INSERT INTO inventario_kit_items (kit_id, componente_id, cantidad, organization_id) VALUES
    (v_k, v_p1, 1, v_org), (v_k, v_p2, 2, v_org), (v_k2, v_p1, 3, v_org), (v_k2, v_p3, 2, v_org);
  INSERT INTO _s VALUES (v_org, v_g, v_a, v_c, v_l, v_u, v_x, v_p1, v_p2, v_p3, v_k, v_k2, v_k0);
END $$;

-- 1-4: shape.
INSERT INTO _r SELECT 1, 'exactly one calcular_costo_kit, with 5 arguments', '1|5',
  (SELECT count(*)::TEXT || '|' || COALESCE(max(pronargs)::TEXT, '-') FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace AND proname = 'calcular_costo_kit');
INSERT INTO _r SELECT 2, 'authenticated and service_role can execute the new calcular_costo_kit', 'true|true',
  has_function_privilege('authenticated', 'public.calcular_costo_kit(text,text,text,numeric,numeric)', 'EXECUTE')::TEXT || '|' ||
  has_function_privilege('service_role', 'public.calcular_costo_kit(text,text,text,numeric,numeric)', 'EXECUTE')::TEXT;
INSERT INTO _r SELECT 3, 'sync trigger is AFTER ... FOR EACH ROW and lists moneda', 'true',
  (SELECT (pg_get_triggerdef(t.oid) ~ '^CREATE TRIGGER inventario_sync_compartidos_grupo AFTER UPDATE OF .*moneda ON public\.inventario FOR EACH ROW WHEN')::TEXT
     FROM pg_trigger t WHERE t.tgrelid = 'public.inventario'::regclass AND t.tgname = 'inventario_sync_compartidos_grupo');
INSERT INTO _r SELECT 4, 'new trigger is BEFORE INSERT OR UPDATE OF grupo_id FOR EACH ROW', 'true',
  (SELECT (pg_get_triggerdef(t.oid) ~ '^CREATE TRIGGER inventario_moneda_grupo BEFORE INSERT OR UPDATE OF grupo_id ON public\.inventario FOR EACH ROW EXECUTE FUNCTION inventario_moneda_grupo\(\)$')::TEXT
     FROM pg_trigger t WHERE t.tgrelid = 'public.inventario'::regclass AND t.tgname = 'inventario_moneda_grupo');

-- 10-13: INSERT into a group takes the group's currency, whatever the INSERT said.
INSERT INTO inventario (organization_id, codigo, nombre, categoria, precio_compra, precio_venta, grupo_id, atributos)
  SELECT org, 'P408-B', 'Probe 408 Funda - Azul', 'P408Cat', 10, 20, g, '[{"opcion":"Color","valor":"Azul"}]' FROM _s;
INSERT INTO inventario (organization_id, codigo, nombre, categoria, precio_compra, precio_venta, moneda, grupo_id, atributos)
  SELECT org, 'P408-E', 'Probe 408 Funda - Negro', 'P408Cat', 10, 20, 'EUR', g, '[{"opcion":"Color","valor":"Negro"}]' FROM _s;
INSERT INTO _r SELECT 10, 'a variant inserted without moneda into a USD group is USD', 'USD',
  COALESCE((SELECT i.moneda FROM inventario i, _s WHERE i.organization_id = _s.org AND i.codigo = 'P408-B'), 'NULL');
INSERT INTO _r SELECT 11, 'a variant inserted as EUR into a USD group is USD', 'USD',
  COALESCE((SELECT i.moneda FROM inventario i, _s WHERE i.organization_id = _s.org AND i.codigo = 'P408-E'), 'NULL');
INSERT INTO _r SELECT 12, 'the first member of an empty group kept its own currency', 'USD',
  COALESCE((SELECT i.moneda FROM inventario i JOIN _s ON i.id = _s.a), 'NULL');
INSERT INTO _r SELECT 13, 'an ungrouped insert keeps its currency (local stays NULL)', 'NULL',
  COALESCE((SELECT i.moneda FROM inventario i JOIN _s ON i.id = _s.l), 'NULL');

-- 20-25: moving into a group.
DO $$ BEGIN
  PERFORM pg_temp.probe(20, 'moving a local item into a USD group is refused', '23514',
    format($q$UPDATE inventario SET grupo_id = %L, atributos = '[{"opcion":"Color","valor":"Blanco"}]' WHERE id = %L$q$,
           (SELECT g FROM _s), (SELECT l FROM _s)));
  PERFORM pg_temp.probe(22, 'moving a USD item into the USD group is accepted', 'ok',
    format($q$UPDATE inventario SET grupo_id = %L, atributos = '[{"opcion":"Color","valor":"Gris"}]' WHERE id = %L$q$,
           (SELECT g FROM _s), (SELECT u FROM _s)));
  PERFORM pg_temp.probe(23, 'rewriting grupo_id with the same value never raises', 'ok',
    format('UPDATE inventario SET grupo_id = grupo_id, moneda = moneda WHERE id = %L', (SELECT a FROM _s)));
  PERFORM pg_temp.probe(24, 'ungrouping (grupo_id NULL) never raises', 'ok',
    format('UPDATE inventario SET grupo_id = NULL, atributos = NULL WHERE id = %L', (SELECT u FROM _s)));
END $$;
DO $$
DECLARE v_msg TEXT := '(no error)';
BEGIN
  BEGIN
    UPDATE inventario SET grupo_id = (SELECT g FROM _s), atributos = '[{"opcion":"Color","valor":"Blanco"}]'
     WHERE id = (SELECT l FROM _s);
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  INSERT INTO _r VALUES (21, 'the refusal message is MONEDA_GRUPO_MIXTA (the app maps it to 400)', 'MONEDA_GRUPO_MIXTA', v_msg);
END $$;
INSERT INTO _r SELECT 25, 'the refused item is still local and ungrouped', 'NULL|NULL',
  COALESCE(i.moneda, 'NULL') || '|' || COALESCE(i.grupo_id, 'NULL') FROM inventario i JOIN _s ON i.id = _s.l;

-- 30-34: changing the currency of one variant changes the whole group (archived member included).
UPDATE inventario SET moneda = 'EUR' WHERE id = (SELECT a FROM _s);
INSERT INTO _r SELECT 30, 'one variant set to EUR: every member of the group is EUR (A, B, C archived, E)', '4|4',
  count(*)::TEXT || '|' || count(*) FILTER (WHERE i.moneda = 'EUR')::TEXT
  FROM inventario i JOIN _s ON i.grupo_id = _s.g AND i.organization_id = _s.org;
-- The PUT route's group-wide statement (AFTER ROW trigger: the propagation finds nothing left to do).
DO $$ BEGIN
  PERFORM pg_temp.probe(31, 'group-wide UPDATE SET moneda = NULL WHERE grupo_id (the route statement) runs', 'ok',
    format('UPDATE inventario SET moneda = NULL WHERE grupo_id = %L AND organization_id = %L', (SELECT g FROM _s), (SELECT org FROM _s)));
END $$;
INSERT INTO _r SELECT 32, 'after the group-wide statement every member is local', '4|0',
  count(*)::TEXT || '|' || count(*) FILTER (WHERE i.moneda IS NOT NULL)::TEXT
  FROM inventario i JOIN _s ON i.grupo_id = _s.g AND i.organization_id = _s.org;
DO $$ BEGIN
  PERFORM pg_temp.probe(33, 'now the local item may join the (now local) group', 'ok',
    format($q$UPDATE inventario SET grupo_id = %L, atributos = '[{"opcion":"Color","valor":"Blanco"}]' WHERE id = %L$q$,
           (SELECT g FROM _s), (SELECT l FROM _s)));
END $$;
INSERT INTO _r SELECT 34, 'ungrouped USD rows were never touched by any group write (U, X)', '2',
  count(*)::TEXT FROM inventario i, _s WHERE i.id IN (_s.u, _s.x) AND i.moneda = 'USD';

-- 40-49: kit cost. K = 500 x1 (local) + 10 USD x2.
INSERT INTO _r SELECT 40, 'K at USD 1200, unit 10: 500 + 2 x round(12000/10)x10', '24500',
  COALESCE(trim_scale(calcular_costo_kit(k, org, 'USD', 1200, 10))::TEXT, 'NULL') FROM _s;
INSERT INTO _r SELECT 41, 'K at USD 1234.567, unit 10: 500 + 2 x 12350', '25200',
  COALESCE(trim_scale(calcular_costo_kit(k, org, 'USD', 1234.567, 10))::TEXT, 'NULL') FROM _s;
INSERT INTO _r SELECT 42, 'K at USD 1234.567, unit 0: 500 + 2 x round(12345.67, 2)', '25191.34',
  COALESCE(trim_scale(calcular_costo_kit(k, org, 'USD', 1234.567, 0))::TEXT, 'NULL') FROM _s;
INSERT INTO _r SELECT 43, 'K without a rate is NULL', 'NULL',
  COALESCE(trim_scale(calcular_costo_kit(k, org, 'USD'))::TEXT, 'NULL') FROM _s;
INSERT INTO _r SELECT 44, 'K with a zero rate is NULL', 'NULL',
  COALESCE(trim_scale(calcular_costo_kit(k, org, 'USD', 0, 10))::TEXT, 'NULL') FROM _s;
INSERT INTO _r SELECT 45, 'K with p_moneda EUR (component is USD) is NULL', 'NULL',
  COALESCE(trim_scale(calcular_costo_kit(k, org, 'EUR', 1200, 10))::TEXT, 'NULL') FROM _s;
INSERT INTO _r SELECT 46, 'K with the 2-argument call is NULL (a foreign component, no rate)', 'NULL',
  COALESCE(trim_scale(calcular_costo_kit(k, org))::TEXT, 'NULL') FROM _s;
INSERT INTO _r SELECT 47, 'K2 (local only) with the 2-argument call equals the direct sum (3x500 + 2x7.5)', '1515|1515',
  COALESCE(trim_scale(calcular_costo_kit(k2, org))::TEXT, 'NULL') || '|' ||
  (SELECT trim_scale(SUM(ki.cantidad * COALESCE(inv.precio_compra, 0)))::TEXT
     FROM inventario_kit_items ki JOIN inventario inv ON inv.id = ki.componente_id
    WHERE ki.kit_id = _s.k2 AND ki.organization_id = _s.org) FROM _s;
INSERT INTO _r SELECT 48, 'K2 (local only) ignores any rate passed', 'true',
  (calcular_costo_kit(k2, org, 'USD', 1200, 10) = calcular_costo_kit(k2, org))::TEXT FROM _s;
INSERT INTO _r SELECT 49, 'an empty kit costs 0', '0',
  COALESCE(trim_scale(calcular_costo_kit(k0, org))::TEXT, 'NULL') FROM _s;

-- ROLLBACK REHEARSAL (last: DROP TRIGGER holds ACCESS EXCLUSIVE on inventario until the final ROLLBACK).
-- ROLLBACK:BEGIN
SET LOCAL lock_timeout = '3s';

DROP TRIGGER IF EXISTS inventario_moneda_grupo ON inventario;
DROP FUNCTION IF EXISTS inventario_moneda_grupo();

CREATE OR REPLACE FUNCTION inventario_sync_compartidos_grupo()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_setting('stapp.sync_grupo', true) = 'on' THEN
    RETURN NULL;
  END IF;
  PERFORM set_config('stapp.sync_grupo', 'on', true);
  UPDATE inventario i SET
    descripcion = NEW.descripcion, categoria = NEW.categoria,
    tipo_dispositivo = NEW.tipo_dispositivo, proveedor = NEW.proveedor,
    proveedor_id = NEW.proveedor_id, dias_garantia_default = NEW.dias_garantia_default,
    trackea_lotes = NEW.trackea_lotes, trackea_series = NEW.trackea_series,
    dias_alerta_vencimiento = NEW.dias_alerta_vencimiento
  WHERE i.grupo_id = NEW.grupo_id AND i.organization_id = NEW.organization_id
    AND (i.descripcion, i.categoria, i.tipo_dispositivo, i.proveedor, i.proveedor_id,
         i.dias_garantia_default, i.trackea_lotes, i.trackea_series, i.dias_alerta_vencimiento)
        IS DISTINCT FROM
        (NEW.descripcion, NEW.categoria, NEW.tipo_dispositivo, NEW.proveedor, NEW.proveedor_id,
         NEW.dias_garantia_default, NEW.trackea_lotes, NEW.trackea_series, NEW.dias_alerta_vencimiento);
  PERFORM set_config('stapp.sync_grupo', 'off', true);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER inventario_sync_compartidos_grupo
  AFTER UPDATE OF descripcion, categoria, tipo_dispositivo, proveedor, proveedor_id,
                  dias_garantia_default, trackea_lotes, trackea_series, dias_alerta_vencimiento
  ON inventario
  FOR EACH ROW
  WHEN (NEW.grupo_id IS NOT NULL AND
        (OLD.descripcion, OLD.categoria, OLD.tipo_dispositivo, OLD.proveedor, OLD.proveedor_id,
         OLD.dias_garantia_default, OLD.trackea_lotes, OLD.trackea_series, OLD.dias_alerta_vencimiento)
        IS DISTINCT FROM
        (NEW.descripcion, NEW.categoria, NEW.tipo_dispositivo, NEW.proveedor, NEW.proveedor_id,
         NEW.dias_garantia_default, NEW.trackea_lotes, NEW.trackea_series, NEW.dias_alerta_vencimiento))
  EXECUTE FUNCTION inventario_sync_compartidos_grupo();

DROP FUNCTION IF EXISTS calcular_costo_kit(TEXT, TEXT, TEXT, NUMERIC, NUMERIC);

CREATE OR REPLACE FUNCTION calcular_costo_kit(
  p_kit_id  TEXT,
  p_org_id  TEXT
) RETURNS NUMERIC AS $$
DECLARE
  v_costo NUMERIC;
BEGIN
  SELECT COALESCE(SUM(ki.cantidad * COALESCE(inv.precio_compra, 0)), 0)
    INTO v_costo
  FROM inventario_kit_items ki
  JOIN inventario inv ON inv.id = ki.componente_id
  WHERE ki.kit_id = p_kit_id
    AND ki.organization_id = p_org_id;

  RETURN v_costo;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION calcular_costo_kit(TEXT,TEXT) IS
  'Suma (cantidad * precio_compra) de cada componente directo de un kit. NO explosiona sub-kits.';

GRANT EXECUTE ON FUNCTION calcular_costo_kit(TEXT,TEXT) TO authenticated, service_role;
-- ROLLBACK:END
INSERT INTO _r SELECT 80, 'rehearsal: the new trigger and its function are gone', '0',
  ((SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.inventario'::regclass AND tgname = 'inventario_moneda_grupo') +
   (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'inventario_moneda_grupo'))::TEXT;
INSERT INTO _r SELECT 81, 'rehearsal: one calcular_costo_kit with 2 arguments, granted as in 177', '1|2|true',
  (SELECT count(*)::TEXT || '|' || COALESCE(max(pronargs)::TEXT, '-') FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace AND proname = 'calcular_costo_kit') || '|' ||
  has_function_privilege('authenticated', 'public.calcular_costo_kit(text,text)', 'EXECUTE')::TEXT;
INSERT INTO _r SELECT 82, 'rehearsal: the 177 function sums K raw again (500 + 2x10)', '520',
  COALESCE(trim_scale(calcular_costo_kit(k, org))::TEXT, 'NULL') FROM _s;
INSERT INTO _r SELECT 83, 'rehearsal: the sync trigger no longer lists moneda', 'false',
  (SELECT (pg_get_triggerdef(t.oid) ~ 'moneda')::TEXT
     FROM pg_trigger t WHERE t.tgrelid = 'public.inventario'::regclass AND t.tgname = 'inventario_sync_compartidos_grupo');
UPDATE inventario SET moneda = 'USD' WHERE id = (SELECT a FROM _s);
INSERT INTO _r SELECT 84, 'rehearsal: a currency change no longer fans out (only A is USD)', '1',
  count(*) FILTER (WHERE i.moneda = 'USD')::TEXT
  FROM inventario i JOIN _s ON i.grupo_id = _s.g AND i.organization_id = _s.org;

INSERT INTO _r SELECT 999, 'probe rows recorded (a missing row means a probe did not run)', '34', count(*)::TEXT FROM _r;

SELECT orden, probe, esperado, obtenido FROM _r ORDER BY orden, probe;

ROLLBACK;
