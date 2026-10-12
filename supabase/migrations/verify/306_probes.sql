-- =============================================================================
-- Verificación de la migración 306 — numeración de recibos de cuenta corriente.
--
-- CÓMO CORRERLO (ver verify/README.md):
--   - SQL editor de Supabase Studio, DESPUES de aplicar 306.
--   - SIN RLS. La policy de cuenta_corriente (mig 066) es FOR ALL TO
--     authenticated sobre auth.uid(); en el editor no hay JWT, así que con RLS
--     encendido no ve ninguna fila y el setup aborta. Correr sin RLS además es
--     fiel a producción: las rutas usan supabaseAdmin (service_role).
--
-- Todo corre dentro de BEGIN/ROLLBACK: no persiste ningún dato, y en particular
-- no quema números de recibo reales.
--
-- Los resultados se acumulan en _r y salen en UN solo SELECT al final, porque
-- el editor muestra únicamente el último statement que devuelve filas.
--
-- Verificado contra la base real el 2026-08-22: 9/9 verdes.
-- =============================================================================

BEGIN;

CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);

-- Un movimiento de dinero recibido (DEPOSITO o PAGO) para probar la emisión, y
-- uno de débito (CARGO o USO) para probar el rechazo.
CREATE TEMP TABLE _probe_cobro AS
SELECT id, organization_id FROM cuenta_corriente
WHERE tipo IN ('DEPOSITO', 'PAGO') ORDER BY created_at DESC LIMIT 1;

CREATE TEMP TABLE _probe_debito AS
SELECT id, organization_id FROM cuenta_corriente
WHERE tipo IN ('CARGO', 'USO') ORDER BY created_at DESC LIMIT 1;

INSERT INTO _r SELECT 0, 'setup: movimiento de cobro', '1', COUNT(*)::TEXT FROM _probe_cobro;

-- ---------------------------------------------------------------------------
-- PROBE 1 — La columna y el índice único parcial existen.
--
-- El índice es PARCIAL (WHERE numero_recibo IS NOT NULL) a propósito: la enorme
-- mayoría de los movimientos nunca se imprime y sus NULL no deben competir
-- entre sí por la unicidad.
-- ---------------------------------------------------------------------------
INSERT INTO _r SELECT 1, 'columna numero_recibo', 'integer',
  COALESCE((SELECT data_type FROM information_schema.columns
            WHERE table_name = 'cuenta_corriente' AND column_name = 'numero_recibo'), 'FALTA');

INSERT INTO _r SELECT 1, 'indice unico / parcial', 'true / true',
  (SELECT indisunique::TEXT || ' / ' || (indpred IS NOT NULL)::TEXT
     FROM pg_index WHERE indexrelid = 'cuenta_corriente_numero_recibo_org_uniq'::regclass);

-- ---------------------------------------------------------------------------
-- PROBES 2, 3 y 4 — Emisión, reimpresión y correlativo por organización.
--
-- La 3 es la garantía central de la 306: si la reimpresión devolviera un número
-- distinto, el cliente terminaría con dos papeles numerados distinto por el
-- mismo cobro.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_id TEXT; v_org TEXT; n1 INT; n2 INT; v_persistido INT;
BEGIN
  SELECT id, organization_id INTO v_id, v_org FROM _probe_cobro;
  IF v_id IS NULL THEN
    INSERT INTO _r VALUES (2, 'emision', '-', 'ABORTADA: sin movimientos DEPOSITO/PAGO');
    RETURN;
  END IF;

  UPDATE cuenta_corriente SET numero_recibo = NULL WHERE id = v_id;
  n1 := asignar_numero_recibo_cc(v_org, v_id);
  SELECT numero_recibo INTO v_persistido FROM cuenta_corriente WHERE id = v_id;
  INSERT INTO _r VALUES (2, 'primera emision se persiste', n1::TEXT, v_persistido::TEXT);

  n2 := asignar_numero_recibo_cc(v_org, v_id);
  INSERT INTO _r VALUES (3, 'reimpresion = mismo numero', n1::TEXT, n2::TEXT);

  INSERT INTO _r SELECT 4, 'max de la org', n1::TEXT, MAX(numero_recibo)::TEXT
  FROM cuenta_corriente WHERE organization_id = v_org;
END $$;

-- ---------------------------------------------------------------------------
-- PROBE 5 — Un movimiento de débito NO se puede emitir como recibo.
--
-- Un recibo acredita dinero recibido; CARGO (fiado) y USO (consumo de saldo)
-- son débitos. La función debe levantar excepción, no acuñar un número.
-- Se saltea sola si la base no tiene movimientos de débito.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_id TEXT; v_org TEXT;
BEGIN
  SELECT id, organization_id INTO v_id, v_org FROM _probe_debito;
  IF v_id IS NULL THEN
    INSERT INTO _r VALUES (5, 'debito rechazado', 'error', 'SALTEADA: sin CARGO/USO en la base');
    RETURN;
  END IF;
  BEGIN
    PERFORM asignar_numero_recibo_cc(v_org, v_id);
    INSERT INTO _r VALUES (5, 'debito rechazado', 'error', 'FALLO: emitio recibo de un debito');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO _r VALUES (5, 'debito rechazado', 'error', 'OK: ' || SQLERRM);
  END;
END $$;

-- ---------------------------------------------------------------------------
-- PROBE 6 — Un movimiento inexistente levanta excepción, no devuelve NULL.
--
-- Importa más de lo que parece: es lo que hace que la función falle ruidosa si
-- alguna vez se la llamara bajo RLS sin permiso de ver la fila, en vez de hacer
-- un UPDATE de cero filas y devolver un número que nunca se persistió.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM asignar_numero_recibo_cc('org-inexistente', 'mov-inexistente');
  INSERT INTO _r VALUES (6, 'movimiento inexistente', 'error', 'FALLO: no levanto excepcion');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES (6, 'movimiento inexistente', 'error', 'OK: ' || SQLERRM);
END $$;

-- ---------------------------------------------------------------------------
-- PROBE 7 — No quedaron sobrecargas de la función.
-- ---------------------------------------------------------------------------
INSERT INTO _r SELECT 7, 'sobrecargas de la funcion', '1', COUNT(*)::TEXT
FROM pg_proc WHERE proname = 'asignar_numero_recibo_cc';

-- Resultado único. Verde = `esperado` coincide con `obtenido` en las probes
-- numéricas, y `obtenido` arranca con "OK:" en las probes 5 y 6.
SELECT orden, probe, esperado, obtenido FROM _r ORDER BY orden, probe;

ROLLBACK;
