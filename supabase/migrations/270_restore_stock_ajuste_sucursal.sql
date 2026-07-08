-- Migration 270: persistir sucursal_id en el AJUSTE de restore_stock_on_cancel.
--
-- restore_stock_on_cancel (trigger AFTER UPDATE ON ventas, última definición en
-- mig 261) inserta un AJUSTE en cuenta_corriente al anular una venta con
-- cliente_id, pero nunca seteaba sucursal_id. Esa fila quedaba con
-- sucursal_id = NULL, sumándose al gap documentado en mig 267/269
-- (cuenta_corriente sin sucursal_id en los writers de fiado que no pasan por
-- depositar_cuenta_corriente).
--
-- Fix: el único delta respecto a la definición de mig 261 es agregar
-- sucursal_id al INSERT del AJUSTE, tomado de NEW.sucursal_id (columna de
-- ventas, NOT NULL desde mig 207 — el trigger corre sobre la fila de ventas,
-- así que siempre está disponible). Resto de la función idéntico a 261.

CREATE OR REPLACE FUNCTION restore_stock_on_cancel()
RETURNS TRIGGER AS $$
DECLARE
  v_item RECORD;
  v_dep_origen TEXT;
  v_saldo DECIMAL;
  v_nuevo DECIMAL;
  v_neto DECIMAL;
  v_ya_devuelto DECIMAL;
BEGIN
  IF OLD.estado = 'COMPLETADA' AND NEW.estado = 'ANULADA' THEN
    FOR v_item IN
      SELECT iv.inventario_id, iv.cantidad, iv.id AS item_id, i.stock
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

      SELECT COALESCE(SUM(id2.cantidad), 0) INTO v_ya_devuelto
      FROM items_devolucion id2
      JOIN devoluciones_venta dv ON dv.id = id2.devolucion_id
      WHERE dv.venta_id = NEW.id
        AND id2.item_venta_id = v_item.item_id
        AND id2.restaurar_stock = true;

      IF GREATEST(v_item.cantidad - v_ya_devuelto, 0) = 0 THEN CONTINUE; END IF;

      -- Record movement
      INSERT INTO movimientos_inventario (
        inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
        referencia_id, referencia_tipo, organization_id,
        deposito_id
      ) VALUES (
        v_item.inventario_id, 'ANULACION', GREATEST(v_item.cantidad - v_ya_devuelto, 0),
        v_item.stock, v_item.stock + GREATEST(v_item.cantidad - v_ya_devuelto, 0),
        NEW.id, 'ANULACION_VENTA', NEW.organization_id,
        v_dep_origen
      );

      -- Restore aggregate stock
      UPDATE inventario SET stock = stock + GREATEST(v_item.cantidad - v_ya_devuelto, 0)
      WHERE id = v_item.inventario_id;

      -- Dual-write: restore per-deposit stock to the same deposit it was taken from.
      -- Cast a INTEGER: incrementar_stock_deposito espera INTEGER y v_ya_devuelto es DECIMAL.
      PERFORM incrementar_stock_deposito(
        v_item.inventario_id, NEW.organization_id, v_dep_origen,
        GREATEST(v_item.cantidad - v_ya_devuelto, 0)::INTEGER);
    END LOOP;

    -- Reversa net-zero de TODO lo que la venta movio en cuenta corriente.
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
          referencia_tipo, referencia_id, observaciones,
          sucursal_id
        ) VALUES (
          NEW.organization_id, NEW.cliente_id, 'AJUSTE', -v_neto, v_nuevo,
          'VENTA', NEW.id, 'Reversa por anulacion de venta',
          NEW.sucursal_id
        );
        UPDATE clientes SET saldo_cuenta = v_nuevo WHERE id = NEW.cliente_id;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
