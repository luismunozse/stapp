-- Probes de la migracion 314: el catalogo publico reserva, no descuenta.
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
  VALUES (v_org, 'PROBE-314 producto', 10, 0, 100)
  RETURNING id INTO v_inv;

  INSERT INTO inventario_depositos (inventario_id, deposito_id, stock, stock_reservado, organization_id)
  VALUES (v_inv, v_dep, 10, 0, v_org)
  ON CONFLICT (inventario_id, deposito_id) DO UPDATE SET stock = 10, stock_reservado = 0;

  INSERT INTO catalogo_items (organization_id, nombre, precio, activo, inventario_id, tipo)
  VALUES (v_org, 'PROBE-314 item', 100, TRUE, v_inv, 'PRODUCTO')
  RETURNING id INTO v_cat;

  PERFORM set_config('probe314.org', v_org, TRUE);
  PERFORM set_config('probe314.inv', v_inv, TRUE);
  PERFORM set_config('probe314.cat', v_cat, TRUE);
  PERFORM set_config('probe314.dep', v_dep, TRUE);

  INSERT INTO _r VALUES (0, 'setup', 'ok', 'ok');
END $$;

-- ── Reservar 3 unidades ──
DO $$
DECLARE
  v_org TEXT := current_setting('probe314.org', TRUE);
  v_cat TEXT := current_setting('probe314.cat', TRUE);
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
       (SELECT stock::TEXT FROM inventario WHERE id = current_setting('probe314.inv', TRUE))
WHERE current_setting('probe314.inv', TRUE) <> '';

INSERT INTO _r
SELECT 2, 'inventario.stock_reservado sube', '3',
       (SELECT stock_reservado::TEXT FROM inventario WHERE id = current_setting('probe314.inv', TRUE))
WHERE current_setting('probe314.inv', TRUE) <> '';

INSERT INTO _r
SELECT 3, 'detalle por deposito replica la reserva', '3',
       (SELECT COALESCE(SUM(stock_reservado), 0)::TEXT FROM inventario_depositos
        WHERE inventario_id = current_setting('probe314.inv', TRUE))
WHERE current_setting('probe314.inv', TRUE) <> '';

INSERT INTO _r
SELECT 4, 'asiento RESERVA en movimientos_inventario', '1 x RESERVA/COTIZACION',
       (SELECT COUNT(*)::TEXT || ' x ' || COALESCE(MAX(tipo), '?') || '/' || COALESCE(MAX(referencia_tipo), '?')
        FROM movimientos_inventario
        WHERE inventario_id = current_setting('probe314.inv', TRUE))
WHERE current_setting('probe314.inv', TRUE) <> '';

INSERT INTO _r
SELECT 5, 'el movimiento tiene deposito asignado', 'con deposito',
       (SELECT CASE WHEN deposito_id IS NULL THEN 'FALLO: deposito_id NULL' ELSE 'con deposito' END
        FROM movimientos_inventario
        WHERE inventario_id = current_setting('probe314.inv', TRUE)
        LIMIT 1)
WHERE current_setting('probe314.inv', TRUE) <> '';

-- ── Disponibilidad = stock - reservado: 8 mas no entran (quedan 7) ──
DO $$
DECLARE
  v_org TEXT := current_setting('probe314.org', TRUE);
  v_cat TEXT := current_setting('probe314.cat', TRUE);
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

SELECT orden, probe, esperado, obtenido FROM _r ORDER BY orden, probe;

ROLLBACK;
