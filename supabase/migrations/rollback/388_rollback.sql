-- Rollback of 388 (entrega idempotente y reservas de cotización).
--
-- Qué hace:
--   * Quita el índice único de CARGO vigente por orden. La ruta de entrega
--     sigue condicionando el UPDATE al estado leído, así que la doble entrega
--     concurrente sigue cortada en la app; lo que se pierde es la red en base.
--   * Restaura liberar_items_cotizacion de la 206 (libera LEAST(cantidad de la
--     línea, stock_reservado), sin mirar el libro) y reservar_items_cotizacion /
--     reservar_stock_catalogo de la 315 (sin filtro de organización en
--     inventario). Copias textuales de esas migraciones.
--   * No toca datos: los asientos LIBERACION_RESERVA que haya escrito la versión
--     388 son movimientos válidos y se quedan.
--
-- Sin BEGIN propio: el runner envuelve el archivo en una transacción.

SET LOCAL lock_timeout = '3s';

DROP INDEX IF EXISTS cuenta_corriente_cargo_orden_vigente_uniq;

-- ============================================================
-- liberar_items_cotizacion — versión 206
-- ============================================================

CREATE OR REPLACE FUNCTION liberar_items_cotizacion(
  p_cotizacion_id TEXT,
  p_user_id       TEXT,
  p_motivo        TEXT DEFAULT 'Liberación de reserva',
  p_deposito_id   TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_item              RECORD;
  v_stock             INTEGER;
  v_stock_reservado   INTEGER;
  v_org_id            TEXT;
  v_count             INTEGER := 0;
  v_cantidad_liberar  INTEGER;
  v_deposito_efectivo TEXT;
BEGIN
  SELECT organization_id INTO v_org_id
  FROM cotizaciones WHERE id = p_cotizacion_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cotización no encontrada';
  END IF;

  FOR v_item IN
    SELECT ic.id, ic.inventario_id, ic.cantidad, ic.descripcion
    FROM items_cotizacion ic
    WHERE ic.cotizacion_id = p_cotizacion_id
      AND ic.inventario_id IS NOT NULL
  LOOP
    SELECT stock, stock_reservado INTO v_stock, v_stock_reservado
    FROM inventario
    WHERE id = v_item.inventario_id AND deleted_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_cantidad_liberar := LEAST(v_item.cantidad, v_stock_reservado);

    IF v_cantidad_liberar > 0 THEN
      UPDATE inventario
      SET stock_reservado = stock_reservado - v_cantidad_liberar
      WHERE id = v_item.inventario_id;

      -- Dual-write: replicate liberation to per-deposit stock.
      v_deposito_efectivo := liberar_reserva_deposito(
        v_item.inventario_id, v_org_id, p_deposito_id, v_cantidad_liberar);

      INSERT INTO movimientos_inventario (
        inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
        referencia_id, referencia_tipo, usuario_id, organization_id,
        observaciones, deposito_id
      ) VALUES (
        v_item.inventario_id, 'LIBERACION_RESERVA', v_cantidad_liberar,
        v_stock, v_stock,
        p_cotizacion_id, 'COTIZACION', p_user_id, v_org_id,
        p_motivo,
        v_deposito_efectivo
      );

      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'itemsLiberados', v_count);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION liberar_items_cotizacion(TEXT, TEXT, TEXT, TEXT) IS NULL;

-- ============================================================
-- reservar_items_cotizacion — versión 315
-- ============================================================

CREATE OR REPLACE FUNCTION reservar_items_cotizacion(
  p_cotizacion_id TEXT,
  p_user_id       TEXT,
  p_deposito_id   TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_item              RECORD;
  v_stock             INTEGER;
  v_stock_reservado   INTEGER;
  v_org_id            TEXT;
  v_disponible        INTEGER;
  v_count             INTEGER := 0;
  v_deposito_efectivo TEXT;
  v_ya_reservado      INTEGER;
  v_faltante          INTEGER;
  v_exceso            INTEGER;
BEGIN
  SELECT organization_id INTO v_org_id
  FROM cotizaciones WHERE id = p_cotizacion_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cotización no encontrada';
  END IF;

  -- Se recorre la UNIÓN de lo que la cotización pide HOY y lo que tiene TOMADO
  -- según el libro, no sólo lo primero.
  --
  --   * Agrupado por producto en los dos lados, porque
  --     reserva_cotizacion_pendiente agrupa por inventario_id: comparar ese
  --     agregado contra la cantidad de UNA línea sub-reserva las cotizaciones
  --     con el mismo producto repetido (dos líneas de 3 reservaban 3 en vez de
  --     6), y el formulario agrega líneas sin deduplicar por inventario.
  --
  --   * FULL OUTER JOIN y no sólo las líneas vivas: si el admin BORRA la línea
  --     de un producto, esa fila deja de existir y un loop sobre
  --     items_cotizacion no vuelve a visitarlo nunca — ni acá, ni en
  --     liberar_items_cotizacion, que también itera las líneas. La reserva
  --     quedaba tomada para siempre. Del lado del libro, un producto sin línea
  --     entra con cantidad 0 y cae solo en la rama de exceso, que lo devuelve
  --     entero.
  FOR v_item IN
    SELECT
      COALESCE(li.inventario_id, lib.inventario_id)   AS inventario_id,
      COALESCE(li.cantidad, 0)                        AS cantidad,
      COALESCE(li.descripcion, '(línea eliminada)')   AS descripcion,
      COALESCE(lib.cantidad, 0)                       AS ya_reservado
    FROM (
      SELECT
        ic.inventario_id,
        SUM(ic.cantidad)::INTEGER AS cantidad,
        MIN(ic.descripcion)       AS descripcion
      FROM items_cotizacion ic
      WHERE ic.cotizacion_id = p_cotizacion_id
        AND ic.inventario_id IS NOT NULL
      GROUP BY ic.inventario_id
    ) li
    FULL OUTER JOIN reserva_cotizacion_pendiente(p_cotizacion_id) lib
      ON lib.inventario_id = li.inventario_id
  LOOP
    v_ya_reservado := v_item.ya_reservado;

    -- Se reserva el FALTANTE, no la cantidad entera encima de lo que había:
    -- con cobertura parcial (la solicitud reservó 2 y después un admin editó
    -- la línea a 5) reservar 5 dejaba 7 tomadas para una cotización de 5, y la
    -- venta liberaba 5 dejando 2 colgadas para siempre.
    v_faltante := v_item.cantidad - COALESCE(v_ya_reservado, 0);

    -- Sobre-cobertura: la cotización tiene tomado MÁS de lo que pide ahora
    -- (el catálogo reservó 5 y el admin la editó a 2, o borró la línea entera
    -- y ahora pide 0). Saltear dejaba ese excedente colgado para siempre: la
    -- venta libera LEAST(cantidad_actual, …) y liberar_reserva_catalogo sólo
    -- corre en rechazo o borrado, que el DELETE ni siquiera permite sobre una
    -- cotización ACEPTADA. Hay que devolverlo acá.
    IF v_faltante < 0 THEN
      SELECT stock, stock_reservado INTO v_stock, v_stock_reservado
      FROM inventario
      WHERE id = v_item.inventario_id AND deleted_at IS NULL
      FOR UPDATE;

      IF NOT FOUND THEN
        CONTINUE;
      END IF;

      v_exceso := LEAST(-v_faltante, GREATEST(0, COALESCE(v_stock_reservado, 0)));

      IF v_exceso > 0 THEN
        UPDATE inventario
        SET stock_reservado = stock_reservado - v_exceso
        WHERE id = v_item.inventario_id;

        v_deposito_efectivo := liberar_reserva_deposito(
          v_item.inventario_id, v_org_id, p_deposito_id, v_exceso);

        INSERT INTO movimientos_inventario (
          inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
          referencia_id, referencia_tipo, usuario_id, organization_id,
          observaciones, deposito_id
        ) VALUES (
          v_item.inventario_id, 'LIBERACION_RESERVA', v_exceso,
          v_stock, v_stock,
          p_cotizacion_id, 'COTIZACION', p_user_id, v_org_id,
          'Ajuste: la cotización redujo la cantidad reservada',
          v_deposito_efectivo
        );
      END IF;

      CONTINUE;
    END IF;

    IF v_faltante = 0 THEN
      CONTINUE;
    END IF;

    SELECT stock, stock_reservado INTO v_stock, v_stock_reservado
    FROM inventario
    WHERE id = v_item.inventario_id AND deleted_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Producto no encontrado para item "%"', v_item.descripcion;
    END IF;

    v_disponible := v_stock - v_stock_reservado;

    IF v_disponible < v_faltante THEN
      RAISE EXCEPTION 'Stock insuficiente para "%". Disponible: %, Solicitado: %',
        v_item.descripcion, v_disponible, v_faltante;
    END IF;

    UPDATE inventario
    SET stock_reservado = stock_reservado + v_faltante
    WHERE id = v_item.inventario_id;

    v_deposito_efectivo := reservar_stock_deposito(
      v_item.inventario_id, v_org_id, p_deposito_id, v_faltante, false);

    INSERT INTO movimientos_inventario (
      inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
      referencia_id, referencia_tipo, usuario_id, organization_id,
      observaciones, deposito_id
    ) VALUES (
      v_item.inventario_id, 'RESERVA', v_faltante,
      v_stock, v_stock,
      p_cotizacion_id, 'COTIZACION', p_user_id, v_org_id,
      'Reserva por aprobación de cotización',
      v_deposito_efectivo
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'itemsReservados', v_count);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION reservar_items_cotizacion(TEXT, TEXT, TEXT) IS
  'Reserva stock de los items de una cotización. Idempotente por (cotización, item) contra movimientos_inventario: no re-reserva lo que esa cotización ya tiene tomado, y devuelve el excedente si la cotización se redujo. v315.';

-- ============================================================
-- reservar_stock_catalogo — versión 315
-- ============================================================

CREATE OR REPLACE FUNCTION reservar_stock_catalogo(
  p_organization_id TEXT,
  p_items           JSONB,
  p_cotizacion_id   TEXT
) RETURNS BOOLEAN AS $$
DECLARE
  v_item        JSONB;
  v_item_id     TEXT;
  v_variante_id TEXT;
  v_cantidad    INTEGER;
  v_stock       INTEGER;
  v_inv_id      TEXT;
  v_inv_stock   INTEGER;
  v_inv_reserv  INTEGER;
  v_disponible  INTEGER;
  v_deposito    TEXT;
  v_nombre      TEXT;
  v_var_stock   INTEGER;
  v_var_etq     TEXT;
BEGIN
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_item_id     := v_item->>'item_id';
    v_variante_id := NULLIF(v_item->>'variante_id', '');
    v_cantidad    := (v_item->>'cantidad')::INTEGER;

    IF v_cantidad <= 0 THEN
      RAISE EXCEPTION 'Cantidad inválida: %', v_cantidad
        USING ERRCODE = '22023';
    END IF;

    -- ============ Variante ============
    -- catalogo_variantes no tiene fila en inventario ni detalle por depósito:
    -- su stock es un contador propio del catálogo y se sigue descontando acá.
    IF v_variante_id IS NOT NULL THEN
      SELECT stock, etiqueta INTO v_var_stock, v_var_etq
        FROM catalogo_variantes
        WHERE id = v_variante_id
          AND item_id = v_item_id
          AND organization_id = p_organization_id
          AND activo = TRUE
        FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Variante % no encontrada o inactiva', v_variante_id
          USING ERRCODE = 'P0002';
      END IF;

      IF v_var_stock IS NOT NULL THEN
        IF v_var_stock < v_cantidad THEN
          RAISE EXCEPTION 'Stock insuficiente para variante "%" (disponible: %)', v_var_etq, v_var_stock
            USING ERRCODE = 'P0003';
        END IF;
        UPDATE catalogo_variantes
          SET stock = stock - v_cantidad
          WHERE id = v_variante_id;

        -- Se anota SÓLO cuando de verdad se descontó (stock NULL = el item no
        -- lleva control), para que la restitución nunca acredite de más.
        INSERT INTO catalogo_reservas_cotizacion (
          cotizacion_id, organization_id, catalogo_item_id, variante_id, cantidad
        ) VALUES (
          p_cotizacion_id, p_organization_id, v_item_id, v_variante_id, v_cantidad
        );
      END IF;
      CONTINUE;
    END IF;

    -- ============ Item base ============
    SELECT stock, inventario_id, nombre
      INTO v_stock, v_inv_id, v_nombre
      FROM catalogo_items
      WHERE id = v_item_id
        AND organization_id = p_organization_id
        AND activo = TRUE
      FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Item % no encontrado o inactivo', v_item_id
        USING ERRCODE = 'P0002';
    END IF;

    -- Fuente de verdad única (239): inventario si está linkeado, si no
    -- catalogo_items.stock.
    IF v_inv_id IS NOT NULL THEN
      -- `deleted_at IS NULL` es obligatorio: liberar_items_cotizacion filtra
      -- igual y hace CONTINUE si no encuentra (206:1450). Si la reserva
      -- aceptara filas muertas, crearia una reserva que ningun camino puede
      -- liberar jamas.
      SELECT stock, stock_reservado INTO v_inv_stock, v_inv_reserv
        FROM inventario
        WHERE id = v_inv_id
          AND deleted_at IS NULL
        FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'El producto vinculado a "%" ya no existe', v_nombre
          USING ERRCODE = 'P0002';
      END IF;

      -- Disponible = stock - reservado, el mismo criterio que
      -- reservar_items_cotizacion y que el storefront.
      IF v_inv_stock IS NOT NULL THEN
        v_disponible := v_inv_stock - COALESCE(v_inv_reserv, 0);

        IF v_disponible < v_cantidad THEN
          RAISE EXCEPTION 'Stock insuficiente para "%" (disponible: %)', v_nombre, v_disponible
            USING ERRCODE = 'P0003';
        END IF;

        UPDATE inventario
          SET stock_reservado = stock_reservado + v_cantidad
          WHERE id = v_inv_id;

        -- Réplica en el detalle por depósito (no strict: reparte entre filas
        -- con capacidad). Puede levantar P0011 si la org no tiene depósito
        -- principal; es el mismo riesgo que corre el flujo interno, y desde la
        -- migración 217 toda org nace con uno.
        v_deposito := reservar_stock_deposito(
          v_inv_id, p_organization_id, NULL, v_cantidad, false);

        -- usuario_id NULL a propósito: el flujo es público y anónimo, y la
        -- columna tiene FK a users(id) — cualquier string sintético revienta.
        INSERT INTO movimientos_inventario (
          inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
          referencia_id, referencia_tipo, usuario_id, organization_id,
          observaciones, deposito_id
        ) VALUES (
          v_inv_id, 'RESERVA', v_cantidad,
          v_inv_stock, v_inv_stock,
          p_cotizacion_id, 'COTIZACION', NULL, p_organization_id,
          'Reserva por solicitud desde el catálogo público',
          v_deposito
        );
      END IF;
    ELSIF v_stock IS NOT NULL THEN
      IF v_stock < v_cantidad THEN
        RAISE EXCEPTION 'Stock insuficiente para "%" (disponible: %)', v_nombre, v_stock
          USING ERRCODE = 'P0003';
      END IF;

      UPDATE catalogo_items
        SET stock = stock - v_cantidad
        WHERE id = v_item_id;

      INSERT INTO catalogo_reservas_cotizacion (
        cotizacion_id, organization_id, catalogo_item_id, variante_id, cantidad
      ) VALUES (
        p_cotizacion_id, p_organization_id, v_item_id, NULL, v_cantidad
      );
    END IF;
  END LOOP;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION reservar_stock_catalogo(TEXT, JSONB, TEXT) IS
  'Reserva stock para una solicitud del catálogo público. Fuente única por item: variante > inventario (si linkeado) > catalogo_items.stock. Sobre inventario RESERVA (stock_reservado) con réplica por depósito y asiento RESERVA en movimientos_inventario; nunca descuenta inventario.stock. v315.';

REVOKE EXECUTE ON FUNCTION reservar_stock_catalogo(TEXT, JSONB, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION reservar_stock_catalogo(TEXT, JSONB, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION reservar_stock_catalogo(TEXT, JSONB, TEXT) TO service_role;
