-- =============================================
-- 108: Stock Reservado + Analytics
-- 3.1 Columna stock_reservado en inventario
-- 3.2 Vincular items_cotizacion a inventario
-- 3.3 Nuevos tipos de movimiento
-- 3.4 RPCs de reserva/liberación
-- 3.5 Actualizar add/remove_repuesto_inventario
-- =============================================

-- ========================================
-- 3.1 STOCK RESERVADO
-- ========================================

ALTER TABLE inventario ADD COLUMN IF NOT EXISTS stock_reservado INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE inventario ADD CONSTRAINT chk_inventario_stock_reservado
  CHECK (stock_reservado >= 0);

-- ========================================
-- 3.2 VINCULAR ITEMS_COTIZACION A INVENTARIO
-- ========================================

ALTER TABLE items_cotizacion ADD COLUMN IF NOT EXISTS inventario_id TEXT DEFAULT NULL REFERENCES inventario(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS items_cotizacion_inventario_idx ON items_cotizacion(inventario_id);

-- ========================================
-- 3.3 NUEVOS TIPOS DE MOVIMIENTO
-- ========================================

ALTER TABLE movimientos_inventario DROP CONSTRAINT IF EXISTS movimientos_inventario_tipo_check;
ALTER TABLE movimientos_inventario ADD CONSTRAINT movimientos_inventario_tipo_check
  CHECK (tipo IN ('ENTRADA','SALIDA','AJUSTE','VENTA','DEVOLUCION','ANULACION','RESERVA','LIBERACION_RESERVA','COMPRA_RECIBIDA'));

-- ========================================
-- 3.4 RPCs DE RESERVA/LIBERACIÓN PARA COTIZACIONES
-- ========================================

-- Reservar stock cuando una cotización es ACEPTADA
CREATE OR REPLACE FUNCTION reservar_items_cotizacion(p_cotizacion_id TEXT, p_user_id TEXT)
RETURNS JSONB AS $$
DECLARE
  v_item RECORD;
  v_stock INTEGER;
  v_stock_reservado INTEGER;
  v_org_id TEXT;
  v_disponible INTEGER;
  v_count INTEGER := 0;
BEGIN
  -- Get org_id from cotizacion
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

    INSERT INTO movimientos_inventario (
      inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
      referencia_id, referencia_tipo, usuario_id, organization_id, observaciones
    ) VALUES (
      v_item.inventario_id, 'RESERVA', v_item.cantidad,
      v_stock, v_stock,
      p_cotizacion_id, 'COTIZACION', p_user_id, v_org_id,
      'Reserva por aprobación de cotización'
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'itemsReservados', v_count);
END;
$$ LANGUAGE plpgsql;

-- Liberar reservas cuando una cotización se rechaza, cancela o vence
CREATE OR REPLACE FUNCTION liberar_items_cotizacion(p_cotizacion_id TEXT, p_user_id TEXT, p_motivo TEXT DEFAULT 'Liberación de reserva')
RETURNS JSONB AS $$
DECLARE
  v_item RECORD;
  v_stock INTEGER;
  v_stock_reservado INTEGER;
  v_org_id TEXT;
  v_count INTEGER := 0;
  v_cantidad_liberar INTEGER;
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

    -- Don't release more than what's reserved
    v_cantidad_liberar := LEAST(v_item.cantidad, v_stock_reservado);

    IF v_cantidad_liberar > 0 THEN
      UPDATE inventario
      SET stock_reservado = stock_reservado - v_cantidad_liberar
      WHERE id = v_item.inventario_id;

      INSERT INTO movimientos_inventario (
        inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
        referencia_id, referencia_tipo, usuario_id, organization_id, observaciones
      ) VALUES (
        v_item.inventario_id, 'LIBERACION_RESERVA', v_cantidad_liberar,
        v_stock, v_stock,
        p_cotizacion_id, 'COTIZACION', p_user_id, v_org_id,
        p_motivo
      );

      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'itemsLiberados', v_count);
END;
$$ LANGUAGE plpgsql;

-- ========================================
-- 3.5 ACTUALIZAR add/remove_repuesto_inventario
-- Ahora RESERVAN en vez de descontar stock
-- ========================================

CREATE OR REPLACE FUNCTION add_repuesto_inventario(
  p_orden_id TEXT,
  p_inventario_id TEXT,
  p_cantidad INTEGER
)
RETURNS JSON AS $$
DECLARE
  v_stock INTEGER;
  v_stock_reservado INTEGER;
  v_precio NUMERIC;
  v_repuesto_id TEXT;
  v_org_id TEXT;
  v_disponible INTEGER;
BEGIN
  SELECT stock, stock_reservado, precio_venta, organization_id
  INTO v_stock, v_stock_reservado, v_precio, v_org_id
  FROM inventario
  WHERE id = p_inventario_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Item no encontrado');
  END IF;

  v_disponible := v_stock - v_stock_reservado;

  IF v_disponible < p_cantidad THEN
    RETURN json_build_object('error', format('Stock insuficiente. Disponible: %s', v_disponible));
  END IF;

  INSERT INTO repuestos_orden (orden_id, inventario_id, cantidad, precio_unitario)
  VALUES (p_orden_id, p_inventario_id, p_cantidad, v_precio)
  RETURNING id INTO v_repuesto_id;

  -- Reserve instead of deducting
  UPDATE inventario
  SET stock_reservado = stock_reservado + p_cantidad
  WHERE id = p_inventario_id;

  INSERT INTO movimientos_inventario (
    inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
    referencia_id, referencia_tipo, observaciones, organization_id
  ) VALUES (
    p_inventario_id, 'RESERVA', p_cantidad, v_stock, v_stock,
    p_orden_id, 'orden_servicio',
    'Repuesto reservado para orden de servicio',
    v_org_id
  );

  RETURN json_build_object('success', true, 'id', v_repuesto_id);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION remove_repuesto_inventario(
  p_repuesto_id TEXT
)
RETURNS JSON AS $$
DECLARE
  v_inventario_id TEXT;
  v_cantidad INTEGER;
  v_orden_id TEXT;
  v_stock INTEGER;
  v_stock_reservado INTEGER;
  v_org_id TEXT;
  v_cantidad_liberar INTEGER;
BEGIN
  DELETE FROM repuestos_orden
  WHERE id = p_repuesto_id
  RETURNING inventario_id, cantidad, orden_id INTO v_inventario_id, v_cantidad, v_orden_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Repuesto no encontrado');
  END IF;

  IF v_inventario_id IS NOT NULL THEN
    SELECT stock, stock_reservado, organization_id INTO v_stock, v_stock_reservado, v_org_id
    FROM inventario
    WHERE id = v_inventario_id
    FOR UPDATE;

    v_cantidad_liberar := LEAST(v_cantidad, v_stock_reservado);

    IF v_cantidad_liberar > 0 THEN
      UPDATE inventario
      SET stock_reservado = stock_reservado - v_cantidad_liberar
      WHERE id = v_inventario_id;

      INSERT INTO movimientos_inventario (
        inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
        referencia_id, referencia_tipo, observaciones, organization_id
      ) VALUES (
        v_inventario_id, 'LIBERACION_RESERVA', v_cantidad_liberar, v_stock, v_stock,
        v_orden_id, 'orden_servicio',
        'Reserva liberada - repuesto removido de orden de servicio',
        v_org_id
      );
    END IF;
  END IF;

  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql;

-- ========================================
-- 3.6 CONSUMIR RESERVA AL ENTREGAR ORDEN
-- Descuenta stock real + libera reserva
-- ========================================

CREATE OR REPLACE FUNCTION consumir_reservas_orden(p_orden_id TEXT, p_user_id TEXT)
RETURNS JSONB AS $$
DECLARE
  v_rep RECORD;
  v_stock INTEGER;
  v_stock_reservado INTEGER;
  v_org_id TEXT;
  v_count INTEGER := 0;
  v_cantidad_reservada INTEGER;
BEGIN
  SELECT organization_id INTO v_org_id
  FROM ordenes WHERE id = p_orden_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada';
  END IF;

  FOR v_rep IN
    SELECT ro.inventario_id, ro.cantidad
    FROM repuestos_orden ro
    WHERE ro.orden_id = p_orden_id
      AND ro.inventario_id IS NOT NULL
  LOOP
    SELECT stock, stock_reservado INTO v_stock, v_stock_reservado
    FROM inventario
    WHERE id = v_rep.inventario_id
    FOR UPDATE;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_cantidad_reservada := LEAST(v_rep.cantidad, v_stock_reservado);

    -- Deduct from physical stock
    UPDATE inventario
    SET stock = stock - v_rep.cantidad,
        stock_reservado = stock_reservado - v_cantidad_reservada
    WHERE id = v_rep.inventario_id;

    INSERT INTO movimientos_inventario (
      inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
      referencia_id, referencia_tipo, usuario_id, organization_id, observaciones
    ) VALUES (
      v_rep.inventario_id, 'SALIDA', v_rep.cantidad,
      v_stock, v_stock - v_rep.cantidad,
      p_orden_id, 'orden_servicio', p_user_id, v_org_id,
      'Consumo de repuesto al entregar orden'
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'itemsConsumidos', v_count);
END;
$$ LANGUAGE plpgsql;

-- ========================================
-- 3.7 LIBERAR RESERVAS AL CANCELAR ORDEN
-- ========================================

CREATE OR REPLACE FUNCTION liberar_reservas_orden(p_orden_id TEXT, p_user_id TEXT)
RETURNS JSONB AS $$
DECLARE
  v_rep RECORD;
  v_stock INTEGER;
  v_stock_reservado INTEGER;
  v_org_id TEXT;
  v_count INTEGER := 0;
  v_cantidad_liberar INTEGER;
BEGIN
  SELECT organization_id INTO v_org_id
  FROM ordenes WHERE id = p_orden_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada';
  END IF;

  FOR v_rep IN
    SELECT ro.inventario_id, ro.cantidad
    FROM repuestos_orden ro
    WHERE ro.orden_id = p_orden_id
      AND ro.inventario_id IS NOT NULL
  LOOP
    SELECT stock, stock_reservado INTO v_stock, v_stock_reservado
    FROM inventario
    WHERE id = v_rep.inventario_id
    FOR UPDATE;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_cantidad_liberar := LEAST(v_rep.cantidad, v_stock_reservado);

    IF v_cantidad_liberar > 0 THEN
      UPDATE inventario
      SET stock_reservado = stock_reservado - v_cantidad_liberar
      WHERE id = v_rep.inventario_id;

      INSERT INTO movimientos_inventario (
        inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
        referencia_id, referencia_tipo, usuario_id, organization_id, observaciones
      ) VALUES (
        v_rep.inventario_id, 'LIBERACION_RESERVA', v_cantidad_liberar,
        v_stock, v_stock,
        p_orden_id, 'orden_servicio', p_user_id, v_org_id,
        'Reserva liberada por cancelación de orden'
      );

      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'itemsLiberados', v_count);
END;
$$ LANGUAGE plpgsql;
