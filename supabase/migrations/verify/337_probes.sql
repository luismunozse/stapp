-- Probes de la migracion 337: vencimiento de reservas del catalogo publico.
--
-- Correr en el SQL editor de Supabase Studio tal cual (el BEGIN / ROLLBACK esta
-- incluido: nada de lo que crea queda). db-run.mjs detecta el BEGIN y rechaza
-- --apply. Requiere la 315 y la 337 ya aplicadas.
--
-- Verde = `esperado` igual a `obtenido` en cada fila.
--
-- Cobertura: vencida se libera (A y C), vigente / aceptada / pre-barrera /
-- convertida no se tocan, idempotencia, rechazo posterior sin doble acreditacion,
-- conversion despues del vencimiento (no se come reserva ajena; B/C se vuelven
-- a descontar y validan stock), aceptar una vencida, y CHECK de reserva_horas.
-- La conversion se prueba sobre las funciones que convertir_cotizacion_venta_
-- atomica invoca (no sobre crear_venta_atomica entera): la prueba de humo
-- completa queda para hacerla a mano en la app.
BEGIN;

CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);
CREATE TEMP TABLE _ids (k TEXT PRIMARY KEY, v TEXT);

-- ── Setup ──
-- Producto A (linkeado, stock 10), item C1 y C2 (sin link, stock 10).
-- Q1 vencida (A2 + C1 2), Q7 vencida (A1), Q2 vigente (A1), Q3 aceptada (A1),
-- Q4 pre-barrera (A1), Q5 convertida (A1), Q6 vencida (C2 2).
DO $$
DECLARE
  v_org TEXT; v_dep TEXT; v_inv TEXT; v_a TEXT; v_c1 TEXT; v_c2 TEXT; v_cli TEXT; v_cot TEXT;
  r RECORD;
BEGIN
  SELECT id INTO v_org FROM organizations ORDER BY created_at LIMIT 1;
  IF v_org IS NULL THEN
    INSERT INTO _r VALUES (0, 'setup', 'una org', 'SALTEADO: la base no tiene organizations');
    RETURN;
  END IF;
  SELECT get_deposito_principal(v_org) INTO v_dep;
  IF v_dep IS NULL THEN
    INSERT INTO _r VALUES (0, 'setup', 'deposito principal', 'SALTEADO: la org no tiene deposito principal');
    RETURN;
  END IF;

  -- Horas fijas para que la probe no dependa de la config real de la org.
  UPDATE catalogo_config SET reserva_horas = 48 WHERE organization_id = v_org;

  INSERT INTO inventario (organization_id, nombre, stock, stock_reservado, precio_venta)
  VALUES (v_org, 'PROBE-337 producto', 10, 0, 100) RETURNING id INTO v_inv;
  INSERT INTO inventario_depositos (inventario_id, deposito_id, stock, stock_reservado, organization_id)
  VALUES (v_inv, v_dep, 10, 0, v_org)
  ON CONFLICT (inventario_id, deposito_id) DO UPDATE SET stock = 10, stock_reservado = 0;

  INSERT INTO catalogo_items (organization_id, nombre, precio, activo, inventario_id, tipo)
  VALUES (v_org, 'PROBE-337 A', 100, TRUE, v_inv, 'PRODUCTO') RETURNING id INTO v_a;
  INSERT INTO catalogo_items (organization_id, nombre, precio, activo, stock, tipo)
  VALUES (v_org, 'PROBE-337 C1', 100, TRUE, 10, 'PRODUCTO') RETURNING id INTO v_c1;
  INSERT INTO catalogo_items (organization_id, nombre, precio, activo, stock, tipo)
  VALUES (v_org, 'PROBE-337 C2', 100, TRUE, 10, 'PRODUCTO') RETURNING id INTO v_c2;

  SELECT id INTO v_cli FROM clientes WHERE organization_id = v_org LIMIT 1;

  INSERT INTO _ids VALUES ('org', v_org), ('inv', v_inv), ('a', v_a), ('c1', v_c1), ('c2', v_c2);

  FOR r IN SELECT * FROM (VALUES
    ('q1', 'PROBE-337-1', now() - interval '100 hours', 'A', 2, 'C1', 2),
    ('q7', 'PROBE-337-7', now() - interval '100 hours', 'A', 1, NULL, 0),
    ('q2', 'PROBE-337-2', now() - interval '1 hour',    'A', 1, NULL, 0),
    ('q3', 'PROBE-337-3', now() - interval '100 hours', 'A', 1, NULL, 0),
    ('q4', 'PROBE-337-4', '2026-08-01 00:00:00+00'::timestamptz, 'A', 1, NULL, 0),
    ('q5', 'PROBE-337-5', now() - interval '100 hours', 'A', 1, NULL, 0),
    ('q6', 'PROBE-337-6', now() - interval '100 hours', NULL, 0, 'C2', 2)
  ) AS t(k, num, creada, ia, qa, ic, qc)
  LOOP
    INSERT INTO cotizaciones (organization_id, cliente_id, numero_cotizacion,
                              tipo, estado, origen, subtotal, iva, total)
    VALUES (v_org, v_cli, r.num, 'PRESUPUESTO', 'ENVIADA', 'CATALOGO_PUBLICO', 100, 0, 100)
    RETURNING id INTO v_cot;
    INSERT INTO _ids VALUES (r.k, v_cot);

    IF r.ia IS NOT NULL THEN
      PERFORM reservar_stock_catalogo(v_org,
        jsonb_build_array(jsonb_build_object('item_id', v_a, 'cantidad', r.qa)), v_cot);
    END IF;
    IF r.ic IS NOT NULL THEN
      PERFORM reservar_stock_catalogo(v_org,
        jsonb_build_array(jsonb_build_object('item_id', CASE r.ic WHEN 'C1' THEN v_c1 ELSE v_c2 END,
                                             'cantidad', r.qc)), v_cot);
    END IF;

    -- created_at se fija DESPUES de reservar: la reserva no depende de el.
    UPDATE cotizaciones SET created_at = r.creada WHERE id = v_cot;
  END LOOP;

  UPDATE cotizaciones SET estado = 'ACEPTADA' WHERE id = (SELECT v FROM _ids WHERE k = 'q3');
  UPDATE cotizaciones SET venta_id = 'probe-337-venta' WHERE id = (SELECT v FROM _ids WHERE k = 'q5');

  INSERT INTO _r VALUES (0, 'setup', 'ok', 'ok');
END $$;

CREATE FUNCTION pg_temp.id(p_k TEXT) RETURNS TEXT AS $$ SELECT v FROM _ids WHERE k = p_k $$ LANGUAGE sql;
CREATE FUNCTION pg_temp.reservado() RETURNS TEXT AS $$
  SELECT stock_reservado::TEXT FROM inventario WHERE id = pg_temp.id('inv') $$ LANGUAGE sql;
CREATE FUNCTION pg_temp.stock_c(p_k TEXT) RETURNS TEXT AS $$
  SELECT stock::TEXT FROM catalogo_items WHERE id = pg_temp.id(p_k) $$ LANGUAGE sql;
CREATE FUNCTION pg_temp.pendiente(p_k TEXT) RETURNS TEXT AS $$
  SELECT COALESCE((SELECT cantidad::TEXT FROM reserva_cotizacion_pendiente(pg_temp.id(p_k))), '0') $$ LANGUAGE sql;

-- ── Antes: A reservado = 2+1+1+1+1+1 = 7, C1 = 8, C2 = 8 ──
INSERT INTO _r SELECT 1, 'antes: stock_reservado de A', '7', pg_temp.reservado() WHERE EXISTS (SELECT 1 FROM _ids);
INSERT INTO _r SELECT 2, 'antes: C1 descontado', '8', pg_temp.stock_c('c1') WHERE EXISTS (SELECT 1 FROM _ids);

-- ── Correr el vencimiento ──
-- Limite alto: la probe corre sobre una base real que puede tener otras
-- solicitudes vencidas anteriores a las de la probe.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _ids) THEN RETURN; END IF;
  PERFORM expirar_reservas_catalogo(5000);
END $$;

-- Vencidas Q1 (A2, C1) y Q7 (A1) se liberan; Q6 (C2) tambien.
INSERT INTO _r SELECT 3, 'Q1 vencida: A pendiente 0', '0', pg_temp.pendiente('q1') WHERE EXISTS (SELECT 1 FROM _ids);
INSERT INTO _r SELECT 4, 'Q1 vencida: stock_reservado de A baja 3 (Q1+Q7)', '4', pg_temp.reservado() WHERE EXISTS (SELECT 1 FROM _ids);
INSERT INTO _r SELECT 5, 'Q1 vencida: C1 restituido', '10', pg_temp.stock_c('c1') WHERE EXISTS (SELECT 1 FROM _ids);
INSERT INTO _r SELECT 6, 'Q1 vencida: ledger con motivo vencida', 'vencida',
  (SELECT motivo FROM catalogo_reservas_cotizacion WHERE cotizacion_id = pg_temp.id('q1'))
  WHERE EXISTS (SELECT 1 FROM _ids);
INSERT INTO _r SELECT 7, 'Q1 vencida: el estado NO cambia', 'ENVIADA',
  (SELECT estado::TEXT FROM cotizaciones WHERE id = pg_temp.id('q1')) WHERE EXISTS (SELECT 1 FROM _ids);
INSERT INTO _r SELECT 8, 'Q6 vencida (solo C): C2 restituido', '10', pg_temp.stock_c('c2') WHERE EXISTS (SELECT 1 FROM _ids);

-- No tocadas.
INSERT INTO _r SELECT 9,  'Q2 vigente no se toca', '1', pg_temp.pendiente('q2') WHERE EXISTS (SELECT 1 FROM _ids);
INSERT INTO _r SELECT 10, 'Q3 aceptada no se toca', '1', pg_temp.pendiente('q3') WHERE EXISTS (SELECT 1 FROM _ids);
INSERT INTO _r SELECT 11, 'Q4 pre-barrera no se toca', '1', pg_temp.pendiente('q4') WHERE EXISTS (SELECT 1 FROM _ids);
INSERT INTO _r SELECT 12, 'Q5 convertida no se toca', '1', pg_temp.pendiente('q5') WHERE EXISTS (SELECT 1 FROM _ids);

-- Idempotente: segunda corrida no devuelve nada mas.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _ids) THEN RETURN; END IF;
  PERFORM expirar_reservas_catalogo(5000);
END $$;
INSERT INTO _r SELECT 13, 'segunda corrida: stock_reservado igual', '4', pg_temp.reservado() WHERE EXISTS (SELECT 1 FROM _ids);
INSERT INTO _r SELECT 14, 'segunda corrida: C1 igual', '10', pg_temp.stock_c('c1') WHERE EXISTS (SELECT 1 FROM _ids);

-- ── Rechazar una solicitud YA vencida: sin doble acreditacion ──
UPDATE cotizaciones SET estado = 'RECHAZADA' WHERE id = pg_temp.id('q7');
INSERT INTO _r SELECT 15, 'rechazar Q7 vencida: stock_reservado no baja de nuevo', '4', pg_temp.reservado() WHERE EXISTS (SELECT 1 FROM _ids);

-- ── Conversion despues del vencimiento (Q1) ──
-- Evidencia del bug que corrige la 337: liberar_items_cotizacion (lo que usaba
-- la conversion) libera la linea SIN netear el libro y se come reserva ajena.
-- Se mide dentro de un sub-bloque que se revierte.
DO $$
DECLARE v_antes TEXT; v_despues TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _ids) THEN RETURN; END IF;
  v_antes := pg_temp.reservado();
  BEGIN
    PERFORM liberar_items_cotizacion(pg_temp.id('q1'), NULL, 'probe');
    v_despues := pg_temp.reservado();
    RAISE EXCEPTION 'rollback-probe';
  EXCEPTION WHEN raise_exception THEN
    NULL;
  END;
  INSERT INTO _r VALUES (16, 'evidencia: liberar_items_cotizacion tras vencer libera de mas',
                         'baja (' || v_antes || ' -> menos)',
                         CASE WHEN v_despues::INT < v_antes::INT THEN 'baja (' || v_antes || ' -> menos)'
                              ELSE 'no baja' END);
END $$;

-- Lo que la conversion llama ahora para el catalogo: liberar por el libro.
INSERT INTO _r SELECT 17, 'estado intacto tras el bloque revertido', '4', pg_temp.reservado() WHERE EXISTS (SELECT 1 FROM _ids);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _ids) THEN RETURN; END IF;
  PERFORM retomar_reserva_catalogo_vencida(pg_temp.id('q1'));
  PERFORM consumir_reserva_catalogo(pg_temp.id('q1'), 'probe conversion');
  PERFORM liberar_reserva_catalogo(pg_temp.id('q1'), 'probe conversion');
END $$;
INSERT INTO _r SELECT 18, 'convertir Q1 vencida: no se come reserva ajena', '4', pg_temp.reservado() WHERE EXISTS (SELECT 1 FROM _ids);
INSERT INTO _r SELECT 19, 'convertir Q1 vencida: C1 se descuenta de nuevo (la venta no lo hace)', '8', pg_temp.stock_c('c1') WHERE EXISTS (SELECT 1 FROM _ids);
INSERT INTO _r SELECT 20, 'convertir Q1 vencida: no queda reserva abierta', '0',
  (SELECT COUNT(*)::TEXT FROM catalogo_reservas_cotizacion WHERE cotizacion_id = pg_temp.id('q1') AND liberada_at IS NULL)
  WHERE EXISTS (SELECT 1 FROM _ids);
-- Repetir no vuelve a descontar.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _ids) THEN RETURN; END IF;
  PERFORM retomar_reserva_catalogo_vencida(pg_temp.id('q1'));
END $$;
INSERT INTO _r SELECT 21, 'retomar repetido no descuenta dos veces', '8', pg_temp.stock_c('c1') WHERE EXISTS (SELECT 1 FROM _ids);

-- ── Aceptar una solicitud vencida (Q6, C2): re-descuenta y valida ──
UPDATE catalogo_items SET stock = 1 WHERE id = pg_temp.id('c2');
DO $$
DECLARE v_msg TEXT := 'sin error';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _ids) THEN RETURN; END IF;
  BEGIN
    UPDATE cotizaciones SET estado = 'ACEPTADA' WHERE id = pg_temp.id('q6');
  EXCEPTION WHEN SQLSTATE 'P0003' THEN
    v_msg := 'P0003';
  END;
  INSERT INTO _r VALUES (22, 'aceptar vencida sin stock suficiente se rechaza', 'P0003', v_msg);
END $$;
UPDATE catalogo_items SET stock = 10 WHERE id = pg_temp.id('c2');
UPDATE cotizaciones SET estado = 'ACEPTADA' WHERE id = pg_temp.id('q6');
INSERT INTO _r SELECT 23, 'aceptar vencida con stock: C2 se descuenta de nuevo', '8', pg_temp.stock_c('c2') WHERE EXISTS (SELECT 1 FROM _ids);

-- ── Config y permisos ──
DO $$
DECLARE v_bajo TEXT := 'sin error'; v_alto TEXT := 'sin error'; v_org TEXT;
BEGIN
  SELECT v INTO v_org FROM _ids WHERE k = 'org';
  IF v_org IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM catalogo_config WHERE organization_id = v_org) THEN
    INSERT INTO _r VALUES (24, 'CHECK reserva_horas', 'check_violation x2', 'SALTEADO: la org no tiene catalogo_config');
    RETURN;
  END IF;
  BEGIN UPDATE catalogo_config SET reserva_horas = 0 WHERE organization_id = v_org;
  EXCEPTION WHEN check_violation THEN v_bajo := 'check_violation'; END;
  BEGIN UPDATE catalogo_config SET reserva_horas = 721 WHERE organization_id = v_org;
  EXCEPTION WHEN check_violation THEN v_alto := 'check_violation'; END;
  INSERT INTO _r VALUES (24, 'CHECK reserva_horas rechaza 0 y 721', 'check_violation x2', v_bajo || ' x ' || v_alto);
END $$;

INSERT INTO _r SELECT 25, 'anon sin EXECUTE en expirar_reservas_catalogo', 'false',
  has_function_privilege('anon', 'expirar_reservas_catalogo(int)', 'EXECUTE')::TEXT;
INSERT INTO _r SELECT 26, 'authenticated sin EXECUTE en expirar_reservas_catalogo', 'false',
  has_function_privilege('authenticated', 'expirar_reservas_catalogo(int)', 'EXECUTE')::TEXT;

SELECT orden, probe, esperado, obtenido,
       CASE WHEN esperado = obtenido THEN 'OK' ELSE 'FALLA' END AS resultado
  FROM _r ORDER BY orden;

ROLLBACK;
