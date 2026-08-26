-- Rollback de la migracion 314.
--
-- Devuelve el catalogo publico al descuento directo de inventario.stock
-- (definiciones de las migraciones 239 y 240) y reservar_items_cotizacion a la
-- version de la 206, sin el guard de idempotencia.
--
-- CUIDADO: no es un rollback limpio de DATOS. Las reservas que la 314 ya haya
-- creado quedan vivas en inventario.stock_reservado y en inventario_depositos,
-- y despues de esto ningun camino las libera. HAY QUE LIBERARLAS ANTES.
--
-- 1. Listar las cotizaciones del catalogo con reserva viva:
--
--      SELECT c.id, c.numero_cotizacion, c.estado, c.created_at
--      FROM cotizaciones c
--      WHERE c.origen = 'CATALOGO_PUBLICO'
--        AND EXISTS (SELECT 1 FROM reserva_cotizacion_pendiente(c.id))
--      ORDER BY c.created_at;
--
-- 2. Liberarlas TODAS mientras las funciones de la 314 siguen vivas:
--
--      SELECT liberar_reserva_catalogo(c.id, 'Rollback 314')
--      FROM cotizaciones c
--      WHERE c.origen = 'CATALOGO_PUBLICO'
--        AND EXISTS (SELECT 1 FROM reserva_cotizacion_pendiente(c.id));
--
-- 3. Recien ahi correr el resto de este archivo.
--
-- Del lado de la app hay que revertir tambien:
--   * lib/catalogo/stock-disponible.ts y sus consumidores: el storefront
--     calcula stock - stock_reservado. Con el descuento directo de vuelta, esa
--     resta descuenta dos veces lo que ya salio del stock.
--   * El cron /api/cron/catalogo-reservas-vencidas y su entrada en vercel.json:
--     sin expirar_reservas_catalogo, cada corrida devuelve 500.
--   * Las llamadas a liberar_reserva_catalogo en app/api/cotizaciones/[id]/route.ts
--     (PUT y DELETE) y en app/api/public/cotizaciones/[token]/rechazar/route.ts.

DROP FUNCTION IF EXISTS expirar_reservas_catalogo(INTEGER);
DROP FUNCTION IF EXISTS liberar_reserva_catalogo(TEXT, TEXT);
DROP FUNCTION IF EXISTS reserva_cotizacion_pendiente(TEXT);

-- reservar_items_cotizacion vuelve a la definicion de la 206 (sin el guard de
-- idempotencia). Ojo: con esto vuelve el doble-reserva del camino
-- catalogo -> convertir-orden -> aprobar.
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

DROP FUNCTION IF EXISTS reservar_stock_catalogo(TEXT, JSONB, TEXT);

CREATE OR REPLACE FUNCTION reservar_stock_catalogo(
  p_organization_id TEXT,
  p_items JSONB
) RETURNS BOOLEAN AS $$
DECLARE
  v_item        JSONB;
  v_item_id     TEXT;
  v_variante_id TEXT;
  v_cantidad    INTEGER;
  v_stock       INTEGER;
  v_inv_id      TEXT;
  v_inv_stock   INTEGER;
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

    IF v_inv_id IS NOT NULL THEN
      SELECT stock INTO v_inv_stock
        FROM inventario
        WHERE id = v_inv_id
        FOR UPDATE;

      IF v_inv_stock IS NOT NULL AND v_inv_stock < v_cantidad THEN
        RAISE EXCEPTION 'Stock insuficiente para "%" (disponible: %)', v_nombre, v_inv_stock
          USING ERRCODE = 'P0003';
      END IF;

      UPDATE inventario
        SET stock = GREATEST(0, stock - v_cantidad)
        WHERE id = v_inv_id;
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

REVOKE EXECUTE ON FUNCTION reservar_stock_catalogo(TEXT, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION reservar_stock_catalogo(TEXT, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION reservar_stock_catalogo(TEXT, JSONB) TO service_role;

-- crear_cotizacion_publica_atomica vuelve al orden de la 240:
-- stock -> cupon -> cotizacion -> items -> abandono.
CREATE OR REPLACE FUNCTION crear_cotizacion_publica_atomica(
  p_cotizacion  JSONB,
  p_items       JSONB,
  p_stock_items JSONB,
  p_telefono    TEXT
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

  v_stock_ok := reservar_stock_catalogo(v_org_id, p_stock_items);

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
