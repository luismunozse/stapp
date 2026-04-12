-- =============================================
-- 110: OC Items Free-Form (sin dependencia de inventario)
-- Permite crear ítems de OC con descripción libre
-- y vincular a inventario al momento de recibir
-- =============================================

-- Agregar descripcion para items de texto libre
ALTER TABLE items_orden_compra ADD COLUMN IF NOT EXISTS descripcion TEXT;

-- Hacer inventario_id nullable (se vincula al recibir)
ALTER TABLE items_orden_compra ALTER COLUMN inventario_id DROP NOT NULL;

-- Backfill: copiar nombre del inventario a descripcion para items existentes
UPDATE items_orden_compra ioc
SET descripcion = i.nombre
FROM inventario i
WHERE ioc.inventario_id = i.id
  AND ioc.descripcion IS NULL;

-- ========================================
-- RPC actualizada: recibir con vinculación a inventario
-- ========================================

CREATE OR REPLACE FUNCTION recibir_orden_compra(
  p_oc_id TEXT,
  p_user_id TEXT,
  p_items JSONB  -- [{itemId, cantidadRecibida, inventarioId?}]
)
RETURNS JSONB AS $$
DECLARE
  v_item JSONB;
  v_ioc RECORD;
  v_inv_id TEXT;
  v_inv_stock INTEGER;
  v_org_id TEXT;
  v_total_pedida INTEGER := 0;
  v_total_recibida INTEGER := 0;
  v_nuevo_estado TEXT;
  v_count INTEGER := 0;
BEGIN
  SELECT organization_id INTO v_org_id
  FROM ordenes_compra WHERE id = p_oc_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden de compra no encontrada';
  END IF;

  -- Process each received item
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    -- Get the OC item
    SELECT ioc.*
    INTO v_ioc
    FROM items_orden_compra ioc
    WHERE ioc.id = (v_item->>'itemId')
      AND ioc.orden_compra_id = p_oc_id
    FOR UPDATE;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    -- Resolve inventario_id: use provided one, or fall back to existing
    v_inv_id := COALESCE(v_item->>'inventarioId', v_ioc.inventario_id);

    -- Link item to inventory if not yet linked
    IF v_inv_id IS NOT NULL AND v_ioc.inventario_id IS NULL THEN
      UPDATE items_orden_compra
      SET inventario_id = v_inv_id
      WHERE id = (v_item->>'itemId');
    END IF;

    -- Update received quantity
    UPDATE items_orden_compra
    SET cantidad_recibida = cantidad_recibida + (v_item->>'cantidadRecibida')::INTEGER
    WHERE id = (v_item->>'itemId');

    -- Increment inventory stock if linked
    IF v_inv_id IS NOT NULL THEN
      SELECT stock INTO v_inv_stock
      FROM inventario WHERE id = v_inv_id
      FOR UPDATE;

      UPDATE inventario
      SET stock = stock + (v_item->>'cantidadRecibida')::INTEGER
      WHERE id = v_inv_id;

      -- Record movement
      INSERT INTO movimientos_inventario (
        inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
        referencia_id, referencia_tipo, usuario_id, organization_id, observaciones
      ) VALUES (
        v_inv_id, 'COMPRA_RECIBIDA', (v_item->>'cantidadRecibida')::INTEGER,
        v_inv_stock, v_inv_stock + (v_item->>'cantidadRecibida')::INTEGER,
        p_oc_id, 'ORDEN_COMPRA', p_user_id, v_org_id,
        'Recepción de orden de compra'
      );
    END IF;

    v_count := v_count + 1;
  END LOOP;

  -- Calculate new state
  SELECT
    SUM(cantidad_pedida), SUM(cantidad_recibida)
  INTO v_total_pedida, v_total_recibida
  FROM items_orden_compra
  WHERE orden_compra_id = p_oc_id;

  IF v_total_recibida >= v_total_pedida THEN
    v_nuevo_estado := 'RECIBIDA';
  ELSIF v_total_recibida > 0 THEN
    v_nuevo_estado := 'RECIBIDA_PARCIAL';
  ELSE
    v_nuevo_estado := 'ENVIADA';
  END IF;

  UPDATE ordenes_compra
  SET estado = v_nuevo_estado,
      fecha_recepcion_real = CASE WHEN v_nuevo_estado = 'RECIBIDA' THEN NOW() ELSE fecha_recepcion_real END
  WHERE id = p_oc_id;

  RETURN jsonb_build_object(
    'success', true,
    'itemsRecibidos', v_count,
    'nuevoEstado', v_nuevo_estado
  );
END;
$$ LANGUAGE plpgsql;
