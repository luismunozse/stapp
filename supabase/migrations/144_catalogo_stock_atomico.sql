-- ============================================
-- 144: RPC atómica para decrementar stock de catálogo
-- ============================================
-- Reserva stock de items del catálogo + inventario linkeado en una transacción.
-- Usa SELECT ... FOR UPDATE para evitar race conditions cuando dos clientes
-- compran el mismo item al mismo tiempo.
--
-- Input: array JSON de items: [{ "item_id": "...", "cantidad": 1 }, ...]
-- Output: TRUE si todo OK. RAISE EXCEPTION si stock insuficiente.
-- ============================================

CREATE OR REPLACE FUNCTION reservar_stock_catalogo(
  p_organization_id TEXT,
  p_items JSONB
) RETURNS BOOLEAN AS $$
DECLARE
  v_item        JSONB;
  v_item_id     TEXT;
  v_cantidad    INTEGER;
  v_stock       INTEGER;
  v_inv_id      TEXT;
  v_inv_stock   INTEGER;
  v_nombre      TEXT;
BEGIN
  -- Validar y bloquear cada item
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_item_id  := v_item->>'item_id';
    v_cantidad := (v_item->>'cantidad')::INTEGER;

    IF v_cantidad <= 0 THEN
      RAISE EXCEPTION 'Cantidad inválida: %', v_cantidad
        USING ERRCODE = '22023';
    END IF;

    -- Lock fila del catalogo_item
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

    -- Si linkeado a inventario, lock + check ese stock
    IF v_inv_id IS NOT NULL THEN
      SELECT stock INTO v_inv_stock
        FROM inventario
        WHERE id = v_inv_id
        FOR UPDATE;

      IF v_inv_stock IS NOT NULL AND v_inv_stock < v_cantidad THEN
        RAISE EXCEPTION 'Stock insuficiente para "%" (disponible: %)', v_nombre, v_inv_stock
          USING ERRCODE = 'P0003';
      END IF;

      -- Decrementar inventario
      UPDATE inventario
        SET stock = GREATEST(0, stock - v_cantidad)
        WHERE id = v_inv_id;
    END IF;

    -- Si catalogo_items.stock no es null, validar y decrementar
    IF v_stock IS NOT NULL THEN
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

COMMENT ON FUNCTION reservar_stock_catalogo IS
  'Reserva stock atómico para checkout de catálogo público. Lock por fila, RAISE si insuficiente. ERRCODE P0003 = stock insuficiente.';
