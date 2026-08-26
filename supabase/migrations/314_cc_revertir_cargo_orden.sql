-- ============================================================================
-- 314: revert a fiado CARGO back out of a client's cuenta corriente
-- ============================================================================
-- The reversal primitive already exists: devolver_cuenta_corriente (type
-- DEVOLUCION, positive amount, no balance validation), signature in mig
-- 268:187-196. It is already wired into sale returns, invoice void/delete and
-- order-payment void. The ONE reversal point never wired is the fiado CARGO
-- produced by delivering an order (entregar/route.ts:187) -- and ENTREGADO is
-- a terminal state (lib/orden-state-machine.ts:19, empty list), so there is no
-- "un-deliver" either. This migration closes that hole.
--
-- The three new columns are the double-reversal guard AND what the panel reads
-- to pair a CARGO with the DEVOLUCION that cancelled it. All nullable, purely
-- additive, no backfill: existing rows mean "not reverted", which is true.
--
-- The order itself is deliberately NOT touched: it stays ENTREGADO with its
-- costo_final and its history. The work happened; what is being reverted is the
-- charge. The order does not come back as debt elsewhere because
-- get_deuda_cliente_sucursal excludes orders carrying a CARGO whether reverted
-- or not (migration 309).
-- ============================================================================

ALTER TABLE cuenta_corriente
  ADD COLUMN IF NOT EXISTS revertido_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revertido_por           TEXT REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revertido_movimiento_id TEXT;

-- Partial: the overwhelming majority of rows are never reverted, so the classic
-- flow pays no write or space cost for this index.
CREATE INDEX IF NOT EXISTS idx_cuenta_corriente_revertido
  ON cuenta_corriente(revertido_movimiento_id)
  WHERE revertido_movimiento_id IS NOT NULL;

CREATE OR REPLACE FUNCTION revertir_cargos_orden(
  p_org_id         TEXT,
  p_cliente_id     TEXT,
  p_movimiento_ids JSONB,
  p_motivo         TEXT,
  p_usuario_id     TEXT
)
RETURNS JSONB AS $$
DECLARE
  v_id          TEXT;
  v_mov         cuenta_corriente%ROWTYPE;
  v_devolucion  JSONB;
  v_revertidos  JSONB := '[]'::JSONB;
  v_saldo       DECIMAL;
BEGIN
  IF p_movimiento_ids IS NULL OR jsonb_array_length(p_movimiento_ids) = 0 THEN
    RAISE EXCEPTION 'revertir_cargos_orden: no movements given';
  END IF;

  IF COALESCE(TRIM(p_motivo), '') = '' THEN
    RAISE EXCEPTION 'revertir_cargos_orden: motivo is required';
  END IF;

  FOR v_id IN SELECT jsonb_array_elements_text(p_movimiento_ids)
  LOOP
    -- FOR UPDATE: the endpoint validates too, but only this read under lock can
    -- keep two concurrent reversals of the same CARGO from both succeeding.
    SELECT * INTO v_mov
    FROM cuenta_corriente
    WHERE id = v_id
      AND organization_id = p_org_id
      AND cliente_id = p_cliente_id
    FOR UPDATE;

    IF v_mov.id IS NULL THEN
      RAISE EXCEPTION 'revertir_cargos_orden: movement % not found for this client', v_id;
    END IF;

    IF v_mov.tipo <> 'CARGO' OR v_mov.referencia_tipo <> 'ORDEN' THEN
      RAISE EXCEPTION 'revertir_cargos_orden: movement % is not an order fiado charge', v_id;
    END IF;

    IF v_mov.revertido_at IS NOT NULL THEN
      RAISE EXCEPTION 'revertir_cargos_orden: movement % was already reverted', v_id;
    END IF;

    -- sucursal_id comes from the ORIGINAL movement, never from the operator
    -- doing the reversal: the credit has to land in the same branch that took
    -- the debt or the per-branch arqueo goes crooked.
    SELECT devolver_cuenta_corriente(
      p_org_id,
      p_cliente_id,
      ABS(v_mov.monto),
      'ORDEN',
      v_mov.referencia_id,
      p_usuario_id,
      p_motivo,
      v_mov.sucursal_id
    ) INTO v_devolucion;

    UPDATE cuenta_corriente
    SET revertido_at            = NOW(),
        revertido_por           = p_usuario_id,
        revertido_movimiento_id = v_devolucion->>'id'
    WHERE id = v_mov.id;

    v_revertidos := v_revertidos || jsonb_build_object(
      'movimientoId', v_mov.id,
      'devolucionId', v_devolucion->>'id',
      'monto',        ABS(v_mov.monto)
    );
  END LOOP;

  SELECT saldo_cuenta INTO v_saldo FROM clientes WHERE id = p_cliente_id;

  RETURN jsonb_build_object('revertidos', v_revertidos, 'saldoNuevo', v_saldo);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================
-- Sensitive RPC -- REVOKE from PUBLIC/anon/authenticated
-- ============================================================
-- SECURITY DEFINER runs with owner privileges and ignores RLS. The anon key
-- ships in the browser bundle, so without this REVOKE anyone could reverse any
-- client's fiado charges in any organization straight through PostgREST. Only
-- the app's service_role client (supabaseAdmin) may call it.
REVOKE EXECUTE ON FUNCTION revertir_cargos_orden(TEXT, TEXT, JSONB, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION revertir_cargos_orden(TEXT, TEXT, JSONB, TEXT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION revertir_cargos_orden(TEXT, TEXT, JSONB, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION revertir_cargos_orden(TEXT, TEXT, JSONB, TEXT, TEXT) TO service_role;

COMMENT ON FUNCTION revertir_cargos_orden(TEXT, TEXT, JSONB, TEXT, TEXT) IS
  'Reverts one or more fiado CARGO movements (referencia_tipo=ORDEN) for a '
  'client, all in one transaction. Posts a DEVOLUCION per charge via '
  'devolver_cuenta_corriente, inheriting the ORIGINAL movement sucursal_id, and '
  'marks the CARGO as reverted. Raises if any movement is missing, is not an '
  'order charge, or was already reverted -- nothing is reverted in that case.';
