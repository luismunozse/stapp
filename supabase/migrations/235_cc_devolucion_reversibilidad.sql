-- ============================================================
-- Migration 235: CC reversibilidad fase 2
--   A. devolver_cuenta_corriente — nueva primitiva DEVOLUCION+
--   B. restore_stock_on_cancel   — reversa net-zero (reemplaza la reversa simple)
--   C. crear_nota_credito        — acredita si metodo_devolucion = CUENTA_CORRIENTE
-- ============================================================

-- ============================================================
-- A. devolver_cuenta_corriente
-- ============================================================
CREATE OR REPLACE FUNCTION devolver_cuenta_corriente(
  p_org_id TEXT,
  p_cliente_id TEXT,
  p_monto DECIMAL,
  p_referencia_tipo TEXT,
  p_referencia_id TEXT,
  p_usuario_id TEXT DEFAULT NULL,
  p_observaciones TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_saldo_actual DECIMAL;
  v_nuevo_saldo DECIMAL;
  v_mov_id TEXT;
BEGIN
  SELECT saldo_cuenta INTO v_saldo_actual
  FROM clientes WHERE id = p_cliente_id AND organization_id = p_org_id FOR UPDATE;

  IF v_saldo_actual IS NULL THEN
    RAISE EXCEPTION 'Cliente no encontrado';
  END IF;

  v_nuevo_saldo := COALESCE(v_saldo_actual, 0) + p_monto;

  INSERT INTO cuenta_corriente (
    organization_id, cliente_id, tipo, monto, saldo_posterior,
    referencia_tipo, referencia_id, usuario_id, observaciones
  ) VALUES (
    p_org_id, p_cliente_id, 'DEVOLUCION', p_monto, v_nuevo_saldo,
    p_referencia_tipo, p_referencia_id, p_usuario_id,
    COALESCE(p_observaciones, 'Devolucion a cuenta corriente')
  ) RETURNING id INTO v_mov_id;

  UPDATE clientes SET saldo_cuenta = v_nuevo_saldo WHERE id = p_cliente_id;

  RETURN jsonb_build_object('id', v_mov_id, 'saldoAnterior', v_saldo_actual, 'saldoNuevo', v_nuevo_saldo);
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- B. restore_stock_on_cancel — reversa net-zero
--    Verbatim de mig 225, salvo el bloque CC que se reemplaza por net-zero.
--    Se agrega v_neto DECIMAL al DECLARE.
-- ============================================================
CREATE OR REPLACE FUNCTION restore_stock_on_cancel()
RETURNS TRIGGER AS $$
DECLARE
  v_item RECORD;
  v_dep_origen TEXT;
  v_saldo DECIMAL;
  v_nuevo DECIMAL;
  v_neto DECIMAL;
BEGIN
  IF OLD.estado = 'COMPLETADA' AND NEW.estado = 'ANULADA' THEN
    FOR v_item IN
      SELECT iv.inventario_id, iv.cantidad, i.stock
      FROM items_venta iv
      JOIN inventario i ON i.id = iv.inventario_id
      WHERE iv.venta_id = NEW.id AND iv.inventario_id IS NOT NULL
    LOOP
      -- Look up which deposit the original VENTA movement used for this item.
      SELECT m.deposito_id INTO v_dep_origen
      FROM movimientos_inventario m
      WHERE m.referencia_id = NEW.id AND m.tipo = 'VENTA'
        AND m.inventario_id = v_item.inventario_id
      ORDER BY m.created_at DESC LIMIT 1;

      -- Record movement
      INSERT INTO movimientos_inventario (
        inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
        referencia_id, referencia_tipo, organization_id,
        deposito_id
      ) VALUES (
        v_item.inventario_id, 'ANULACION', v_item.cantidad,
        v_item.stock, v_item.stock + v_item.cantidad,
        NEW.id, 'ANULACION_VENTA', NEW.organization_id,
        v_dep_origen
      );

      -- Restore aggregate stock
      UPDATE inventario SET stock = stock + v_item.cantidad
      WHERE id = v_item.inventario_id;

      -- Dual-write: restore per-deposit stock to the same deposit it was taken from.
      PERFORM incrementar_stock_deposito(
        v_item.inventario_id, NEW.organization_id, v_dep_origen, v_item.cantidad);
    END LOOP;

    -- Reversa net-zero de TODO lo que la venta movio en cuenta corriente
    IF NEW.cliente_id IS NOT NULL THEN
      SELECT COALESCE(SUM(monto), 0) INTO v_neto
      FROM cuenta_corriente
      WHERE referencia_id = NEW.id AND referencia_tipo = 'VENTA'
        AND tipo IN ('CARGO','USO','PAGO');

      IF v_neto <> 0 THEN
        SELECT saldo_cuenta INTO v_saldo FROM clientes WHERE id = NEW.cliente_id FOR UPDATE;
        v_nuevo := COALESCE(v_saldo, 0) - v_neto;
        INSERT INTO cuenta_corriente (
          organization_id, cliente_id, tipo, monto, saldo_posterior,
          referencia_tipo, referencia_id, observaciones
        ) VALUES (
          NEW.organization_id, NEW.cliente_id, 'AJUSTE', -v_neto, v_nuevo,
          'VENTA', NEW.id, 'Reversa por anulacion de venta'
        );
        UPDATE clientes SET saldo_cuenta = v_nuevo WHERE id = NEW.cliente_id;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- C. crear_nota_credito — acredita CC si metodo_devolucion = CUENTA_CORRIENTE
--    Verbatim de mig 214, con v_cliente_id TEXT en DECLARE y el bloque CC
--    agregado tras el RETURNING id INTO v_nc_id.
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
  v_cliente_id TEXT;
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

  -- Acreditar a cuenta corriente si el reembolso es a CC
  IF p_metodo_devolucion = 'CUENTA_CORRIENTE' THEN
    IF p_venta_id IS NOT NULL THEN
      SELECT cliente_id INTO v_cliente_id FROM ventas WHERE id = p_venta_id;
    ELSIF p_orden_id IS NOT NULL THEN
      SELECT cliente_id INTO v_cliente_id FROM ordenes_servicio WHERE id = p_orden_id;
    END IF;
    IF v_cliente_id IS NOT NULL THEN
      PERFORM devolver_cuenta_corriente(p_org_id, v_cliente_id, p_monto,
        'NOTA_CREDITO', v_nc_id, p_user_id, 'Nota de credito');
    END IF;
  END IF;

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

      -- Restock atomico
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
  'Crea nota de crédito con items y restock atómico. sucursal_id derivado in-RPC del padre (venta o orden). Si metodo_devolucion = CUENTA_CORRIENTE, acredita via devolver_cuenta_corriente.';
