-- =============================================================================
-- Verificación de la migración 314 — revertir_cargos_orden y columnas de
-- reversa en cuenta_corriente.
--
-- CÓMO CORRERLO (ver verify/README.md):
--   - SQL editor de Supabase Studio, DESPUES de aplicar 314.
--   - SIN RLS. cuenta_corriente/clientes/sucursales tienen policies FOR ALL TO
--     authenticated sobre auth.uid(); en el editor no hay JWT, así que con RLS
--     encendido el setup de este probe no vería ninguna fila propia. Correr
--     sin RLS es además fiel a producción: las rutas usan supabaseAdmin
--     (service_role).
--
-- Todo corre dentro de BEGIN/ROLLBACK: no persiste ningún dato. En particular
-- este archivo CREA organización/sucursales/clientes de prueba (con slugs y
-- teléfonos claramente namespaceados 'probe-314-...') porque el RPC bajo
-- prueba necesita estados muy puntuales (saldo previo exacto, sucursal_id
-- distinguible, choque entre clientes/orgs) que no se pueden pedir prestados
-- de forma confiable a filas reales existentes. Nada de esto se necesita real:
-- cuenta_corriente.referencia_id no tiene FK, así que un TEXT arbitrario alcanza
-- para simular el CARGO que produce /entregar.
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
-- PROBE 0 — Las columnas, el índice parcial, la función y sus permisos existen.
-- ---------------------------------------------------------------------------
INSERT INTO _r SELECT 0, 'columna revertido_at', 'timestamp with time zone',
  COALESCE((SELECT data_type FROM information_schema.columns
            WHERE table_name = 'cuenta_corriente' AND column_name = 'revertido_at'), 'FALTA');

INSERT INTO _r SELECT 0, 'columna revertido_por', 'text',
  COALESCE((SELECT data_type FROM information_schema.columns
            WHERE table_name = 'cuenta_corriente' AND column_name = 'revertido_por'), 'FALTA');

INSERT INTO _r SELECT 0, 'columna revertido_movimiento_id', 'text',
  COALESCE((SELECT data_type FROM information_schema.columns
            WHERE table_name = 'cuenta_corriente' AND column_name = 'revertido_movimiento_id'), 'FALTA');

INSERT INTO _r SELECT 0, 'indice parcial idx_cuenta_corriente_revertido', 'true',
  COALESCE((SELECT (indpred IS NOT NULL)::TEXT
            FROM pg_index WHERE indexrelid = 'idx_cuenta_corriente_revertido'::regclass), 'FALTA');

INSERT INTO _r SELECT 0, 'una sola funcion revertir_cargos_orden', '1', COUNT(*)::TEXT
FROM pg_proc WHERE proname = 'revertir_cargos_orden';

-- RPC sensible (SECURITY DEFINER, ignora RLS): PUBLIC/anon/authenticated NO
-- pueden invocarla directo por PostgREST con la anon key; solo service_role.
INSERT INTO _r SELECT 0, 'PUBLIC sin EXECUTE', 'false',
  has_function_privilege('public', 'revertir_cargos_orden(text, text, jsonb, text, text)', 'EXECUTE')::TEXT;
INSERT INTO _r SELECT 0, 'anon sin EXECUTE', 'false',
  has_function_privilege('anon', 'revertir_cargos_orden(text, text, jsonb, text, text)', 'EXECUTE')::TEXT;
INSERT INTO _r SELECT 0, 'authenticated sin EXECUTE', 'false',
  has_function_privilege('authenticated', 'revertir_cargos_orden(text, text, jsonb, text, text)', 'EXECUTE')::TEXT;
INSERT INTO _r SELECT 0, 'service_role con EXECUTE', 'true',
  has_function_privilege('service_role', 'revertir_cargos_orden(text, text, jsonb, text, text)', 'EXECUTE')::TEXT;

-- ---------------------------------------------------------------------------
-- Setup — org/sucursales/clientes de prueba. Guardados en una temp table
-- porque cada bloque DO siguiente necesita leer varios de estos ids.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _setup (
  org_a TEXT, org_b TEXT,
  sucursal_1 TEXT, sucursal_2 TEXT,
  cliente_1 TEXT, cliente_2 TEXT, cliente_b TEXT
);

DO $$
DECLARE
  v_org_a TEXT; v_org_b TEXT;
  v_suc_1 TEXT; v_suc_2 TEXT;
  v_cli_1 TEXT; v_cli_2 TEXT; v_cli_b TEXT;
BEGIN
  INSERT INTO organizations (nombre, slug)
    VALUES ('Probe 314 Org A', 'probe-314-org-a') RETURNING id INTO v_org_a;
  INSERT INTO organizations (nombre, slug)
    VALUES ('Probe 314 Org B', 'probe-314-org-b') RETURNING id INTO v_org_b;

  INSERT INTO sucursales (organization_id, nombre)
    VALUES (v_org_a, 'Probe 314 Sucursal 1') RETURNING id INTO v_suc_1;
  INSERT INTO sucursales (organization_id, nombre)
    VALUES (v_org_a, 'Probe 314 Sucursal 2') RETURNING id INTO v_suc_2;

  INSERT INTO clientes (nombre, telefono, organization_id)
    VALUES ('Probe 314 Cliente 1', '3110000001', v_org_a) RETURNING id INTO v_cli_1;
  INSERT INTO clientes (nombre, telefono, organization_id)
    VALUES ('Probe 314 Cliente 2', '3110000002', v_org_a) RETURNING id INTO v_cli_2;
  INSERT INTO clientes (nombre, telefono, organization_id)
    VALUES ('Probe 314 Cliente B', '3110000003', v_org_b) RETURNING id INTO v_cli_b;

  INSERT INTO _setup VALUES (v_org_a, v_org_b, v_suc_1, v_suc_2, v_cli_1, v_cli_2, v_cli_b);
END $$;

INSERT INTO _r SELECT 0, 'setup: org/sucursales/clientes de prueba creados', '1', COUNT(*)::TEXT FROM _setup;

-- ---------------------------------------------------------------------------
-- PROBES 1, 2 y 3 — Un CARGO real (via cargar_deuda_cuenta_corriente, igual
-- que /entregar) se revierte: el saldo vuelve exacto, la DEVOLUCION hereda la
-- sucursal del CARGO original, y una segunda reversa del mismo movimiento
-- levanta excepción (guard revertido_at IS NOT NULL bajo FOR UPDATE).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_org TEXT; v_cli TEXT; v_suc1 TEXT;
  v_saldo_pre DECIMAL; v_saldo_post DECIMAL;
  v_cargo JSONB; v_cargo_id TEXT;
  v_resultado JSONB; v_devolucion_id TEXT; v_devolucion_suc TEXT;
BEGIN
  SELECT org_a, cliente_1, sucursal_1 INTO v_org, v_cli, v_suc1 FROM _setup;

  SELECT saldo_cuenta INTO v_saldo_pre FROM clientes WHERE id = v_cli;

  SELECT cargar_deuda_cuenta_corriente(v_org, v_cli, 500.00, 'ORDEN', 'orden-probe-1', NULL, v_suc1)
    INTO v_cargo;
  v_cargo_id := v_cargo->>'id';

  SELECT revertir_cargos_orden(v_org, v_cli, jsonb_build_array(v_cargo_id), 'reversa de prueba', NULL)
    INTO v_resultado;
  v_devolucion_id := v_resultado->'revertidos'->0->>'devolucionId';

  SELECT saldo_cuenta INTO v_saldo_post FROM clientes WHERE id = v_cli;
  INSERT INTO _r VALUES (1, 'saldo vuelve al valor previo al cargo', v_saldo_pre::TEXT, v_saldo_post::TEXT);

  SELECT sucursal_id INTO v_devolucion_suc FROM cuenta_corriente WHERE id = v_devolucion_id;
  INSERT INTO _r VALUES (2, 'DEVOLUCION hereda sucursal_id del CARGO original',
    v_suc1, COALESCE(v_devolucion_suc, 'NULL'));

  BEGIN
    PERFORM revertir_cargos_orden(v_org, v_cli, jsonb_build_array(v_cargo_id), 'segunda reversa', NULL);
    INSERT INTO _r VALUES (3, 'doble reversa del mismo movimiento', 'error', 'FALLO: no levanto excepcion');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES (3, 'doble reversa del mismo movimiento', 'error', 'OK: ' || SQLERRM);
  END;
END $$;

-- ---------------------------------------------------------------------------
-- PROBES 4, 5 y 6 — Solo un CARGO con referencia_tipo=ORDEN es revertible.
-- Un DEPOSITO, un PAGO y un CARGO con otra referencia se rechazan todos.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_org TEXT; v_cli TEXT;
  v_deposito_id TEXT; v_pago_id TEXT; v_cargo_no_orden_id TEXT;
BEGIN
  SELECT org_a, cliente_1 INTO v_org, v_cli FROM _setup;

  INSERT INTO cuenta_corriente (organization_id, cliente_id, tipo, monto, saldo_posterior, referencia_tipo, referencia_id)
    VALUES (v_org, v_cli, 'DEPOSITO', 100, 0, 'MANUAL', NULL) RETURNING id INTO v_deposito_id;

  INSERT INTO cuenta_corriente (organization_id, cliente_id, tipo, monto, saldo_posterior, referencia_tipo, referencia_id)
    VALUES (v_org, v_cli, 'PAGO', 100, 0, 'ORDEN', 'orden-probe-pago') RETURNING id INTO v_pago_id;

  INSERT INTO cuenta_corriente (organization_id, cliente_id, tipo, monto, saldo_posterior, referencia_tipo, referencia_id)
    VALUES (v_org, v_cli, 'CARGO', -100, 0, 'MANUAL', NULL) RETURNING id INTO v_cargo_no_orden_id;

  BEGIN
    PERFORM revertir_cargos_orden(v_org, v_cli, jsonb_build_array(v_deposito_id), 'rechazo esperado', NULL);
    INSERT INTO _r VALUES (4, 'rechaza tipo DEPOSITO', 'error', 'FALLO: no levanto excepcion');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES (4, 'rechaza tipo DEPOSITO', 'error', 'OK: ' || SQLERRM);
  END;

  BEGIN
    PERFORM revertir_cargos_orden(v_org, v_cli, jsonb_build_array(v_pago_id), 'rechazo esperado', NULL);
    INSERT INTO _r VALUES (5, 'rechaza tipo PAGO', 'error', 'FALLO: no levanto excepcion');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES (5, 'rechaza tipo PAGO', 'error', 'OK: ' || SQLERRM);
  END;

  BEGIN
    PERFORM revertir_cargos_orden(v_org, v_cli, jsonb_build_array(v_cargo_no_orden_id), 'rechazo esperado', NULL);
    INSERT INTO _r VALUES (6, 'rechaza CARGO con referencia_tipo != ORDEN', 'error', 'FALLO: no levanto excepcion');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES (6, 'rechaza CARGO con referencia_tipo != ORDEN', 'error', 'OK: ' || SQLERRM);
  END;
END $$;

-- ---------------------------------------------------------------------------
-- PROBES 7 y 8 — Un movimiento de otro cliente (misma org) y uno de otra
-- organización se rechazan: el SELECT ... WHERE id/organization_id/cliente_id
-- no matchea y el RPC lo trata como "no encontrado".
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_org_a TEXT; v_org_b TEXT; v_cli_1 TEXT; v_cli_2 TEXT; v_cli_b TEXT; v_suc1 TEXT;
  v_cargo_cli2 JSONB; v_cargo_cli2_id TEXT;
  v_cargo_orgb JSONB; v_cargo_orgb_id TEXT;
BEGIN
  SELECT org_a, org_b, cliente_1, cliente_2, cliente_b, sucursal_1
    INTO v_org_a, v_org_b, v_cli_1, v_cli_2, v_cli_b, v_suc1
    FROM _setup;

  SELECT cargar_deuda_cuenta_corriente(v_org_a, v_cli_2, 200.00, 'ORDEN', 'orden-probe-cli2', NULL, v_suc1)
    INTO v_cargo_cli2;
  v_cargo_cli2_id := v_cargo_cli2->>'id';

  SELECT cargar_deuda_cuenta_corriente(v_org_b, v_cli_b, 200.00, 'ORDEN', 'orden-probe-orgb', NULL, NULL)
    INTO v_cargo_orgb;
  v_cargo_orgb_id := v_cargo_orgb->>'id';

  BEGIN
    -- Pide reversa como cliente_1 (org A) de un movimiento que es de cliente_2 (org A).
    PERFORM revertir_cargos_orden(v_org_a, v_cli_1, jsonb_build_array(v_cargo_cli2_id), 'rechazo esperado', NULL);
    INSERT INTO _r VALUES (7, 'rechaza movimiento de otro cliente', 'error', 'FALLO: no levanto excepcion');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES (7, 'rechaza movimiento de otro cliente', 'error', 'OK: ' || SQLERRM);
  END;

  BEGIN
    -- Pide reversa como org A / cliente_1 de un movimiento que es de org B.
    PERFORM revertir_cargos_orden(v_org_a, v_cli_1, jsonb_build_array(v_cargo_orgb_id), 'rechazo esperado', NULL);
    INSERT INTO _r VALUES (8, 'rechaza movimiento de otra organizacion', 'error', 'FALLO: no levanto excepcion');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES (8, 'rechaza movimiento de otra organizacion', 'error', 'OK: ' || SQLERRM);
  END;
END $$;

-- ---------------------------------------------------------------------------
-- PROBE 9 — Atomicidad del lote: dos CARGO válidos + un id inexistente en el
-- mismo llamado no revierten NADA, ni siquiera los que ya se habían procesado
-- antes de llegar al inválido dentro del loop.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_org TEXT; v_cli TEXT; v_suc1 TEXT;
  v_saldo_pre DECIMAL; v_saldo_post DECIMAL;
  v_cargo_a JSONB; v_cargo_a_id TEXT;
  v_cargo_b JSONB; v_cargo_b_id TEXT;
  v_revertido_a TIMESTAMPTZ; v_revertido_b TIMESTAMPTZ;
BEGIN
  SELECT org_a, cliente_1, sucursal_1 INTO v_org, v_cli, v_suc1 FROM _setup;

  SELECT cargar_deuda_cuenta_corriente(v_org, v_cli, 300.00, 'ORDEN', 'orden-probe-batch-a', NULL, v_suc1)
    INTO v_cargo_a;
  v_cargo_a_id := v_cargo_a->>'id';

  SELECT cargar_deuda_cuenta_corriente(v_org, v_cli, 150.00, 'ORDEN', 'orden-probe-batch-b', NULL, v_suc1)
    INTO v_cargo_b;
  v_cargo_b_id := v_cargo_b->>'id';

  SELECT saldo_cuenta INTO v_saldo_pre FROM clientes WHERE id = v_cli;

  BEGIN
    PERFORM revertir_cargos_orden(
      v_org, v_cli,
      jsonb_build_array(v_cargo_a_id, v_cargo_b_id, 'movimiento-inexistente'),
      'lote con un invalido', NULL
    );
    INSERT INTO _r VALUES (9, 'lote con un movimiento invalido levanta excepcion', 'error', 'FALLO: no levanto excepcion');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES (9, 'lote con un movimiento invalido levanta excepcion', 'error', 'OK: ' || SQLERRM);
  END;

  SELECT saldo_cuenta INTO v_saldo_post FROM clientes WHERE id = v_cli;
  INSERT INTO _r VALUES (9, 'lote invalido: saldo del cliente sin cambios', v_saldo_pre::TEXT, v_saldo_post::TEXT);

  SELECT revertido_at INTO v_revertido_a FROM cuenta_corriente WHERE id = v_cargo_a_id;
  SELECT revertido_at INTO v_revertido_b FROM cuenta_corriente WHERE id = v_cargo_b_id;
  INSERT INTO _r VALUES (9, 'lote invalido: primer CARGO del lote sigue sin revertir',
    'NULL', COALESCE(v_revertido_a::TEXT, 'NULL'));
  INSERT INTO _r VALUES (9, 'lote invalido: segundo CARGO del lote sigue sin revertir',
    'NULL', COALESCE(v_revertido_b::TEXT, 'NULL'));
END $$;

-- Resultado único. Verde = `esperado` coincide con `obtenido`, y `obtenido`
-- arranca con "OK:" en las probes que esperan un error.
SELECT orden, probe, esperado, obtenido FROM _r ORDER BY orden, probe;

ROLLBACK;
