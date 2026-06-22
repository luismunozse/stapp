-- Migration 248: Atomic factura void and delete RPCs; harden registrar_pago_factura_atomica.
-- Applied manually in Supabase SQL editor.

-- ============================================================
-- (1) Recreate registrar_pago_factura_atomica with ANULADA guard
--     Body is verbatim from migration 243 with one added guard block.
-- ============================================================
CREATE OR REPLACE FUNCTION registrar_pago_factura_atomica(
  p_org_id          TEXT,
  p_factura_id      TEXT,
  p_usuario_id      TEXT,
  p_cliente_id      TEXT,
  p_observaciones   TEXT,
  p_pagos           JSONB,
  p_idempotency_key TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_factura        RECORD;
  v_cliente_id     TEXT;
  v_pendiente      DECIMAL;
  v_total_pagos    DECIMAL;
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
BEGIN
  -- 1. Lock factura and resolve org/cliente via its orden
  SELECT f.*,
         o.organization_id AS org_id,
         o.cliente_id      AS orden_cliente_id
    INTO v_factura
    FROM facturas f
    JOIN ordenes_servicio o ON o.id = f.orden_id
    WHERE f.id = p_factura_id
    FOR UPDATE OF f;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Factura no encontrada';
  END IF;

  IF v_factura.org_id <> p_org_id THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  -- ANULADA guard (added in migration 248)
  IF v_factura.estado_pago::text = 'ANULADA' THEN
    RAISE EXCEPTION 'No se pueden registrar pagos en una factura anulada';
  END IF;

  -- 2. Resolve cliente_id
  v_cliente_id := COALESCE(NULLIF(p_cliente_id, ''), v_factura.orden_cliente_id);

  -- 3. Validate amount
  v_pendiente   := v_factura.total - COALESCE(v_factura.monto_abonado, 0);
  v_total_pagos := COALESCE(
    (SELECT SUM((p->>'monto')::DECIMAL) FROM jsonb_array_elements(p_pagos) AS p),
    0
  );

  IF v_total_pagos > v_pendiente + 0.01 THEN
    RAISE EXCEPTION 'El monto total (%) excede el pendiente (%)',
      ROUND(v_total_pagos::NUMERIC, 2), ROUND(v_pendiente::NUMERIC, 2);
  END IF;

  -- 4. Idempotency claim INSIDE this transaction (claim+work+seal are atomic)
  IF p_idempotency_key IS NOT NULL THEN
    BEGIN
      INSERT INTO pago_idempotency (organization_id, idempotency_key, factura_id)
        VALUES (p_org_id, p_idempotency_key, p_factura_id);
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
    -- Note: factura route does NOT do fiado reconciliation.
    IF v_metodo = 'CUENTA_CORRIENTE' AND v_cliente_id IS NOT NULL THEN
      PERFORM usar_cuenta_corriente(
        p_org_id, v_cliente_id, v_monto,
        'FACTURA', p_factura_id, p_usuario_id
      );
    END IF;

    -- pagos_parciales.metodo_pago is type `metodo_pago` (not metodo_pago_venta)
    INSERT INTO pagos_parciales (
      factura_id, monto, metodo_pago, numero_referencia, observaciones,
      cuotas, recargo_porcentaje, monto_original,
      costo_financiero_porcentaje, costo_financiero_monto
    ) VALUES (
      p_factura_id, v_monto, v_metodo::metodo_pago, v_referencia, p_observaciones,
      v_cuotas, v_recargo, v_monto_original,
      v_cf_pct, v_cf_monto
    )
    RETURNING id, fecha INTO v_pago_id, v_pago_fecha;

    v_pagos_array := v_pagos_array || jsonb_build_object(
      'id',                        v_pago_id,
      'monto',                     v_monto,
      'metodoPago',                v_metodo,
      'referencia',                v_referencia,
      'fecha',                     v_pago_fecha,
      'cuotas',                    v_cuotas,
      'recargoPorcentaje',         v_recargo,
      'montoOriginal',             v_monto_original,
      'costoFinancieroPorcentaje', v_cf_pct,
      'costoFinancieroMonto',      v_cf_monto
    );
  END LOOP;

  -- 6. Update factura estado_pago
  v_nuevo_abonado := COALESCE(v_factura.monto_abonado, 0) + v_total_pagos;
  v_estado := CASE
    WHEN v_nuevo_abonado <= 0          THEN 'PENDIENTE'
    WHEN v_nuevo_abonado >= v_factura.total THEN 'PAGADO'
    ELSE                                    'PAGADO_PARCIAL'
  END;

  -- facturas.estado_pago is the enum `estado_pago` (unlike ventas which is TEXT),
  -- so cast explicitly to avoid any text→enum assignment ambiguity.
  UPDATE facturas
    SET monto_abonado = v_nuevo_abonado,
        estado_pago   = v_estado::estado_pago
    WHERE id = p_factura_id;

  -- 7. Build response (same shape as the JS route)
  v_response := jsonb_build_object(
    'pagos',    v_pagos_array,
    'factura',  jsonb_build_object(
      'montoAbonado', v_nuevo_abonado,
      'estadoPago',   v_estado,
      'pendiente',    v_factura.total - v_nuevo_abonado
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

COMMENT ON FUNCTION registrar_pago_factura_atomica(TEXT,TEXT,TEXT,TEXT,TEXT,JSONB,TEXT) IS
  'Atomic payment batch for /api/pagos (factura payments). '
  'Runs CC deductions (usar_cuenta_corriente), pagos_parciales inserts, '
  'and facturas update in ONE transaction. '
  'Idempotency claim is inside the same transaction so claim+seal are atomic — '
  'no partial-state window. No fiado reconciliation (factura route does not do it). '
  'Returns {replayed: bool, response: {pagos:[], factura:{}}}. '
  'Migration 248: added ANULADA guard — rejects payments on voided invoices.';

-- ============================================================
-- (2) anular_factura_atomica
-- ============================================================
CREATE OR REPLACE FUNCTION anular_factura_atomica(
  p_org_id     TEXT,
  p_factura_id TEXT,
  p_user_id    TEXT
) RETURNS JSONB AS $$
DECLARE
  v_factura RECORD;
  v_pago    RECORD;
BEGIN
  -- Lock factura row; join orden for org_id and cliente_id
  SELECT f.*, o.organization_id AS org_id, o.cliente_id AS cliente_id
    INTO v_factura
    FROM facturas f
    JOIN ordenes_servicio o ON o.id = f.orden_id
    WHERE f.id = p_factura_id
    FOR UPDATE OF f;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Factura no encontrada';
  END IF;

  IF v_factura.org_id <> p_org_id THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  IF v_factura.estado_pago::text = 'ANULADA' THEN
    RAISE EXCEPTION 'La factura ya esta anulada';
  END IF;

  -- Re-credit CC for each CUENTA_CORRIENTE partial payment
  FOR v_pago IN
    SELECT monto, metodo_pago
      FROM pagos_parciales
      WHERE factura_id = p_factura_id
  LOOP
    IF v_pago.metodo_pago::text = 'CUENTA_CORRIENTE' AND v_factura.cliente_id IS NOT NULL THEN
      PERFORM devolver_cuenta_corriente(
        p_org_id,
        v_factura.cliente_id,
        v_pago.monto,
        'FACTURA',
        p_factura_id,
        p_user_id,
        'Anulacion factura ' || v_factura.numero_factura
      );
    END IF;
  END LOOP;

  UPDATE facturas
    SET estado_pago = 'ANULADA'::estado_pago
    WHERE id = p_factura_id;

  RETURN jsonb_build_object('ok', true);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION anular_factura_atomica(TEXT,TEXT,TEXT) IS
  'Voids a factura atomically. Guards: not-found, org mismatch, already-ANULADA. '
  'Re-credits CUENTA_CORRIENTE partial payments via devolver_cuenta_corriente. '
  'Sets estado_pago=ANULADA. Any failure rolls back everything. Migration 248.';

-- ============================================================
-- (3) eliminar_factura_atomica
-- ============================================================
CREATE OR REPLACE FUNCTION eliminar_factura_atomica(
  p_org_id     TEXT,
  p_factura_id TEXT,
  p_user_id    TEXT
) RETURNS JSONB AS $$
DECLARE
  v_factura RECORD;
  v_pago    RECORD;
BEGIN
  -- Lock factura row; join orden for org_id, cliente_id, and numero_factura
  SELECT f.*, o.organization_id AS org_id, o.cliente_id AS cliente_id
    INTO v_factura
    FROM facturas f
    JOIN ordenes_servicio o ON o.id = f.orden_id
    WHERE f.id = p_factura_id
    FOR UPDATE OF f;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Factura no encontrada';
  END IF;

  IF v_factura.org_id <> p_org_id THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  -- Re-credit CC for each CUENTA_CORRIENTE partial payment
  FOR v_pago IN
    SELECT monto, metodo_pago
      FROM pagos_parciales
      WHERE factura_id = p_factura_id
  LOOP
    IF v_pago.metodo_pago::text = 'CUENTA_CORRIENTE' AND v_factura.cliente_id IS NOT NULL THEN
      PERFORM devolver_cuenta_corriente(
        p_org_id,
        v_factura.cliente_id,
        v_pago.monto,
        'FACTURA',
        p_factura_id,
        p_user_id,
        'Eliminacion factura ' || v_factura.numero_factura
      );
    END IF;
  END LOOP;

  DELETE FROM pagos_parciales WHERE factura_id = p_factura_id;
  DELETE FROM facturas WHERE id = p_factura_id;

  RETURN jsonb_build_object('ok', true);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION eliminar_factura_atomica(TEXT,TEXT,TEXT) IS
  'Deletes a factura atomically. Guards: not-found, org mismatch. '
  'Re-credits CUENTA_CORRIENTE partial payments via devolver_cuenta_corriente, '
  'then deletes pagos_parciales and the factura in the same transaction. '
  'Any failure (including CC credit failure) rolls back everything. Migration 248.';
