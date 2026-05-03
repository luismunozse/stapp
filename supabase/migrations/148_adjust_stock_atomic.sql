-- ============================================
-- 148: RPC atómica para ajuste rápido de stock
-- ============================================
-- Reemplaza el patrón read-modify-write del endpoint
-- POST /api/inventario/[id]/stock por una operación atómica.
-- Bloquea la fila con SELECT ... FOR UPDATE y registra el movimiento
-- en la misma transacción, evitando que dos ajustes concurrentes
-- pierdan incrementos o queden con auditoría inconsistente.
--
-- Modos:
--   absolute -> stock = p_value
--   delta    -> stock = stock + p_value
--
-- Errores (ERRCODE):
--   P0002 -> item no encontrado / archivado / org distinta
--   P0003 -> stock resultante negativo
--   22023 -> mode inválido
--
-- Output JSONB:
--   { stock, changed, stockAnterior, stockPosterior, movimientoId }
-- ============================================

CREATE OR REPLACE FUNCTION adjust_stock_atomic(
  p_inventario_id    TEXT,
  p_organization_id  TEXT,
  p_user_id          TEXT,
  p_mode             TEXT,
  p_value            INTEGER,
  p_motivo           TEXT DEFAULT NULL,
  p_tipo             TEXT DEFAULT 'AJUSTE',
  p_referencia_tipo  TEXT DEFAULT 'AJUSTE_MANUAL'
) RETURNS JSONB AS $$
DECLARE
  v_stock_anterior   INTEGER;
  v_stock_posterior  INTEGER;
  v_cantidad         INTEGER;
  v_mov_id           TEXT;
BEGIN
  IF p_mode NOT IN ('absolute', 'delta') THEN
    RAISE EXCEPTION 'Modo inválido: %', p_mode
      USING ERRCODE = '22023';
  END IF;

  IF p_tipo NOT IN ('AJUSTE', 'ENTRADA') THEN
    RAISE EXCEPTION 'Tipo inválido: %', p_tipo
      USING ERRCODE = '22023';
  END IF;

  -- Lock the row to serialize concurrent adjustments.
  SELECT stock
    INTO v_stock_anterior
    FROM inventario
    WHERE id = p_inventario_id
      AND organization_id = p_organization_id
      AND deleted_at IS NULL
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF p_mode = 'absolute' THEN
    v_stock_posterior := p_value;
  ELSE
    v_stock_posterior := v_stock_anterior + p_value;
  END IF;

  IF v_stock_posterior < 0 THEN
    RAISE EXCEPTION 'El stock no puede quedar negativo'
      USING ERRCODE = 'P0003';
  END IF;

  IF v_stock_posterior = v_stock_anterior THEN
    RETURN jsonb_build_object(
      'stock', v_stock_anterior,
      'changed', false,
      'stockAnterior', v_stock_anterior,
      'stockPosterior', v_stock_anterior,
      'movimientoId', NULL
    );
  END IF;

  v_cantidad := v_stock_posterior - v_stock_anterior;

  UPDATE inventario
     SET stock = v_stock_posterior,
         updated_at = NOW()
   WHERE id = p_inventario_id;

  INSERT INTO movimientos_inventario (
    inventario_id, tipo, cantidad,
    stock_anterior, stock_posterior,
    referencia_tipo, observaciones,
    usuario_id, organization_id
  ) VALUES (
    p_inventario_id, p_tipo, v_cantidad,
    v_stock_anterior, v_stock_posterior,
    p_referencia_tipo,
    COALESCE(p_motivo, 'Ajuste rápido desde lista'),
    p_user_id, p_organization_id
  )
  RETURNING id INTO v_mov_id;

  RETURN jsonb_build_object(
    'stock', v_stock_posterior,
    'changed', true,
    'stockAnterior', v_stock_anterior,
    'stockPosterior', v_stock_posterior,
    'movimientoId', v_mov_id
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION adjust_stock_atomic(TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT) IS
  'Ajuste atómico de stock con lock por fila. Update + movimiento auditable en una transacción. ERRCODE: P0002 no encontrado, P0003 stock negativo, 22023 modo/tipo inválido.';
