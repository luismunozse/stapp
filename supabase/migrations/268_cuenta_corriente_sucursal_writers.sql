-- ========================================================================
-- Migration 268: CUENTA_CORRIENTE fiado writers — persist sucursal_id
-- ========================================================================
-- Gap (discovered during recordatorios-cobro-whatsapp / PR 1 sign audit):
-- mig 238 added cuenta_corriente.sucursal_id and threaded p_sucursal_id
-- through depositar_cuenta_corriente ONLY. The four fiado-writing functions
-- below have NEVER persisted sucursal_id — every CARGO/USO/PAGO/DEVOLUCION
-- row has sucursal_id = NULL. This silently understates (often to exactly
-- zero) any branch-scoped fiado read (e.g. get_deuda_cliente_sucursal, mig
-- 267) for non-admin operators, who are always branch-scoped.
--
-- Fix (same pattern as depositar_cuenta_corriente, mig 238):
--   1. Add p_sucursal_id TEXT DEFAULT NULL as the new LAST parameter
--      (zero-downtime, backward compatible — existing positional callers
--      that omit it keep working and simply write NULL, same as today).
--   2. Persist it on the cuenta_corriente INSERT.
--   3. DROP the old-arity overload first to avoid an ambiguous overload:
--      a call with the old N args would otherwise match both the old
--      function and the new function (whose extra param has a default).
--
-- Historical rows with sucursal_id = NULL are NOT backfilled — there is no
-- reliable source to attribute them to a branch after the fact. This
-- migration only fixes correctness for NEW movements going forward.
--
-- No callers are dropped/changed at the SQL level; the ~10 app-layer call
-- sites are updated in this same PR to pass p_sucursal_id explicitly.
-- ========================================================================

-- ============================================================
-- 1. cargar_deuda_cuenta_corriente (CARGO) — base: mig 234
-- ============================================================
DROP FUNCTION IF EXISTS cargar_deuda_cuenta_corriente(TEXT, TEXT, DECIMAL, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION cargar_deuda_cuenta_corriente(
  p_org_id TEXT,
  p_cliente_id TEXT,
  p_monto DECIMAL,
  p_referencia_tipo TEXT,
  p_referencia_id TEXT,
  p_usuario_id TEXT DEFAULT NULL,
  p_sucursal_id TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_saldo_actual DECIMAL;
  v_nuevo_saldo DECIMAL;
  v_mov_id TEXT;
BEGIN
  SELECT saldo_cuenta INTO v_saldo_actual
  FROM clientes
  WHERE id = p_cliente_id AND organization_id = p_org_id
  FOR UPDATE;

  IF v_saldo_actual IS NULL THEN
    RAISE EXCEPTION 'Cliente no encontrado';
  END IF;

  v_nuevo_saldo := COALESCE(v_saldo_actual, 0) - p_monto;

  INSERT INTO cuenta_corriente (
    organization_id, cliente_id, tipo, monto, saldo_posterior,
    referencia_tipo, referencia_id, usuario_id, observaciones,
    sucursal_id
  ) VALUES (
    p_org_id, p_cliente_id, 'CARGO', -p_monto, v_nuevo_saldo,
    p_referencia_tipo, p_referencia_id, p_usuario_id,
    'Cargo a cuenta corriente (saldo pendiente)',
    p_sucursal_id
  ) RETURNING id INTO v_mov_id;

  UPDATE clientes SET saldo_cuenta = v_nuevo_saldo WHERE id = p_cliente_id;

  RETURN jsonb_build_object('id', v_mov_id, 'saldoAnterior', v_saldo_actual, 'saldoNuevo', v_nuevo_saldo);
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 2. pagar_fiado_cuenta_corriente (PAGO) — base: mig 234
-- ============================================================
DROP FUNCTION IF EXISTS pagar_fiado_cuenta_corriente(TEXT, TEXT, DECIMAL, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION pagar_fiado_cuenta_corriente(
  p_org_id TEXT,
  p_cliente_id TEXT,
  p_monto DECIMAL,
  p_referencia_tipo TEXT,
  p_referencia_id TEXT,
  p_usuario_id TEXT DEFAULT NULL,
  p_observaciones TEXT DEFAULT NULL,
  p_sucursal_id TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_saldo_actual DECIMAL;
  v_nuevo_saldo DECIMAL;
  v_mov_id TEXT;
BEGIN
  SELECT saldo_cuenta INTO v_saldo_actual
  FROM clientes
  WHERE id = p_cliente_id AND organization_id = p_org_id
  FOR UPDATE;

  IF v_saldo_actual IS NULL THEN
    RAISE EXCEPTION 'Cliente no encontrado';
  END IF;

  v_nuevo_saldo := COALESCE(v_saldo_actual, 0) + p_monto;

  INSERT INTO cuenta_corriente (
    organization_id, cliente_id, tipo, monto, saldo_posterior,
    referencia_tipo, referencia_id, usuario_id, observaciones,
    sucursal_id
  ) VALUES (
    p_org_id, p_cliente_id, 'PAGO', p_monto, v_nuevo_saldo,
    p_referencia_tipo, p_referencia_id, p_usuario_id,
    COALESCE(p_observaciones, 'Pago de fiado'),
    p_sucursal_id
  ) RETURNING id INTO v_mov_id;

  UPDATE clientes SET saldo_cuenta = v_nuevo_saldo WHERE id = p_cliente_id;

  RETURN jsonb_build_object('id', v_mov_id, 'saldoAnterior', v_saldo_actual, 'saldoNuevo', v_nuevo_saldo);
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 3. usar_cuenta_corriente (USO) — base: mig 066
-- ============================================================
DROP FUNCTION IF EXISTS usar_cuenta_corriente(TEXT, TEXT, DECIMAL, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION usar_cuenta_corriente(
  p_org_id TEXT,
  p_cliente_id TEXT,
  p_monto DECIMAL,
  p_referencia_tipo TEXT,
  p_referencia_id TEXT,
  p_usuario_id TEXT DEFAULT NULL,
  p_sucursal_id TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_saldo_actual DECIMAL;
  v_nuevo_saldo DECIMAL;
  v_mov_id TEXT;
BEGIN
  -- Obtener saldo actual con lock
  SELECT saldo_cuenta INTO v_saldo_actual
  FROM clientes
  WHERE id = p_cliente_id AND organization_id = p_org_id
  FOR UPDATE;

  IF v_saldo_actual IS NULL THEN
    RAISE EXCEPTION 'Cliente no encontrado';
  END IF;

  IF v_saldo_actual < p_monto THEN
    RAISE EXCEPTION 'Saldo insuficiente. Disponible: %', v_saldo_actual;
  END IF;

  v_nuevo_saldo := v_saldo_actual - p_monto;

  -- Crear movimiento (monto negativo)
  INSERT INTO cuenta_corriente (
    organization_id, cliente_id, tipo, monto, saldo_posterior,
    referencia_tipo, referencia_id, usuario_id,
    sucursal_id
  ) VALUES (
    p_org_id, p_cliente_id, 'USO', -p_monto, v_nuevo_saldo,
    p_referencia_tipo, p_referencia_id, p_usuario_id,
    p_sucursal_id
  ) RETURNING id INTO v_mov_id;

  -- Actualizar saldo en clientes
  UPDATE clientes SET saldo_cuenta = v_nuevo_saldo WHERE id = p_cliente_id;

  RETURN jsonb_build_object(
    'id', v_mov_id,
    'saldoAnterior', v_saldo_actual,
    'saldoNuevo', v_nuevo_saldo
  );
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 4. devolver_cuenta_corriente (DEVOLUCION) — base: mig 235
-- ============================================================
DROP FUNCTION IF EXISTS devolver_cuenta_corriente(TEXT, TEXT, DECIMAL, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION devolver_cuenta_corriente(
  p_org_id TEXT,
  p_cliente_id TEXT,
  p_monto DECIMAL,
  p_referencia_tipo TEXT,
  p_referencia_id TEXT,
  p_usuario_id TEXT DEFAULT NULL,
  p_observaciones TEXT DEFAULT NULL,
  p_sucursal_id TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_saldo_actual DECIMAL;
  v_nuevo_saldo DECIMAL;
  v_mov_id TEXT;
BEGIN
  SELECT saldo_cuenta INTO v_saldo_actual
  FROM clientes WHERE id = p_cliente_id AND organization_id = p_org_id FOR UPDATE;

  IF v_saldo_actual IS NULL THEN
    RAISE EXCEPTION 'Cliente no encontrado';
  END IF;

  v_nuevo_saldo := COALESCE(v_saldo_actual, 0) + p_monto;

  INSERT INTO cuenta_corriente (
    organization_id, cliente_id, tipo, monto, saldo_posterior,
    referencia_tipo, referencia_id, usuario_id, observaciones,
    sucursal_id
  ) VALUES (
    p_org_id, p_cliente_id, 'DEVOLUCION', p_monto, v_nuevo_saldo,
    p_referencia_tipo, p_referencia_id, p_usuario_id,
    COALESCE(p_observaciones, 'Devolucion a cuenta corriente'),
    p_sucursal_id
  ) RETURNING id INTO v_mov_id;

  UPDATE clientes SET saldo_cuenta = v_nuevo_saldo WHERE id = p_cliente_id;

  RETURN jsonb_build_object('id', v_mov_id, 'saldoAnterior', v_saldo_actual, 'saldoNuevo', v_nuevo_saldo);
END;
$$ LANGUAGE plpgsql;
