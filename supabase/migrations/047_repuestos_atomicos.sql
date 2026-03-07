-- ========================================
-- Funciones atómicas para repuestos (evitar inconsistencia de stock)
-- ========================================

-- Agregar repuesto de inventario a una orden (atómico)
CREATE OR REPLACE FUNCTION add_repuesto_inventario(
  p_orden_id UUID,
  p_inventario_id UUID,
  p_cantidad INTEGER
)
RETURNS JSON AS $$
DECLARE
  v_stock INTEGER;
  v_precio NUMERIC;
  v_repuesto_id UUID;
BEGIN
  -- Obtener stock y precio con lock
  SELECT stock, precio_venta INTO v_stock, v_precio
  FROM inventario
  WHERE id = p_inventario_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Item no encontrado');
  END IF;

  IF v_stock < p_cantidad THEN
    RETURN json_build_object('error', 'Stock insuficiente');
  END IF;

  -- Insertar repuesto
  INSERT INTO repuestos_orden (orden_id, inventario_id, cantidad, precio_unitario)
  VALUES (p_orden_id, p_inventario_id, p_cantidad, v_precio)
  RETURNING id INTO v_repuesto_id;

  -- Decrementar stock
  UPDATE inventario
  SET stock = stock - p_cantidad
  WHERE id = p_inventario_id;

  RETURN json_build_object('success', true, 'id', v_repuesto_id);
END;
$$ LANGUAGE plpgsql;

-- Eliminar repuesto y restaurar stock (atómico)
CREATE OR REPLACE FUNCTION remove_repuesto_inventario(
  p_repuesto_id UUID
)
RETURNS JSON AS $$
DECLARE
  v_inventario_id UUID;
  v_cantidad INTEGER;
BEGIN
  -- Obtener datos del repuesto y eliminarlo
  DELETE FROM repuestos_orden
  WHERE id = p_repuesto_id
  RETURNING inventario_id, cantidad INTO v_inventario_id, v_cantidad;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Repuesto no encontrado');
  END IF;

  -- Restaurar stock si era de inventario
  IF v_inventario_id IS NOT NULL THEN
    UPDATE inventario
    SET stock = stock + v_cantidad
    WHERE id = v_inventario_id;
  END IF;

  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql;
