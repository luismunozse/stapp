-- =============================================================================
-- Verificación de la migración 315 — crear_reparaciones_express, columna
-- pago_idempotency.cliente_id y feature flag reparaciones_express.
--
-- CÓMO CORRERLO (ver verify/README.md):
--   - SQL editor de Supabase Studio, DESPUES de aplicar 315.
--   - SIN RLS. ordenes_servicio/clientes/cuenta_corriente/plans tienen policies
--     FOR ALL TO authenticated sobre auth.uid(); en el editor no hay JWT, así
--     que con RLS encendido el setup de este probe no vería ninguna fila
--     propia. Correr sin RLS es además fiel a producción: las rutas usan
--     supabaseAdmin (service_role).
--
-- Todo corre dentro de BEGIN/ROLLBACK: no persiste ningún dato. Este archivo
-- CREA una organización/sucursal/cliente de prueba (namespaceados
-- 'probe-315-...') porque el RPC necesita un cliente con saldo_cuenta
-- conocido y una organización sin otras órdenes que contaminen los conteos.
--
-- crear_reparaciones_express, igual que revertir_cargos_orden (311), levanta
-- con RAISE EXCEPTION simple (SQLSTATE P0001, no check_violation), así que los
-- bloques que esperan rechazo usan EXCEPTION WHEN OTHERS, no WHEN check_violation.
--
-- Los resultados se acumulan en _r y salen en UN solo SELECT al final, porque
-- el editor muestra únicamente el último statement que devuelve filas.
--
-- Pendiente de correr contra la base real (no se ejecutó SQL como parte de
-- este trabajo).
-- =============================================================================

BEGIN;

CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);

-- ---------------------------------------------------------------------------
-- PROBE 0 — La función, sus permisos, la columna nueva y la feature flag
-- existen tal como los describe la migración.
-- ---------------------------------------------------------------------------
INSERT INTO _r SELECT 0, 'una sola funcion crear_reparaciones_express', '1', COUNT(*)::TEXT
FROM pg_proc WHERE proname = 'crear_reparaciones_express';

INSERT INTO _r SELECT 0, 'PUBLIC sin EXECUTE', 'false',
  has_function_privilege('public', 'crear_reparaciones_express(text, text, text, jsonb, text, text, text)', 'EXECUTE')::TEXT;
INSERT INTO _r SELECT 0, 'anon sin EXECUTE', 'false',
  has_function_privilege('anon', 'crear_reparaciones_express(text, text, text, jsonb, text, text, text)', 'EXECUTE')::TEXT;
INSERT INTO _r SELECT 0, 'authenticated sin EXECUTE', 'false',
  has_function_privilege('authenticated', 'crear_reparaciones_express(text, text, text, jsonb, text, text, text)', 'EXECUTE')::TEXT;
INSERT INTO _r SELECT 0, 'service_role con EXECUTE', 'true',
  has_function_privilege('service_role', 'crear_reparaciones_express(text, text, text, jsonb, text, text, text)', 'EXECUTE')::TEXT;

INSERT INTO _r SELECT 0, 'columna pago_idempotency.cliente_id', 'text',
  COALESCE((SELECT data_type FROM information_schema.columns
            WHERE table_name = 'pago_idempotency' AND column_name = 'cliente_id'), 'FALTA');

INSERT INTO _r SELECT 0, 'feature flag reparaciones_express en plan profesional', 'true',
  COALESCE((SELECT (feature_flags->>'reparaciones_express') FROM plans WHERE slug = 'profesional'), 'FALTA');
INSERT INTO _r SELECT 0, 'feature flag reparaciones_express en plan pro', 'true',
  COALESCE((SELECT (feature_flags->>'reparaciones_express') FROM plans WHERE slug = 'pro'), 'FALTA');

-- ---------------------------------------------------------------------------
-- Setup — org/sucursal/cliente de prueba, sin otras órdenes que contaminen
-- los conteos por cliente usados más abajo.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _setup (org_id TEXT, sucursal_id TEXT, cliente_id TEXT);

DO $$
DECLARE
  v_org TEXT; v_suc TEXT; v_cli TEXT;
BEGIN
  INSERT INTO organizations (nombre, slug)
    VALUES ('Probe 315 Org', 'probe-315-org') RETURNING id INTO v_org;

  INSERT INTO sucursales (organization_id, nombre)
    VALUES (v_org, 'Probe 315 Sucursal') RETURNING id INTO v_suc;

  INSERT INTO clientes (nombre, telefono, organization_id)
    VALUES ('Probe 315 Cliente', '3120000001', v_org) RETURNING id INTO v_cli;

  INSERT INTO _setup VALUES (v_org, v_suc, v_cli);
END $$;

INSERT INTO _r SELECT 0, 'setup: org/sucursal/cliente de prueba creados', '1', COUNT(*)::TEXT FROM _setup;

-- ---------------------------------------------------------------------------
-- PROBES 1 a 4 — Camino feliz: 2 reparaciones en un solo lote.
-- 1: N ordenes nacen ENTREGADO con su costo_final.
-- 2: exactamente N CARGO, uno por orden, cada uno apuntando a su propia orden.
-- 3: el saldo del cliente baja exactamente el total del lote, encadenado.
-- 4: la garantia se crea solo para la reparacion que trae diasGarantia > 0.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_org TEXT; v_suc TEXT; v_cli TEXT;
  v_precio1 DECIMAL(10,2) := 15000.00;
  v_precio2 DECIMAL(10,2) := 8000.00;
  v_reparaciones JSONB;
  v_resultado JSONB;
  v_orden1_id TEXT; v_orden2_id TEXT;
  v_saldo_pre DECIMAL(10,2); v_saldo_post DECIMAL(10,2);
  v_cargo1_id TEXT; v_cargo2_id TEXT;
  v_cargo1_ref TEXT; v_cargo2_ref TEXT;
  v_cargo1_saldo_post DECIMAL(10,2); v_cargo2_saldo_post DECIMAL(10,2);
  v_cnt_entregado INT;
  v_cnt_cargo INT;
  v_cnt_garantia1 INT; v_cnt_garantia2 INT;
BEGIN
  SELECT org_id, sucursal_id, cliente_id INTO v_org, v_suc, v_cli FROM _setup;

  SELECT saldo_cuenta INTO v_saldo_pre FROM clientes WHERE id = v_cli;

  v_reparaciones := jsonb_build_array(
    jsonb_build_object(
      'dispositivo', 'iPhone 12', 'tipoDispositivo', 'CELULAR', 'marca', 'Apple',
      'precio', v_precio1, 'trabajoRealizado', 'Cambio de pantalla',
      'publicToken', 'probe-315-tok-1', 'diasGarantia', 30,
      'fechaVencimientoGarantia', '2027-01-01T00:00:00Z'
    ),
    jsonb_build_object(
      'dispositivo', 'Notebook Lenovo', 'tipoDispositivo', 'COMPUTADORA', 'marca', 'Lenovo',
      'precio', v_precio2, 'trabajoRealizado', 'Cambio de teclado',
      'publicToken', 'probe-315-tok-2'
    )
  );

  SELECT crear_reparaciones_express(v_org, v_suc, v_cli, v_reparaciones, NULL, NULL, NULL)
    INTO v_resultado;

  v_orden1_id := v_resultado->'ordenes'->0->>'id';
  v_orden2_id := v_resultado->'ordenes'->1->>'id';
  v_cargo1_id := v_resultado->'ordenes'->0->>'movimientoId';
  v_cargo2_id := v_resultado->'ordenes'->1->>'movimientoId';

  -- PROBE 1
  INSERT INTO _r VALUES (1, 'cantidad de ordenes en la respuesta', '2',
    jsonb_array_length(v_resultado->'ordenes')::TEXT);

  SELECT COUNT(*) INTO v_cnt_entregado FROM ordenes_servicio
    WHERE id IN (v_orden1_id, v_orden2_id) AND estado = 'ENTREGADO';
  INSERT INTO _r VALUES (1, 'ambas ordenes nacen en ENTREGADO', '2', v_cnt_entregado::TEXT);

  INSERT INTO _r SELECT 1, 'costo_final de la orden 1 = precio', v_precio1::TEXT,
    (SELECT costo_final FROM ordenes_servicio WHERE id = v_orden1_id)::TEXT;
  INSERT INTO _r SELECT 1, 'costo_final de la orden 2 = precio', v_precio2::TEXT,
    (SELECT costo_final FROM ordenes_servicio WHERE id = v_orden2_id)::TEXT;

  -- PROBE 2
  SELECT COUNT(*) INTO v_cnt_cargo FROM cuenta_corriente
    WHERE cliente_id = v_cli AND tipo = 'CARGO' AND referencia_tipo = 'ORDEN';
  INSERT INTO _r VALUES (2, 'cantidad de movimientos CARGO = N', '2', v_cnt_cargo::TEXT);

  SELECT referencia_id INTO v_cargo1_ref FROM cuenta_corriente WHERE id = v_cargo1_id;
  INSERT INTO _r VALUES (2, 'CARGO de la orden 1 referencia a su propia orden', v_orden1_id, v_cargo1_ref);
  SELECT referencia_id INTO v_cargo2_ref FROM cuenta_corriente WHERE id = v_cargo2_id;
  INSERT INTO _r VALUES (2, 'CARGO de la orden 2 referencia a su propia orden', v_orden2_id, v_cargo2_ref);

  -- PROBE 3
  SELECT saldo_cuenta INTO v_saldo_post FROM clientes WHERE id = v_cli;
  INSERT INTO _r VALUES (3, 'saldo baja exactamente el total del lote',
    (v_saldo_pre - v_precio1 - v_precio2)::TEXT, v_saldo_post::TEXT);

  SELECT saldo_posterior INTO v_cargo1_saldo_post FROM cuenta_corriente WHERE id = v_cargo1_id;
  INSERT INTO _r VALUES (3, 'saldo_posterior encadena tras el primer CARGO',
    (v_saldo_pre - v_precio1)::TEXT, v_cargo1_saldo_post::TEXT);

  SELECT saldo_posterior INTO v_cargo2_saldo_post FROM cuenta_corriente WHERE id = v_cargo2_id;
  INSERT INTO _r VALUES (3, 'saldo_posterior encadena tras el segundo CARGO',
    (v_saldo_pre - v_precio1 - v_precio2)::TEXT, v_cargo2_saldo_post::TEXT);

  -- PROBE 4
  SELECT COUNT(*) INTO v_cnt_garantia1 FROM garantias WHERE orden_id = v_orden1_id;
  INSERT INTO _r VALUES (4, 'garantia creada para la reparacion con diasGarantia', '1', v_cnt_garantia1::TEXT);
  SELECT COUNT(*) INTO v_cnt_garantia2 FROM garantias WHERE orden_id = v_orden2_id;
  INSERT INTO _r VALUES (4, 'sin garantia para la reparacion sin diasGarantia', '0', v_cnt_garantia2::TEXT);
END $$;

-- ---------------------------------------------------------------------------
-- PROBE 5 — Atomicidad: un lote de 3 reparaciones donde la tercera tiene
-- precio <= 0 levanta excepcion y NO deja sobrevivir ni las 2 ordenes ni sus
-- CARGO que ya se habian insertado antes de llegar a la invalida dentro del
-- loop.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_org TEXT; v_suc TEXT; v_cli TEXT;
  v_reparaciones JSONB;
  v_cnt_ordenes_pre INT; v_cnt_ordenes_post INT;
  v_cnt_cargo_pre INT; v_cnt_cargo_post INT;
  v_saldo_pre DECIMAL(10,2); v_saldo_post DECIMAL(10,2);
BEGIN
  SELECT org_id, sucursal_id, cliente_id INTO v_org, v_suc, v_cli FROM _setup;

  SELECT COUNT(*) INTO v_cnt_ordenes_pre FROM ordenes_servicio WHERE cliente_id = v_cli;
  SELECT COUNT(*) INTO v_cnt_cargo_pre FROM cuenta_corriente WHERE cliente_id = v_cli AND tipo = 'CARGO';
  SELECT saldo_cuenta INTO v_saldo_pre FROM clientes WHERE id = v_cli;

  v_reparaciones := jsonb_build_array(
    jsonb_build_object('dispositivo', 'TV Samsung', 'tipoDispositivo', 'OTRO', 'precio', 5000.00,
      'trabajoRealizado', 'Cambio de fuente', 'publicToken', 'probe-315-tok-atomic-1'),
    jsonb_build_object('dispositivo', 'Parlante JBL', 'tipoDispositivo', 'OTRO', 'precio', 3000.00,
      'trabajoRealizado', 'Cambio de bateria', 'publicToken', 'probe-315-tok-atomic-2'),
    jsonb_build_object('dispositivo', 'Mouse Logitech', 'tipoDispositivo', 'OTRO', 'precio', -1,
      'trabajoRealizado', 'Reparacion de click', 'publicToken', 'probe-315-tok-atomic-3')
  );

  BEGIN
    PERFORM crear_reparaciones_express(v_org, v_suc, v_cli, v_reparaciones, NULL, NULL, NULL);
    INSERT INTO _r VALUES (5, 'lote con un precio invalido levanta excepcion', 'error', 'FALLO: no levanto excepcion');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES (5, 'lote con un precio invalido levanta excepcion', 'error', 'OK: ' || SQLERRM);
  END;

  SELECT COUNT(*) INTO v_cnt_ordenes_post FROM ordenes_servicio WHERE cliente_id = v_cli;
  INSERT INTO _r VALUES (5, 'lote invalido: ninguna orden sobrevive',
    v_cnt_ordenes_pre::TEXT, v_cnt_ordenes_post::TEXT);

  SELECT COUNT(*) INTO v_cnt_cargo_post FROM cuenta_corriente WHERE cliente_id = v_cli AND tipo = 'CARGO';
  INSERT INTO _r VALUES (5, 'lote invalido: ningun CARGO sobrevive',
    v_cnt_cargo_pre::TEXT, v_cnt_cargo_post::TEXT);

  SELECT saldo_cuenta INTO v_saldo_post FROM clientes WHERE id = v_cli;
  INSERT INTO _r VALUES (5, 'lote invalido: saldo del cliente sin cambios',
    v_saldo_pre::TEXT, v_saldo_post::TEXT);
END $$;

-- ---------------------------------------------------------------------------
-- PROBE 6 — Idempotencia: la misma idempotencyKey dos veces no cobra doble.
-- La segunda llamada replica la respuesta de la primera sin volver a correr
-- el loop.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_org TEXT; v_suc TEXT; v_cli TEXT;
  v_precio DECIMAL(10,2) := 4000.00;
  v_reparaciones JSONB;
  v_key TEXT := 'probe-315-idem-1';
  v_resultado1 JSONB; v_resultado2 JSONB;
  v_saldo_pre DECIMAL(10,2); v_saldo_post1 DECIMAL(10,2); v_saldo_post2 DECIMAL(10,2);
  v_cnt_ordenes_pre INT; v_cnt_ordenes_post INT;
BEGIN
  SELECT org_id, sucursal_id, cliente_id INTO v_org, v_suc, v_cli FROM _setup;

  SELECT saldo_cuenta INTO v_saldo_pre FROM clientes WHERE id = v_cli;
  SELECT COUNT(*) INTO v_cnt_ordenes_pre FROM ordenes_servicio WHERE cliente_id = v_cli;

  v_reparaciones := jsonb_build_array(
    jsonb_build_object('dispositivo', 'Tablet Samsung', 'tipoDispositivo', 'TABLET', 'precio', v_precio,
      'trabajoRealizado', 'Cambio de vidrio', 'publicToken', 'probe-315-tok-idem')
  );

  SELECT crear_reparaciones_express(v_org, v_suc, v_cli, v_reparaciones, NULL, NULL, v_key)
    INTO v_resultado1;
  INSERT INTO _r VALUES (6, 'primera llamada no viene replayed', 'false',
    COALESCE((v_resultado1->>'replayed'), 'false'));

  SELECT saldo_cuenta INTO v_saldo_post1 FROM clientes WHERE id = v_cli;

  SELECT crear_reparaciones_express(v_org, v_suc, v_cli, v_reparaciones, NULL, NULL, v_key)
    INTO v_resultado2;
  INSERT INTO _r VALUES (6, 'segunda llamada con la misma key viene replayed', 'true',
    (v_resultado2->>'replayed'));

  INSERT INTO _r VALUES (6, 'segunda llamada replica la respuesta de la primera',
    (v_resultado1->'ordenes')::TEXT, (v_resultado2->'response'->'ordenes')::TEXT);

  SELECT saldo_cuenta INTO v_saldo_post2 FROM clientes WHERE id = v_cli;
  INSERT INTO _r VALUES (6, 'la segunda llamada no vuelve a cobrar', v_saldo_post1::TEXT, v_saldo_post2::TEXT);

  SELECT COUNT(*) INTO v_cnt_ordenes_post FROM ordenes_servicio WHERE cliente_id = v_cli;
  INSERT INTO _r VALUES (6, 'la segunda llamada no crea una segunda orden',
    (v_cnt_ordenes_pre + 1)::TEXT, v_cnt_ordenes_post::TEXT);
END $$;

-- ---------------------------------------------------------------------------
-- PROBE 7 — Una reparacion con precio <= 0, sola en el lote, se rechaza.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_org TEXT; v_suc TEXT; v_cli TEXT;
  v_reparaciones JSONB;
BEGIN
  SELECT org_id, sucursal_id, cliente_id INTO v_org, v_suc, v_cli FROM _setup;

  v_reparaciones := jsonb_build_array(
    jsonb_build_object('dispositivo', 'Consola PS5', 'tipoDispositivo', 'CONSOLA', 'precio', 0,
      'trabajoRealizado', 'Limpieza', 'publicToken', 'probe-315-tok-precio-cero')
  );

  BEGIN
    PERFORM crear_reparaciones_express(v_org, v_suc, v_cli, v_reparaciones, NULL, NULL, NULL);
    INSERT INTO _r VALUES (7, 'precio <= 0 se rechaza', 'error', 'FALLO: no levanto excepcion');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES (7, 'precio <= 0 se rechaza', 'error', 'OK: ' || SQLERRM);
  END;
END $$;

-- Resultado único. Verde = `esperado` coincide con `obtenido`, y `obtenido`
-- arranca con "OK:" en las probes que esperan un error.
SELECT orden, probe, esperado, obtenido FROM _r ORDER BY orden, probe;

ROLLBACK;
