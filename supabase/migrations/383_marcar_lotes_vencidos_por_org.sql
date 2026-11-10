-- ============================================================================
-- 383: marcar_lotes_vencidos acotada a una organización
-- ============================================================================
-- La versión de 175 no recibía parámetros y recorría los lotes ACTIVO vencidos
-- de TODAS las organizaciones. La única llamada es el botón manual de
-- /inventario/lotes (POST /api/inventario/lotes/marcar-vencidos), que actúa en
-- nombre de una sola org.
--
-- Qué cambia:
--   * Firma nueva marcar_lotes_vencidos(p_organization_id TEXT). El FOR filtra
--     por organization_id y los UPDATE de inventario / inventario_depositos
--     también, como red.
--   * Se elimina la versión sin parámetros, para que no quede ningún camino
--     global.
--   * SET search_path y EXECUTE solo para service_role (la ruta usa supabaseAdmin).
--
-- El cuerpo es el de 175 sin otros cambios: mismo movimiento AJUSTE con
-- referencia_tipo LOTE_VENCIDO, mismo conteo de retorno.
--
-- Despliegue: aplicar esta migración y desplegar la ruta que pasa
-- p_organization_id. Entre una cosa y otra el botón devuelve error (la firma
-- vieja ya no existe); no afecta ningún otro flujo.

SET LOCAL lock_timeout = '3s';

DROP FUNCTION IF EXISTS marcar_lotes_vencidos();

CREATE OR REPLACE FUNCTION marcar_lotes_vencidos(p_organization_id TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lote            inventario_lotes%ROWTYPE;
  v_count           INTEGER := 0;
  v_stock_anterior  INTEGER;
  v_stock_posterior INTEGER;
BEGIN
  IF p_organization_id IS NULL OR p_organization_id = '' THEN
    RAISE EXCEPTION 'marcar_lotes_vencidos: p_organization_id es obligatorio';
  END IF;

  FOR v_lote IN
    SELECT * FROM inventario_lotes
    WHERE organization_id = p_organization_id
      AND estado = 'ACTIVO'
      AND fecha_vencimiento IS NOT NULL
      AND fecha_vencimiento <= CURRENT_DATE
    FOR UPDATE
  LOOP
    -- Solo descontar stock si todavía tenía cantidad
    IF v_lote.cantidad_actual > 0 THEN
      SELECT stock INTO v_stock_anterior FROM inventario
        WHERE id = v_lote.inventario_id
          AND organization_id = p_organization_id
        FOR UPDATE;
      v_stock_anterior := COALESCE(v_stock_anterior, 0);
      v_stock_posterior := GREATEST(v_stock_anterior - v_lote.cantidad_actual, 0);

      UPDATE inventario
        SET stock = v_stock_posterior, updated_at = NOW()
        WHERE id = v_lote.inventario_id
          AND organization_id = p_organization_id;

      IF v_lote.deposito_id IS NOT NULL THEN
        UPDATE inventario_depositos
          SET stock = GREATEST(stock - v_lote.cantidad_actual, 0), updated_at = NOW()
          WHERE inventario_id = v_lote.inventario_id
            AND deposito_id = v_lote.deposito_id
            AND organization_id = p_organization_id;
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
$$;

REVOKE EXECUTE ON FUNCTION marcar_lotes_vencidos(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION marcar_lotes_vencidos(TEXT) TO service_role;

COMMENT ON FUNCTION marcar_lotes_vencidos(TEXT) IS
  'Marca como VENCIDO los lotes ACTIVO de la org con fecha_vencimiento<=hoy y descuenta del stock. Idempotente. Retorna count.';
