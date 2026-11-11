-- Rollback de cobros_replay_antes_de_validar (394): vuelve a las definiciones previas.

SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.registrar_cobros_orden_atomica(p_org_id text, p_orden_id text, p_usuario_id text, p_pagos jsonb, p_observaciones text, p_descuento numeric DEFAULT 0, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
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
  SELECT id, costo_final, total_cobrado, descuento_cobro, cliente_id, estado, sucursal_id
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
        'ORDEN', p_orden_id, p_usuario_id, v_orden.sucursal_id
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
        'ORDEN', p_orden_id, p_usuario_id, NULL, v_orden.sucursal_id
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
$function$;

CREATE OR REPLACE FUNCTION public.registrar_pago_factura_atomica(p_org_id text, p_factura_id text, p_usuario_id text, p_cliente_id text, p_observaciones text, p_pagos jsonb, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
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
  -- 1. Lock factura and resolve org/cliente/sucursal via its orden
  SELECT f.*,
         o.organization_id AS org_id,
         o.cliente_id      AS orden_cliente_id,
         o.sucursal_id     AS orden_sucursal_id
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
        'FACTURA', p_factura_id, p_usuario_id, v_factura.orden_sucursal_id
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
$function$;

