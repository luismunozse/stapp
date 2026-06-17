-- Migration 237: Atomic payment batch RPC for POST /api/ventas/[id]/pagos
-- Replaces the non-atomic JS sequence (usar_cuenta_corriente + pagos_venta insert + ventas update)
-- with a single transaction. The idempotency claim happens INSIDE the same transaction so
-- claim+work+seal commit or roll back together — eliminating the partial-state window.

CREATE OR REPLACE FUNCTION registrar_pagos_venta_atomica(
  p_org_id       TEXT,
  p_venta_id     TEXT,
  p_usuario_id   TEXT,
  p_cliente_id   TEXT,
  p_observaciones TEXT,
  p_pagos        JSONB,
  p_idempotency_key TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_venta          RECORD;
  v_pendiente      DECIMAL;
  v_total_pagos    DECIMAL;
  v_cliente_id     TEXT;
  v_pago           JSONB;
  v_pago_id        TEXT;
  v_pago_fecha     TIMESTAMPTZ;
  v_monto          DECIMAL;
  v_metodo         TEXT;
  v_referencia     TEXT;
  v_cuotas         INTEGER;
  v_recargo        DECIMAL;
  v_monto_original DECIMAL;
  v_cf_pct         DECIMAL;
  v_cf_monto       DECIMAL;
  v_pagos_array    JSONB := '[]'::JSONB;
  v_nuevo_abonado  DECIMAL;
  v_estado         TEXT;
  v_response       JSONB;
  v_existing       JSONB;
  v_total_externo  DECIMAL := 0;
BEGIN
  -- 1. Lock and load venta
  SELECT * INTO v_venta
  FROM ventas
  WHERE id = p_venta_id AND organization_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venta no encontrada';
  END IF;

  IF v_venta.estado = 'ANULADA' THEN
    RAISE EXCEPTION 'No se pueden registrar pagos en una venta anulada';
  END IF;

  -- 2. Validate amount
  v_pendiente   := v_venta.total - COALESCE(v_venta.monto_abonado, 0);
  v_total_pagos := COALESCE((SELECT SUM((p->>'monto')::DECIMAL) FROM jsonb_array_elements(p_pagos) AS p), 0);

  IF v_total_pagos > v_pendiente + 0.01 THEN
    RAISE EXCEPTION 'El monto total (%) excede el pendiente (%)',
      ROUND(v_total_pagos::NUMERIC, 2), ROUND(v_pendiente::NUMERIC, 2);
  END IF;

  -- 3. Idempotency claim (INSIDE this transaction — claim+work+seal are atomic)
  IF p_idempotency_key IS NOT NULL THEN
    BEGIN
      INSERT INTO pago_idempotency (organization_id, idempotency_key, venta_id)
        VALUES (p_org_id, p_idempotency_key, p_venta_id);
    EXCEPTION WHEN unique_violation THEN
      -- A committed row always has a non-null response (claim+seal are atomic).
      -- A concurrent in-flight transaction will block here until it commits/rolls back,
      -- then this branch fires and reads the now-committed response.
      SELECT response INTO v_existing
        FROM pago_idempotency
        WHERE organization_id = p_org_id AND idempotency_key = p_idempotency_key;
      RETURN jsonb_build_object('replayed', true, 'response', v_existing);
    END;
  END IF;

  -- 4. Resolve cliente_id
  v_cliente_id := COALESCE(NULLIF(p_cliente_id, ''), v_venta.cliente_id);

  -- 5. Payment loop
  FOR v_pago IN SELECT * FROM jsonb_array_elements(p_pagos)
  LOOP
    v_monto          := (v_pago->>'monto')::DECIMAL;
    v_metodo         := v_pago->>'metodo';
    v_referencia     := NULLIF(v_pago->>'referencia', '');
    v_cuotas         := (v_pago->>'cuotas')::INTEGER;
    v_recargo        := (v_pago->>'recargo')::DECIMAL;
    v_monto_original := (v_pago->>'montoOriginal')::DECIMAL;
    v_cf_pct         := (v_pago->>'costoFinanciero')::DECIMAL;
    v_cf_monto       := CASE WHEN v_cf_pct IS NOT NULL AND v_cf_pct > 0
                              THEN ROUND(v_monto * v_cf_pct / 100.0, 2)
                              ELSE NULL END;

    -- CC: deduct from customer balance (raises on insufficient saldo → full rollback)
    IF v_metodo = 'CUENTA_CORRIENTE' AND v_cliente_id IS NOT NULL THEN
      PERFORM usar_cuenta_corriente(
        p_org_id, v_cliente_id, v_monto,
        'VENTA', p_venta_id, p_usuario_id
      );
    ELSE
      -- Accumulate non-CC for fiado reconciliation
      v_total_externo := v_total_externo + v_monto;
    END IF;

    INSERT INTO pagos_venta (
      venta_id, monto, metodo_pago, numero_referencia, observaciones,
      cuotas, recargo_porcentaje, monto_original,
      costo_financiero_porcentaje, costo_financiero_monto
    ) VALUES (
      p_venta_id, v_monto, v_metodo::metodo_pago_venta, v_referencia, p_observaciones,
      v_cuotas, v_recargo, v_monto_original,
      v_cf_pct, v_cf_monto
    )
    RETURNING id, fecha INTO v_pago_id, v_pago_fecha;

    v_pagos_array := v_pagos_array || jsonb_build_object(
      'id',                      v_pago_id,
      'monto',                   v_monto,
      'metodoPago',              v_metodo,
      'referencia',              v_referencia,
      'fecha',                   v_pago_fecha,
      'cuotas',                  v_cuotas,
      'recargoPorcentaje',       v_recargo,
      'montoOriginal',           v_monto_original,
      'costoFinancieroPorcentaje', v_cf_pct,
      'costoFinancieroMonto',    v_cf_monto
    );
  END LOOP;

  -- 5b. Reconcile fiado: non-CC payments credit the customer's CC balance.
  -- NON-FATAL on purpose: the JS route only logs a fiado error and still records
  -- the payment, so we mirror that exactly. Wrapping in a sub-block keeps a fiado
  -- failure from rolling back the whole (otherwise valid) payment. The pagos +
  -- venta update still commit; the fiado credit is skipped and surfaced as a WARNING.
  IF v_cliente_id IS NOT NULL AND v_total_externo > 0 THEN
    BEGIN
      PERFORM pagar_fiado_cuenta_corriente(
        p_org_id, v_cliente_id, v_total_externo,
        'VENTA', p_venta_id, p_usuario_id, NULL
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Error acreditando pago de fiado (venta %): %', p_venta_id, SQLERRM;
    END;
  END IF;

  -- 6. Update venta
  v_nuevo_abonado := COALESCE(v_venta.monto_abonado, 0) + v_total_pagos;
  v_estado := CASE
    WHEN v_nuevo_abonado >= v_venta.total THEN 'PAGADO'
    WHEN v_nuevo_abonado > 0             THEN 'PAGADO_PARCIAL'
    ELSE                                      'PENDIENTE'
  END;

  UPDATE ventas
    SET monto_abonado = v_nuevo_abonado,
        estado_pago   = v_estado
    WHERE id = p_venta_id;

  -- 7. Build response (same shape as the JS route)
  v_response := jsonb_build_object(
    'pagos', v_pagos_array,
    'venta', jsonb_build_object(
      'montoAbonado', v_nuevo_abonado,
      'estadoPago',   v_estado,
      'pendiente',    v_venta.total - v_nuevo_abonado
    )
  );

  -- 8. Seal idempotency row
  IF p_idempotency_key IS NOT NULL THEN
    UPDATE pago_idempotency
      SET response = v_response
      WHERE organization_id = p_org_id AND idempotency_key = p_idempotency_key;
  END IF;

  RETURN jsonb_build_object('replayed', false, 'response', v_response);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION registrar_pagos_venta_atomica(TEXT,TEXT,TEXT,TEXT,TEXT,JSONB,TEXT) IS
  'Atomic payment batch for /api/ventas/[id]/pagos. '
  'Runs CC deductions (usar_cuenta_corriente), pagos_venta inserts, fiado reconciliation '
  '(pagar_fiado_cuenta_corriente), and ventas update in ONE transaction. '
  'Idempotency claim is inside the same transaction so claim+seal are atomic — '
  'no partial-state window. Returns {replayed: bool, response: {pagos:[], venta:{}}}. '
  'Migration 237.';
