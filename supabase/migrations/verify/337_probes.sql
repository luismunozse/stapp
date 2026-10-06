-- Probes de la migracion 337: vencimiento de reservas del catalogo publico.
--
-- Correr en el SQL editor de Supabase Studio tal cual (el BEGIN / ROLLBACK esta
-- incluido: nada de lo que crea queda). db-run.mjs detecta el BEGIN y rechaza
-- --apply. Requiere la 315 y la 337 ya aplicadas.
--
-- Verde = `esperado` igual a `obtenido` en cada fila.
--
-- Cobertura: vencida se libera (A y C), vigente / aceptada / sin libro (pre-315) /
-- convertida no se tocan, fila trabada (stock_reservado en 0) se cierra sin tocar
-- stock, idempotencia, rechazo posterior sin doble acreditacion, conversion
-- despues del vencimiento (no se come reserva ajena; B/C se vuelven a descontar y
-- validan stock), mixta A + B/C vencida y luego aceptada, aceptar una vencida, y
-- CHECK de reserva_horas. Al final, conversion de punta a punta con la RPC real
-- (cotizacion interna y cotizacion de catalogo vencida): ese bloque va envuelto
-- en EXCEPTION, asi que si el setup de la venta no cierra en tu base sale
-- SALTEADO con el motivo en vez de abortar el resto.
BEGIN;

CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);
CREATE TEMP TABLE _ids (k TEXT PRIMARY KEY, v TEXT);

-- ── Parte 0: generate_cuid() no depende del search_path del llamador ──
DO $$
DECLARE v TEXT;
BEGIN
  PERFORM set_config('search_path', 'public, pg_temp', true);
  BEGIN
    v := generate_cuid();
    INSERT INTO _r VALUES (0, 'generate_cuid con search_path=public,pg_temp', 'ok', 'ok');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES (0, 'generate_cuid con search_path=public,pg_temp', 'ok', SQLERRM);
  END;
  PERFORM set_config('search_path', '"$user", public, extensions', true);
END $$;

-- ── Setup ──
-- Producto A (linkeado, stock 10), item C1 y C2 (sin link, stock 10).
-- Q1 vencida mixta (A2 + C1 2), Q7 vencida (A1), Q2 vigente (A1), Q3 aceptada
-- (A1), Q4 sin libro (como una cotizacion pre-315: nada reservado), Q5
-- convertida (A1), Q6 vencida (C2 2).
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

  -- Cliente propio de la probe: no depende de que la org ya tenga uno.
  INSERT INTO clientes (organization_id, nombre, telefono)
  VALUES (v_org, 'PROBE-337 cliente', '0000000000') RETURNING id INTO v_cli;

  INSERT INTO inventario (organization_id, codigo, categoria, precio_compra, nombre, stock, stock_reservado, precio_venta)
  VALUES (v_org, 'PROBE-337-INV1', 'PROBE', 0, 'PROBE-337 producto', 10, 0, 100) RETURNING id INTO v_inv;
  INSERT INTO inventario_depositos (inventario_id, deposito_id, stock, stock_reservado, organization_id)
  VALUES (v_inv, v_dep, 10, 0, v_org)
  ON CONFLICT (inventario_id, deposito_id) DO UPDATE SET stock = 10, stock_reservado = 0;

  INSERT INTO catalogo_items (organization_id, nombre, precio, activo, inventario_id, tipo)
  VALUES (v_org, 'PROBE-337 A', 100, TRUE, v_inv, 'PRODUCTO') RETURNING id INTO v_a;
  INSERT INTO catalogo_items (organization_id, nombre, precio, activo, stock, tipo)
  VALUES (v_org, 'PROBE-337 C1', 100, TRUE, 10, 'PRODUCTO') RETURNING id INTO v_c1;
  INSERT INTO catalogo_items (organization_id, nombre, precio, activo, stock, tipo)
  VALUES (v_org, 'PROBE-337 C2', 100, TRUE, 10, 'PRODUCTO') RETURNING id INTO v_c2;

  INSERT INTO _ids VALUES ('cli', v_cli), ('org', v_org), ('inv', v_inv), ('a', v_a), ('c1', v_c1), ('c2', v_c2);

  FOR r IN SELECT * FROM (VALUES
    ('q1', 'PROBE-337-1', now() - interval '100 hours', 'A', 2, 'C1', 2),
    ('q7', 'PROBE-337-7', now() - interval '100 hours', 'A', 1, NULL, 0),
    ('q2', 'PROBE-337-2', now() - interval '1 hour',    'A', 1, NULL, 0),
    ('q3', 'PROBE-337-3', now() - interval '100 hours', 'A', 1, NULL, 0),
    ('q4', 'PROBE-337-4', now() - interval '100 hours', NULL, 0, NULL, 0),
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

-- ── Setup 2: fila trabada + cotizaciones para la conversion de punta a punta ──
-- Q8: reserva de 2 sobre inv2 cuyo stock_reservado se "perdio" (0): liberar_
--     reserva_catalogo no puede devolver nada y antes quedaba candidata para siempre.
-- Q9: cotizacion INTERNA (origen NULL) con reserva sobre inv3.
-- Q10: catalogo mixta A (inv4) + C3, vencida. Q11: reserva ajena vigente sobre inv4.
DO $$
DECLARE
  v_org TEXT; v_cli TEXT; v_inv2 TEXT; v_inv3 TEXT; v_inv4 TEXT; v_a2 TEXT; v_a4 TEXT; v_c3 TEXT;
  v_q8 TEXT; v_q9 TEXT; v_q10 TEXT; v_q11 TEXT;
BEGIN
  SELECT v INTO v_org FROM _ids WHERE k = 'org';
  SELECT v INTO v_cli FROM _ids WHERE k = 'cli';
  IF v_org IS NULL THEN RETURN; END IF;

  INSERT INTO inventario (organization_id, codigo, categoria, precio_compra, nombre, stock, stock_reservado, precio_venta)
  VALUES (v_org, 'PROBE-337-INV2', 'PROBE', 0, 'PROBE-337 inv2', 10, 0, 100) RETURNING id INTO v_inv2;
  INSERT INTO inventario (organization_id, codigo, categoria, precio_compra, nombre, stock, stock_reservado, precio_venta)
  VALUES (v_org, 'PROBE-337-INV3', 'PROBE', 0, 'PROBE-337 inv3', 10, 0, 100) RETURNING id INTO v_inv3;
  INSERT INTO inventario (organization_id, codigo, categoria, precio_compra, nombre, stock, stock_reservado, precio_venta)
  VALUES (v_org, 'PROBE-337-INV4', 'PROBE', 0, 'PROBE-337 inv4', 10, 0, 100) RETURNING id INTO v_inv4;
  INSERT INTO catalogo_items (organization_id, nombre, precio, activo, inventario_id, tipo)
  VALUES (v_org, 'PROBE-337 A2', 100, TRUE, v_inv2, 'PRODUCTO') RETURNING id INTO v_a2;
  INSERT INTO catalogo_items (organization_id, nombre, precio, activo, inventario_id, tipo)
  VALUES (v_org, 'PROBE-337 A4', 100, TRUE, v_inv4, 'PRODUCTO') RETURNING id INTO v_a4;
  INSERT INTO catalogo_items (organization_id, nombre, precio, activo, stock, tipo)
  VALUES (v_org, 'PROBE-337 C3', 100, TRUE, 10, 'PRODUCTO') RETURNING id INTO v_c3;
  INSERT INTO _ids VALUES ('inv2', v_inv2), ('inv3', v_inv3), ('inv4', v_inv4), ('c3', v_c3);

  -- Q8 (trabada)
  INSERT INTO cotizaciones (organization_id, cliente_id, numero_cotizacion, tipo, estado, origen, subtotal, iva, total)
  VALUES (v_org, v_cli, 'PROBE-337-8', 'PRESUPUESTO', 'ENVIADA', 'CATALOGO_PUBLICO', 100, 0, 100) RETURNING id INTO v_q8;
  PERFORM reservar_stock_catalogo(v_org, jsonb_build_array(jsonb_build_object('item_id', v_a2, 'cantidad', 2)), v_q8);
  UPDATE inventario SET stock_reservado = 0 WHERE id = v_inv2;
  UPDATE cotizaciones SET created_at = now() - interval '100 hours' WHERE id = v_q8;
  INSERT INTO _ids VALUES ('q8', v_q8);

  -- Q9 (interna, origen NULL) con linea e inventario reservado por la ruta de siempre
  INSERT INTO cotizaciones (organization_id, cliente_id, numero_cotizacion, tipo, estado, subtotal, iva, total)
  VALUES (v_org, v_cli, 'PROBE-337-9', 'ORDEN', 'ENVIADA', 200, 0, 200) RETURNING id INTO v_q9;
  INSERT INTO items_cotizacion (cotizacion_id, descripcion, cantidad, precio_unitario, subtotal, inventario_id)
  VALUES (v_q9, 'PROBE-337 inv3', 2, 100, 200, v_inv3);
  PERFORM reservar_items_cotizacion(v_q9, NULL);
  INSERT INTO _ids VALUES ('q9', v_q9);

  -- Q10 (catalogo mixta, vencida) y Q11 (reserva ajena vigente sobre el mismo inv4)
  INSERT INTO cotizaciones (organization_id, cliente_id, numero_cotizacion, tipo, estado, origen, subtotal, iva, total)
  VALUES (v_org, v_cli, 'PROBE-337-10', 'PRESUPUESTO', 'ENVIADA', 'CATALOGO_PUBLICO', 100, 0, 100) RETURNING id INTO v_q10;
  PERFORM reservar_stock_catalogo(v_org, jsonb_build_array(
    jsonb_build_object('item_id', v_a4, 'cantidad', 1),
    jsonb_build_object('item_id', v_c3, 'cantidad', 2)), v_q10);
  UPDATE cotizaciones SET created_at = now() - interval '100 hours' WHERE id = v_q10;
  INSERT INTO _ids VALUES ('q10', v_q10);

  INSERT INTO cotizaciones (organization_id, cliente_id, numero_cotizacion, tipo, estado, origen, subtotal, iva, total)
  VALUES (v_org, v_cli, 'PROBE-337-11', 'PRESUPUESTO', 'ENVIADA', 'CATALOGO_PUBLICO', 300, 0, 300) RETURNING id INTO v_q11;
  PERFORM reservar_stock_catalogo(v_org, jsonb_build_array(jsonb_build_object('item_id', v_a4, 'cantidad', 3)), v_q11);
  INSERT INTO _ids VALUES ('q11', v_q11);
END $$;

CREATE FUNCTION pg_temp.id(p_k TEXT) RETURNS TEXT AS $$ SELECT v FROM _ids WHERE k = p_k $$ LANGUAGE sql;
CREATE FUNCTION pg_temp.reservado() RETURNS TEXT AS $$
  SELECT stock_reservado::TEXT FROM inventario WHERE id = pg_temp.id('inv') $$ LANGUAGE sql;
CREATE FUNCTION pg_temp.stock_c(p_k TEXT) RETURNS TEXT AS $$
  SELECT stock::TEXT FROM catalogo_items WHERE id = pg_temp.id(p_k) $$ LANGUAGE sql;
CREATE FUNCTION pg_temp.pendiente(p_k TEXT) RETURNS TEXT AS $$
  SELECT COALESCE((SELECT cantidad::TEXT FROM reserva_cotizacion_pendiente(pg_temp.id(p_k))), '0') $$ LANGUAGE sql;

-- ── Antes: A reservado = Q1 2 + Q7 1 + Q2 1 + Q3 1 + Q5 1 = 6; C1 = 8 ──
INSERT INTO _r SELECT 1, 'antes: stock_reservado de A', '6', pg_temp.reservado() WHERE EXISTS (SELECT 1 FROM _ids);
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
INSERT INTO _r SELECT 4, 'Q1 vencida: stock_reservado de A baja 3 (Q1+Q7)', '3', pg_temp.reservado() WHERE EXISTS (SELECT 1 FROM _ids);
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
INSERT INTO _r SELECT 11, 'Q4 sin libro (pre-315): no se le asienta nada', '0',
  (SELECT COUNT(*)::TEXT FROM movimientos_inventario WHERE referencia_id = pg_temp.id('q4'))
  WHERE EXISTS (SELECT 1 FROM _ids);
INSERT INTO _r SELECT 12, 'Q5 convertida no se toca', '1', pg_temp.pendiente('q5') WHERE EXISTS (SELECT 1 FROM _ids);

-- Idempotente: segunda corrida no devuelve nada mas.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _ids) THEN RETURN; END IF;
  PERFORM expirar_reservas_catalogo(5000);
END $$;
INSERT INTO _r SELECT 13, 'segunda corrida: stock_reservado igual', '3', pg_temp.reservado() WHERE EXISTS (SELECT 1 FROM _ids);
INSERT INTO _r SELECT 14, 'segunda corrida: C1 igual', '10', pg_temp.stock_c('c1') WHERE EXISTS (SELECT 1 FROM _ids);

-- Fila trabada (Q8): se cierra en el libro sin tocar stock y no vuelve a ser candidata.
INSERT INTO _r SELECT 27, 'Q8 trabada: el libro queda saldado', '0', pg_temp.pendiente('q8') WHERE EXISTS (SELECT 1 FROM _ids);
INSERT INTO _r SELECT 28, 'Q8 trabada: stock_reservado no baja de 0', '0',
  (SELECT stock_reservado::TEXT FROM inventario WHERE id = pg_temp.id('inv2')) WHERE EXISTS (SELECT 1 FROM _ids);
INSERT INTO _r SELECT 29, 'Q8 trabada: stock no se acredita', '10',
  (SELECT stock::TEXT FROM inventario WHERE id = pg_temp.id('inv2')) WHERE EXISTS (SELECT 1 FROM _ids);
INSERT INTO _r SELECT 30, 'Q8 trabada: 1 asiento vencida-sin-reserva', '1',
  (SELECT COUNT(*)::TEXT FROM movimientos_inventario
    WHERE referencia_id = pg_temp.id('q8') AND observaciones = 'vencida-sin-reserva')
  WHERE EXISTS (SELECT 1 FROM _ids);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _ids) THEN RETURN; END IF;
  PERFORM expirar_reservas_catalogo(5000);
END $$;
INSERT INTO _r SELECT 31, 'Q8 trabada: otra corrida no la vuelve a procesar', '1',
  (SELECT COUNT(*)::TEXT FROM movimientos_inventario
    WHERE referencia_id = pg_temp.id('q8') AND observaciones = 'vencida-sin-reserva')
  WHERE EXISTS (SELECT 1 FROM _ids);

-- ── Rechazar una solicitud YA vencida: sin doble acreditacion ──
UPDATE cotizaciones SET estado = 'RECHAZADA' WHERE id = pg_temp.id('q7');
INSERT INTO _r SELECT 15, 'rechazar Q7 vencida: stock_reservado no baja de nuevo', '3', pg_temp.reservado() WHERE EXISTS (SELECT 1 FROM _ids);

-- ── Conversion despues del vencimiento (Q1, mixta A + C1) ──
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
                         'baja',
                         CASE WHEN v_despues::INT < v_antes::INT THEN 'baja' ELSE 'no baja' END);
END $$;
INSERT INTO _r SELECT 17, 'estado intacto tras el bloque revertido', '3', pg_temp.reservado() WHERE EXISTS (SELECT 1 FROM _ids);

-- Mixta vencida y luego ACEPTADA: el trigger re-descuenta C1 y valida stock; A
-- (PRESUPUESTO no reserva al aceptar) queda sin reserva a proposito.
UPDATE cotizaciones SET estado = 'ACEPTADA' WHERE id = pg_temp.id('q1');
INSERT INTO _r SELECT 32, 'mixta aceptada tras vencer: C1 se descuenta de nuevo', '8', pg_temp.stock_c('c1') WHERE EXISTS (SELECT 1 FROM _ids);
INSERT INTO _r SELECT 33, 'mixta aceptada tras vencer: A no se re-reserva', '3', pg_temp.reservado() WHERE EXISTS (SELECT 1 FROM _ids);

-- Lo que la conversion llama ahora para el catalogo.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _ids) THEN RETURN; END IF;
  PERFORM retomar_reserva_catalogo_vencida(pg_temp.id('q1'));
  PERFORM consumir_reserva_catalogo(pg_temp.id('q1'), 'probe conversion');
  PERFORM liberar_reserva_catalogo(pg_temp.id('q1'), 'probe conversion');
END $$;
INSERT INTO _r SELECT 18, 'convertir Q1 vencida: no se come reserva ajena', '3', pg_temp.reservado() WHERE EXISTS (SELECT 1 FROM _ids);
INSERT INTO _r SELECT 19, 'convertir Q1 vencida: C1 queda descontado una sola vez', '8', pg_temp.stock_c('c1') WHERE EXISTS (SELECT 1 FROM _ids);
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

-- ── Conversion de punta a punta con la RPC real ──
-- Q9 (interna, origen NULL) conserva el camino de siempre: liberar_items_cotizacion.
-- Q10 (catalogo mixta, vencida, aceptada) no puede comerse la reserva ajena de Q11
-- sobre inv4, y C3 se descuenta una sola vez.
DO $$
DECLARE
  v_org TEXT; v_cli TEXT; v_user TEXT; v_suc TEXT; v_res JSONB;
  v_q9 TEXT; v_q10 TEXT; v_inv3 TEXT; v_inv4 TEXT; v_c3 TEXT;
BEGIN
  SELECT v INTO v_org FROM _ids WHERE k = 'org';
  IF v_org IS NULL THEN RETURN; END IF;
  SELECT v INTO v_cli FROM _ids WHERE k = 'cli';
  SELECT v INTO v_q9 FROM _ids WHERE k = 'q9';
  SELECT v INTO v_q10 FROM _ids WHERE k = 'q10';
  SELECT v INTO v_inv3 FROM _ids WHERE k = 'inv3';
  SELECT v INTO v_inv4 FROM _ids WHERE k = 'inv4';
  SELECT v INTO v_c3 FROM _ids WHERE k = 'c3';
  SELECT id INTO v_user FROM users WHERE organization_id = v_org LIMIT 1;
  SELECT id INTO v_suc FROM sucursales WHERE organization_id = v_org AND principal LIMIT 1;

  BEGIN
    IF v_user IS NULL OR v_suc IS NULL THEN
      RAISE EXCEPTION 'la org no tiene usuario o sucursal principal';
    END IF;

    -- Q10 vencio en las corridas de arriba; aceptarla re-descuenta C3.
    UPDATE cotizaciones SET estado = 'ACEPTADA' WHERE id = v_q10;

    -- Q9: interna, reserva de 2 sobre inv3, se vende 2.
    v_res := convertir_cotizacion_venta_atomica(
      v_org, v_user, v_cli, 'PROBE', NULL, 200, 0, 'MONTO', 0, 200, 'EFECTIVO', NULL, NULL, 1, 0, 200,
      jsonb_build_array(jsonb_build_object('inventarioId', v_inv3, 'descripcion', 'PROBE-337 inv3',
        'cantidad', 2, 'precioUnitario', 100, 'diasGarantia', 0, 'descuento', 0,
        'tipoDescuento', 'MONTO', 'porcentajeDescuento', 0, 'costo', NULL)),
      p_sucursal_id => v_suc, p_cotizacion_id => v_q9);
    INSERT INTO _r VALUES (40, 'e2e interna: stock 10 -> 8 (la venta descuenta)', '8',
      (SELECT stock::TEXT FROM inventario WHERE id = v_inv3));
    INSERT INTO _r VALUES (41, 'e2e interna: reserva liberada por liberar_items_cotizacion', '0',
      (SELECT stock_reservado::TEXT FROM inventario WHERE id = v_inv3));
    INSERT INTO _r VALUES (42, 'e2e interna: asiento de liberacion de la conversion', '1',
      (SELECT COUNT(*)::TEXT FROM movimientos_inventario WHERE referencia_id = v_q9
        AND tipo = 'LIBERACION_RESERVA' AND observaciones = 'Reserva consumida por conversión a venta'));

    -- Q10: catalogo mixta, se vende 1 de inv4 (A). Q11 retiene 3 sobre inv4.
    v_res := convertir_cotizacion_venta_atomica(
      v_org, v_user, v_cli, 'PROBE', NULL, 100, 0, 'MONTO', 0, 100, 'EFECTIVO', NULL, NULL, 1, 0, 100,
      jsonb_build_array(jsonb_build_object('inventarioId', v_inv4, 'descripcion', 'PROBE-337 A4',
        'cantidad', 1, 'precioUnitario', 100, 'diasGarantia', 0, 'descuento', 0,
        'tipoDescuento', 'MONTO', 'porcentajeDescuento', 0, 'costo', NULL)),
      p_sucursal_id => v_suc, p_cotizacion_id => v_q10);
    INSERT INTO _r VALUES (43, 'e2e catalogo vencida: stock de inv4 10 -> 9', '9',
      (SELECT stock::TEXT FROM inventario WHERE id = v_inv4));
    INSERT INTO _r VALUES (44, 'e2e catalogo vencida: no se come la reserva ajena (Q11 = 3)', '3',
      (SELECT stock_reservado::TEXT FROM inventario WHERE id = v_inv4));
    INSERT INTO _r VALUES (45, 'e2e catalogo vencida: C3 descontado una sola vez (10 -> 8)', '8',
      (SELECT stock::TEXT FROM catalogo_items WHERE id = v_c3));
    INSERT INTO _r VALUES (46, 'e2e catalogo vencida: sin reserva abierta en el libro', '0',
      (SELECT COUNT(*)::TEXT FROM catalogo_reservas_cotizacion WHERE cotizacion_id = v_q10 AND liberada_at IS NULL));
    INSERT INTO _r VALUES (47, 'e2e catalogo vencida: venta_id grabado', 'si',
      (SELECT CASE WHEN venta_id IS NOT NULL THEN 'si' ELSE 'no' END FROM cotizaciones WHERE id = v_q10));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES (40, 'e2e conversion real', 'ok', 'SALTEADO: ' || SQLSTATE || ' ' || SQLERRM);
  END;
END $$;

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
