-- ============================================================
-- 214: Stamp sucursal_id in crear_nota_credito (derive in-body)
-- ============================================================
-- Design decision: derive sucursal_id INSIDE the RPC from the parent
-- venta or orden, not as a new param. This is the single source of truth
-- pattern — the route cannot drift from the parent's actual sucursal.
-- No route changes needed for correctness.
--
-- Requires migration 211 to have run (notas_credito.sucursal_id column).
-- The original function had no defaults on any param → DROP is NOT required
-- (CREATE OR REPLACE with the same 9-param signature replaces in-place).
-- ============================================================

CREATE OR REPLACE FUNCTION crear_nota_credito(
  p_org_id           TEXT,
  p_venta_id         TEXT,
  p_orden_id         TEXT,
  p_motivo           TEXT,
  p_monto            NUMERIC,
  p_metodo_devolucion TEXT,
  p_notas            TEXT,
  p_user_id          TEXT,
  p_items            JSONB
)
RETURNS JSON AS $$
DECLARE
  v_nc_id     TEXT;
  v_numero    TEXT;
  v_item      JSONB;
  v_inv_id    TEXT;
  v_cant      INTEGER;
  v_restock   BOOLEAN;
  v_sucursal_id TEXT;
BEGIN
  -- Derive sucursal_id from parent (single source of truth)
  IF p_venta_id IS NOT NULL THEN
    SELECT sucursal_id INTO v_sucursal_id FROM ventas WHERE id = p_venta_id;
  ELSIF p_orden_id IS NOT NULL THEN
    SELECT sucursal_id INTO v_sucursal_id FROM ordenes_servicio WHERE id = p_orden_id;
  END IF;

  v_numero := get_next_nota_credito_number(p_org_id);

  INSERT INTO notas_credito (
    organization_id, numero, venta_id, orden_id, motivo, monto,
    metodo_devolucion, user_id, notas, sucursal_id
  ) VALUES (
    p_org_id, v_numero, p_venta_id, p_orden_id, p_motivo, p_monto,
    p_metodo_devolucion, p_user_id, p_notas, v_sucursal_id
  )
  RETURNING id INTO v_nc_id;

  IF p_items IS NOT NULL THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      v_inv_id  := v_item->>'inventario_id';
      v_cant    := (v_item->>'cantidad')::INTEGER;
      v_restock := COALESCE((v_item->>'restock')::BOOLEAN, TRUE);

      INSERT INTO items_nota_credito (
        nota_credito_id, item_venta_id, inventario_id,
        descripcion, cantidad, precio_unitario, restock
      ) VALUES (
        v_nc_id,
        v_item->>'item_venta_id',
        v_inv_id,
        v_item->>'descripcion',
        v_cant,
        (v_item->>'precio_unitario')::NUMERIC,
        v_restock
      );

      -- Restock atómico
      IF v_restock AND v_inv_id IS NOT NULL THEN
        UPDATE inventario SET stock = stock + v_cant WHERE id = v_inv_id;
        INSERT INTO movimientos_inventario (
          inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
          referencia_id, referencia_tipo, observaciones, organization_id, usuario_id
        )
        SELECT
          v_inv_id, 'DEVOLUCION', v_cant, stock - v_cant, stock,
          v_nc_id, 'nota_credito',
          'Restock por nota de crédito ' || v_numero, p_org_id, p_user_id
        FROM inventario WHERE id = v_inv_id;
      END IF;
    END LOOP;
  END IF;

  RETURN json_build_object('success', true, 'id', v_nc_id, 'numero', v_numero);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION crear_nota_credito(TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, JSONB) IS
  'Crea nota de crédito con items y restock atómico. sucursal_id derivado in-RPC del padre (venta o orden) — single source of truth, sin necesidad de param extra desde la ruta.';
