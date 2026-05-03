-- ============================================
-- 150: RPC atómica para ajuste masivo de precios por porcentaje
-- ============================================
-- Reemplaza el patrón fetch + map JS + Promise.all updates del endpoint
-- PATCH /api/inventario/bulk action=price_adjust.
--
-- Antes: leía precios, calculaba en JS, lanzaba updates en paralelo.
-- Si entre el fetch y el update otro proceso editaba el precio, el bulk
-- lo pisaba con un valor calculado sobre datos viejos.
--
-- Ahora: UPDATE con expresión SQL en una sola sentencia. Postgres aplica
-- el multiplicador sobre el valor commiteado al momento del lock, sin
-- ventana de race entre lectura y escritura.
--
-- Input:
--   p_organization_id TEXT
--   p_ids             TEXT[]   (ids del inventario)
--   p_column          TEXT     ('precio_compra' | 'precio_venta')
--   p_factor          NUMERIC  (1 + percent/100)
--
-- Output JSONB: { updated: int }
-- ============================================

CREATE OR REPLACE FUNCTION bulk_price_adjust(
  p_organization_id  TEXT,
  p_ids              TEXT[],
  p_column           TEXT,
  p_factor           NUMERIC
) RETURNS JSONB AS $$
DECLARE
  v_updated INTEGER := 0;
BEGIN
  IF p_column NOT IN ('precio_compra', 'precio_venta') THEN
    RAISE EXCEPTION 'Columna inválida: %', p_column
      USING ERRCODE = '22023';
  END IF;

  IF p_factor IS NULL OR p_factor < 0 THEN
    RAISE EXCEPTION 'Factor inválido: %', p_factor
      USING ERRCODE = '22023';
  END IF;

  -- UPDATE con expresión SQL: GREATEST(0, ...) clamp en cero,
  -- ROUND a 2 decimales para evitar float drift acumulado.
  IF p_column = 'precio_compra' THEN
    UPDATE inventario
       SET precio_compra = GREATEST(0, ROUND(precio_compra * p_factor, 2)),
           updated_at = NOW()
     WHERE id = ANY(p_ids)
       AND organization_id = p_organization_id
       AND deleted_at IS NULL;
  ELSE
    UPDATE inventario
       SET precio_venta = GREATEST(0, ROUND(precio_venta * p_factor, 2)),
           updated_at = NOW()
     WHERE id = ANY(p_ids)
       AND organization_id = p_organization_id
       AND deleted_at IS NULL;
  END IF;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object('updated', v_updated);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION bulk_price_adjust(TEXT, TEXT[], TEXT, NUMERIC) IS
  'Ajusta precios en lote por multiplicador en una sola sentencia UPDATE atómica. Sin ventana de race entre read y write. ERRCODE 22023: columna o factor inválido.';
