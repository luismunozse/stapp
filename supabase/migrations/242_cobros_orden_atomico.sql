-- Migration 242: Atomic cobros RPC for POST and DELETE /api/ordenes/[id]/cobros
-- Fixes bug A (non-atomic insert after usar_cuenta_corriente, no idempotency)
-- and bug B (devolver_cuenta_corriente error swallowed after anulado update).
-- Applied manually in Supabase SQL editor.

-- (1) Extend pago_idempotency for orders (idempotent DDL)
ALTER TABLE pago_idempotency ALTER COLUMN venta_id DROP NOT NULL;
ALTER TABLE pago_idempotency ADD COLUMN IF NOT EXISTS orden_id TEXT;

-- (2) Atomic cobros registration
CREATE OR REPLACE FUNCTION registrar_cobros_orden_atomica(
  p_org_id           TEXT,
  p_orden_id         TEXT,
  p_usuario_id       TEXT,
  p_pagos            JSONB,
  p_observaciones    TEXT,
  p_descuento        DECIMAL DEFAULT 0,
  p_idempotency_key  TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_orden            RECORD;
  v_descuento_total  DECIMAL;
  v_pendiente        DECIMAL;
  v_total_pagos      DECIMAL;
  v_total_externo    DECIMAL := 0;
  v_pago             JSONB;
  v_cobro_id         TEXT;
  v_monto            DECIMAL;
  v_metodo           TEXT;
  v_referencia       TEXT;
  v_cuotas           INTEGER;
  v_recargo          DECIMAL;
  v_monto_original   DECIMAL;
  v_cf_pct           DECIMAL;
  v_cf_monto         DECIMAL;
  v_cobros_array     JSONB := '[]'::JSONB;
  v_response         JSONB;
  v_existing         JSONB;
BEGIN
  -- 1. Lock and load orden
  SELECT id, costo_final, total_cobrado, descuento_cobro, cliente_id, estado
    INTO v_orden
    FROM ordenes_servicio
    WHERE id = p_orden_id AND organization_id = p_org_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada';
  END IF;

  -- 2. Amount validation
  v_descuento_total := COALESCE(v_orden.descuento_cobro, 0) + COALESCE(p_descuento, 0);
  v_pendiente       := COALESCE(v_orden.costo_final, 0) - v_descuento_total - COALESCE(v_orden.total_cobrado, 0);
  v_total_pagos     := COALESCE(
    (SELECT SUM((p->>'monto')::DECIMAL) FROM jsonb_array_elements(p_pagos) AS p),
    0
  );

  IF v_total_pagos > v_pendiente + 0.01 THEN
    RAISE EXCEPTION 'El monto total (%) excede el pendiente (%)',
      ROUND(v_total_pagos::NUMERIC, 2), ROUND(v_pendiente::NUMERIC, 2);
  END IF;

  -- 3. Idempotency claim INSIDE this transaction
  IF p_idempotency_key IS NOT NULL THEN
    BEGIN
      INSERT INTO pago_idempotency (organization_id, idempotency_key, orden_id)
        VALUES (p_org_id, p_idempotency_key, p_orden_id);
    EXCEPTION WHEN unique_violation THEN
      SELECT response INTO v_existing
        FROM pago_idempotency
        WHERE organization_id = p_org_id AND idempotency_key = p_idempotency_key;
      RETURN jsonb_build_object('replayed', true, 'response', v_existing);
    END;
  END IF;

  -- 4. Apply new discount if provided
  IF p_descuento > 0 THEN
    UPDATE ordenes_servicio
      SET descuento_cobro = v_descuento_total
      WHERE id = p_orden_id;
  END IF;

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
    IF v_metodo = 'CUENTA_CORRIENTE' AND v_orden.cliente_id IS NOT NULL THEN
      PERFORM usar_cuenta_corriente(
        p_org_id, v_orden.cliente_id, v_monto,
        'ORDEN', p_orden_id, p_usuario_id
      );
    ELSE
      v_total_externo := v_total_externo + v_monto;
    END IF;

    INSERT INTO cobros_orden (
      orden_id, organization_id, monto, metodo_pago, numero_referencia, observaciones,
      cuotas, recargo_porcentaje, monto_original,
      costo_financiero_monto, costo_financiero_porcentaje, usuario_id
    ) VALUES (
      p_orden_id, p_org_id, v_monto, v_metodo, v_referencia, p_observaciones,
      v_cuotas, v_recargo, v_monto_original,
      v_cf_monto, v_cf_pct, p_usuario_id
    )
    RETURNING id INTO v_cobro_id;

    v_cobros_array := v_cobros_array || jsonb_build_object(
      'id',     v_cobro_id,
      'monto',  v_monto,
      'metodo', v_metodo,
      'cuotas', v_cuotas
    );
  END LOOP;

  -- 6. Fiado reconciliation: non-CC payments credit the customer's CC balance.
  -- NON-FATAL: mirrors the JS route behavior (log, don't fail).
  IF v_orden.estado IN ('ENTREGADO', 'ENTREGADO_SIN_REPARACION')
     AND v_orden.cliente_id IS NOT NULL
     AND v_total_externo > 0
  THEN
    BEGIN
      PERFORM pagar_fiado_cuenta_corriente(
        p_org_id, v_orden.cliente_id, v_total_externo,
        'ORDEN', p_orden_id, p_usuario_id, NULL
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Error acreditando fiado (orden %): %', p_orden_id, SQLERRM;
    END;
  END IF;

  -- 7. Recalculate cobro state
  PERFORM recalcular_estado_cobro(p_orden_id);

  -- 8. Build response from updated orden
  SELECT
    jsonb_build_object(
      'cobros', v_cobros_array,
      'orden',  jsonb_build_object(
        'totalCobrado', COALESCE(total_cobrado, 0),
        'estadoCobro',  estado_cobro,
        'descuento',    COALESCE(descuento_cobro, 0)
      )
    )
  INTO v_response
  FROM ordenes_servicio
  WHERE id = p_orden_id;

  -- 9. Seal idempotency row
  IF p_idempotency_key IS NOT NULL THEN
    UPDATE pago_idempotency
      SET response = v_response
      WHERE organization_id = p_org_id AND idempotency_key = p_idempotency_key;
  END IF;

  RETURN jsonb_build_object('replayed', false, 'response', v_response);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION registrar_cobros_orden_atomica(TEXT,TEXT,TEXT,JSONB,TEXT,DECIMAL,TEXT) IS
  'Atomic cobros batch for POST /api/ordenes/[id]/cobros. '
  'Runs CC deductions (usar_cuenta_corriente), cobros_orden inserts, fiado reconciliation '
  '(pagar_fiado_cuenta_corriente), and recalcular_estado_cobro in ONE transaction. '
  'Idempotency claim is inside the same transaction so claim+seal are atomic — '
  'no partial-state window. Fixes bug A (non-atomic insert + no idempotency). '
  'Returns {replayed: bool, response: {cobros:[], orden:{}}}. Migration 242.';

-- (3) Atomic cobro cancellation
CREATE OR REPLACE FUNCTION anular_cobro_orden_atomica(
  p_org_id     TEXT,
  p_orden_id   TEXT,
  p_cobro_id   TEXT,
  p_usuario_id TEXT,
  p_motivo     TEXT
) RETURNS JSONB AS $$
DECLARE
  v_cobro     RECORD;
  v_cliente_id TEXT;
BEGIN
  -- 1. Lock cobro
  SELECT id, monto, anulado, metodo_pago
    INTO v_cobro
    FROM cobros_orden
    WHERE id = p_cobro_id AND orden_id = p_orden_id AND organization_id = p_org_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cobro no encontrado';
  END IF;

  -- 2. Guard: already cancelled
  IF v_cobro.anulado THEN
    RAISE EXCEPTION 'El cobro ya fue anulado';
  END IF;

  -- 3. Get cliente_id from the orden
  SELECT cliente_id INTO v_cliente_id
    FROM ordenes_servicio
    WHERE id = p_orden_id AND organization_id = p_org_id;

  -- 4. FIRST reverse CC credit (FATAL — if this fails, the whole txn rolls back
  --    and anulado=true is never committed, which is exactly the fix for bug B)
  IF v_cobro.metodo_pago = 'CUENTA_CORRIENTE' AND v_cliente_id IS NOT NULL THEN
    PERFORM devolver_cuenta_corriente(
      p_org_id, v_cliente_id, v_cobro.monto,
      'ORDEN', p_orden_id, p_usuario_id,
      'Anulacion de cobro con cuenta corriente'
    );
  END IF;

  -- 5. Mark as cancelled (only runs if step 4 succeeded)
  UPDATE cobros_orden
    SET anulado       = true,
        anulado_at    = now(),
        anulado_por   = p_usuario_id,
        anulado_motivo = p_motivo
    WHERE id = p_cobro_id;

  -- 6. Recalculate cobro state
  PERFORM recalcular_estado_cobro(p_orden_id);

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION anular_cobro_orden_atomica(TEXT,TEXT,TEXT,TEXT,TEXT) IS
  'Atomic cobro cancellation for DELETE /api/ordenes/[id]/cobros. '
  'Calls devolver_cuenta_corriente BEFORE committing anulado=true so a '
  'failed devolución rolls back the entire cancellation (fixes bug B). '
  'Migration 242.';
