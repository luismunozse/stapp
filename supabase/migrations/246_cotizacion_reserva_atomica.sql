-- ========================================
-- Migration 246: Atomic cotizacion approval and venta conversion
-- Applied manually in Supabase SQL editor
-- ========================================
--
-- Fixes two phantom-reservation bugs:
--
-- C-1: aprobar_cotizacion_atomica
--   • Adds optimistic lock (FOR UPDATE + estado='ENVIADA' guard) to prevent
--     concurrent double-approve.
--   • Runs reservar_items_cotizacion INSIDE the same transaction so a stock
--     failure rolls back the estado update → cotizacion cannot be ACEPTADA
--     without stock reserved.
--
-- C-2: convertir_cotizacion_venta_atomica
--   • Wraps crear_venta_atomica + liberar_items_cotizacion in a single function
--     (= one transaction). A liberar failure rolls back the sale, preventing the
--     phantom-reservation where stock_reservado stays inflated forever.
-- ========================================

-- ============================================================
-- Part 1: aprobar_cotizacion_atomica
-- ============================================================

CREATE OR REPLACE FUNCTION aprobar_cotizacion_atomica(
  p_org_id       TEXT,
  p_cotizacion_id TEXT,
  p_user_id      TEXT,
  p_firma        TEXT    DEFAULT NULL,
  p_firma_mime   TEXT    DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_cot cotizaciones%ROWTYPE;
BEGIN
  -- Lock the row and verify it exists and belongs to the org
  SELECT * INTO v_cot
  FROM cotizaciones
  WHERE id = p_cotizacion_id
    AND organization_id = p_org_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cotizacion no encontrada';
  END IF;

  -- Optimistic state guard (prevents double-approve)
  IF v_cot.estado::TEXT <> 'ENVIADA' THEN
    RAISE EXCEPTION 'Solo se pueden aprobar cotizaciones enviadas';
  END IF;

  -- Atomically update estado + firma fields
  UPDATE cotizaciones
  SET estado           = 'ACEPTADA',
      firma_aprobacion = p_firma,
      firma_mime       = p_firma_mime,
      fecha_aprobacion = NOW()
  WHERE id = p_cotizacion_id;

  -- Reserve stock for non-PRESUPUESTO cotizaciones
  -- FATAL: if reservar_items_cotizacion raises (stock insuficiente) the whole
  -- approval transaction rolls back — cotizacion stays ENVIADA.
  IF v_cot.tipo::TEXT <> 'PRESUPUESTO' THEN
    PERFORM reservar_items_cotizacion(
      p_cotizacion_id,
      COALESCE(p_user_id, 'system')
    );
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION aprobar_cotizacion_atomica(TEXT, TEXT, TEXT, TEXT, TEXT) IS
  'Atomically approves a cotizacion (ENVIADA → ACEPTADA) and reserves inventory. '
  'Uses FOR UPDATE to prevent concurrent double-approve. '
  'Stock reservation failure rolls back the entire approval. Migration 246.';

-- ============================================================
-- Part 2: convertir_cotizacion_venta_atomica
-- ============================================================
-- Wraps crear_venta_atomica (migration 230) + liberar_items_cotizacion (migration 108)
-- in a single function so both run in one transaction.
-- Parameter list mirrors crear_venta_atomica exactly, plus a trailing p_cotizacion_id.
-- ============================================================

CREATE OR REPLACE FUNCTION convertir_cotizacion_venta_atomica(
  p_org_id                  TEXT,
  p_vendedor_id             TEXT,
  p_cliente_id              TEXT,
  p_cliente_nombre          TEXT,
  p_cliente_telefono        TEXT,
  p_subtotal                DECIMAL,
  p_descuento               DECIMAL,
  p_tipo_descuento          TEXT,
  p_porcentaje_descuento    DECIMAL,
  p_total                   DECIMAL,
  p_metodo_pago             TEXT,
  p_observaciones           TEXT,
  p_numero_referencia       TEXT,
  p_cuotas                  INTEGER,
  p_recargo_porcentaje      DECIMAL,
  p_monto_original          DECIMAL,
  p_items                   JSONB,
  p_pagos                   JSONB    DEFAULT NULL,
  p_idempotency_key         TEXT     DEFAULT NULL,
  p_deposito_id             TEXT     DEFAULT NULL,
  p_sucursal_id             TEXT     DEFAULT NULL,
  p_cotizacion_id           TEXT     DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
BEGIN
  -- Create the sale (stock deducted inside crear_venta_atomica)
  v_result := crear_venta_atomica(
    p_org_id,
    p_vendedor_id,
    p_cliente_id,
    p_cliente_nombre,
    p_cliente_telefono,
    p_subtotal,
    p_descuento,
    p_tipo_descuento,
    p_porcentaje_descuento,
    p_total,
    p_metodo_pago,
    p_observaciones,
    p_numero_referencia,
    p_cuotas,
    p_recargo_porcentaje,
    p_monto_original,
    p_items,
    p_pagos,
    p_idempotency_key,
    p_deposito_id,
    p_sucursal_id
  );

  -- Release the cotizacion reservations atomically.
  -- If liberar fails → entire transaction rolls back → sale is aborted.
  -- This is the correct behavior: no phantom reservation.
  IF p_cotizacion_id IS NOT NULL THEN
    PERFORM liberar_items_cotizacion(
      p_cotizacion_id,
      p_vendedor_id,
      'Reserva consumida por conversión a venta'
    );
  END IF;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION convertir_cotizacion_venta_atomica(TEXT,TEXT,TEXT,TEXT,TEXT,DECIMAL,DECIMAL,TEXT,DECIMAL,DECIMAL,TEXT,TEXT,TEXT,INTEGER,DECIMAL,DECIMAL,JSONB,JSONB,TEXT,TEXT,TEXT,TEXT) IS
  'Wraps crear_venta_atomica + liberar_items_cotizacion in a single transaction. '
  'A liberar failure rolls back the sale preventing phantom reservations. Migration 246.';
