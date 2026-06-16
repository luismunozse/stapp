-- 1) Tipos de movimiento: agregar CARGO (fiado) y PAGO (pago de fiado)
ALTER TABLE cuenta_corriente DROP CONSTRAINT IF EXISTS cuenta_corriente_tipo_check;
ALTER TABLE cuenta_corriente ADD CONSTRAINT cuenta_corriente_tipo_check
  CHECK (tipo IN ('DEPOSITO','USO','DEVOLUCION','AJUSTE','CARGO','PAGO'));

-- 2) cargar_deuda ahora inserta CARGO (antes USO). Misma firma y semántica.
CREATE OR REPLACE FUNCTION cargar_deuda_cuenta_corriente(
  p_org_id TEXT,
  p_cliente_id TEXT,
  p_monto DECIMAL,
  p_referencia_tipo TEXT,
  p_referencia_id TEXT,
  p_usuario_id TEXT DEFAULT NULL
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
    referencia_tipo, referencia_id, usuario_id, observaciones
  ) VALUES (
    p_org_id, p_cliente_id, 'CARGO', -p_monto, v_nuevo_saldo,
    p_referencia_tipo, p_referencia_id, p_usuario_id,
    'Cargo a cuenta corriente (saldo pendiente)'
  ) RETURNING id INTO v_mov_id;

  UPDATE clientes SET saldo_cuenta = v_nuevo_saldo WHERE id = p_cliente_id;

  RETURN jsonb_build_object('id', v_mov_id, 'saldoAnterior', v_saldo_actual, 'saldoNuevo', v_nuevo_saldo);
END;
$$ LANGUAGE plpgsql;

-- 3) pagar_fiado: credito (+) que baja el fiado. No valida saldo (un pago siempre entra).
CREATE OR REPLACE FUNCTION pagar_fiado_cuenta_corriente(
  p_org_id TEXT,
  p_cliente_id TEXT,
  p_monto DECIMAL,
  p_referencia_tipo TEXT,
  p_referencia_id TEXT,
  p_usuario_id TEXT DEFAULT NULL,
  p_observaciones TEXT DEFAULT NULL
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
    referencia_tipo, referencia_id, usuario_id, observaciones
  ) VALUES (
    p_org_id, p_cliente_id, 'PAGO', p_monto, v_nuevo_saldo,
    p_referencia_tipo, p_referencia_id, p_usuario_id,
    COALESCE(p_observaciones, 'Pago de fiado')
  ) RETURNING id INTO v_mov_id;

  UPDATE clientes SET saldo_cuenta = v_nuevo_saldo WHERE id = p_cliente_id;

  RETURN jsonb_build_object('id', v_mov_id, 'saldoAnterior', v_saldo_actual, 'saldoNuevo', v_nuevo_saldo);
END;
$$ LANGUAGE plpgsql;
