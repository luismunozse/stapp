-- ============================================
-- 149: RPC atómica para aplicar lote de precios desde importación
-- ============================================
-- Reemplaza al endpoint POST /api/inventario/precios/execute que ejecutaba
-- updates en paralelo con Promise.all y luego intentaba insertar historial
-- por separado (si fallaba el historial, los precios ya estaban escritos
-- y solo se logueaba el error).
--
-- Esta RPC procesa el batch completo en una sola transacción:
--   - SELECT ... FOR UPDATE por cada item (evita races con otros updates)
--   - UPDATE precios solo si cambian
--   - INSERT historial_precios en la misma transacción
--   - Filtra items que no pertenecen a la organización
--
-- Si cualquier paso falla, toda la transacción revierte: ni precios ni
-- historial quedan parcialmente aplicados.
--
-- Input p_updates: JSONB array de
--   { id, precio_compra_nuevo (number|null), precio_venta_nuevo (number|null) }
--
-- Output JSONB:
--   { updated: int, skipped: int, notFound: [ids] }
-- ============================================

CREATE OR REPLACE FUNCTION apply_precios_batch(
  p_organization_id  TEXT,
  p_user_id          TEXT,
  p_motivo           TEXT,
  p_updates          JSONB
) RETURNS JSONB AS $$
DECLARE
  v_update           JSONB;
  v_id               TEXT;
  v_compra_nuevo     NUMERIC;
  v_venta_nuevo      NUMERIC;
  v_compra_actual    NUMERIC;
  v_venta_actual     NUMERIC;
  v_patch_compra     NUMERIC;
  v_patch_venta      NUMERIC;
  v_cambia           BOOLEAN;
  v_motivo           TEXT;
  v_updated          INTEGER := 0;
  v_skipped          INTEGER := 0;
  v_not_found        TEXT[] := ARRAY[]::TEXT[];
BEGIN
  v_motivo := COALESCE(NULLIF(TRIM(p_motivo), ''), 'Importación de lista de precios');

  -- Procesar items en orden estable por id para evitar deadlocks cuando
  -- dos importaciones simultáneas tocan el mismo conjunto.
  FOR v_update IN
    SELECT value FROM jsonb_array_elements(p_updates) AS value
    ORDER BY value->>'id'
  LOOP
    v_id := v_update->>'id';
    v_compra_nuevo := NULLIF(v_update->>'precio_compra_nuevo', '')::NUMERIC;
    v_venta_nuevo  := NULLIF(v_update->>'precio_venta_nuevo', '')::NUMERIC;

    SELECT precio_compra, precio_venta
      INTO v_compra_actual, v_venta_actual
      FROM inventario
      WHERE id = v_id
        AND organization_id = p_organization_id
        AND deleted_at IS NULL
      FOR UPDATE;

    IF NOT FOUND THEN
      v_not_found := v_not_found || v_id;
      CONTINUE;
    END IF;

    v_patch_compra := NULL;
    v_patch_venta := NULL;
    v_cambia := FALSE;

    IF v_compra_nuevo IS NOT NULL AND v_compra_nuevo <> v_compra_actual THEN
      v_patch_compra := v_compra_nuevo;
      v_cambia := TRUE;
    END IF;

    IF v_venta_nuevo IS NOT NULL AND v_venta_nuevo <> v_venta_actual THEN
      v_patch_venta := v_venta_nuevo;
      v_cambia := TRUE;
    END IF;

    IF NOT v_cambia THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    UPDATE inventario
       SET precio_compra = COALESCE(v_patch_compra, precio_compra),
           precio_venta  = COALESCE(v_patch_venta, precio_venta),
           updated_at    = NOW()
     WHERE id = v_id;

    INSERT INTO historial_precios (
      inventario_id,
      precio_compra_anterior, precio_compra_nuevo,
      precio_venta_anterior,  precio_venta_nuevo,
      motivo, usuario_id, organization_id
    ) VALUES (
      v_id,
      CASE WHEN v_patch_compra IS NOT NULL THEN v_compra_actual ELSE NULL END,
      v_patch_compra,
      CASE WHEN v_patch_venta IS NOT NULL THEN v_venta_actual ELSE NULL END,
      v_patch_venta,
      v_motivo,
      p_user_id,
      p_organization_id
    );

    v_updated := v_updated + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'updated',  v_updated,
    'skipped',  v_skipped,
    'notFound', to_jsonb(v_not_found)
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION apply_precios_batch(TEXT, TEXT, TEXT, JSONB) IS
  'Aplica lote de cambios de precios atómicamente: update inventario + insert historial_precios en una transacción. Items ajenos a la org se reportan en notFound. FOR UPDATE por fila para serializar con otros writes.';
