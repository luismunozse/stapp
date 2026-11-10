-- Rollback de 383 (marcar_lotes_vencidos por organización).
--
-- Vuelve a la versión sin parámetros de 175, que recorre TODAS las
-- organizaciones. Solo usar si hay que revertir el despliegue de la ruta: la
-- ruta nueva llama marcar_lotes_vencidos(p_organization_id) y deja de
-- funcionar tras este rollback.

SET LOCAL lock_timeout = '3s';

DROP FUNCTION IF EXISTS marcar_lotes_vencidos(TEXT);

CREATE OR REPLACE FUNCTION marcar_lotes_vencidos()
RETURNS INTEGER AS $$
DECLARE
  v_lote            inventario_lotes%ROWTYPE;
  v_count           INTEGER := 0;
  v_stock_anterior  INTEGER;
  v_stock_posterior INTEGER;
BEGIN
  FOR v_lote IN
    SELECT * FROM inventario_lotes
    WHERE estado = 'ACTIVO'
      AND fecha_vencimiento IS NOT NULL
      AND fecha_vencimiento <= CURRENT_DATE
    FOR UPDATE
  LOOP
    -- Solo descontar stock si todavía tenía cantidad
    IF v_lote.cantidad_actual > 0 THEN
      SELECT stock INTO v_stock_anterior FROM inventario
        WHERE id = v_lote.inventario_id FOR UPDATE;
      v_stock_anterior := COALESCE(v_stock_anterior, 0);
      v_stock_posterior := GREATEST(v_stock_anterior - v_lote.cantidad_actual, 0);

      UPDATE inventario
        SET stock = v_stock_posterior, updated_at = NOW()
        WHERE id = v_lote.inventario_id;

      IF v_lote.deposito_id IS NOT NULL THEN
        UPDATE inventario_depositos
          SET stock = GREATEST(stock - v_lote.cantidad_actual, 0), updated_at = NOW()
          WHERE inventario_id = v_lote.inventario_id
            AND deposito_id = v_lote.deposito_id;
      END IF;

      INSERT INTO movimientos_inventario (
        inventario_id, tipo, cantidad,
        stock_anterior, stock_posterior,
        deposito_id, referencia_id, referencia_tipo,
        lote_id, organization_id, observaciones
      ) VALUES (
        v_lote.inventario_id, 'AJUSTE', -v_lote.cantidad_actual,
        v_stock_anterior, v_stock_posterior,
        v_lote.deposito_id, v_lote.id, 'LOTE_VENCIDO',
        v_lote.id, v_lote.organization_id,
        format('Lote %s vencido (%s)', v_lote.numero_lote, v_lote.fecha_vencimiento)
      );
    END IF;

    UPDATE inventario_lotes
      SET estado = 'VENCIDO',
          cantidad_actual = 0,
          updated_at = NOW()
      WHERE id = v_lote.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION marcar_lotes_vencidos() IS
  'Marca como VENCIDO lotes ACTIVO con fecha_vencimiento<=hoy y descuenta del stock. Idempotente. Retorna count.';
