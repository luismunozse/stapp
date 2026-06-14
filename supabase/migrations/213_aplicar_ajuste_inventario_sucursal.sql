-- ============================================================
-- 213: Add p_sucursal_id to aplicar_ajuste_inventario RPC
-- ============================================================
-- Adding a new trailing param with DEFAULT NULL to the existing function.
-- The original had 8 fixed params (no defaults). PG will treat the 9-param
-- form as a new overload — DROP the old 8-arg signature first to avoid
-- PostgREST ambiguity.
-- Requires migration 211 to have run first (sucursal_id column must exist).
-- ============================================================

DROP FUNCTION IF EXISTS aplicar_ajuste_inventario(TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, BOOLEAN, TEXT);

CREATE OR REPLACE FUNCTION aplicar_ajuste_inventario(
  p_inventario_id       TEXT,
  p_tipo                TEXT,
  p_direccion           TEXT,
  p_cantidad            INTEGER,
  p_motivo              TEXT,
  p_comprobante_url     TEXT,
  p_afecta_rentabilidad BOOLEAN,
  p_user_id             TEXT,
  p_sucursal_id         TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  v_stock      INTEGER;
  v_org_id     TEXT;
  v_precio_compra NUMERIC;
  v_ajuste_id  TEXT;
  v_delta      INTEGER;
  v_nuevo_stock INTEGER;
BEGIN
  SELECT stock, organization_id, precio_compra
  INTO v_stock, v_org_id, v_precio_compra
  FROM inventario
  WHERE id = p_inventario_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Item no encontrado');
  END IF;

  v_delta       := CASE WHEN p_direccion = 'SALIDA' THEN -p_cantidad ELSE p_cantidad END;
  v_nuevo_stock := v_stock + v_delta;

  IF v_nuevo_stock < 0 THEN
    RETURN json_build_object('error', format('Stock insuficiente. Stock actual: %s', v_stock));
  END IF;

  INSERT INTO ajustes_inventario (
    organization_id, inventario_id, tipo, direccion, cantidad,
    costo_unitario_snapshot, motivo, comprobante_url, user_id,
    afecta_rentabilidad, sucursal_id
  ) VALUES (
    v_org_id, p_inventario_id, p_tipo, p_direccion, p_cantidad,
    COALESCE(v_precio_compra, 0), p_motivo, p_comprobante_url, p_user_id,
    p_afecta_rentabilidad, p_sucursal_id
  )
  RETURNING id INTO v_ajuste_id;

  UPDATE inventario SET stock = v_nuevo_stock WHERE id = p_inventario_id;

  INSERT INTO movimientos_inventario (
    inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
    referencia_id, referencia_tipo, observaciones, organization_id, usuario_id
  ) VALUES (
    p_inventario_id, 'AJUSTE', p_cantidad, v_stock, v_nuevo_stock,
    v_ajuste_id, 'ajuste_inventario',
    format('Ajuste %s %s: %s', p_tipo, p_direccion, COALESCE(p_motivo, 'sin motivo')),
    v_org_id, p_user_id
  );

  RETURN json_build_object('success', true, 'id', v_ajuste_id, 'nuevoStock', v_nuevo_stock);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION aplicar_ajuste_inventario(TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, BOOLEAN, TEXT, TEXT) IS
  'Aplica ajuste de inventario de forma atómica (INSERT ajuste + UPDATE stock + INSERT movimiento). p_sucursal_id nullable: NULL para ajustes históricos / sin sucursal específica.';
