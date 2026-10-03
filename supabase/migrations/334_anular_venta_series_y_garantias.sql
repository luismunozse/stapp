-- Migration 334: anular una venta deja bien el stock, las series y las garantias.
--
-- restore_stock_on_cancel (270), al pasar una venta a ANULADA:
--   1. Devolvia al stock lo vendido menos lo devuelto CON reposicion. Lo
--      devuelto sin reponer (roto, descartado) volvia a sumarse: stock de
--      unidades que no existen.
--   2. Dejaba las series de la venta en VENDIDO / GARANTIA_ACTIVA: el producto
--      figuraba con stock pero sin series para venderlo.
--   3. Dejaba las garantias ACTIVA: el certificado seguia saliendo y los
--      reportes las contaban.
--
-- Ahora descuenta todo lo devuelto, libera las series y anula las garantias.
-- La reversa de cuenta corriente queda igual. Las ventas ya anuladas no se
-- tocan (el trigger solo actua en el paso COMPLETADA -> ANULADA); para las
-- garantias historicas hay un UPDATE al final.

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
      SELECT iv.inventario_id, iv.cantidad, iv.id AS item_id, iv.dias_garantia, i.stock
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

      -- 334: TODO lo devuelto, no solo lo que volvio al stock. Lo devuelto sin
      -- reponer (roto, descartado) ya no esta en ningun lado: sumarlo al
      -- anular inflaba el stock con unidades que no existen.
      SELECT COALESCE(SUM(id2.cantidad), 0) INTO v_ya_devuelto
      FROM items_devolucion id2
      JOIN devoluciones_venta dv ON dv.id = id2.devolucion_id
      WHERE dv.venta_id = NEW.id
        AND id2.item_venta_id = v_item.item_id;

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

      -- 334: las series que la venta entrego vuelven a estar disponibles (el
      -- stock ya volvio; sin esto el producto figuraba con stock y sin series
      -- para venderlo). Las ya devueltas no estan en VENDIDO/GARANTIA_ACTIVA.
      -- fecha_garantia_vence solo se limpia si la puso esta venta (mismo
      -- criterio que la devolucion, mig 317).
      UPDATE inventario_series
      SET estado = 'DISPONIBLE', venta_id = NULL, cliente_id = NULL, fecha_venta = NULL,
          fecha_garantia_vence = CASE
            WHEN COALESCE(v_item.dias_garantia, 0) > 0 THEN NULL
            ELSE fecha_garantia_vence END,
          updated_at = NOW()
      WHERE venta_id = NEW.id
        AND inventario_id = v_item.inventario_id
        AND estado::text IN ('VENDIDO', 'GARANTIA_ACTIVA');
    END LOOP;

    -- 334: la venta se deshizo entera: sus garantias no cubren nada. Solo las
    -- ACTIVA: una RECLAMADA o VENCIDA tiene historia propia.
    UPDATE garantias_venta
    SET estado = 'ANULADA'
    WHERE venta_id = NEW.id
      AND estado::text = 'ACTIVA';

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

-- Garantias de ventas que ya estaban anuladas
UPDATE garantias_venta g
SET estado = 'ANULADA'
FROM ventas v
WHERE v.id = g.venta_id
  AND v.estado::text = 'ANULADA'
  AND g.estado::text = 'ACTIVA';
