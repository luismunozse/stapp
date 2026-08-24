-- ============================================================================
-- 312: express repairs charged straight to a client's cuenta corriente
-- ============================================================================
-- N repairs already done for one client, charged as debt in a single pass, with
-- no order lifecycle. Each repair is a real ordenes_servicio row that is BORN in
-- the terminal state ENTREGADO.
--
-- Born, not transitioned: lib/orden-state-machine.ts:12 does not allow
-- RECIBIDO -> ENTREGADO (the path runs through REPARADO). Creating the row
-- already terminal is a creation, so the state machine is neither touched nor
-- weakened — the same move crear_recepcion_multiple makes when it creates its
-- orders already in RECIBIDO.
--
-- Everything runs in ONE transaction, which buys two properties for free, both
-- inherited from mig 288:
--   1. the update_ordenes_count trigger (mig 167) rolls the whole batch back
--      when the organization is over its plan's order limit;
--   2. the sequential cargar_deuda_cuenta_corriente calls take FOR UPDATE on the
--      client row inside this same transaction, so the saldo_posterior chain
--      stays consistent with no race against another terminal.
--
-- get_next_order_number, never MAX+1: two counter terminals of the same
-- organization inserting at once would read the same max and collide against
-- UNIQUE(organization_id, numero_orden), showing a raw database error to
-- whoever is standing at the counter.
--
-- publicToken and the warranty expiry date are computed by the app and arrive in
-- p_reparaciones: tokens so the database does not depend on pgcrypto (mig 288),
-- the expiry because it is a CALENDAR day in the workshop timezone
-- (organizations.zona_horaria) and NOW() + interval would land on the wrong day
-- for any workshop outside UTC.
-- ============================================================================

-- pago_idempotency already carries venta_id / orden_id / factura_id, each added
-- by the flow that needed it (mig 233, 242, 243). A batch has none of those.
ALTER TABLE pago_idempotency ADD COLUMN IF NOT EXISTS cliente_id TEXT;

CREATE OR REPLACE FUNCTION crear_reparaciones_express(
  p_organization_id TEXT,
  p_sucursal_id     TEXT,
  p_cliente_id      TEXT,
  p_reparaciones    JSONB,
  p_operador_id     TEXT,
  p_created_by      TEXT,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_rep          JSONB;
  v_orden_id     TEXT;
  v_numero_orden INTEGER;
  v_codigo_orden TEXT;
  v_prefijo      TEXT;
  v_precio       DECIMAL;
  v_dias         INTEGER;
  v_cargo        JSONB;
  v_ordenes      JSONB := '[]'::JSONB;
  v_total        DECIMAL := 0;
  v_saldo        DECIMAL;
  v_existing     JSONB;
  v_result       JSONB;
BEGIN
  IF p_reparaciones IS NULL OR jsonb_array_length(p_reparaciones) = 0 THEN
    RAISE EXCEPTION 'reparaciones_express: at least one repair is required';
  END IF;

  -- Idempotency claim INSIDE this transaction (same shape as mig 269:651-661).
  -- This is money: without it a double click on a slow connection charges the
  -- client twice.
  IF p_idempotency_key IS NOT NULL THEN
    BEGIN
      INSERT INTO pago_idempotency (organization_id, idempotency_key, cliente_id)
        VALUES (p_organization_id, p_idempotency_key, p_cliente_id);
    EXCEPTION WHEN unique_violation THEN
      SELECT response INTO v_existing
        FROM pago_idempotency
        WHERE organization_id = p_organization_id
          AND idempotency_key = p_idempotency_key;
      RETURN jsonb_build_object('replayed', true, 'response', v_existing);
    END;
  END IF;

  FOR v_rep IN SELECT * FROM jsonb_array_elements(p_reparaciones)
  LOOP
    IF COALESCE(v_rep->>'publicToken', '') = '' THEN
      RAISE EXCEPTION 'reparaciones_express: missing publicToken for %', v_rep->>'dispositivo';
    END IF;

    v_precio := (v_rep->>'precio')::DECIMAL;
    IF v_precio IS NULL OR v_precio <= 0 THEN
      RAISE EXCEPTION 'reparaciones_express: price must be greater than 0 for %', v_rep->>'dispositivo';
    END IF;

    SELECT prefijo_orden INTO v_prefijo
    FROM tipos_dispositivo
    WHERE organization_id = p_organization_id
      AND codigo = (v_rep->>'tipoDispositivo')
      AND activo = TRUE
    LIMIT 1;

    v_prefijo      := COALESCE(v_prefijo, 'ORD');
    v_numero_orden := get_next_order_number(p_organization_id);
    v_codigo_orden := v_prefijo || LPAD(v_numero_orden::TEXT, 3, '0');

    INSERT INTO ordenes_servicio (
      numero_orden, codigo_orden, cliente_id, organization_id, sucursal_id,
      dispositivo, tipo_dispositivo, marca, imei, problema_reportado,
      estado, estado_cobro, costo_final, total_cobrado,
      fecha_entrega, fecha_completado, entregado_por_user_id, recibido_por,
      public_token
    ) VALUES (
      v_numero_orden,
      v_codigo_orden,
      p_cliente_id,
      p_organization_id,
      p_sucursal_id,
      v_rep->>'dispositivo',
      v_rep->>'tipoDispositivo',
      NULLIF(v_rep->>'marca', ''),
      NULLIF(v_rep->>'imei', ''),
      v_rep->>'trabajoRealizado',
      'ENTREGADO',
      'PENDIENTE',
      v_precio,
      0,
      NOW(),
      NOW(),
      p_created_by,
      p_operador_id,
      v_rep->>'publicToken'
    ) RETURNING id INTO v_orden_id;

    INSERT INTO orden_eventos (
      orden_id, organization_id, tipo, estado_nuevo, descripcion, created_by
    ) VALUES (
      v_orden_id, p_organization_id, 'CAMBIO_ESTADO', 'ENTREGADO',
      'Reparación express: el equipo se entregó en el momento, sin recepción previa',
      p_created_by
    );

    v_dias := COALESCE((v_rep->>'diasGarantia')::INTEGER, 0);
    IF v_dias > 0 THEN
      INSERT INTO garantias (orden_id, dias_validez, fecha_inicio, fecha_vencimiento)
      VALUES (
        v_orden_id,
        v_dias,
        NOW(),
        (v_rep->>'fechaVencimientoGarantia')::TIMESTAMPTZ
      );
    END IF;

    SELECT cargar_deuda_cuenta_corriente(
      p_organization_id, p_cliente_id, v_precio, 'ORDEN', v_orden_id,
      p_created_by, p_sucursal_id
    ) INTO v_cargo;

    v_total   := v_total + v_precio;
    v_ordenes := v_ordenes || jsonb_build_object(
      'id',           v_orden_id,
      'numeroOrden',  v_numero_orden,
      'codigoOrden',  v_codigo_orden,
      'dispositivo',  v_rep->>'dispositivo',
      'precio',       v_precio,
      'publicToken',  v_rep->>'publicToken',
      'movimientoId', v_cargo->>'id'
    );
  END LOOP;

  SELECT saldo_cuenta INTO v_saldo FROM clientes WHERE id = p_cliente_id;

  v_result := jsonb_build_object(
    'ordenes',      v_ordenes,
    'totalCargado', v_total,
    'saldoNuevo',   v_saldo
  );

  IF p_idempotency_key IS NOT NULL THEN
    UPDATE pago_idempotency
      SET response = v_result
      WHERE organization_id = p_organization_id
        AND idempotency_key = p_idempotency_key;
  END IF;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION crear_reparaciones_express(TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION crear_reparaciones_express(TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION crear_reparaciones_express(TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION crear_reparaciones_express(TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT) TO service_role;

COMMENT ON FUNCTION crear_reparaciones_express(TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT) IS
  'Creates N express repair orders for one client, born in the terminal state '
  'ENTREGADO, each with its CARGO on the client cuenta corriente, in a single '
  'transaction. Rolls the whole batch back on any failure, plan order limit '
  'included. Idempotent through pago_idempotency.';

-- Feature flag: Profesional y Pro. A dedicated flag and NOT a reuse of
-- recepcion_multiple: they are independent features and a workshop may want one
-- without the other.
UPDATE plans SET
  feature_flags = COALESCE(feature_flags, '{}'::jsonb) || '{"reparaciones_express": true}'::jsonb,
  updated_at = NOW()
WHERE slug IN ('profesional', 'pro');
