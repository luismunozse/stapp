-- Verification of 410: crear_recepcion_multiple registers each equipo's estado físico (408).
--
-- Run AFTER 410 is applied:  node scripts/db-run.mjs <this file>
-- (no --apply: the file opens its own transaction and always ends in ROLLBACK).
-- Only data created: one scratch organization ('probe-410-org') with a client and the receptions
-- the probes create, rolled back with everything.
-- The rollback rehearsal at the end takes a lock on the function until that ROLLBACK, so it runs last.
-- Green = esperado equals obtenido, or obtenido starts with 'OK:' for probes that expect an error.
-- An expected 'P0001:DANOS_X' compares SQLSTATE and message; a bare SQLSTATE like '23514' compares
-- only the SQLSTATE. Each failing call runs inside the probe's own subtransaction, which is what
-- the API sees: the whole statement fails and nothing of that reception remains.
-- Assumes the org insert creates its principal sucursal (217), as 348 and 408 do.

BEGIN;

CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);
CREATE TEMP TABLE _s (org TEXT, suc TEXT, cli TEXT);
CREATE TEMP TABLE _rec (k TEXT PRIMARY KEY, res JSONB);

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

-- The reception call for the scratch org; p_equipos gets a publicToken per element.
CREATE FUNCTION pg_temp.recepcion(p_equipos JSONB)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_equipos JSONB;
BEGIN
  SELECT jsonb_agg(e.el || jsonb_build_object('publicToken', 'probe410-' || md5(random()::TEXT)) ORDER BY e.ord)
    INTO v_equipos FROM jsonb_array_elements(p_equipos) WITH ORDINALITY AS e(el, ord);
  RETURN public.crear_recepcion_multiple(
    (SELECT org FROM _s), (SELECT suc FROM _s), (SELECT cli FROM _s), v_equipos,
    NULL, NULL, true, NULL, NULL, NULL, NULL);
END $$;

-- orders | pins | sin-daños flags of one reception.
CREATE FUNCTION pg_temp.resumen(p_recepcion_id TEXT)
RETURNS TEXT LANGUAGE sql AS $$
  SELECT (SELECT count(*) FROM ordenes_servicio WHERE recepcion_id = p_recepcion_id)::TEXT || '|' ||
         (SELECT count(*) FROM orden_danos d JOIN ordenes_servicio o ON o.id = d.orden_id
           WHERE o.recepcion_id = p_recepcion_id)::TEXT || '|' ||
         (SELECT count(*) FROM ordenes_servicio WHERE recepcion_id = p_recepcion_id AND recepcion_sin_danos)::TEXT
$$;

INSERT INTO organizations (nombre, slug) VALUES ('Probe 410 Org', 'probe-410-org');
DO $$
DECLARE v_org TEXT; v_suc TEXT; v_cli TEXT;
BEGIN
  SELECT id INTO v_org FROM organizations WHERE slug = 'probe-410-org';
  SELECT id INTO v_suc FROM sucursales WHERE organization_id = v_org AND principal LIMIT 1;
  INSERT INTO clientes (organization_id, nombre, telefono) VALUES (v_org, 'Cliente 410', '000') RETURNING id INTO v_cli;
  INSERT INTO _s VALUES (v_org, v_suc, v_cli);
END $$;

-- 1: equipo 1 with 2 pins, equipo 2 "sin daños", equipo 3 without estado físico.
INSERT INTO _rec SELECT 'a', pg_temp.recepcion(
  '[{"dispositivo":"iPhone 13","tipoDispositivo":"CELULAR","problemaReportado":"No enciende",
     "danos":[{"diagrama":"celular@1","vista":"frente","x":0.1,"y":0.2,"tipo":"rayon","nota":" borde "},
              {"diagrama":"celular@1","vista":"dorso","x":0.5,"y":0.5,"tipo":"golpe"}],
     "recepcionSinDanos":false},
    {"dispositivo":"Notebook HP","tipoDispositivo":"COMPUTADORA","problemaReportado":"Lenta","recepcionSinDanos":true},
    {"dispositivo":"Tablet","tipoDispositivo":"TABLET","problemaReportado":"Pantalla"}]'::jsonb);
INSERT INTO _r SELECT 1, 'reception creates 3 orders', '3',
  jsonb_array_length((SELECT res->'ordenes' FROM _rec WHERE k = 'a'))::TEXT;
INSERT INTO _r SELECT 1, 'equipo 1: 2 recepcion pins numbered 1,2 with the trimmed note', '1,2|recepcion|borde',
  (SELECT string_agg(numero::TEXT, ',' ORDER BY numero) || '|' || min(momento) || '|' || max(nota)
     FROM orden_danos WHERE orden_id = (SELECT res->'ordenes'->0->>'id' FROM _rec WHERE k = 'a'));
INSERT INTO _r SELECT 1, 'equipo 1: flag sin daños stays false', 'false',
  (SELECT recepcion_sin_danos::TEXT FROM ordenes_servicio WHERE id = (SELECT res->'ordenes'->0->>'id' FROM _rec WHERE k = 'a'));
INSERT INTO _r SELECT 2, 'equipo 2: flag sin daños set and no pins', 'true|0',
  (SELECT o.recepcion_sin_danos::TEXT || '|' || (SELECT count(*) FROM orden_danos d WHERE d.orden_id = o.id)::TEXT
     FROM ordenes_servicio o WHERE o.id = (SELECT res->'ordenes'->1->>'id' FROM _rec WHERE k = 'a'));
INSERT INTO _r SELECT 3, 'equipo 3 (no estado físico): no flag, no pins', 'false|0',
  (SELECT o.recepcion_sin_danos::TEXT || '|' || (SELECT count(*) FROM orden_danos d WHERE d.orden_id = o.id)::TEXT
     FROM ordenes_servicio o WHERE o.id = (SELECT res->'ordenes'->2->>'id' FROM _rec WHERE k = 'a'));
INSERT INTO _r SELECT 3, 'every pin belongs to the scratch org', 'true',
  (SELECT bool_and(organization_id = (SELECT org FROM _s))::TEXT FROM orden_danos
    WHERE orden_id IN (SELECT jsonb_array_elements((SELECT res->'ordenes' FROM _rec WHERE k = 'a'))->>'id'));

-- 4: a reception without any estado físico still works exactly as before.
INSERT INTO _rec SELECT 'b', pg_temp.recepcion(
  '[{"dispositivo":"A","tipoDispositivo":"CELULAR","problemaReportado":"x"},
    {"dispositivo":"B","tipoDispositivo":"CELULAR","problemaReportado":"y"}]'::jsonb);
INSERT INTO _r SELECT 4, 'reception without estado físico: 2 orders, no pins, no flags', '2|0|0',
  pg_temp.resumen((SELECT res->'recepcion'->>'id' FROM _rec WHERE k = 'b'));

CREATE TEMP TABLE _antes AS
  SELECT (SELECT count(*) FROM recepciones WHERE organization_id = (SELECT org FROM _s)) AS recepciones,
         (SELECT count(*) FROM ordenes_servicio WHERE organization_id = (SELECT org FROM _s)) AS ordenes,
         (SELECT count(*) FROM orden_danos WHERE organization_id = (SELECT org FROM _s)) AS danos;

DO $$ BEGIN
  -- 5: equipo 2 with pins AND sin daños: the whole reception fails (equipo 1 was valid).
  PERFORM pg_temp.probe(5, 'pins + sin daños on equipo 2 fails the whole reception', 'P0001:DANOS_SIN_DANOS_CON_PINS',
    $q$SELECT pg_temp.recepcion('[{"dispositivo":"A","tipoDispositivo":"CELULAR","problemaReportado":"x",
        "danos":[{"diagrama":"celular@1","vista":"frente","x":0.1,"y":0.1,"tipo":"rayon"}]},
      {"dispositivo":"B","tipoDispositivo":"CELULAR","problemaReportado":"y","recepcionSinDanos":true,
        "danos":[{"diagrama":"celular@1","vista":"frente","x":0.2,"y":0.2,"tipo":"golpe"}]}]'::jsonb)$q$);
  -- 6: an out-of-range pin on equipo 2 violates the orden_danos CHECK: whole reception fails.
  PERFORM pg_temp.probe(6, 'x = 1.5 on equipo 2 fails the whole reception (CHECK)', '23514',
    $q$SELECT pg_temp.recepcion('[{"dispositivo":"A","tipoDispositivo":"CELULAR","problemaReportado":"x","recepcionSinDanos":true},
      {"dispositivo":"B","tipoDispositivo":"CELULAR","problemaReportado":"y",
        "danos":[{"diagrama":"celular@1","vista":"frente","x":1.5,"y":0.2,"tipo":"golpe"}]}]'::jsonb)$q$);
  -- 7: an unknown pin tipo violates the CHECK too.
  PERFORM pg_temp.probe(7, 'unknown pin tipo fails the whole reception (CHECK)', '23514',
    $q$SELECT pg_temp.recepcion('[{"dispositivo":"A","tipoDispositivo":"CELULAR","problemaReportado":"x",
        "danos":[{"diagrama":"celular@1","vista":"frente","x":0.1,"y":0.2,"tipo":"quemadura"}]},
      {"dispositivo":"B","tipoDispositivo":"CELULAR","problemaReportado":"y"}]'::jsonb)$q$);
END $$;
INSERT INTO _r SELECT 8, 'failed receptions left no reception, order or pin behind', a.recepciones || '|' || a.ordenes || '|' || a.danos,
  (SELECT count(*) FROM recepciones WHERE organization_id = (SELECT org FROM _s))::TEXT || '|' ||
  (SELECT count(*) FROM ordenes_servicio WHERE organization_id = (SELECT org FROM _s))::TEXT || '|' ||
  (SELECT count(*) FROM orden_danos WHERE organization_id = (SELECT org FROM _s))::TEXT
  FROM _antes a;

-- 9: the recepcion pins stay closed to direct inserts after the reception (the RPC closes the GUC).
DO $$ BEGIN
  PERFORM pg_temp.probe(9, 'direct recepcion INSERT after the reception is refused', 'P0001:DANOS_RECEPCION_INMUTABLE',
    $q$INSERT INTO orden_danos (organization_id, orden_id, diagrama, vista, x, y, tipo, momento)
       SELECT organization_id, id, 'celular@1', 'frente', 0.3, 0.3, 'golpe', 'recepcion' FROM ordenes_servicio
        WHERE id = (SELECT res->'ordenes'->2->>'id' FROM _rec WHERE k = 'a')$q$);
END $$;

-- 10: function attributes and grants are the live ones (CREATE OR REPLACE keeps them).
INSERT INTO _r SELECT 10, 'still SECURITY INVOKER', 'false',
  (SELECT bool_or(prosecdef)::TEXT FROM pg_proc WHERE proname = 'crear_recepcion_multiple');
INSERT INTO _r SELECT 10, 'grants unchanged (anon|authenticated|service_role)', 'true|true|true',
  has_function_privilege('anon', 'public.crear_recepcion_multiple(text,text,text,jsonb,text,text,boolean,text,text,text,text)', 'EXECUTE')::TEXT || '|' ||
  has_function_privilege('authenticated', 'public.crear_recepcion_multiple(text,text,text,jsonb,text,text,boolean,text,text,text,text)', 'EXECUTE')::TEXT || '|' ||
  has_function_privilege('service_role', 'public.crear_recepcion_multiple(text,text,text,jsonb,text,text,boolean,text,text,text,text)', 'EXECUTE')::TEXT;
INSERT INTO _r SELECT 10, 'one overload only', '1',
  (SELECT count(*)::TEXT FROM pg_proc WHERE proname = 'crear_recepcion_multiple');

-- 11: ROLLBACK REHEARSAL (last).
-- ROLLBACK:BEGIN
-- Rollback of 410: restores the live crear_recepcion_multiple (without estado físico).
--
-- WHAT IS LOST: nothing stored. Pins and "sin daños" flags already registered stay in
-- orden_danos / ordenes_servicio; new multi-equipment receptions just stop registering them.
-- Run it only after the code that sends danos/recepcionSinDanos per equipo is reverted
-- (otherwise those fields are silently ignored). CREATE OR REPLACE keeps the grants.

CREATE OR REPLACE FUNCTION public.crear_recepcion_multiple(p_organization_id text, p_sucursal_id text, p_cliente_id text, p_equipos jsonb, p_firma_cliente text, p_firma_mime text, p_terminos boolean, p_recibido_por text, p_created_by text, p_telefono_contacto text DEFAULT NULL::text, p_observaciones text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_recepcion_id TEXT;
  v_numero       INTEGER;
  v_codigo       TEXT;
  v_equipo       JSONB;
  v_orden_id     TEXT;
  v_numero_orden INTEGER;
  v_codigo_orden TEXT;
  v_prefijo      TEXT;
  v_ordenes      JSONB := '[]'::JSONB;
BEGIN
  IF p_equipos IS NULL OR jsonb_array_length(p_equipos) < 2 THEN
    RAISE EXCEPTION 'recepcion_multiple: se requieren al menos 2 equipos';
  END IF;

  -- (1) Número propio, independiente del contador de órdenes, vía contador
  -- atómico (evita el race de MAX+1 entre terminales concurrentes).
  v_numero := get_next_recepcion_number(p_organization_id);
  v_codigo := 'REC' || LPAD(v_numero::TEXT, 3, '0');

  INSERT INTO recepciones (
    organization_id, sucursal_id, cliente_id, numero, codigo,
    firma_cliente, firma_mime, terminos_aceptados,
    recibido_por, observaciones, created_by
  ) VALUES (
    p_organization_id, p_sucursal_id, p_cliente_id, v_numero, v_codigo,
    p_firma_cliente, p_firma_mime, COALESCE(p_terminos, FALSE),
    p_recibido_por, p_observaciones, p_created_by
  ) RETURNING id INTO v_recepcion_id;

  -- (2) Una orden por equipo
  FOR v_equipo IN SELECT * FROM jsonb_array_elements(p_equipos)
  LOOP
    IF COALESCE(v_equipo->>'publicToken', '') = '' THEN
      RAISE EXCEPTION 'recepcion_multiple: publicToken faltante para el equipo %', v_equipo->>'dispositivo';
    END IF;

    SELECT prefijo_orden INTO v_prefijo
    FROM tipos_dispositivo
    WHERE organization_id = p_organization_id
      AND codigo = (v_equipo->>'tipoDispositivo')
      AND activo = TRUE
    LIMIT 1;

    v_prefijo := COALESCE(v_prefijo, 'ORD');
    v_numero_orden := get_next_order_number(p_organization_id);
    v_codigo_orden := v_prefijo || LPAD(v_numero_orden::TEXT, 3, '0');

    -- tipo_dispositivo es TEXT desde la migración 033: sin cast a enum
    INSERT INTO ordenes_servicio (
      numero_orden, codigo_orden, cliente_id, organization_id, sucursal_id,
      recepcion_id, dispositivo, tipo_dispositivo, marca, color, imei,
      problema_reportado, accesorios, password_dispositivo, metadata,
      estado, public_token, recibido_por, telefono_contacto
    ) VALUES (
      v_numero_orden,
      v_codigo_orden,
      p_cliente_id,
      p_organization_id,
      p_sucursal_id,
      v_recepcion_id,
      v_equipo->>'dispositivo',
      v_equipo->>'tipoDispositivo',
      NULLIF(v_equipo->>'marca', ''),
      NULLIF(v_equipo->>'color', ''),
      NULLIF(v_equipo->>'imei', ''),
      v_equipo->>'problemaReportado',
      NULLIF(v_equipo->>'accesorios', ''),
      NULLIF(v_equipo->>'codigoAccesoDispositivo', ''),
      COALESCE(v_equipo->'metadata', '{}'::JSONB),
      'RECIBIDO',
      v_equipo->>'publicToken',
      p_recibido_por,
      p_telefono_contacto
    ) RETURNING id INTO v_orden_id;

    v_ordenes := v_ordenes || jsonb_build_object(
      'id',          v_orden_id,
      'numeroOrden', v_numero_orden,
      'codigoOrden', v_codigo_orden,
      'dispositivo', v_equipo->>'dispositivo',
      'publicToken', v_equipo->>'publicToken'
    );
  END LOOP;

  RETURN jsonb_build_object(
    'recepcion', jsonb_build_object('id', v_recepcion_id, 'numero', v_numero, 'codigo', v_codigo),
    'ordenes',   v_ordenes
  );
END;
$function$;
-- ROLLBACK:END
INSERT INTO _r SELECT 11, 'rehearsal: the function no longer registers estado físico', 'false',
  (SELECT bool_or(prosrc LIKE '%registrar_estado_fisico_recepcion%')::TEXT FROM pg_proc WHERE proname = 'crear_recepcion_multiple');
INSERT INTO _rec SELECT 'c', pg_temp.recepcion(
  '[{"dispositivo":"A","tipoDispositivo":"CELULAR","problemaReportado":"x",
     "danos":[{"diagrama":"celular@1","vista":"frente","x":0.1,"y":0.1,"tipo":"rayon"}]},
    {"dispositivo":"B","tipoDispositivo":"CELULAR","problemaReportado":"y","recepcionSinDanos":true}]'::jsonb);
INSERT INTO _r SELECT 11, 'rehearsal: the old function ignores danos/recepcionSinDanos', '2|0|0',
  pg_temp.resumen((SELECT res->'recepcion'->>'id' FROM _rec WHERE k = 'c'));
INSERT INTO _r SELECT 11, 'rehearsal: grants unchanged', 'true|true',
  has_function_privilege('anon', 'public.crear_recepcion_multiple(text,text,text,jsonb,text,text,boolean,text,text,text,text)', 'EXECUTE')::TEXT || '|' ||
  has_function_privilege('service_role', 'public.crear_recepcion_multiple(text,text,text,jsonb,text,text,boolean,text,text,text,text)', 'EXECUTE')::TEXT;

SELECT orden, probe, esperado, obtenido FROM _r ORDER BY orden, probe;

ROLLBACK;
