-- 314_catalogo_reserva_en_vez_de_descuento.sql
--
-- El catálogo público llevaba contabilidad de stock PARALELA. Al crear una
-- solicitud, reservar_stock_catalogo hacía (239:99-101):
--
--     UPDATE inventario SET stock = GREATEST(0, stock - v_cantidad)
--
-- Un descuento físico real, sin pasar por descontar_stock_deposito (el detalle
-- por depósito quedaba desincronizado) y sin asiento en movimientos_inventario
-- (la unidad desaparecía sin rastro en el historial del producto).
--
-- Dos consecuencias, la segunda peor que la primera:
--
--   1. DOBLE DESCUENTO. Si esa cotización termina convertida en venta,
--      crear_venta_atomica descuenta inventario.stock otra vez: la misma unidad
--      sale dos veces del stock. Camino alcanzable hoy: la cotización nace
--      PRESUPUESTO/ENVIADA, un admin le carga equipo_snapshot, la convierte a
--      orden (que le cambia el tipo a ORDEN), la aprueba — ahí
--      reservar_items_cotizacion reserva ADEMÁS — y la convierte a venta.
--
--   2. DESCUENTO PERMANENTE ANTE ABANDONO. Nada devuelve ese stock. Rechazar,
--      borrar o simplemente ignorar la solicitud no dispara ninguna
--      devolución, y liberar_items_cotizacion solo toca stock_reservado —
--      una columna que el catálogo nunca escribía. O sea: cualquiera desde
--      internet podía vaciar el stock declarado de un local sin comprar nada,
--      de forma irreversible.
--
-- Arreglo, en cuatro partes — cambiar descuento por reserva SIN camino de
-- liberación sería puramente cosmético: el stock quedaría igual de
-- inmovilizado, sólo que en otra columna.
--
--   1. El catálogo RESERVA en vez de descontar (parte 1), igual que el flujo
--      interno (reservar_items_cotizacion, migración 206), con réplica por
--      depósito y asiento contable.
--   2. Toda reserva del catálogo se puede DEVOLVER: liberar_reserva_catalogo
--      (partes 3 y 4) calcula lo que esa cotización tomó desde el libro mayor
--      de movimientos, así que es idempotente y nunca se come la reserva de
--      otra cotización. Las rutas la llaman al rechazar (desde CUALQUIER
--      estado, no sólo ACEPTADA) y al borrar en soft.
--   3. El abandono deja de ser permanente: expirar_reservas_catalogo (parte 6)
--      corre por cron y libera lo que quedó ENVIADA pasado el vencimiento.
--   4. El camino catálogo → orden → venta ya no reserva dos veces:
--      reservar_items_cotizacion (parte 5) es idempotente por cotización.
--
-- La conversión a venta libera la reserva (liberar_items_cotizacion) y
-- descuenta UNA sola vez por el camino de siempre.
--
-- Qué cambia para el usuario:
--   * inventario.stock deja de bajar cuando entra una solicitud del catálogo.
--     Lo que sube ahora es stock_reservado, visible como reserva igual que las
--     internas y liberable a mano. El stock "disponible" que ve el comprador NO
--     cambia: el storefront ya pasó a calcular stock - stock_reservado.
--   * Las reservas del catálogo aparecen en el historial del producto como
--     movimiento RESERVA con referencia_tipo COTIZACION, y su devolución como
--     LIBERACION_RESERVA.
--   * Una solicitud sin responder deja de retener stock a los 7 días (default
--     de expirar_reservas_catalogo; ver la nota de decisión de producto en la
--     parte 6).
--
-- REQUIERE además, del lado de la app: el cron
-- /api/cron/catalogo-reservas-vencidas dado de alta en vercel.json. Sin el
-- cron, las partes 1 a 5 siguen siendo correctas pero el abandono vuelve a
-- retener stock indefinidamente.
--
-- NO se hace backfill del stock que las solicitudes viejas ya se comieron:
-- no hay forma de distinguir las que terminaron en venta (descuento correcto)
-- de las abandonadas (descuento espurio). Corregirlo es un ajuste manual de
-- inventario, caso por caso.

-- ============================================================
-- Parte 1: reservar_stock_catalogo
-- ============================================================
-- Se agrega p_cotizacion_id para que el movimiento quede referenciado a la
-- solicitud. Cambia la aridad, así que hay que soltar la firma vieja: con las
-- dos vivas, una llamada de 2 argumentos sería ambigua.

DROP FUNCTION IF EXISTS reservar_stock_catalogo(TEXT, JSONB);

CREATE OR REPLACE FUNCTION reservar_stock_catalogo(
  p_organization_id TEXT,
  p_items           JSONB,
  p_cotizacion_id   TEXT DEFAULT NULL
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
    END IF;
  END LOOP;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION reservar_stock_catalogo(TEXT, JSONB, TEXT) IS
  'Reserva stock para una solicitud del catálogo público. Fuente única por item: variante > inventario (si linkeado) > catalogo_items.stock. Sobre inventario RESERVA (stock_reservado) con réplica por depósito y asiento RESERVA en movimientos_inventario; nunca descuenta inventario.stock. v314.';

REVOKE EXECUTE ON FUNCTION reservar_stock_catalogo(TEXT, JSONB, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION reservar_stock_catalogo(TEXT, JSONB, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION reservar_stock_catalogo(TEXT, JSONB, TEXT) TO service_role;

-- ============================================================
-- Parte 2: crear_cotizacion_publica_atomica
-- ============================================================
-- La reserva pasa a correr DESPUÉS del INSERT de la cotización para poder
-- referenciarla en movimientos_inventario. Sigue siendo una única transacción
-- plpgsql: si el stock no alcanza, rollbackea todo igual que antes (cotización,
-- items y consumo del cupón incluidos).
--
-- Único efecto observable del reordenamiento: cuando fallan cupón Y stock a la
-- vez, ahora gana el error del cupón (P0004 → 400) en lugar del de stock
-- (P0003 → 409). Antes era al revés. El route mapea ambos.

CREATE OR REPLACE FUNCTION crear_cotizacion_publica_atomica(
  p_cotizacion  JSONB,   -- { organization_id, cliente_id, numero_cotizacion, public_token, notas, subtotal, iva, cupon_codigo? }
  p_items       JSONB,   -- [{ descripcion, cantidad, precio_unitario, subtotal, inventario_id, catalogo_item_id, comentario_cliente, adjuntos, variante_id, variante_etiqueta }]
  p_stock_items JSONB,   -- [{ item_id, cantidad, variante_id? }] para reservar_stock_catalogo
  p_telefono    TEXT     -- para marcar abandono recovered (opcional, NULL = no marcar)
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_cotizacion_id TEXT;
  v_item          JSONB;
  v_org_id        TEXT;
  v_stock_ok      BOOLEAN;
  v_subtotal      DECIMAL;
  v_iva           DECIMAL;
  v_codigo        TEXT;
  v_cupon_res     JSONB;
  v_cupon_id      TEXT := NULL;
  v_cupon_codigo  TEXT := NULL;
  v_descuento     DECIMAL := 0;
  v_total         DECIMAL;
BEGIN
  v_org_id   := p_cotizacion->>'organization_id';
  v_subtotal := COALESCE((p_cotizacion->>'subtotal')::DECIMAL, 0);
  v_iva      := COALESCE((p_cotizacion->>'iva')::DECIMAL, 0);
  v_codigo   := NULLIF(p_cotizacion->>'cupon_codigo', '');

  -- 1. Cupón dentro de la transacción (fix ERR-02, migración 240).
  -- aplicar_cupon_catalogo valida + incrementa usos_actuales con FOR UPDATE.
  -- Si algo falla más abajo, el incremento rollbackea solo: nunca queda un
  -- cupón consumido sin cotización.
  IF v_codigo IS NOT NULL THEN
    v_cupon_res := aplicar_cupon_catalogo(v_org_id, v_codigo, v_subtotal);
    IF NOT COALESCE((v_cupon_res->>'ok')::BOOLEAN, FALSE) THEN
      RAISE EXCEPTION '%', COALESCE(v_cupon_res->>'error', 'Cupón inválido')
        USING ERRCODE = 'P0004';
    END IF;
    v_cupon_id     := v_cupon_res->>'cupon_id';
    v_cupon_codigo := v_cupon_res->>'codigo';
    v_descuento    := COALESCE((v_cupon_res->>'descuento_aplicado')::DECIMAL, 0);
  END IF;

  v_total := GREATEST(0, v_subtotal - v_descuento) + v_iva;

  -- 2. Cotización + items.
  INSERT INTO cotizaciones (
    organization_id, cliente_id, numero_cotizacion, public_token,
    tipo, estado, origen, notas,
    subtotal, iva, total, iva_porcentaje,
    descuento_global_tipo, descuento_global_valor,
    cupon_id, cupon_codigo, cupon_descuento
  )
  VALUES (
    v_org_id,
    p_cotizacion->>'cliente_id',
    p_cotizacion->>'numero_cotizacion',
    p_cotizacion->>'public_token',
    'PRESUPUESTO',
    'ENVIADA',
    'CATALOGO_PUBLICO',
    p_cotizacion->>'notas',
    v_subtotal,
    v_iva,
    v_total,
    0,
    'porcentaje',
    0,
    v_cupon_id,
    v_cupon_codigo,
    CASE WHEN v_descuento > 0 THEN v_descuento ELSE NULL END
  )
  RETURNING id INTO v_cotizacion_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO items_cotizacion (
      cotizacion_id, descripcion, cantidad, precio_unitario, subtotal,
      unidad, descuento_tipo, descuento_valor,
      inventario_id, catalogo_item_id, tipo_repuesto,
      comentario_cliente, adjuntos,
      variante_id, variante_etiqueta
    )
    VALUES (
      v_cotizacion_id,
      v_item->>'descripcion',
      (v_item->>'cantidad')::INTEGER,
      (v_item->>'precio_unitario')::DECIMAL,
      (v_item->>'subtotal')::DECIMAL,
      'Unidad',
      'porcentaje',
      0,
      NULLIF(v_item->>'inventario_id', ''),
      NULLIF(v_item->>'catalogo_item_id', ''),
      'NO_APLICA',
      NULLIF(v_item->>'comentario_cliente', ''),
      COALESCE(v_item->'adjuntos', '[]'::jsonb),
      NULLIF(v_item->>'variante_id', ''),
      NULLIF(v_item->>'variante_etiqueta', '')
    );
  END LOOP;

  -- 3. Reservar stock con la cotización ya creada, para que el movimiento
  -- quede referenciado a ella. Si no alcanza (P0003), la exception revierte
  -- cotización, items y cupón.
  v_stock_ok := reservar_stock_catalogo(v_org_id, p_stock_items, v_cotizacion_id);

  IF p_telefono IS NOT NULL AND length(p_telefono) > 0 THEN
    UPDATE catalogo_carritos_abandonados
    SET recovered_at = NOW(),
        cotizacion_id = v_cotizacion_id
    WHERE organization_id = v_org_id
      AND cliente_telefono = p_telefono
      AND recovered_at IS NULL;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'cotizacion_id', v_cotizacion_id,
    'cupon_id', v_cupon_id,
    'cupon_codigo', v_cupon_codigo,
    'cupon_descuento', v_descuento,
    'total', v_total
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION crear_cotizacion_publica_atomica(JSONB, JSONB, JSONB, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION crear_cotizacion_publica_atomica(JSONB, JSONB, JSONB, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION crear_cotizacion_publica_atomica(JSONB, JSONB, JSONB, TEXT) TO service_role;

-- ============================================================
-- Parte 3: reserva_cotizacion_pendiente
-- ============================================================
-- Cuánto tiene reservado HOY una cotización, según el libro mayor de
-- movimientos referenciados a ella.
--
-- Hace falta porque liberar_items_cotizacion libera
-- LEAST(item.cantidad, inventario.stock_reservado) mirando la fila de
-- inventario: sobre una cotización que nunca reservó, se comería la reserva de
-- OTRA cotización. Los movimientos referenciados son lo único que dice cuánto
-- tomó ESTA cotización, y hacen la liberación idempotente: después de liberar,
-- el asiento LIBERACION_RESERVA baja el neto a 0 y una segunda llamada no
-- devuelve nada.

CREATE OR REPLACE FUNCTION reserva_cotizacion_pendiente(p_cotizacion_id TEXT)
RETURNS TABLE (inventario_id TEXT, cantidad INTEGER) AS $$
  SELECT
    mi.inventario_id,
    SUM(CASE WHEN mi.tipo = 'RESERVA' THEN mi.cantidad ELSE -mi.cantidad END)::INTEGER
  FROM movimientos_inventario mi
  WHERE mi.referencia_id   = p_cotizacion_id
    AND mi.referencia_tipo = 'COTIZACION'
    AND mi.tipo IN ('RESERVA', 'LIBERACION_RESERVA')
  GROUP BY mi.inventario_id
  HAVING SUM(CASE WHEN mi.tipo = 'RESERVA' THEN mi.cantidad ELSE -mi.cantidad END) > 0;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION reserva_cotizacion_pendiente(TEXT) IS
  'Reserva viva de una cotización por item, neteando RESERVA contra LIBERACION_RESERVA en movimientos_inventario. v314.';

-- ============================================================
-- Parte 4: liberar_reserva_catalogo
-- ============================================================
-- Devuelve la reserva que tomó una solicitud del catálogo. Se llama al
-- rechazar (desde CUALQUIER estado), al borrar en soft y al vencer.
--
-- No filtra `deleted_at` sobre inventario a propósito: si el producto se
-- borró en soft después de la reserva, esa reserva igual tiene que volver.

CREATE OR REPLACE FUNCTION liberar_reserva_catalogo(
  p_cotizacion_id TEXT,
  p_motivo        TEXT DEFAULT 'Reserva del catálogo liberada'
) RETURNS JSONB AS $$
DECLARE
  v_org_id   TEXT;
  v_origen   TEXT;
  v_row      RECORD;
  v_stock    INTEGER;
  v_deposito TEXT;
  v_count    INTEGER := 0;
BEGIN
  SELECT organization_id, origen INTO v_org_id, v_origen
    FROM cotizaciones
    WHERE id = p_cotizacion_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'itemsLiberados', 0);
  END IF;

  -- Sólo cotizaciones nacidas del catálogo. Las internas ya tienen su propio
  -- ciclo de reserva/liberación y no hay que tocarlo.
  IF v_origen IS DISTINCT FROM 'CATALOGO_PUBLICO' THEN
    RETURN jsonb_build_object('ok', true, 'itemsLiberados', 0);
  END IF;

  FOR v_row IN SELECT * FROM reserva_cotizacion_pendiente(p_cotizacion_id)
  LOOP
    SELECT stock INTO v_stock
      FROM inventario
      WHERE id = v_row.inventario_id
      FOR UPDATE;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    UPDATE inventario
      SET stock_reservado = GREATEST(0, stock_reservado - v_row.cantidad)
      WHERE id = v_row.inventario_id;

    v_deposito := liberar_reserva_deposito(
      v_row.inventario_id, v_org_id, NULL, v_row.cantidad);

    INSERT INTO movimientos_inventario (
      inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
      referencia_id, referencia_tipo, usuario_id, organization_id,
      observaciones, deposito_id
    ) VALUES (
      v_row.inventario_id, 'LIBERACION_RESERVA', v_row.cantidad,
      v_stock, v_stock,
      p_cotizacion_id, 'COTIZACION', NULL, v_org_id,
      p_motivo, v_deposito
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'itemsLiberados', v_count);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION liberar_reserva_catalogo(TEXT, TEXT) IS
  'Devuelve la reserva viva de una cotización del catálogo público. Idempotente (se apoya en reserva_cotizacion_pendiente). No-op sobre cotizaciones de otro origen. v314.';

REVOKE EXECUTE ON FUNCTION liberar_reserva_catalogo(TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION liberar_reserva_catalogo(TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION liberar_reserva_catalogo(TEXT, TEXT) TO service_role;

-- ============================================================
-- Parte 5: reservar_items_cotizacion idempotente por cotización
-- ============================================================
-- Cierra el doble-reserva del camino catálogo → venta:
--   catálogo reserva 1x  →  convertir-orden pone tipo='ORDEN' (deja ENVIADA)
--   →  aprobar reserva OTRA VEZ, porque aprobar_cotizacion_atomica reserva
--      siempre que tipo <> 'PRESUPUESTO'  →  2x reservado
--   →  la venta descuenta 1x y libera 1x  →  queda 1x reservado PARA SIEMPRE.
--
-- Se elige saltear la reserva de aprobación (en vez de liberar la del catálogo
-- en convertir-orden) para que la unidad quede retenida de punta a punta: la
-- otra opción abre una ventana entre convertir-orden y aprobar donde otro
-- comprador puede llevarse el stock y la aprobación falla.
--
-- El guard es por (cotización, item) contra el libro mayor y no por
-- `origen = 'CATALOGO_PUBLICO'`: así protege también al fallback JS de la ruta
-- de aprobar y a la aprobación desde el portal público, sin cambiar en nada el
-- comportamiento de una cotización que todavía no reservó (libro vacío).
--
-- Copia de la definición de la migración 206 + el guard.

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
    -- Guard de idempotencia: si esta cotización ya tiene reserva viva sobre
    -- este item, no se reserva de nuevo.
    SELECT cantidad INTO v_ya_reservado
      FROM reserva_cotizacion_pendiente(p_cotizacion_id)
      WHERE inventario_id = v_item.inventario_id;

    IF COALESCE(v_ya_reservado, 0) >= v_item.cantidad THEN
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

    IF v_disponible < v_item.cantidad THEN
      RAISE EXCEPTION 'Stock insuficiente para "%". Disponible: %, Solicitado: %',
        v_item.descripcion, v_disponible, v_item.cantidad;
    END IF;

    UPDATE inventario
    SET stock_reservado = stock_reservado + v_item.cantidad
    WHERE id = v_item.inventario_id;

    v_deposito_efectivo := reservar_stock_deposito(
      v_item.inventario_id, v_org_id, p_deposito_id, v_item.cantidad, false);

    INSERT INTO movimientos_inventario (
      inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
      referencia_id, referencia_tipo, usuario_id, organization_id,
      observaciones, deposito_id
    ) VALUES (
      v_item.inventario_id, 'RESERVA', v_item.cantidad,
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
  'Reserva stock de los items de una cotización. Idempotente por (cotización, item) contra movimientos_inventario: no re-reserva lo que esa cotización ya tiene tomado. v314.';

-- ============================================================
-- Parte 6: expirar_reservas_catalogo
-- ============================================================
-- El abandono es el caso más común: el visitante pide, nadie contesta, la
-- cotización se queda ENVIADA para siempre y la reserva con ella. Sin esto, un
-- anónimo puede dejar el catálogo entero en "Agotado" sin comprar nada.
--
-- Se resuelve con cron (el repo ya tiene infraestructura: vercel.json crons +
-- lib/cron-auth, e incluso un cron de catálogo, catalogo-pii-purge) en vez de
-- liberación perezosa al leer, porque la lectura del catálogo es SSR cacheada
-- con unstable_cache: colgar escrituras de ahí las haría correr de forma
-- impredecible, o no correr en absoluto mientras el cache esté caliente.
--
-- p_dias: ventana de retención cuando la cotización no tiene fecha_vencimiento
-- (las del catálogo no la traen). Default 7 días.
-- DECISIÓN DE PRODUCTO PENDIENTE: 7 es un default razonable para e-commerce,
-- no un número validado con el negocio. Si tiene que ser configurable por org,
-- va como columna en catalogo_config.

CREATE OR REPLACE FUNCTION expirar_reservas_catalogo(p_dias INTEGER DEFAULT 7)
RETURNS JSONB AS $$
DECLARE
  v_cot          RECORD;
  v_cotizaciones INTEGER := 0;
  v_items        INTEGER := 0;
  v_res          JSONB;
BEGIN
  FOR v_cot IN
    SELECT c.id
    FROM cotizaciones c
    WHERE c.origen = 'CATALOGO_PUBLICO'
      AND c.estado = 'ENVIADA'
      AND c.deleted_at IS NULL
      AND COALESCE(c.fecha_vencimiento, c.created_at + (p_dias || ' days')::INTERVAL) < NOW()
      AND EXISTS (SELECT 1 FROM reserva_cotizacion_pendiente(c.id))
  LOOP
    v_res := liberar_reserva_catalogo(
      v_cot.id, 'Reserva vencida: solicitud del catálogo sin respuesta');

    v_cotizaciones := v_cotizaciones + 1;
    v_items        := v_items + COALESCE((v_res->>'itemsLiberados')::INTEGER, 0);
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'cotizaciones', v_cotizaciones,
    'items', v_items,
    'dias', p_dias,
    'ran_at', NOW()
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION expirar_reservas_catalogo(INTEGER) IS
  'Libera las reservas de solicitudes del catálogo que quedaron ENVIADA más allá de su vencimiento. Deja el estado intacto: la cotización se puede aprobar después y ahí vuelve a reservar. v314.';

REVOKE EXECUTE ON FUNCTION expirar_reservas_catalogo(INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION expirar_reservas_catalogo(INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION expirar_reservas_catalogo(INTEGER) TO service_role;
