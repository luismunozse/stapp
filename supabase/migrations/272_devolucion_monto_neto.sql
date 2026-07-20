-- ============================================================================
-- 272: registrar_devolucion_atomica — reembolso NETO (no bruto)
-- ============================================================================
-- Bug (#2): el cálculo de monto_devolucion (migración 247, re-emitido en 269)
-- sumaba el precio BRUTO de las líneas devueltas:
--     v_monto_devolucion := SUM(cantidad * precio_unitario)
-- ignorando el descuento de línea (items_venta.descuento / porcentaje_descuento),
-- el descuento global de la venta (ventas.descuento) y el IVA. Resultado: se
-- reembolsaba de MÁS. Ej: venta de 10×$100 con 10% de descuento de línea (el
-- cliente pagó $900) → una devolución total acreditaba $1.000 a la cuenta
-- corriente. El cliente ganaba $100.
--
-- Fix: reembolsar exactamente lo pagado por las unidades devueltas = la porción
-- proporcional de venta.total. Al escalar sobre venta.total, el descuento global
-- y el IVA quedan plegados proporcionalmente:
--     neto_unidad(item) = (cantidad*precio - descuento_linea) / cantidad
--     neto_total        = Σ neto_unidad(item) * cantidad      (todas las líneas)
--     neto_devuelto     = Σ neto_unidad(item) * cantidad_devuelta
--     monto_devolucion  = ROUND(venta.total * neto_devuelto / neto_total, 2)
--
-- Espeja lib/devolucion-refund.ts (computeDevolucionMonto / effectiveUnitNet),
-- que está cubierto por tests unitarios. Los items_devolucion también pasan a
-- guardar el precio neto por unidad en vez del bruto.
--
-- Solo se reescribe esta función; el resto de la lógica (lock FOR UPDATE,
-- validación de cantidades, tipo TOTAL/PARCIAL, restauración de stock/series,
-- reembolso a CC) es idéntica a la de 269.
-- ============================================================================

-- Helper: precio neto por unidad de una línea de venta (descuento de línea
-- aplicado). Espeja effectiveUnitNet() de lib/devolucion-refund.ts.
CREATE OR REPLACE FUNCTION devolucion_unit_net(p_item_venta_id TEXT, p_venta_id TEXT)
RETURNS DECIMAL
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_cant       INTEGER;
  v_precio     DECIMAL;
  v_desc       DECIMAL;
  v_tipo       TEXT;
  v_pct        DECIMAL;
  v_bruto      DECIMAL;
  v_desc_linea DECIMAL;
BEGIN
  SELECT cantidad, precio_unitario, COALESCE(descuento, 0),
         COALESCE(tipo_descuento, 'MONTO'), COALESCE(porcentaje_descuento, 0)
  INTO v_cant, v_precio, v_desc, v_tipo, v_pct
  FROM items_venta
  WHERE id = p_item_venta_id AND venta_id = p_venta_id;

  IF NOT FOUND OR v_cant IS NULL OR v_cant <= 0 THEN
    RETURN 0;
  END IF;

  v_bruto := v_cant * v_precio;
  v_desc_linea := CASE
                    WHEN v_tipo = 'PORCENTAJE' THEN v_bruto * v_pct / 100.0
                    ELSE LEAST(v_desc, v_bruto)
                  END;
  RETURN (v_bruto - v_desc_linea) / v_cant;
END;
$$;

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
  v_unit_net            DECIMAL;
  elem                  JSONB;
  -- For tipo computation
  v_iv                  RECORD;
  v_total_returned_after INTEGER;
  v_all_fully_returned  BOOLEAN;
  v_new_in_batch        INTEGER;
  -- Refund math (net proportional to venta.total)
  v_neto_total          DECIMAL := 0;
  v_neto_devuelto       DECIMAL := 0;
  v_prior_refunded      DECIMAL := 0;
  v_remaining           DECIMAL := 0;
  v_paid_unit           DECIMAL;
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
  -- Step 3: Compute tipo (TOTAL/PARCIAL) and monto_devolucion (NETO)
  -- ----------------------------------------------------------------
  -- Neto total de la venta = Σ (bruto de línea − descuento de línea).
  SELECT COALESCE(SUM(
           (iv.cantidad * iv.precio_unitario)
           - CASE
               WHEN iv.tipo_descuento = 'PORCENTAJE'
                 THEN (iv.cantidad * iv.precio_unitario) * COALESCE(iv.porcentaje_descuento, 0) / 100.0
               ELSE LEAST(COALESCE(iv.descuento, 0), iv.cantidad * iv.precio_unitario)
             END
         ), 0)
  INTO v_neto_total
  FROM items_venta iv
  WHERE iv.venta_id = p_venta_id;

  -- Neto de las unidades devueltas en este batch.
  FOR elem IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_unit_net := devolucion_unit_net(elem->>'itemVentaId', p_venta_id);
    v_neto_devuelto := v_neto_devuelto + v_unit_net * (elem->>'cantidad')::integer;
  END LOOP;

  -- Tipo: check if ALL items_venta will be fully returned after this batch
  v_all_fully_returned := TRUE;
  FOR v_iv IN SELECT id, cantidad FROM items_venta WHERE venta_id = p_venta_id
  LOOP
    SELECT COALESCE(SUM(id3.cantidad), 0)
    INTO v_already_returned
    FROM items_devolucion id3
    JOIN devoluciones_venta dv3 ON dv3.id = id3.devolucion_id
    WHERE dv3.venta_id = p_venta_id
      AND id3.item_venta_id = v_iv.id;

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

  -- Reembolso = porción proporcional de venta.total (pliega global + IVA), con
  -- cap contra lo ya devuelto y true-up exacto en la devolución TOTAL, de modo
  -- que la suma de reembolsos de una venta nunca supere venta.total.
  SELECT COALESCE(SUM(monto_devolucion), 0) INTO v_prior_refunded
  FROM devoluciones_venta WHERE venta_id = p_venta_id;

  v_remaining := GREATEST(ROUND(COALESCE(v_venta.total, 0) - v_prior_refunded, 2), 0);

  IF v_tipo = 'TOTAL' THEN
    v_monto_devolucion := v_remaining;
  ELSIF v_neto_total > 0 THEN
    v_monto_devolucion := LEAST(
      ROUND(COALESCE(v_venta.total, 0) * v_neto_devuelto / v_neto_total, 2),
      v_remaining
    );
  ELSE
    v_monto_devolucion := 0;
  END IF;

  -- ----------------------------------------------------------------
  -- Step 4: INSERT devoluciones_venta
  -- ----------------------------------------------------------------
  INSERT INTO devoluciones_venta (
    venta_id, numero_devolucion, motivo, tipo, monto_devolucion, estado,
    observaciones, procesado_por, organization_id,
    metodo_reembolso, reembolso_referencia, fecha_reembolso, reembolso_procesado_por
  ) VALUES (
    p_venta_id, p_numero_devolucion, p_motivo, v_tipo, v_monto_devolucion, 'COMPLETADA',
    NULLIF(p_observaciones, ''), p_user_id, p_org_id,
    NULLIF(p_metodo_reembolso, '')::metodo_reembolso,
    NULLIF(p_reembolso_referencia, ''),
    CASE WHEN NULLIF(p_metodo_reembolso, '') IS NOT NULL THEN now() ELSE NULL END,
    CASE WHEN NULLIF(p_metodo_reembolso, '') IS NOT NULL THEN p_user_id ELSE NULL END
  ) RETURNING id INTO v_dev_id;

  -- ----------------------------------------------------------------
  -- Step 5: INSERT items_devolucion (precio PAGADO por unidad: neto de línea
  -- escalado por venta.total/neto_total, así los subtotales reconcilian con
  -- monto_devolucion).
  -- ----------------------------------------------------------------
  FOR elem IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_unit_net := devolucion_unit_net(elem->>'itemVentaId', p_venta_id);
    v_paid_unit := CASE
                     WHEN v_neto_total > 0
                       THEN v_unit_net * COALESCE(v_venta.total, 0) / v_neto_total
                     ELSE 0
                   END;

    INSERT INTO items_devolucion (
      devolucion_id, item_venta_id, inventario_id, cantidad, precio_unitario, subtotal, restaurar_stock
    ) VALUES (
      v_dev_id,
      elem->>'itemVentaId',
      NULLIF(elem->>'inventarioId', ''),
      (elem->>'cantidad')::integer,
      ROUND(v_paid_unit, 2),
      ROUND(v_paid_unit * (elem->>'cantidad')::integer, 2),
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
          elem->>'inventarioId', p_org_id, p_user_id,
          (elem->>'cantidad')::integer, v_dev_id,
          'Devolución ' || p_numero_devolucion || ' - ' || p_motivo,
          NULL, p_venta_id
        );

        UPDATE inventario_series
        SET estado = 'DISPONIBLE', fecha_venta = NULL, venta_id = NULL,
            cliente_id = NULL, updated_at = now()
        WHERE id IN (
          SELECT id FROM inventario_series
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
      END;
    END IF;
  END LOOP;

  -- ----------------------------------------------------------------
  -- Step 7: CC refund — FATAL (no handler → rolls back on failure; fixes H-2)
  -- ----------------------------------------------------------------
  IF NULLIF(p_metodo_reembolso, '') = 'CUENTA_CORRIENTE' AND v_venta.cliente_id IS NOT NULL THEN
    PERFORM devolver_cuenta_corriente(
      p_org_id, v_venta.cliente_id, v_monto_devolucion,
      'VENTA', p_venta_id, p_user_id,
      'Devolucion ' || p_numero_devolucion, v_venta.sucursal_id
    );
  END IF;

  -- ----------------------------------------------------------------
  -- Step 8: Return result
  -- ----------------------------------------------------------------
  RETURN jsonb_build_object(
    'id', v_dev_id, 'tipo', v_tipo, 'montoDevolucion', v_monto_devolucion
  );

END;
$function$;

COMMENT ON FUNCTION public.registrar_devolucion_atomica(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB) IS
  'Atomic return registration with FOR UPDATE lock on venta. '
  'Fixes H-1 (TOCTOU) and H-2 (non-atomic writes). Migration 247. '
  'Migration 269: forwards v_venta.sucursal_id to devolver_cuenta_corriente. '
  'Migración 272: monto_devolucion = porción proporcional de venta.total (neto '
  'de descuentos de línea + global + IVA), no el precio bruto. Espeja '
  'lib/devolucion-refund.ts.';
