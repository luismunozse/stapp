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
-- Arreglo: el catálogo RESERVA en vez de descontar, igual que el flujo interno
-- (reservar_items_cotizacion, migración 206). La conversión a venta libera la
-- reserva (liberar_items_cotizacion) y descuenta UNA sola vez por el camino de
-- siempre, heredando el descuento por depósito y el asiento contable.
--
-- Qué cambia para el usuario:
--   * inventario.stock deja de bajar cuando entra una solicitud del catálogo.
--     Lo que sube ahora es stock_reservado, visible como reserva igual que las
--     internas y liberable a mano. El stock "disponible" que ve el comprador NO
--     cambia: el storefront ya pasó a calcular stock - stock_reservado.
--   * Las reservas del catálogo aparecen en el historial del producto como
--     movimiento RESERVA con referencia_tipo COTIZACION.
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
      SELECT stock, stock_reservado INTO v_inv_stock, v_inv_reserv
        FROM inventario
        WHERE id = v_inv_id
        FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Producto no encontrado para "%"', v_nombre
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
