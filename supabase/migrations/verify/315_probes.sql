-- Probes de la migracion 315: el catalogo publico reserva, no descuenta.
--
-- Correr en el SQL editor de Supabase Studio, SIN RLS, tal cual (el BEGIN /
-- ROLLBACK esta incluido: nada de lo que crea queda).
--
-- Verde = `esperado` igual a `obtenido` en cada fila.

BEGIN;

CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);

-- ── Setup: org + deposito + producto + item de catalogo linkeado ──
DO $$
DECLARE
  v_org  TEXT;
  v_dep  TEXT;
  v_inv  TEXT;
  v_cat  TEXT;
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

  INSERT INTO inventario (organization_id, nombre, stock, stock_reservado, precio_venta)
  VALUES (v_org, 'PROBE-315 producto', 10, 0, 100)
  RETURNING id INTO v_inv;

  INSERT INTO inventario_depositos (inventario_id, deposito_id, stock, stock_reservado, organization_id)
  VALUES (v_inv, v_dep, 10, 0, v_org)
  ON CONFLICT (inventario_id, deposito_id) DO UPDATE SET stock = 10, stock_reservado = 0;

  INSERT INTO catalogo_items (organization_id, nombre, precio, activo, inventario_id, tipo)
  VALUES (v_org, 'PROBE-315 item', 100, TRUE, v_inv, 'PRODUCTO')
  RETURNING id INTO v_cat;

  PERFORM set_config('probe315.org', v_org, TRUE);
  PERFORM set_config('probe315.inv', v_inv, TRUE);
  PERFORM set_config('probe315.cat', v_cat, TRUE);
  PERFORM set_config('probe315.dep', v_dep, TRUE);

  INSERT INTO _r VALUES (0, 'setup', 'ok', 'ok');
END $$;

-- ── Reservar 3 unidades ──
DO $$
DECLARE
  v_org TEXT := current_setting('probe315.org', TRUE);
  v_cat TEXT := current_setting('probe315.cat', TRUE);
BEGIN
  IF v_org IS NULL OR v_org = '' THEN RETURN; END IF;

  PERFORM reservar_stock_catalogo(
    v_org,
    jsonb_build_array(jsonb_build_object('item_id', v_cat, 'cantidad', 3)),
    NULL
  );
END $$;

INSERT INTO _r
SELECT 1, 'inventario.stock NO se toca', '10',
       (SELECT stock::TEXT FROM inventario WHERE id = current_setting('probe315.inv', TRUE))
WHERE current_setting('probe315.inv', TRUE) <> '';

INSERT INTO _r
SELECT 2, 'inventario.stock_reservado sube', '3',
       (SELECT stock_reservado::TEXT FROM inventario WHERE id = current_setting('probe315.inv', TRUE))
WHERE current_setting('probe315.inv', TRUE) <> '';

INSERT INTO _r
SELECT 3, 'detalle por deposito replica la reserva', '3',
       (SELECT COALESCE(SUM(stock_reservado), 0)::TEXT FROM inventario_depositos
        WHERE inventario_id = current_setting('probe315.inv', TRUE))
WHERE current_setting('probe315.inv', TRUE) <> '';

INSERT INTO _r
SELECT 4, 'asiento RESERVA en movimientos_inventario', '1 x RESERVA/COTIZACION',
       (SELECT COUNT(*)::TEXT || ' x ' || COALESCE(MAX(tipo), '?') || '/' || COALESCE(MAX(referencia_tipo), '?')
        FROM movimientos_inventario
        WHERE inventario_id = current_setting('probe315.inv', TRUE))
WHERE current_setting('probe315.inv', TRUE) <> '';

INSERT INTO _r
SELECT 5, 'el movimiento tiene deposito asignado', 'con deposito',
       (SELECT CASE WHEN deposito_id IS NULL THEN 'FALLO: deposito_id NULL' ELSE 'con deposito' END
        FROM movimientos_inventario
        WHERE inventario_id = current_setting('probe315.inv', TRUE)
        LIMIT 1)
WHERE current_setting('probe315.inv', TRUE) <> '';

-- ── Disponibilidad = stock - reservado: 8 mas no entran (quedan 7) ──
DO $$
DECLARE
  v_org TEXT := current_setting('probe315.org', TRUE);
  v_cat TEXT := current_setting('probe315.cat', TRUE);
BEGIN
  IF v_org IS NULL OR v_org = '' THEN RETURN; END IF;

  PERFORM reservar_stock_catalogo(
    v_org,
    jsonb_build_array(jsonb_build_object('item_id', v_cat, 'cantidad', 8)),
    NULL
  );
  INSERT INTO _r VALUES (6, 'valida contra stock - reservado', 'error P0003', 'FALLO: dejo reservar 8 sobre 7 disponibles');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES (6, 'valida contra stock - reservado', 'error P0003', 'OK: ' || SQLSTATE || ' ' || SQLERRM);
END $$;

-- ── Liberar: la reserva vuelve entera ──
-- Se crea una cotizacion del catalogo de verdad para poder referenciar los
-- movimientos: liberar_reserva_catalogo trabaja sobre el libro mayor.
DO $$
DECLARE
  v_org TEXT := current_setting('probe315.org', TRUE);
  v_inv TEXT := current_setting('probe315.inv', TRUE);
  v_cot TEXT;
  v_cli TEXT;
BEGIN
  IF v_org IS NULL OR v_org = '' THEN RETURN; END IF;

  SELECT id INTO v_cli FROM clientes WHERE organization_id = v_org LIMIT 1;

  INSERT INTO cotizaciones (organization_id, cliente_id, numero_cotizacion,
                            tipo, estado, origen, subtotal, iva, total)
  VALUES (v_org, v_cli, 'PROBE-315', 'PRESUPUESTO', 'ENVIADA',
          'CATALOGO_PUBLICO', 100, 0, 100)
  RETURNING id INTO v_cot;

  -- Movimiento de reserva referenciado a esa cotizacion (lo que hace la parte 1).
  INSERT INTO movimientos_inventario (
    inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
    referencia_id, referencia_tipo, usuario_id, organization_id
  ) VALUES (v_inv, 'RESERVA', 3, 10, 10, v_cot, 'COTIZACION', NULL, v_org);

  PERFORM set_config('probe315.cot', v_cot, TRUE);
END $$;

INSERT INTO _r
SELECT 7, 'reserva_cotizacion_pendiente ve la reserva', '3',
       (SELECT cantidad::TEXT FROM reserva_cotizacion_pendiente(current_setting('probe315.cot', TRUE)))
WHERE COALESCE(current_setting('probe315.cot', TRUE), '') <> '';

DO $$
DECLARE v_cot TEXT := current_setting('probe315.cot', TRUE);
BEGIN
  IF v_cot IS NULL OR v_cot = '' THEN RETURN; END IF;
  PERFORM liberar_reserva_catalogo(v_cot, 'probe');
END $$;

INSERT INTO _r
SELECT 8, 'liberar devuelve stock_reservado a 0', '0',
       (SELECT stock_reservado::TEXT FROM inventario WHERE id = current_setting('probe315.inv', TRUE))
WHERE COALESCE(current_setting('probe315.cot', TRUE), '') <> '';

INSERT INTO _r
SELECT 9, 'el libro mayor queda saldado', 'sin reserva viva',
       (SELECT CASE WHEN COUNT(*) = 0 THEN 'sin reserva viva'
                    ELSE 'FALLO: quedan ' || COUNT(*)::TEXT END
        FROM reserva_cotizacion_pendiente(current_setting('probe315.cot', TRUE)))
WHERE COALESCE(current_setting('probe315.cot', TRUE), '') <> '';

-- Idempotencia: liberar dos veces no puede devolver de mas.
DO $$
DECLARE v_cot TEXT := current_setting('probe315.cot', TRUE);
BEGIN
  IF v_cot IS NULL OR v_cot = '' THEN RETURN; END IF;
  PERFORM liberar_reserva_catalogo(v_cot, 'probe repetido');
END $$;

INSERT INTO _r
SELECT 10, 'liberar dos veces no devuelve de mas', '0',
       (SELECT stock_reservado::TEXT FROM inventario WHERE id = current_setting('probe315.inv', TRUE))
WHERE COALESCE(current_setting('probe315.cot', TRUE), '') <> '';

-- Aislamiento: una cotizacion que NUNCA reservo no puede comerse reserva ajena.
DO $$
DECLARE
  v_org TEXT := current_setting('probe315.org', TRUE);
  v_inv TEXT := current_setting('probe315.inv', TRUE);
  v_otra TEXT;
  v_cli TEXT;
BEGIN
  IF v_org IS NULL OR v_org = '' THEN RETURN; END IF;

  -- Reserva viva de OTRO (simula una cotizacion interna aprobada).
  UPDATE inventario SET stock_reservado = 4 WHERE id = v_inv;

  SELECT id INTO v_cli FROM clientes WHERE organization_id = v_org LIMIT 1;
  INSERT INTO cotizaciones (organization_id, cliente_id, numero_cotizacion,
                            tipo, estado, origen, subtotal, iva, total)
  VALUES (v_org, v_cli, 'PROBE-315-B', 'PRESUPUESTO', 'ENVIADA',
          'CATALOGO_PUBLICO', 100, 0, 100)
  RETURNING id INTO v_otra;

  PERFORM liberar_reserva_catalogo(v_otra, 'probe sin reserva propia');
  PERFORM set_config('probe315.otra', v_otra, TRUE);
END $$;

INSERT INTO _r
SELECT 11, 'no toca la reserva de otra cotizacion', '4',
       (SELECT stock_reservado::TEXT FROM inventario WHERE id = current_setting('probe315.inv', TRUE))
WHERE COALESCE(current_setting('probe315.otra', TRUE), '') <> '';

-- ── Aritmetica del guard de reservar_items_cotizacion ──
-- Dos lineas del MISMO producto (3 y 3) sobre una cotizacion interna: tienen
-- que reservarse 6, no 3. El guard comparaba el agregado del libro contra una
-- sola linea y sub-reservaba.
DO $$
DECLARE
  v_org TEXT := current_setting('probe315.org', TRUE);
  v_inv TEXT;
  v_cot TEXT;
  v_cli TEXT;
  v_dep TEXT := current_setting('probe315.dep', TRUE);
BEGIN
  IF v_org IS NULL OR v_org = '' THEN RETURN; END IF;

  INSERT INTO inventario (organization_id, nombre, stock, stock_reservado, precio_venta)
  VALUES (v_org, 'PROBE-315 doble linea', 20, 0, 100) RETURNING id INTO v_inv;
  INSERT INTO inventario_depositos (inventario_id, deposito_id, stock, stock_reservado, organization_id)
  VALUES (v_inv, v_dep, 20, 0, v_org)
  ON CONFLICT (inventario_id, deposito_id) DO UPDATE SET stock = 20, stock_reservado = 0;

  SELECT id INTO v_cli FROM clientes WHERE organization_id = v_org LIMIT 1;
  INSERT INTO cotizaciones (organization_id, cliente_id, numero_cotizacion,
                            tipo, estado, origen, subtotal, iva, total)
  VALUES (v_org, v_cli, 'PROBE-315-C', 'ORDEN', 'ENVIADA', NULL, 100, 0, 100)
  RETURNING id INTO v_cot;

  INSERT INTO items_cotizacion (cotizacion_id, descripcion, cantidad, precio_unitario,
                                subtotal, unidad, inventario_id, tipo_repuesto)
  VALUES (v_cot, 'linea 1', 3, 10, 30, 'Unidad', v_inv, 'NO_APLICA'),
         (v_cot, 'linea 2', 3, 10, 30, 'Unidad', v_inv, 'NO_APLICA');

  PERFORM reservar_items_cotizacion(v_cot, 'system');
  PERFORM set_config('probe315.inv2', v_inv, TRUE);
  PERFORM set_config('probe315.cot2', v_cot, TRUE);
END $$;

INSERT INTO _r
SELECT 12, 'dos lineas del mismo producto reservan la suma', '6',
       (SELECT stock_reservado::TEXT FROM inventario WHERE id = current_setting('probe315.inv2', TRUE))
WHERE COALESCE(current_setting('probe315.inv2', TRUE), '') <> '';

-- Re-reservar la misma cotizacion no puede sumar nada (idempotencia).
DO $$
DECLARE v_cot TEXT := current_setting('probe315.cot2', TRUE);
BEGIN
  IF v_cot IS NULL OR v_cot = '' THEN RETURN; END IF;
  PERFORM reservar_items_cotizacion(v_cot, 'system');
END $$;

INSERT INTO _r
SELECT 13, 'reservar dos veces no suma de mas', '6',
       (SELECT stock_reservado::TEXT FROM inventario WHERE id = current_setting('probe315.inv2', TRUE))
WHERE COALESCE(current_setting('probe315.inv2', TRUE), '') <> '';

-- Cobertura parcial: se sube la linea a 5+3=8 y se re-reserva. Tiene que
-- quedar 8, no 6+8=14.
DO $$
DECLARE v_cot TEXT := current_setting('probe315.cot2', TRUE);
BEGIN
  IF v_cot IS NULL OR v_cot = '' THEN RETURN; END IF;
  UPDATE items_cotizacion SET cantidad = 5
    WHERE cotizacion_id = v_cot AND descripcion = 'linea 1';
  PERFORM reservar_items_cotizacion(v_cot, 'system');
END $$;

INSERT INTO _r
SELECT 14, 'cobertura parcial reserva solo el faltante', '8',
       (SELECT stock_reservado::TEXT FROM inventario WHERE id = current_setting('probe315.inv2', TRUE))
WHERE COALESCE(current_setting('probe315.inv2', TRUE), '') <> '';

-- ── Variantes: descuento directo, restitucion al liberar ──
DO $$
DECLARE
  v_org TEXT := current_setting('probe315.org', TRUE);
  v_cat TEXT;
  v_var TEXT;
  v_cot TEXT;
  v_cli TEXT;
BEGIN
  IF v_org IS NULL OR v_org = '' THEN RETURN; END IF;

  INSERT INTO catalogo_items (organization_id, nombre, precio, activo, tipo)
  VALUES (v_org, 'PROBE-315 con variantes', 100, TRUE, 'PRODUCTO')
  RETURNING id INTO v_cat;

  INSERT INTO catalogo_variantes (organization_id, item_id, etiqueta, stock, activo)
  VALUES (v_org, v_cat, 'Rojo', 10, TRUE) RETURNING id INTO v_var;

  -- La cotizacion va PRIMERO: la reserva se anota contra ella (FK NOT NULL).
  SELECT id INTO v_cli FROM clientes WHERE organization_id = v_org LIMIT 1;
  INSERT INTO cotizaciones (organization_id, cliente_id, numero_cotizacion,
                            tipo, estado, origen, subtotal, iva, total)
  VALUES (v_org, v_cli, 'PROBE-315-D', 'PRESUPUESTO', 'ENVIADA',
          'CATALOGO_PUBLICO', 100, 0, 100)
  RETURNING id INTO v_cot;

  INSERT INTO items_cotizacion (cotizacion_id, descripcion, cantidad, precio_unitario,
                                subtotal, unidad, catalogo_item_id, variante_id, tipo_repuesto)
  VALUES (v_cot, 'PROBE-315 Rojo', 4, 25, 100, 'Unidad', v_cat, v_var, 'NO_APLICA');

  PERFORM reservar_stock_catalogo(
    v_org,
    jsonb_build_array(jsonb_build_object('item_id', v_cat, 'variante_id', v_var, 'cantidad', 4)),
    v_cot);

  -- El admin edita la cantidad DESPUES de que entro el pedido: la restitucion
  -- no puede mirar esto, tiene que devolver los 4 que se tomaron.
  UPDATE items_cotizacion SET cantidad = 10
    WHERE cotizacion_id = v_cot AND variante_id = v_var;

  PERFORM set_config('probe315.var', v_var, TRUE);
  PERFORM set_config('probe315.cot3', v_cot, TRUE);
END $$;

INSERT INTO _r
SELECT 15, 'la variante se descuenta al pedir', '6',
       (SELECT stock::TEXT FROM catalogo_variantes WHERE id = current_setting('probe315.var', TRUE))
WHERE COALESCE(current_setting('probe315.var', TRUE), '') <> '';

DO $$
DECLARE v_cot TEXT := current_setting('probe315.cot3', TRUE);
BEGIN
  IF v_cot IS NULL OR v_cot = '' THEN RETURN; END IF;
  PERFORM liberar_reserva_catalogo(v_cot, 'probe variante');
  PERFORM liberar_reserva_catalogo(v_cot, 'probe variante repetido');
END $$;

INSERT INTO _r
SELECT 16, 'la variante se restituye al liberar (y solo una vez)', '10',
       (SELECT stock::TEXT FROM catalogo_variantes WHERE id = current_setting('probe315.var', TRUE))
WHERE COALESCE(current_setting('probe315.var', TRUE), '') <> '';

INSERT INTO _r
SELECT 17, 'la reserva del catalogo queda cerrada', 'sin abiertas',
       (SELECT CASE WHEN COUNT(*) = 0 THEN 'sin abiertas'
                    ELSE 'FALLO: quedan ' || COUNT(*)::TEXT END
        FROM catalogo_reservas_cotizacion
        WHERE cotizacion_id = current_setting('probe315.cot3', TRUE)
          AND liberada_at IS NULL)
WHERE COALESCE(current_setting('probe315.cot3', TRUE), '') <> '';

-- El caso que la marca booleana no podia expresar: el admin edita la cantidad
-- despues de pedir. Se devuelve lo RESERVADO (4), no lo que la linea pide hoy.
INSERT INTO _r
SELECT 18, 'devuelve lo reservado, no la cantidad editada', '4',
       (SELECT cantidad::TEXT FROM catalogo_reservas_cotizacion
        WHERE cotizacion_id = current_setting('probe315.cot3', TRUE)
        LIMIT 1)
WHERE COALESCE(current_setting('probe315.cot3', TRUE), '') <> '';

-- La venta cierra la reserva SIN devolver: la mercaderia ya salio.
DO $$
DECLARE
  v_org TEXT := current_setting('probe315.org', TRUE);
  v_cat TEXT;
  v_var TEXT;
  v_cot TEXT;
  v_cli TEXT;
BEGIN
  IF v_org IS NULL OR v_org = '' THEN RETURN; END IF;

  INSERT INTO catalogo_items (organization_id, nombre, precio, activo, tipo)
  VALUES (v_org, 'PROBE-315 vendida', 100, TRUE, 'PRODUCTO') RETURNING id INTO v_cat;
  INSERT INTO catalogo_variantes (organization_id, item_id, etiqueta, stock, activo)
  VALUES (v_org, v_cat, 'Azul', 10, TRUE) RETURNING id INTO v_var;

  SELECT id INTO v_cli FROM clientes WHERE organization_id = v_org LIMIT 1;
  INSERT INTO cotizaciones (organization_id, cliente_id, numero_cotizacion,
                            tipo, estado, origen, subtotal, iva, total)
  VALUES (v_org, v_cli, 'PROBE-315-E', 'PRESUPUESTO', 'ENVIADA',
          'CATALOGO_PUBLICO', 100, 0, 100)
  RETURNING id INTO v_cot;

  PERFORM reservar_stock_catalogo(
    v_org,
    jsonb_build_array(jsonb_build_object('item_id', v_cat, 'variante_id', v_var, 'cantidad', 3)),
    v_cot);

  -- La venta consume, y despues alguien rechaza la cotizacion.
  PERFORM consumir_reserva_catalogo(v_cot, 'probe venta');
  UPDATE cotizaciones SET estado = 'RECHAZADA' WHERE id = v_cot;

  PERFORM set_config('probe315.var2', v_var, TRUE);
END $$;

INSERT INTO _r
SELECT 19, 'rechazar despues de vender NO acredita de vuelta', '7',
       (SELECT stock::TEXT FROM catalogo_variantes WHERE id = current_setting('probe315.var2', TRUE))
WHERE COALESCE(current_setting('probe315.var2', TRUE), '') <> '';

-- El trigger: el UPDATE de estado de arriba tuvo que disparar la liberacion
-- sin que nadie llamara a la funcion a mano.
INSERT INTO _r
SELECT 20, 'el trigger existe sobre cotizaciones', 'presente',
       (SELECT CASE WHEN COUNT(*) > 0 THEN 'presente' ELSE 'FALLO: no esta' END
        FROM pg_trigger
        WHERE tgname = 'cotizaciones_liberar_reserva_catalogo'
          AND NOT tgisinternal);

-- Interaccion con la 312: una cotizacion REEMPLAZADA por una revision no
-- restituye su stock de catalogo — lo debe la revision.
DO $$
DECLARE
  v_org  TEXT := current_setting('probe315.org', TRUE);
  v_cat  TEXT;
  v_var  TEXT;
  v_orig TEXT;
  v_rev  TEXT;
  v_cli  TEXT;
BEGIN
  IF v_org IS NULL OR v_org = '' THEN RETURN; END IF;

  INSERT INTO catalogo_items (organization_id, nombre, precio, activo, tipo)
  VALUES (v_org, 'PROBE-315 revisada', 100, TRUE, 'PRODUCTO') RETURNING id INTO v_cat;
  INSERT INTO catalogo_variantes (organization_id, item_id, etiqueta, stock, activo)
  VALUES (v_org, v_cat, 'Verde', 10, TRUE) RETURNING id INTO v_var;

  SELECT id INTO v_cli FROM clientes WHERE organization_id = v_org LIMIT 1;

  INSERT INTO cotizaciones (organization_id, cliente_id, numero_cotizacion,
                            tipo, estado, origen, subtotal, iva, total)
  VALUES (v_org, v_cli, 'PROBE-315-F', 'ORDEN', 'ACEPTADA',
          'CATALOGO_PUBLICO', 100, 0, 100)
  RETURNING id INTO v_orig;

  PERFORM reservar_stock_catalogo(
    v_org,
    jsonb_build_array(jsonb_build_object('item_id', v_cat, 'variante_id', v_var, 'cantidad', 4)),
    v_orig);

  -- Nace la revision y marca la original como reemplazada (migracion 311).
  INSERT INTO cotizaciones (organization_id, cliente_id, numero_cotizacion,
                            tipo, estado, subtotal, iva, total, revision_de)
  VALUES (v_org, v_cli, 'PROBE-315-G', 'ORDEN', 'ENVIADA', 100, 0, 100, v_orig)
  RETURNING id INTO v_rev;

  UPDATE cotizaciones SET reemplazada_por = v_rev WHERE id = v_orig;

  -- Ahora se rechaza la ORIGINAL: el trigger corre, pero no debe restituir.
  UPDATE cotizaciones SET estado = 'RECHAZADA' WHERE id = v_orig;

  PERFORM set_config('probe315.var3', v_var, TRUE);
  PERFORM set_config('probe315.rev', v_rev, TRUE);
END $$;

INSERT INTO _r
SELECT 21, 'rechazar la reemplazada NO devuelve el stock', '6',
       (SELECT stock::TEXT FROM catalogo_variantes WHERE id = current_setting('probe315.var3', TRUE))
WHERE COALESCE(current_setting('probe315.var3', TRUE), '') <> '';

-- Y la venta de la revision cierra las filas que quedaron en la original.
DO $$
DECLARE v_rev TEXT := current_setting('probe315.rev', TRUE);
BEGIN
  IF v_rev IS NULL OR v_rev = '' THEN RETURN; END IF;
  PERFORM consumir_reserva_catalogo(v_rev, 'probe venta de revision');
END $$;

INSERT INTO _r
SELECT 22, 'vender la revision cierra la reserva de la original', 'sin abiertas',
       (SELECT CASE WHEN COUNT(*) = 0 THEN 'sin abiertas'
                    ELSE 'FALLO: quedan ' || COUNT(*)::TEXT END
        FROM catalogo_reservas_cotizacion r
        JOIN cotizaciones c ON c.id = r.cotizacion_id
        WHERE c.reemplazada_por = current_setting('probe315.rev', TRUE)
          AND r.liberada_at IS NULL)
WHERE COALESCE(current_setting('probe315.rev', TRUE), '') <> '';

SELECT orden, probe, esperado, obtenido FROM _r ORDER BY orden, probe;

ROLLBACK;
