-- ============================================
-- 151: add_repuesto_inventario debe guardar precio_compra
-- ============================================
-- Bug: migration 108 reescribió add_repuesto_inventario y volvió a usar
-- precio_venta para repuestos_orden.precio_unitario, regresionando el fix
-- de 085 (que había cambiado a precio_compra).
--
-- Por qué importa: la card de comisión técnico calcula
--   ganancia = costo_final - sum(repuesto.precio_unitario * cantidad)
-- Si precio_unitario es precio_venta, la ganancia colapsa a sólo mano de
-- obra y la comisión queda subestimada (a veces cero).
--
-- Reaplica el guardado de precio_compra. Mantiene la lógica de
-- stock_reservado introducida en 108 (reserva en lugar de descontar).
-- ============================================

CREATE OR REPLACE FUNCTION add_repuesto_inventario(
  p_orden_id TEXT,
  p_inventario_id TEXT,
  p_cantidad INTEGER
)
RETURNS JSON AS $$
DECLARE
  v_stock INTEGER;
  v_stock_reservado INTEGER;
  v_costo NUMERIC;
  v_repuesto_id TEXT;
  v_org_id TEXT;
  v_disponible INTEGER;
BEGIN
  -- Lock row, leer COSTO (precio_compra), no precio de venta.
  SELECT stock, stock_reservado, precio_compra, organization_id
  INTO v_stock, v_stock_reservado, v_costo, v_org_id
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
  VALUES (p_orden_id, p_inventario_id, p_cantidad, COALESCE(v_costo, 0))
  RETURNING id INTO v_repuesto_id;

  -- Reserva, no descuento (consistente con migration 108).
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

COMMENT ON FUNCTION add_repuesto_inventario(TEXT, TEXT, INTEGER) IS
  'Inserta repuesto en orden y reserva stock. precio_unitario = precio_compra del inventario (costo, no venta) para que la card de comisión calcule ganancia correctamente.';

-- ============================================
-- Backfill: corregir filas existentes donde precio_unitario quedó con
-- precio_venta. Sólo toca repuestos linkeados a inventario; manuales
-- (inventario_id NULL) los deja como están porque ahí precio_unitario
-- es el valor que cargó el admin (no necesariamente costo).
-- ============================================
UPDATE repuestos_orden ro
SET precio_unitario = i.precio_compra
FROM inventario i
WHERE ro.inventario_id = i.id
  AND ro.precio_unitario = i.precio_venta
  AND i.precio_compra IS NOT NULL
  AND i.precio_compra <> i.precio_venta;
