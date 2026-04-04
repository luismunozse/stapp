-- ========================================
-- Fix: usar precio_compra en vez de precio_venta al agregar repuestos a ordenes
-- El sistema estaba tomando el precio de venta a tecnicos como costo,
-- en lugar del costo real de compra, lo que calculaba mal la ganancia.
-- ========================================

CREATE OR REPLACE FUNCTION add_repuesto_inventario(
  p_orden_id TEXT,
  p_inventario_id TEXT,
  p_cantidad INTEGER
)
RETURNS JSON AS $$
DECLARE
  v_stock INTEGER;
  v_precio NUMERIC;
  v_repuesto_id TEXT;
  v_org_id TEXT;
BEGIN
  -- Obtener stock, precio de COMPRA y org_id con lock
  SELECT stock, precio_compra, organization_id INTO v_stock, v_precio, v_org_id
  FROM inventario
  WHERE id = p_inventario_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Item no encontrado');
  END IF;

  IF v_stock < p_cantidad THEN
    RETURN json_build_object('error', 'Stock insuficiente');
  END IF;

  -- Insertar repuesto con precio de compra (costo real)
  INSERT INTO repuestos_orden (orden_id, inventario_id, cantidad, precio_unitario)
  VALUES (p_orden_id, p_inventario_id, p_cantidad, v_precio)
  RETURNING id INTO v_repuesto_id;

  -- Decrementar stock
  UPDATE inventario
  SET stock = stock - p_cantidad
  WHERE id = p_inventario_id;

  -- Registrar movimiento de inventario
  INSERT INTO movimientos_inventario (
    inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
    referencia_id, referencia_tipo, observaciones, organization_id
  ) VALUES (
    p_inventario_id, 'SALIDA', p_cantidad, v_stock, v_stock - p_cantidad,
    p_orden_id, 'orden_servicio',
    'Repuesto asignado a orden de servicio',
    v_org_id
  );

  RETURN json_build_object('success', true, 'id', v_repuesto_id);
END;
$$ LANGUAGE plpgsql;
