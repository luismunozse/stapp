-- ============================================================
-- Migration 253: editar_venta_atomica — hardening (Bug 4 + M1)
-- ============================================================
-- Applied manually in Supabase SQL editor.
--
-- Two surgical changes over the v206 definition (206_multi_deposito_fase2.sql):
--
--   (M1) ANULADA guard: after locking the venta row, raise if estado = 'ANULADA'.
--        The route already rejects ANULADA edits at the app layer (400), but the
--        RPC is the authoritative safeguard — protects against direct API calls.
--
--   (Bug 4) Cumulative stock validation per inventario_id: mirrors the GROUP BY
--        aggregation that crear_venta_atomica (mig 206/230) already uses. Without
--        this, two line items for the same product (each individually ≤ stock)
--        could both pass validation and oversell.
--
-- Everything else is VERBATIM from mig 206 (editar_venta_atomica v206):
-- signature, params, DECLARE block, step 1 restore-old, step 2 delete,
-- step 3 update header, step 5 insert new items + deposit logic + warranties.
-- ============================================================

-- Drop the current v206 signature (15 params) to avoid an overload.
DROP FUNCTION IF EXISTS editar_venta_atomica(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DECIMAL, DECIMAL, TEXT, DECIMAL, DECIMAL,
  TEXT, TEXT, JSONB, TEXT
);

CREATE OR REPLACE FUNCTION editar_venta_atomica(
  p_org_id TEXT,
  p_user_id TEXT,
  p_venta_id TEXT,
  p_cliente_id TEXT,
  p_cliente_nombre TEXT,
  p_cliente_telefono TEXT,
  p_subtotal DECIMAL,
  p_descuento DECIMAL,
  p_tipo_descuento TEXT,
  p_porcentaje_descuento DECIMAL,
  p_total DECIMAL,
  p_metodo_pago TEXT,
  p_observaciones TEXT,
  p_items JSONB,
  p_deposito_id TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_old_item RECORD;
  v_item JSONB;
  v_item_id TEXT;
  v_inv_stock INTEGER;
  v_inv_nombre TEXT;
  v_garantia_numero TEXT;
  v_metodo metodo_pago_venta;
  v_garantias JSONB := '[]'::JSONB;
  -- multi-deposito
  v_deposito_efectivo TEXT;
  v_dep_origen TEXT;
  -- (M1) estado guard
  v_estado TEXT;
  -- (Bug 4) cumulative stock validation
  v_inv_id TEXT;
  v_req_total INTEGER;
  v_rows INTEGER;
BEGIN
  v_metodo := p_metodo_pago::metodo_pago_venta;

  -- (M1) Lock the venta row and check it is not ANULADA.
  SELECT estado INTO v_estado
  FROM ventas
  WHERE id = p_venta_id AND organization_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venta no encontrada: %', p_venta_id;
  END IF;

  IF v_estado::text = 'ANULADA' THEN
    RAISE EXCEPTION 'No se puede editar una venta anulada';
  END IF;

  -- 1. Restore stock for old items + record ANULACION movements
  FOR v_old_item IN
    SELECT iv.inventario_id, iv.cantidad, i.stock, i.nombre
    FROM items_venta iv
    LEFT JOIN inventario i ON i.id = iv.inventario_id
    WHERE iv.venta_id = p_venta_id AND iv.inventario_id IS NOT NULL
  LOOP
    -- Look up which deposit the original VENTA movement used for this item.
    SELECT m.deposito_id INTO v_dep_origen
    FROM movimientos_inventario m
    WHERE m.referencia_id = p_venta_id AND m.tipo = 'VENTA'
      AND m.inventario_id = v_old_item.inventario_id
    ORDER BY m.created_at DESC LIMIT 1;

    INSERT INTO movimientos_inventario (
      inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
      referencia_id, referencia_tipo, usuario_id, organization_id, observaciones,
      deposito_id
    ) VALUES (
      v_old_item.inventario_id, 'ANULACION', v_old_item.cantidad,
      v_old_item.stock, v_old_item.stock + v_old_item.cantidad,
      p_venta_id, 'EDICION_VENTA', p_user_id, p_org_id,
      'Restauración por edición de venta',
      v_dep_origen
    );

    UPDATE inventario SET stock = stock + v_old_item.cantidad
    WHERE id = v_old_item.inventario_id;

    -- Dual-write: restore per-deposit stock to the same deposit it was taken from.
    PERFORM incrementar_stock_deposito(
      v_old_item.inventario_id, p_org_id, v_dep_origen, v_old_item.cantidad);
  END LOOP;

  -- 2. Delete old items and warranties
  DELETE FROM garantias_venta WHERE venta_id = p_venta_id;
  DELETE FROM items_venta WHERE venta_id = p_venta_id;

  -- 3. Update sale header
  UPDATE ventas SET
    cliente_id = NULLIF(p_cliente_id, ''),
    cliente_nombre = p_cliente_nombre,
    cliente_telefono = NULLIF(p_cliente_telefono, ''),
    subtotal = p_subtotal,
    descuento = p_descuento,
    tipo_descuento = COALESCE(p_tipo_descuento, 'MONTO'),
    porcentaje_descuento = COALESCE(p_porcentaje_descuento, 0),
    total = p_total,
    metodo_pago = v_metodo,
    observaciones = NULLIF(p_observaciones, ''),
    updated_at = NOW()
  WHERE id = p_venta_id AND organization_id = p_org_id;

  -- 4. Validate stock for new items — CUMULATIVE per inventario_id (Bug 4 fix).
  -- Mirrors the GROUP BY aggregation in crear_venta_atomica (mig 206/230).
  -- Step 1 (restore old stock) has already run, so the current stock reflects the
  -- restored state and can be compared against the new items' aggregate demand.
  FOR v_inv_id, v_req_total IN
    SELECT (it->>'inventarioId'),
           SUM((it->>'cantidad')::INTEGER)
    FROM jsonb_array_elements(p_items) AS it
    WHERE (it->>'inventarioId') IS NOT NULL AND (it->>'inventarioId') != ''
    GROUP BY (it->>'inventarioId')
  LOOP
    SELECT stock, nombre INTO v_inv_stock, v_inv_nombre
    FROM inventario
    WHERE id = v_inv_id
      AND organization_id = p_org_id
      AND deleted_at IS NULL
    FOR UPDATE;

    IF v_inv_stock IS NULL THEN
      RAISE EXCEPTION 'Producto no encontrado: %', v_inv_id;
    END IF;

    IF v_inv_stock < v_req_total THEN
      RAISE EXCEPTION 'Stock insuficiente para "%". Disponible: %, solicitado: %',
        v_inv_nombre, v_inv_stock, v_req_total;
    END IF;
  END LOOP;

  -- 5. Insert new items, deduct stock, record VENTA movements, create warranties
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO items_venta (
      venta_id, inventario_id, descripcion, cantidad, precio_unitario, subtotal,
      dias_garantia, descuento, tipo_descuento, porcentaje_descuento
    ) VALUES (
      p_venta_id,
      NULLIF(v_item->>'inventarioId', ''),
      v_item->>'descripcion',
      (v_item->>'cantidad')::INTEGER,
      (v_item->>'precioUnitario')::DECIMAL,
      (v_item->>'cantidad')::INTEGER * (v_item->>'precioUnitario')::DECIMAL,
      COALESCE((v_item->>'diasGarantia')::INTEGER, 0),
      COALESCE((v_item->>'descuento')::DECIMAL, 0),
      COALESCE(v_item->>'tipoDescuento', 'MONTO'),
      COALESCE((v_item->>'porcentajeDescuento')::DECIMAL, 0)
    ) RETURNING id INTO v_item_id;

    IF (v_item->>'inventarioId') IS NOT NULL AND (v_item->>'inventarioId') != '' THEN
      INSERT INTO movimientos_inventario (
        inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
        referencia_id, referencia_tipo, usuario_id, organization_id,
        deposito_id
      )
      SELECT
        (v_item->>'inventarioId'), 'VENTA', -(v_item->>'cantidad')::INTEGER,
        stock, stock - (v_item->>'cantidad')::INTEGER,
        p_venta_id, 'VENTA', p_user_id, p_org_id,
        NULL  -- populated below after descontar_stock_deposito resolves the effective deposit
      FROM inventario WHERE id = (v_item->>'inventarioId');

      UPDATE inventario SET stock = stock - (v_item->>'cantidad')::INTEGER
      WHERE id = (v_item->>'inventarioId');

      -- Dual-write: deduct per-deposit stock. strict=true when deposit is explicit.
      v_deposito_efectivo := descontar_stock_deposito(
        (v_item->>'inventarioId'), p_org_id, p_deposito_id,
        (v_item->>'cantidad')::INTEGER,
        p_deposito_id IS NOT NULL);

      -- Back-fill deposito_id on the movement we just inserted.
      UPDATE movimientos_inventario
      SET deposito_id = v_deposito_efectivo
      WHERE referencia_id = p_venta_id
        AND inventario_id = (v_item->>'inventarioId')
        AND tipo = 'VENTA'
        AND deposito_id IS NULL;
    END IF;

    IF COALESCE((v_item->>'diasGarantia')::INTEGER, 0) > 0 THEN
      SELECT get_next_warranty_sale_number(p_org_id) INTO v_garantia_numero;

      INSERT INTO garantias_venta (
        venta_id, item_venta_id, numero_garantia, dias_validez,
        fecha_inicio, fecha_vencimiento, organization_id
      ) VALUES (
        p_venta_id, v_item_id, v_garantia_numero,
        (v_item->>'diasGarantia')::INTEGER,
        NOW(), NOW() + ((v_item->>'diasGarantia')::INTEGER || ' days')::INTERVAL,
        p_org_id
      );

      v_garantias := v_garantias || jsonb_build_object(
        'numero', v_garantia_numero,
        'itemId', v_item_id,
        'diasValidez', (v_item->>'diasGarantia')::INTEGER
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'garantias', v_garantias);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION editar_venta_atomica(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DECIMAL, DECIMAL, TEXT, DECIMAL, DECIMAL,
  TEXT, TEXT, JSONB, TEXT
) IS
  'Edita venta atómica. v253: (M1) ANULADA guard con FOR UPDATE al inicio; '
  '(Bug 4) validación de stock cumulativa por inventario_id (GROUP BY) antes de insertar '
  'nuevos items — espeja crear_venta_atomica mig 206/230. '
  'Restaura stock al depósito de origen; descuenta nuevos items al depósito indicado.';
