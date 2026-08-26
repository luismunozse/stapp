-- Rollback de la migracion 314.
--
-- Devuelve el catalogo publico al descuento directo de inventario.stock
-- (definiciones de las migraciones 239 y 240, tal cual estaban).
--
-- CUIDADO: no es un rollback limpio de DATOS. Las reservas que la 314 ya haya
-- creado quedan vivas en inventario.stock_reservado y en inventario_depositos,
-- con su asiento RESERVA en movimientos_inventario, y nadie las va a liberar:
-- el codigo viejo no sabe que existen. Antes de correr esto hay que decidir
-- que hacer con ellas, listandolas asi:
--
--   SELECT mi.id, mi.inventario_id, mi.cantidad, mi.referencia_id, mi.created_at
--   FROM movimientos_inventario mi
--   WHERE mi.tipo = 'RESERVA'
--     AND mi.referencia_tipo = 'COTIZACION'
--     AND mi.usuario_id IS NULL          -- marca del flujo publico anonimo
--   ORDER BY mi.created_at DESC;
--
-- Para cada cotizacion todavia abierta, liberar_items_cotizacion(id, <user>,
-- 'Rollback 314') devuelve la reserva. Recien despues correr lo de abajo.
--
-- Tambien hay que revertir el codigo de la app: el storefront calcula
-- disponibilidad como stock - stock_reservado (lib/catalogo/stock-disponible.ts).
-- Con el descuento directo de vuelta, esa resta descuenta dos veces lo que ya
-- salio del stock.

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
