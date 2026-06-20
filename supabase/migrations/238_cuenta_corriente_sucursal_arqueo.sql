-- ========================================
-- Migration 238: CUENTA_CORRIENTE — add sucursal_id (nullable + backfill + index)
-- ========================================
-- Cierra el gap del arqueo por sucursal: hasta ahora cuenta_corriente no tenía
-- columna de sucursal, por lo que fetchMovimientosDia (lib/caja-utils.ts) OMITÍA
-- por completo los depósitos a cuenta corriente cuando el arqueo era por sucursal.
-- Con la columna, cada depósito queda atribuido a la sucursal donde se registró
-- y entra al arqueo de esa sucursal.
--
-- Mismo patrón que la mig 215 (turnos): ADD COLUMN IF NOT EXISTS (sin lock),
-- backfill idempotente con guard IS NULL a la sucursal principal de la org,
-- columna NULLABLE (sin enforcement NOT NULL en esta migración).

-- 1. Columna (nullable) con FK a sucursales
ALTER TABLE cuenta_corriente
  ADD COLUMN IF NOT EXISTS sucursal_id TEXT REFERENCES sucursales(id);

-- 2. Backfill: filas existentes se atribuyen a la sucursal principal de su org.
--    No hay forma de recuperar la sucursal real de depósitos históricos; la
--    principal (Casa Central) es el default seguro y consistente con turnos/
--    movimientos_caja. Idempotente por el guard IS NULL.
UPDATE cuenta_corriente cc
SET sucursal_id = s.id
FROM sucursales s
WHERE cc.sucursal_id IS NULL
  AND s.organization_id = cc.organization_id
  AND s.principal = true
  AND s.deleted_at IS NULL;

-- 3. Índice para el arqueo por sucursal (org + sucursal + tipo + fecha)
CREATE INDEX IF NOT EXISTS cuenta_corriente_org_sucursal_tipo_created_idx
  ON cuenta_corriente(organization_id, sucursal_id, tipo, created_at DESC);

-- ============================================================
-- 4. depositar_cuenta_corriente — agrega p_sucursal_id y lo persiste
--    (base: mig 066, verbatim + columna sucursal_id en el INSERT)
-- ============================================================
-- La firma vieja (7 args) se dropea para evitar overload ambiguo: el único
-- caller (app/api/clientes/[id]/cuenta-corriente/route.ts) pasa p_sucursal_id.
DROP FUNCTION IF EXISTS depositar_cuenta_corriente(TEXT, TEXT, DECIMAL, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION depositar_cuenta_corriente(
  p_org_id TEXT,
  p_cliente_id TEXT,
  p_monto DECIMAL,
  p_metodo_pago TEXT,
  p_numero_referencia TEXT DEFAULT NULL,
  p_observaciones TEXT DEFAULT NULL,
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

  v_nuevo_saldo := v_saldo_actual + p_monto;

  -- Crear movimiento
  INSERT INTO cuenta_corriente (
    organization_id, cliente_id, tipo, monto, saldo_posterior,
    metodo_pago, referencia_tipo, numero_referencia, observaciones, usuario_id,
    sucursal_id
  ) VALUES (
    p_org_id, p_cliente_id, 'DEPOSITO', p_monto, v_nuevo_saldo,
    p_metodo_pago, 'MANUAL', p_numero_referencia, p_observaciones, p_usuario_id,
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
