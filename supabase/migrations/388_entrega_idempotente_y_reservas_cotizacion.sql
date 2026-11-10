-- 388_entrega_idempotente_y_reservas_cotizacion.sql
--
-- Dos redes de seguridad en la base, que acompañan cambios en las rutas:
--
-- PARTE 1: un solo CARGO vivo por orden en cuenta corriente.
--   POST /api/ordenes/[id]/entregar carga el saldo pendiente con
--   cargar_deuda_cuenta_corriente. Dos entregas simultáneas de la misma orden
--   (doble tap, dos operadores) cargaban la deuda dos veces. La ruta ahora
--   condiciona el UPDATE de la orden al estado leído, y este índice es la red
--   por debajo: la base no admite un segundo CARGO de referencia ORDEN para la
--   misma orden mientras el primero siga vigente.
--
--   "Vigente" = revertido_at IS NULL. revertir_cargos_orden (migración 319)
--   marca el CARGO revertido sin borrarlo; ese cargo sale del índice y, si
--   alguna vez hiciera falta, la orden puede volver a tener un cargo nuevo.
--
--   Solo ORDEN: una VENTA tiene varios CARGO legítimos (editar_venta_segura,
--   migraciones 328/372, carga la diferencia como un CARGO adicional).
--   Las otras dos fuentes de CARGO por orden también generan uno solo:
--   crear_reparaciones_express (349) uno por orden nueva, y el backfill 236
--   estaba protegido con NOT EXISTS.
--
--   Si ya hay duplicados el índice no se puede crear. El chequeo previo aborta
--   la migración con el detalle (ver verify/388_precheck.sql para listarlos y
--   decidir cuál revertir con revertir_cargos_orden antes de reintentar).
--
-- PARTE 2: liberar_items_cotizacion libera según el libro, no según la línea.
--   La versión de la 206 liberaba LEAST(item.cantidad, inventario.stock_reservado)
--   por cada línea con inventario_id, sin mirar si ESA cotización había
--   reservado algo. stock_reservado es un contador global por producto, así
--   que rechazar una cotización que nunca reservó (un PRESUPUESTO aceptado:
--   aprobar_cotizacion_atomica solo reserva si tipo <> 'PRESUPUESTO') le
--   comía la reserva a otra cotización u orden.
--
--   Ahora libera exactamente lo pendiente de reserva_cotizacion_pendiente
--   (migración 315: RESERVA - LIBERACION_RESERVA de esta cotización en
--   movimientos_inventario), igual que liberar_reserva_catalogo. Sin reserva
--   registrada no libera nada, y una segunda llamada es un no-op porque la
--   primera ya asentó su LIBERACION_RESERVA. Toda reserva de cotización deja
--   ese asiento desde la migración 108, así que el libro está completo.
--
--   La firma, el valor de retorno y los llamadores no cambian (convertir a
--   venta, aprobación de revisiones 312/337, rechazo en el PUT).
--
-- PARTE 3: aislamiento por organización en los UPDATE de inventario.
--   reservar_items_cotizacion, liberar_items_cotizacion y reservar_stock_catalogo
--   leían y actualizaban inventario filtrando solo por id. Se agrega
--   `AND organization_id = <org>` en lecturas con lock y UPDATE. Un
--   inventario_id de otra organización ahora se comporta como inexistente.
--   reservar_items_cotizacion y reservar_stock_catalogo se copian de su última
--   definición (315) con solo ese cambio.
--
-- Sin BEGIN propio: el runner envuelve el archivo en una transacción.
-- Rollback: rollback/388_rollback.sql. Verificación: verify/388_probes.sql.

-- ============================================================
-- Parte 1: un CARGO vivo por orden
-- ============================================================

DO $$
DECLARE
  v_detalle TEXT;
  v_cantidad INTEGER;
BEGIN
  SELECT COUNT(*), string_agg(
           format('org=%s orden=%s cargos=%s ids=%s', organization_id, referencia_id, n, ids),
           E'\n' ORDER BY organization_id, referencia_id)
    INTO v_cantidad, v_detalle
    FROM (
      SELECT organization_id, referencia_id, COUNT(*) AS n,
             string_agg(id, ',' ORDER BY created_at) AS ids
        FROM cuenta_corriente
       WHERE tipo = 'CARGO'
         AND referencia_tipo = 'ORDEN'
         AND revertido_at IS NULL
       GROUP BY organization_id, referencia_id
      HAVING COUNT(*) > 1
    ) d;

  IF v_cantidad > 0 THEN
    RAISE EXCEPTION 'MIGRACION_388: % orden(es) con mas de un CARGO vigente en cuenta_corriente. Revertir los sobrantes (revertir_cargos_orden) antes de crear el indice:%',
      v_cantidad, E'\n' || v_detalle;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS cuenta_corriente_cargo_orden_vigente_uniq
  ON cuenta_corriente (organization_id, referencia_id)
  WHERE tipo = 'CARGO'
    AND referencia_tipo = 'ORDEN'
    AND revertido_at IS NULL;

COMMENT ON INDEX cuenta_corriente_cargo_orden_vigente_uniq IS
  'Un solo CARGO vigente (no revertido) por orden en cuenta corriente. Red contra entregas concurrentes. v388.';

-- ============================================================
-- Parte 2: liberar_items_cotizacion contra el libro de movimientos
-- ============================================================

CREATE OR REPLACE FUNCTION liberar_items_cotizacion(
  p_cotizacion_id TEXT,
  p_user_id       TEXT,
  p_motivo        TEXT DEFAULT 'Liberación de reserva',
  p_deposito_id   TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_row               RECORD;
  v_stock             INTEGER;
  v_stock_reservado   INTEGER;
  v_org_id            TEXT;
  v_count             INTEGER := 0;
  v_cantidad_liberar  INTEGER;
  v_deposito_efectivo TEXT;
BEGIN
  -- FOR UPDATE serializa dos liberaciones de la misma cotización: sin esto,
  -- las dos leen el mismo pendiente del libro y liberan dos veces. Mismo
  -- criterio que liberar_reserva_catalogo (315).
  SELECT organization_id INTO v_org_id
  FROM cotizaciones WHERE id = p_cotizacion_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cotización no encontrada';
  END IF;

  -- Lo que ESTA cotización tiene tomado según el libro. Vacío si nunca
  -- reservó (PRESUPUESTO) o si ya se liberó: entonces no se toca nada.
  FOR v_row IN SELECT * FROM reserva_cotizacion_pendiente(p_cotizacion_id)
  LOOP
    -- Sin filtro de deleted_at a propósito (igual que liberar_reserva_catalogo):
    -- si el producto se borró en soft después de reservar, la reserva igual
    -- tiene que volver.
    SELECT stock, stock_reservado INTO v_stock, v_stock_reservado
    FROM inventario
    WHERE id = v_row.inventario_id
      AND organization_id = v_org_id
    FOR UPDATE;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    -- Se libera (y se asienta) lo que realmente se puede devolver.
    v_cantidad_liberar := LEAST(v_row.cantidad, GREATEST(0, COALESCE(v_stock_reservado, 0)));

    IF v_cantidad_liberar <= 0 THEN
      CONTINUE;
    END IF;

    UPDATE inventario
    SET stock_reservado = stock_reservado - v_cantidad_liberar
    WHERE id = v_row.inventario_id
      AND organization_id = v_org_id;

    v_deposito_efectivo := liberar_reserva_deposito(
      v_row.inventario_id, v_org_id, p_deposito_id, v_cantidad_liberar);

    INSERT INTO movimientos_inventario (
      inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
      referencia_id, referencia_tipo, usuario_id, organization_id,
      observaciones, deposito_id
    ) VALUES (
      v_row.inventario_id, 'LIBERACION_RESERVA', v_cantidad_liberar,
      v_stock, v_stock,
      p_cotizacion_id, 'COTIZACION', p_user_id, v_org_id,
      p_motivo,
      v_deposito_efectivo
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'itemsLiberados', v_count);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION liberar_items_cotizacion(TEXT, TEXT, TEXT, TEXT) IS
  'Libera la reserva de stock de una cotización según su libro de movimientos (reserva_cotizacion_pendiente): solo lo que esa cotización reservó y todavía no liberó. Idempotente. Inventario filtrado por la organización de la cotización. v388.';

-- ============================================================
-- Parte 3a: reservar_items_cotizacion (copia de la 315 + filtro de organización)
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
      WHERE id = v_item.inventario_id AND organization_id = v_org_id AND deleted_at IS NULL
      FOR UPDATE;

      IF NOT FOUND THEN
        CONTINUE;
      END IF;

      v_exceso := LEAST(-v_faltante, GREATEST(0, COALESCE(v_stock_reservado, 0)));

      IF v_exceso > 0 THEN
        UPDATE inventario
        SET stock_reservado = stock_reservado - v_exceso
        WHERE id = v_item.inventario_id AND organization_id = v_org_id;

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
    WHERE id = v_item.inventario_id AND organization_id = v_org_id AND deleted_at IS NULL
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
    WHERE id = v_item.inventario_id AND organization_id = v_org_id;

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
  'Reserva stock de los items de una cotización. Idempotente por (cotización, item) contra movimientos_inventario: no re-reserva lo que esa cotización ya tiene tomado, y devuelve el excedente si la cotización se redujo. v388: inventario filtrado por la organización de la cotización.';

-- ============================================================
-- Parte 3b: reservar_stock_catalogo (copia de la 315 + filtro de organización)
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
          WHERE id = v_variante_id AND organization_id = p_organization_id;

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
          AND organization_id = p_organization_id
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
          WHERE id = v_inv_id AND organization_id = p_organization_id;

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
        WHERE id = v_item_id AND organization_id = p_organization_id;

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
  'Reserva stock para una solicitud del catálogo público. Fuente única por item: variante > inventario (si linkeado) > catalogo_items.stock. Sobre inventario RESERVA (stock_reservado) con réplica por depósito y asiento RESERVA en movimientos_inventario; nunca descuenta inventario.stock. v388: todos los UPDATE filtran por organización.';

REVOKE EXECUTE ON FUNCTION reservar_stock_catalogo(TEXT, JSONB, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION reservar_stock_catalogo(TEXT, JSONB, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION reservar_stock_catalogo(TEXT, JSONB, TEXT) TO service_role;

-- Las funciones de reserva de cotizaciones solo se llaman desde el servidor
-- (service_role). Se cierra EXECUTE para el resto, igual que reservar_stock_catalogo.
REVOKE EXECUTE ON FUNCTION liberar_items_cotizacion(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION liberar_items_cotizacion(TEXT, TEXT, TEXT, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION liberar_items_cotizacion(TEXT, TEXT, TEXT, TEXT) TO service_role;
REVOKE EXECUTE ON FUNCTION reservar_items_cotizacion(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION reservar_items_cotizacion(TEXT, TEXT, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION reservar_items_cotizacion(TEXT, TEXT, TEXT) TO service_role;
