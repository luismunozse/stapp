-- ============================================================
-- Migration 247: devolución atómica — elimina TOCTOU (H-1) y escrituras no-atómicas (H-2)
-- Applied manually in Supabase SQL editor
--
-- Crea registrar_devolucion_atomica que replica la lógica del route en UNA
-- transacción con FOR UPDATE en la venta. El lock serializa devoluciones
-- concurrentes (fix H-1). Los errores de CC ya no se tragan: si
-- devolver_cuenta_corriente falla, el todo hace rollback (fix H-2).
-- ============================================================

-- Extend the metodo_reembolso enum to include CUENTA_CORRIENTE.
-- The enum was created in migration 053 without this value; the JS route
-- already stores 'CUENTA_CORRIENTE' (as text coercion), so we add it here
-- to allow the RPC to cast the value without error.
DO $$ BEGIN
  ALTER TYPE metodo_reembolso ADD VALUE IF NOT EXISTS 'CUENTA_CORRIENTE';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.registrar_devolucion_atomica(
  p_org_id              TEXT,
  p_venta_id            TEXT,
  p_user_id             TEXT,
  p_numero_devolucion   TEXT,
  p_motivo              TEXT,
  p_observaciones       TEXT,
  p_metodo_reembolso    TEXT,
  p_reembolso_referencia TEXT,
  p_items               JSONB
) RETURNS JSONB
LANGUAGE plpgsql
AS $function$
DECLARE
  v_venta               ventas%ROWTYPE;
  v_dev_id              TEXT;
  v_tipo                TEXT;
  v_monto_devolucion    DECIMAL := 0;
  v_item_original       RECORD;
  v_already_returned    INTEGER;
  v_max_returnable      INTEGER;
  v_precio              DECIMAL;
  elem                  JSONB;
  -- For tipo computation
  v_iv                  RECORD;
  v_total_returned_after INTEGER;
  v_all_fully_returned  BOOLEAN;
  v_new_in_batch        INTEGER;
BEGIN
  -- ----------------------------------------------------------------
  -- Step 1: Lock the sale row to serialize concurrent returns (H-1)
  -- ----------------------------------------------------------------
  SELECT * INTO v_venta
  FROM ventas
  WHERE id = p_venta_id AND organization_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venta no encontrada';
  END IF;

  IF v_venta.estado::text <> 'COMPLETADA' THEN
    RAISE EXCEPTION 'Solo se pueden crear devoluciones para ventas completadas';
  END IF;

  -- ----------------------------------------------------------------
  -- Step 2: Validate each item UNDER the lock
  -- ----------------------------------------------------------------
  FOR elem IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT cantidad, precio_unitario, descripcion
    INTO v_item_original
    FROM items_venta
    WHERE id = elem->>'itemVentaId' AND venta_id = p_venta_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Item de venta no encontrado: %', elem->>'itemVentaId';
    END IF;

    SELECT COALESCE(SUM(id2.cantidad), 0)
    INTO v_already_returned
    FROM items_devolucion id2
    JOIN devoluciones_venta dv ON dv.id = id2.devolucion_id
    WHERE dv.venta_id = p_venta_id
      AND id2.item_venta_id = elem->>'itemVentaId';

    v_max_returnable := v_item_original.cantidad - v_already_returned;

    IF (elem->>'cantidad')::integer > v_max_returnable THEN
      RAISE EXCEPTION 'La cantidad a devolver excede lo permitido para "%". Maximo: %',
        v_item_original.descripcion, v_max_returnable;
    END IF;
  END LOOP;

  -- ----------------------------------------------------------------
  -- Step 3: Compute tipo (TOTAL/PARCIAL) and monto_devolucion
  -- ----------------------------------------------------------------
  -- Accumulate batch amounts and compute monto at same time
  FOR elem IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT precio_unitario INTO v_precio
    FROM items_venta
    WHERE id = elem->>'itemVentaId' AND venta_id = p_venta_id;

    v_monto_devolucion := v_monto_devolucion + (elem->>'cantidad')::integer * v_precio;
  END LOOP;

  -- Tipo: check if ALL items_venta will be fully returned after this batch
  v_all_fully_returned := TRUE;
  FOR v_iv IN SELECT id, cantidad FROM items_venta WHERE venta_id = p_venta_id
  LOOP
    -- already returned before this batch
    SELECT COALESCE(SUM(id3.cantidad), 0)
    INTO v_already_returned
    FROM items_devolucion id3
    JOIN devoluciones_venta dv3 ON dv3.id = id3.devolucion_id
    WHERE dv3.venta_id = p_venta_id
      AND id3.item_venta_id = v_iv.id;

    -- new cantidad in this batch for this item (0 if not in batch)
    SELECT COALESCE((elem2->>'cantidad')::integer, 0)
    INTO v_new_in_batch
    FROM (
      SELECT elem2 FROM jsonb_array_elements(p_items) AS elem2
      WHERE elem2->>'itemVentaId' = v_iv.id
      LIMIT 1
    ) sub;

    v_total_returned_after := v_already_returned + COALESCE(v_new_in_batch, 0);

    IF v_total_returned_after < v_iv.cantidad THEN
      v_all_fully_returned := FALSE;
      EXIT;
    END IF;
  END LOOP;

  v_tipo := CASE WHEN v_all_fully_returned THEN 'TOTAL' ELSE 'PARCIAL' END;

  -- ----------------------------------------------------------------
  -- Step 4: INSERT devoluciones_venta
  -- ----------------------------------------------------------------
  INSERT INTO devoluciones_venta (
    venta_id,
    numero_devolucion,
    motivo,
    tipo,
    monto_devolucion,
    estado,
    observaciones,
    procesado_por,
    organization_id,
    metodo_reembolso,
    reembolso_referencia,
    fecha_reembolso,
    reembolso_procesado_por
  ) VALUES (
    p_venta_id,
    p_numero_devolucion,
    p_motivo,
    v_tipo,
    v_monto_devolucion,
    'COMPLETADA',
    NULLIF(p_observaciones, ''),
    p_user_id,
    p_org_id,
    NULLIF(p_metodo_reembolso, '')::metodo_reembolso,
    NULLIF(p_reembolso_referencia, ''),
    CASE WHEN NULLIF(p_metodo_reembolso, '') IS NOT NULL THEN now() ELSE NULL END,
    CASE WHEN NULLIF(p_metodo_reembolso, '') IS NOT NULL THEN p_user_id ELSE NULL END
  ) RETURNING id INTO v_dev_id;

  -- ----------------------------------------------------------------
  -- Step 5: INSERT items_devolucion
  -- ----------------------------------------------------------------
  FOR elem IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT precio_unitario INTO v_precio
    FROM items_venta
    WHERE id = elem->>'itemVentaId' AND venta_id = p_venta_id;

    INSERT INTO items_devolucion (
      devolucion_id,
      item_venta_id,
      inventario_id,
      cantidad,
      precio_unitario,
      subtotal,
      restaurar_stock
    ) VALUES (
      v_dev_id,
      elem->>'itemVentaId',
      NULLIF(elem->>'inventarioId', ''),
      (elem->>'cantidad')::integer,
      v_precio,
      (elem->>'cantidad')::integer * v_precio,
      (elem->>'restaurarStock')::boolean
    );
  END LOOP;

  -- ----------------------------------------------------------------
  -- Step 6: Stock restoration (per item; P0002 = tolerated, others propagate)
  -- ----------------------------------------------------------------
  FOR elem IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    IF (elem->>'restaurarStock')::boolean AND NULLIF(elem->>'inventarioId', '') IS NOT NULL THEN
      BEGIN
        PERFORM registrar_devolucion_stock(
          elem->>'inventarioId',
          p_org_id,
          p_user_id,
          (elem->>'cantidad')::integer,
          v_dev_id,
          'Devolución ' || p_numero_devolucion || ' - ' || p_motivo,
          NULL,
          p_venta_id
        );

        -- Reset series: mark sold serials for this item+sale back to DISPONIBLE
        UPDATE inventario_series
        SET
          estado      = 'DISPONIBLE',
          fecha_venta = NULL,
          venta_id    = NULL,
          cliente_id  = NULL,
          updated_at  = now()
        WHERE id IN (
          SELECT id
          FROM inventario_series
          WHERE organization_id = p_org_id
            AND inventario_id   = elem->>'inventarioId'
            AND venta_id        = p_venta_id
            AND estado::text   IN ('VENDIDO', 'GARANTIA_ACTIVA')
          ORDER BY fecha_venta DESC
          LIMIT (elem->>'cantidad')::integer
        );

      EXCEPTION
        WHEN SQLSTATE 'P0002' THEN
          RAISE WARNING 'Devolución %: inventario % no encontrado, stock no restaurado',
            p_numero_devolucion, elem->>'inventarioId';
        -- All other exceptions propagate → full rollback
      END;
    END IF;
  END LOOP;

  -- ----------------------------------------------------------------
  -- Step 7: CC refund — FATAL (no handler → rolls back on failure; fixes H-2)
  -- ----------------------------------------------------------------
  IF NULLIF(p_metodo_reembolso, '') = 'CUENTA_CORRIENTE' AND v_venta.cliente_id IS NOT NULL THEN
    PERFORM devolver_cuenta_corriente(
      p_org_id,
      v_venta.cliente_id,
      v_monto_devolucion,
      'VENTA',
      p_venta_id,
      p_user_id,
      'Devolucion ' || p_numero_devolucion
    );
  END IF;

  -- ----------------------------------------------------------------
  -- Step 8: Return result
  -- ----------------------------------------------------------------
  RETURN jsonb_build_object(
    'id',              v_dev_id,
    'tipo',            v_tipo,
    'montoDevolucion', v_monto_devolucion
  );

END;
$function$;

COMMENT ON FUNCTION public.registrar_devolucion_atomica(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB) IS
  'Atomic return registration with FOR UPDATE lock on venta. '
  'Fixes H-1 (TOCTOU: concurrent returns both passing validation) and '
  'H-2 (non-atomic writes: CC refund swallowed, items_devolucion partial failure). '
  'Migration 247.';
