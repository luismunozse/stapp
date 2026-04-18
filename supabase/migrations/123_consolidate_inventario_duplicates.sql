-- ========================================
-- Consolidación de items duplicados en inventario
-- ========================================
-- Mueve el stock del item origen al item destino, registra los movimientos
-- correspondientes (SALIDA en origen, ENTRADA en destino) y archiva (soft-delete)
-- el origen. Todo en una única transacción para garantizar consistencia.
--
-- Uso: cuando se detectan dos items con el mismo producto en el inventario
-- (típicamente por error de carga manual), el operador elige cuál es el item
-- canónico y consolida el resto.
-- ========================================

CREATE OR REPLACE FUNCTION consolidate_inventario_items(
  p_source_id TEXT,
  p_target_id TEXT,
  p_user_id TEXT
)
RETURNS JSONB AS $$
DECLARE
  v_source RECORD;
  v_target RECORD;
  v_org_id TEXT;
  v_stock_source INTEGER;
  v_stock_target_before INTEGER;
  v_stock_target_after INTEGER;
BEGIN
  IF p_source_id = p_target_id THEN
    RAISE EXCEPTION 'El item origen y destino no pueden ser el mismo';
  END IF;

  -- Lock both rows in a stable order to avoid deadlocks when two users
  -- consolidate symmetrically at the same time.
  IF p_source_id < p_target_id THEN
    SELECT * INTO v_source FROM inventario WHERE id = p_source_id FOR UPDATE;
    SELECT * INTO v_target FROM inventario WHERE id = p_target_id FOR UPDATE;
  ELSE
    SELECT * INTO v_target FROM inventario WHERE id = p_target_id FOR UPDATE;
    SELECT * INTO v_source FROM inventario WHERE id = p_source_id FOR UPDATE;
  END IF;

  IF v_source IS NULL THEN
    RAISE EXCEPTION 'Item origen no encontrado';
  END IF;
  IF v_target IS NULL THEN
    RAISE EXCEPTION 'Item destino no encontrado';
  END IF;

  IF v_source.organization_id <> v_target.organization_id THEN
    RAISE EXCEPTION 'Los items pertenecen a organizaciones distintas';
  END IF;

  IF v_source.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'El item origen ya está archivado';
  END IF;
  IF v_target.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'El item destino está archivado';
  END IF;

  -- Stock reservado queda en el origen hasta que las ventas/órdenes asociadas
  -- se liquiden. Bloqueamos la consolidación si hay reservas pendientes para
  -- evitar perder trazabilidad.
  IF COALESCE(v_source.stock_reservado, 0) > 0 THEN
    RAISE EXCEPTION 'El item origen tiene stock reservado (%), liberá las reservas antes de consolidar', v_source.stock_reservado;
  END IF;

  v_org_id := v_source.organization_id;
  v_stock_source := COALESCE(v_source.stock, 0);
  v_stock_target_before := COALESCE(v_target.stock, 0);
  v_stock_target_after := v_stock_target_before + v_stock_source;

  IF v_stock_source > 0 THEN
    -- SALIDA en origen: deja el stock en 0
    UPDATE inventario
       SET stock = 0,
           updated_at = NOW()
     WHERE id = p_source_id;

    INSERT INTO movimientos_inventario (
      inventario_id, tipo, cantidad,
      stock_anterior, stock_posterior,
      referencia_id, referencia_tipo,
      usuario_id, organization_id, observaciones
    ) VALUES (
      p_source_id, 'SALIDA', v_stock_source,
      v_stock_source, 0,
      p_target_id, 'CONSOLIDACION',
      p_user_id, v_org_id,
      'Consolidación: stock movido a ' || v_target.codigo
    );

    -- ENTRADA en destino
    UPDATE inventario
       SET stock = v_stock_target_after,
           updated_at = NOW()
     WHERE id = p_target_id;

    INSERT INTO movimientos_inventario (
      inventario_id, tipo, cantidad,
      stock_anterior, stock_posterior,
      referencia_id, referencia_tipo,
      usuario_id, organization_id, observaciones
    ) VALUES (
      p_target_id, 'ENTRADA', v_stock_source,
      v_stock_target_before, v_stock_target_after,
      p_source_id, 'CONSOLIDACION',
      p_user_id, v_org_id,
      'Consolidación: stock recibido desde ' || v_source.codigo
    );
  END IF;

  -- Archivar origen (soft-delete)
  UPDATE inventario
     SET deleted_at = NOW(),
         deleted_by = p_user_id,
         updated_at = NOW()
   WHERE id = p_source_id;

  RETURN jsonb_build_object(
    'success', true,
    'sourceId', p_source_id,
    'targetId', p_target_id,
    'movedStock', v_stock_source,
    'targetStockAfter', v_stock_target_after
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION consolidate_inventario_items(TEXT, TEXT, TEXT) IS
  'Consolida un item duplicado de inventario: mueve stock al destino, registra movimientos SALIDA/ENTRADA con referencia_tipo=CONSOLIDACION y archiva el origen. Atómico.';
