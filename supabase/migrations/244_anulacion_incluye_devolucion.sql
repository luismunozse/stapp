-- Migration 244: la reversa por anulación de venta también revierte la DEVOLUCION
-- ============================================================
-- Bug C (auditoría cuenta corriente): restore_stock_on_cancel sumaba solo
-- ('CARGO','USO','PAGO') para el AJUSTE net-zero, EXCLUYENDO 'DEVOLUCION'. Si una
-- venta se devolvía a cuenta corriente (movimiento DEVOLUCION, crédito al cliente)
-- y luego se anulaba, ese crédito quedaba sin revertir → crédito fantasma.
--
-- Ejemplo: venta $100 fiado (CARGO -100, saldo -100) → devolución $60 a CC
-- (DEVOLUCION +60, saldo -40) → anulación. Antes: v_neto = -100 → AJUSTE +100 →
-- saldo +60 (fantasma). Ahora: v_neto = -100 + 60 = -40 → AJUSTE +40 → saldo 0.
--
-- Fix: incluir 'DEVOLUCION' en el IN para que el AJUSTE revierta TODOS los
-- movimientos de la venta y el neto quede en cero.
--
-- El resto del cuerpo es idéntico a la migración 235 (recreación verbatim).
-- NOTA: aplicar a mano en el SQL editor de Supabase (sin runner CLI).

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

    -- Reversa net-zero de TODO lo que la venta movio en cuenta corriente.
    -- Incluye DEVOLUCION para no dejar crédito fantasma cuando una venta
    -- devuelta a CC se anula después (bug C).
    IF NEW.cliente_id IS NOT NULL THEN
      SELECT COALESCE(SUM(monto), 0) INTO v_neto
      FROM cuenta_corriente
      WHERE referencia_id = NEW.id AND referencia_tipo = 'VENTA'
        AND tipo IN ('CARGO','USO','PAGO','DEVOLUCION');

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
