-- Verification of 408 (diagrama de daños): orden_danos, triggers and registrar_estado_fisico_recepcion.
--
-- Run AFTER 408 is applied:  node scripts/db-run.mjs <this file>
-- (no --apply: the file opens its own transaction and always ends in ROLLBACK).
-- Only data created: one scratch organization ('probe-408-org') with a client and a few orders, rolled back with everything.
-- The rollback rehearsal at the end takes ACCESS EXCLUSIVE locks until that ROLLBACK, so it runs last.
-- Green = esperado equals obtenido, or obtenido starts with 'OK:' for probes that expect an error.
-- An expected 'P0001:DANOS_X' compares SQLSTATE and message (every contract error is P0001);
-- a bare SQLSTATE like '23514' compares only the SQLSTATE.
-- Assumes the org insert creates its principal sucursal (217), as 348 does.

BEGIN;

CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);
CREATE TEMP TABLE _o (k TEXT PRIMARY KEY, id TEXT);

CREATE FUNCTION pg_temp.probe(p_orden INT, p_probe TEXT, p_esperado TEXT, p_sql TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_got TEXT := 'ok'; v_msg TEXT := '';
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    v_got := CASE WHEN position(':' IN p_esperado) > 0 THEN SQLSTATE || ':' || SQLERRM ELSE SQLSTATE END;
    v_msg := ' ' || SQLERRM;
  END;
  INSERT INTO _r VALUES (p_orden, p_probe, p_esperado,
    CASE WHEN v_got = p_esperado THEN 'OK: ' || v_got ELSE 'FALLO: ' || v_got || v_msg END);
END $$;

INSERT INTO organizations (nombre, slug) VALUES ('Probe 408 Org', 'probe-408-org');

-- Orders: a (main), b (ENTREGADO), c (created 11 min ago), d (cascade), e (sin daños), f (limit), g (user delete).
DO $$
DECLARE
  v_org TEXT; v_suc TEXT; v_cli TEXT; v_k TEXT; v_n INT := 0; v_id TEXT;
BEGIN
  SELECT id INTO v_org FROM organizations WHERE slug = 'probe-408-org';
  SELECT id INTO v_suc FROM sucursales WHERE organization_id = v_org AND principal LIMIT 1;
  INSERT INTO clientes (organization_id, nombre, telefono) VALUES (v_org, 'Cliente 408', '000') RETURNING id INTO v_cli;
  FOREACH v_k IN ARRAY ARRAY['a', 'b', 'c', 'd', 'e', 'f', 'g'] LOOP
    v_n := v_n + 1;
    INSERT INTO ordenes_servicio (organization_id, sucursal_id, cliente_id, numero_orden, codigo_orden,
                                  dispositivo, tipo_dispositivo, problema_reportado, estado)
    VALUES (v_org, v_suc, v_cli, v_n, 'PROBE408-' || v_k, 'Equipo', 'CELULAR', 'No enciende',
            (CASE WHEN v_k = 'b' THEN 'ENTREGADO' ELSE 'RECIBIDO' END)::estado_orden)
    RETURNING id INTO v_id;
    INSERT INTO _o VALUES (v_k, v_id);
  END LOOP;
  UPDATE ordenes_servicio SET fecha_ingreso = now() - interval '11 minutes' WHERE id = (SELECT id FROM _o WHERE k = 'c');
END $$;

-- 1: the RPC inserts 2 pins, returns 2, numbered 1 and 2.
INSERT INTO _r SELECT 1, 'RPC inserts 2 pins and returns 2', '2',
  public.registrar_estado_fisico_recepcion(
    (SELECT id FROM _o WHERE k = 'a'), (SELECT id FROM organizations WHERE slug = 'probe-408-org'),
    '[{"diagrama":"celular@1","vista":"frente","x":0.1,"y":0.2,"tipo":"rayon","nota":"borde"},
      {"diagrama":"celular@1","vista":"dorso","x":0.5,"y":0.5,"tipo":"golpe","nota":null}]'::jsonb,
    false, NULL)::TEXT;
INSERT INTO _r SELECT 1, 'pins are numbered 1,2 as recepcion', '1,2|recepcion',
  (SELECT string_agg(numero::TEXT, ',' ORDER BY numero) || '|' || min(momento)
     FROM orden_danos WHERE orden_id = (SELECT id FROM _o WHERE k = 'a'));

DO $$ BEGIN
  -- 2: a second RPC on the same order is refused.
  PERFORM pg_temp.probe(2, 'second RPC on the same order is refused (ya registrada)', 'P0001:DANOS_RECEPCION_YA_REGISTRADA',
    'SELECT public.registrar_estado_fisico_recepcion((SELECT id FROM _o WHERE k = ''a''), (SELECT id FROM organizations WHERE slug = ''probe-408-org''), ''[]''::jsonb, false, NULL)');
  -- 3: a direct recepcion INSERT is refused (the RPC closed the session flag again).
  PERFORM pg_temp.probe(3, 'direct recepcion INSERT is refused', 'P0001:DANOS_RECEPCION_INMUTABLE',
    'INSERT INTO orden_danos (organization_id, orden_id, diagrama, vista, x, y, tipo, momento) SELECT organization_id, id, ''celular@1'', ''frente'', 0.3, 0.3, ''golpe'', ''recepcion'' FROM ordenes_servicio WHERE id = (SELECT id FROM _o WHERE k = ''a'')');
  -- 4-5: recepcion pins cannot be updated or deleted.
  PERFORM pg_temp.probe(4, 'UPDATE of a pin is refused', 'P0001:DANOS_RECEPCION_INMUTABLE',
    'UPDATE orden_danos SET tipo = ''otro'' WHERE orden_id = (SELECT id FROM _o WHERE k = ''a'')');
  PERFORM pg_temp.probe(5, 'DELETE of a recepcion pin is refused', 'P0001:DANOS_RECEPCION_INMUTABLE',
    'DELETE FROM orden_danos WHERE orden_id = (SELECT id FROM _o WHERE k = ''a'') AND momento = ''recepcion''');
  -- 6: diagnostico pin: insert ok, immediate delete ok.
  PERFORM pg_temp.probe(6, 'diagnostico INSERT is accepted', 'ok',
    'INSERT INTO orden_danos (organization_id, orden_id, diagrama, vista, x, y, tipo, momento) SELECT organization_id, id, ''celular@1'', ''frente'', 0.3, 0.3, ''golpe'', ''diagnostico'' FROM ordenes_servicio WHERE id = (SELECT id FROM _o WHERE k = ''a'')');
  PERFORM pg_temp.probe(6, 'immediate DELETE of that diagnostico pin is accepted', 'ok',
    'DELETE FROM orden_danos WHERE orden_id = (SELECT id FROM _o WHERE k = ''a'') AND momento = ''diagnostico''');
  -- 7: age a diagnostico pin 11 minutes. created_at is forced to now() on INSERT, so the pin is
  -- aged with an UPDATE while the immutability trigger is disabled (inside this probe transaction).
  PERFORM pg_temp.probe(7, 'diagnostico INSERT for aging is accepted', 'ok',
    'INSERT INTO orden_danos (organization_id, orden_id, diagrama, vista, x, y, tipo, momento) SELECT organization_id, id, ''celular@1'', ''frente'', 0.3, 0.3, ''golpe'', ''diagnostico'' FROM ordenes_servicio WHERE id = (SELECT id FROM _o WHERE k = ''a'')');
  ALTER TABLE orden_danos DISABLE TRIGGER orden_danos_before_update;
  UPDATE orden_danos SET created_at = now() - interval '11 minutes'
   WHERE orden_id = (SELECT id FROM _o WHERE k = 'a') AND momento = 'diagnostico';
  ALTER TABLE orden_danos ENABLE TRIGGER orden_danos_before_update;
  PERFORM pg_temp.probe(7, 'DELETE of a diagnostico pin older than 10 min is refused', 'P0001:DANOS_DIAGNOSTICO_FUERA_DE_VENTANA',
    'DELETE FROM orden_danos WHERE orden_id = (SELECT id FROM _o WHERE k = ''a'') AND momento = ''diagnostico''');
  -- 7b: an explicit future created_at is overwritten with now(); 7c: the pin tenant must match the order's.
  PERFORM pg_temp.probe(7, 'diagnostico INSERT with future created_at is accepted', 'ok',
    'INSERT INTO orden_danos (organization_id, orden_id, diagrama, vista, x, y, tipo, momento, created_at) SELECT organization_id, id, ''celular@1'', ''frente'', 0.3, 0.3, ''golpe'', ''diagnostico'', now() + interval ''1 day'' FROM ordenes_servicio WHERE id = (SELECT id FROM _o WHERE k = ''c'')');
  PERFORM pg_temp.probe(7, 'INSERT with another organization_id than the order is refused', 'P0001:DANOS_ORDEN_NO_ENCONTRADA',
    'INSERT INTO orden_danos (organization_id, orden_id, diagrama, vista, x, y, tipo, momento) SELECT o2.id, ordenes_servicio.id, ''celular@1'', ''frente'', 0.3, 0.3, ''golpe'', ''diagnostico'' FROM ordenes_servicio, organizations o2 WHERE ordenes_servicio.id = (SELECT id FROM _o WHERE k = ''a'') AND o2.id <> ordenes_servicio.organization_id LIMIT 1');
  -- 8: closed order.
  PERFORM pg_temp.probe(8, 'diagnostico INSERT on an ENTREGADO order is refused', 'P0001:DANOS_ORDEN_CERRADA',
    'INSERT INTO orden_danos (organization_id, orden_id, diagrama, vista, x, y, tipo, momento) SELECT organization_id, id, ''celular@1'', ''frente'', 0.3, 0.3, ''golpe'', ''diagnostico'' FROM ordenes_servicio WHERE id = (SELECT id FROM _o WHERE k = ''b'')');
  -- 9: sin danos over an order that already has pins; and flag flip with pins.
  PERFORM pg_temp.probe(9, 'RPC sin_danos on an order with pins is refused', 'P0001:DANOS_RECEPCION_YA_REGISTRADA',
    'SELECT public.registrar_estado_fisico_recepcion((SELECT id FROM _o WHERE k = ''a''), (SELECT id FROM organizations WHERE slug = ''probe-408-org''), ''[]''::jsonb, true, NULL)');
  PERFORM pg_temp.probe(9, 'setting recepcion_sin_danos on an order with recepcion pins is refused', 'P0001:DANOS_SIN_DANOS_CON_PINS',
    'UPDATE ordenes_servicio SET recepcion_sin_danos = true WHERE id = (SELECT id FROM _o WHERE k = ''a'')');
  -- 10: CHECK violation.
  PERFORM pg_temp.probe(10, 'x = 1.5 violates the CHECK', '23514',
    'INSERT INTO orden_danos (organization_id, orden_id, diagrama, vista, x, y, tipo, momento) SELECT organization_id, id, ''celular@1'', ''frente'', 1.5, 0.3, ''golpe'', ''diagnostico'' FROM ordenes_servicio WHERE id = (SELECT id FROM _o WHERE k = ''a'')');
  -- 11: order created 11 minutes ago.
  PERFORM pg_temp.probe(11, 'RPC on an order older than 10 min is refused', 'P0001:DANOS_RECEPCION_FUERA_DE_VENTANA',
    'SELECT public.registrar_estado_fisico_recepcion((SELECT id FROM _o WHERE k = ''c''), (SELECT id FROM organizations WHERE slug = ''probe-408-org''), ''[]''::jsonb, false, NULL)');
  -- 14-16: sin danos path and tenant check.
  PERFORM pg_temp.probe(14, 'RPC sin_danos with no pins is accepted', 'ok',
    'SELECT public.registrar_estado_fisico_recepcion((SELECT id FROM _o WHERE k = ''e''), (SELECT id FROM organizations WHERE slug = ''probe-408-org''), ''[]''::jsonb, true, NULL)');
  PERFORM pg_temp.probe(15, 'RPC with pins after sin_danos is refused', 'P0001:DANOS_RECEPCION_YA_REGISTRADA',
    'SELECT public.registrar_estado_fisico_recepcion((SELECT id FROM _o WHERE k = ''e''), (SELECT id FROM organizations WHERE slug = ''probe-408-org''), ''[{"diagrama":"celular@1","vista":"frente","x":0.1,"y":0.1,"tipo":"rayon"}]''::jsonb, false, NULL)');
  PERFORM pg_temp.probe(16, 'RPC for another organization is refused', 'P0001:DANOS_ORDEN_NO_ENCONTRADA',
    'SELECT public.registrar_estado_fisico_recepcion((SELECT id FROM _o WHERE k = ''d''), ''otra-org'', ''[]''::jsonb, false, NULL)');
  -- 17: limit of 30 pins per order.
  PERFORM pg_temp.probe(17, '30 pins are accepted', 'ok',
    'INSERT INTO orden_danos (organization_id, orden_id, diagrama, vista, x, y, tipo, momento) SELECT o.organization_id, o.id, ''celular@1'', ''frente'', 0.3, 0.3, ''golpe'', ''diagnostico'' FROM ordenes_servicio o, generate_series(1, 30) WHERE o.id = (SELECT id FROM _o WHERE k = ''f'')');
  PERFORM pg_temp.probe(17, 'the 31st pin is refused', 'P0001:DANOS_LIMITE',
    'INSERT INTO orden_danos (organization_id, orden_id, diagrama, vista, x, y, tipo, momento) SELECT organization_id, id, ''celular@1'', ''frente'', 0.3, 0.3, ''golpe'', ''diagnostico'' FROM ordenes_servicio WHERE id = (SELECT id FROM _o WHERE k = ''f'')');
END $$;
INSERT INTO _r SELECT 17, 'numbering stays 1..30 without gaps', '1|30|30',
  (SELECT min(numero)::TEXT || '|' || max(numero)::TEXT || '|' || count(DISTINCT numero)::TEXT
     FROM orden_danos WHERE orden_id = (SELECT id FROM _o WHERE k = 'f'));

INSERT INTO _r SELECT 7, 'the future created_at was overwritten with now()', 'true',
  (SELECT bool_and(created_at = now())::TEXT FROM orden_danos WHERE orden_id = (SELECT id FROM _o WHERE k = 'c'));

-- 12: deleting the order cascades through the triggers (recepcion pin and a diagnostico pin older than 10 min).
SELECT public.registrar_estado_fisico_recepcion(
  (SELECT id FROM _o WHERE k = 'd'), (SELECT id FROM organizations WHERE slug = 'probe-408-org'),
  '[{"diagrama":"celular@1","vista":"frente","x":0.1,"y":0.2,"tipo":"rayon"}]'::jsonb, false, NULL);
INSERT INTO orden_danos (organization_id, orden_id, diagrama, vista, x, y, tipo, momento)
  SELECT organization_id, id, 'celular@1', 'frente', 0.3, 0.3, 'golpe', 'diagnostico'
    FROM ordenes_servicio WHERE id = (SELECT id FROM _o WHERE k = 'd');
ALTER TABLE orden_danos DISABLE TRIGGER orden_danos_before_update;
UPDATE orden_danos SET created_at = now() - interval '11 minutes'
 WHERE orden_id = (SELECT id FROM _o WHERE k = 'd') AND momento = 'diagnostico';
ALTER TABLE orden_danos ENABLE TRIGGER orden_danos_before_update;
INSERT INTO _r SELECT 12, 'order d has 2 pins before the delete', '2',
  (SELECT count(*) FROM orden_danos WHERE orden_id = (SELECT id FROM _o WHERE k = 'd'))::TEXT;
DO $$ BEGIN
  PERFORM pg_temp.probe(12, 'DELETE of the order cascades over recepcion and old diagnostico pins', 'ok',
    'DELETE FROM ordenes_servicio WHERE id = (SELECT id FROM _o WHERE k = ''d'')');
END $$;
INSERT INTO _r SELECT 12, 'no pins left for the deleted order', '0',
  (SELECT count(*) FROM orden_danos WHERE orden_id = (SELECT id FROM _o WHERE k = 'd'))::TEXT;

-- 18-20: RLS and function grants.
INSERT INTO _r SELECT 18, 'RLS enabled', 'true',
  (SELECT c.relrowsecurity::TEXT FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'orden_danos');
INSERT INTO _r SELECT 19, 'service_role policy plus own-org SELECT for authenticated, nothing else', '1|1|0',
  (SELECT count(*) FILTER (WHERE policyname = 'orden_danos_all_service' AND 'service_role' = ANY (roles))::TEXT || '|' ||
          count(*) FILTER (WHERE policyname = 'orden_danos_select' AND cmd = 'SELECT' AND roles = '{authenticated}'
                             AND qual LIKE '%get_current_organization_id()%')::TEXT || '|' ||
          count(*) FILTER (WHERE policyname NOT IN ('orden_danos_all_service', 'orden_danos_select'))::TEXT
     FROM pg_policies WHERE schemaname = 'public' AND tablename = 'orden_danos');
INSERT INTO _r SELECT 20, 'RPC is executable by service_role only', 'false|false|true',
  has_function_privilege('anon', 'public.registrar_estado_fisico_recepcion(text,text,jsonb,boolean,text)', 'EXECUTE')::TEXT || '|' ||
  has_function_privilege('authenticated', 'public.registrar_estado_fisico_recepcion(text,text,jsonb,boolean,text)', 'EXECUTE')::TEXT || '|' ||
  has_function_privilege('service_role', 'public.registrar_estado_fisico_recepcion(text,text,jsonb,boolean,text)', 'EXECUTE')::TEXT;

-- 21: user deletion (ON DELETE SET NULL on created_by) must not trip the immutability trigger.
INSERT INTO users (id, email, password, nombre, rol, organization_id)
  SELECT 'probe408-user', 'probe408@example.invalid', 'x', 'Probe 408', 'TECNICO', id
    FROM organizations WHERE slug = 'probe-408-org';
SELECT public.registrar_estado_fisico_recepcion(
  (SELECT id FROM _o WHERE k = 'g'), (SELECT id FROM organizations WHERE slug = 'probe-408-org'),
  '[{"diagrama":"celular@1","vista":"frente","x":0.1,"y":0.2,"tipo":"rayon"}]'::jsonb, false, 'probe408-user');
INSERT INTO _r SELECT 21, 'the pin carries the scratch user before the delete', 'probe408-user',
  (SELECT created_by FROM orden_danos WHERE orden_id = (SELECT id FROM _o WHERE k = 'g'));
DO $$ BEGIN
  PERFORM pg_temp.probe(21, 'DELETE of the user is accepted (SET NULL passes the UPDATE trigger)', 'ok',
    'DELETE FROM users WHERE id = ''probe408-user''');
END $$;
INSERT INTO _r SELECT 21, 'created_by is NULL and the pin survives', '1|true',
  (SELECT count(*)::TEXT || '|' || bool_and(created_by IS NULL)::TEXT
     FROM orden_danos WHERE orden_id = (SELECT id FROM _o WHERE k = 'g'));
-- 22: deleting the organization cascades over every pin, whichever table the cascade reaches first.
DO $$ BEGIN
  PERFORM pg_temp.probe(22, 'DELETE of the organization cascades over its pins', 'ok',
    'DELETE FROM organizations WHERE slug = ''probe-408-org''');
END $$;
INSERT INTO _r SELECT 22, 'no pins left after the organization delete', '0',
  (SELECT count(*) FROM orden_danos WHERE orden_id IN (SELECT id FROM _o))::TEXT;

-- 13: ROLLBACK REHEARSAL (last: ACCESS EXCLUSIVE until the final ROLLBACK).
CREATE TEMP TABLE _antes AS SELECT (SELECT count(*) FROM ordenes_servicio) AS ordenes;
-- ROLLBACK:BEGIN
SET LOCAL lock_timeout = '3s';

DROP TRIGGER IF EXISTS ordenes_servicio_sin_danos_check ON public.ordenes_servicio;
DROP FUNCTION IF EXISTS public.ordenes_servicio_sin_danos_check();
DROP FUNCTION IF EXISTS public.registrar_estado_fisico_recepcion(TEXT, TEXT, JSONB, BOOLEAN, TEXT);

-- Dropping the table drops its triggers; the trigger functions go after it.
DROP TABLE IF EXISTS public.orden_danos;
DROP FUNCTION IF EXISTS public.orden_danos_before_insert();
DROP FUNCTION IF EXISTS public.orden_danos_before_update();
DROP FUNCTION IF EXISTS public.orden_danos_before_delete();

ALTER TABLE public.ordenes_servicio DROP COLUMN IF EXISTS recepcion_sin_danos;
ALTER TABLE public.organizations DROP COLUMN IF EXISTS danos_recepcion_obligatorio;
-- ROLLBACK:END
INSERT INTO _r SELECT 80, 'rehearsal: table, functions and columns are gone', '0',
  ((SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'orden_danos') +
   (SELECT count(*) FROM pg_proc WHERE proname IN ('registrar_estado_fisico_recepcion', 'orden_danos_before_insert')) +
   (SELECT count(*) FROM information_schema.columns
     WHERE table_schema = 'public'
       AND ((table_name = 'ordenes_servicio' AND column_name = 'recepcion_sin_danos')
         OR (table_name = 'organizations' AND column_name = 'danos_recepcion_obligatorio'))))::TEXT;
INSERT INTO _r SELECT 81, 'rehearsal: no order row was lost', a.ordenes::TEXT,
  (SELECT count(*) FROM ordenes_servicio)::TEXT FROM _antes a;

SELECT orden, probe, esperado, obtenido FROM _r ORDER BY orden, probe;

ROLLBACK;
