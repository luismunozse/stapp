-- Migration 306: numero de recibo correlativo por organizacion sobre
-- cuenta_corriente, para poder emitir un comprobante imprimible de cada
-- movimiento de dinero recibido.
--
-- El numero se asigna PEREZOSAMENTE (al emitir el primer recibo del
-- movimiento) y queda persistido, de modo que reimprimir el mismo movimiento
-- devuelve siempre el mismo numero. Asignarlo al crear el movimiento habria
-- obligado a tocar depositar_cuenta_corriente / pagar_fiado_cuenta_corriente
-- y habria quemado numeros en movimientos que nunca se imprimen.

ALTER TABLE cuenta_corriente ADD COLUMN IF NOT EXISTS numero_recibo INTEGER;

-- Indice parcial: solo los movimientos ya emitidos participan de la unicidad,
-- asi los NULL (la enorme mayoria) no compiten entre si.
CREATE UNIQUE INDEX IF NOT EXISTS cuenta_corriente_numero_recibo_org_uniq
  ON cuenta_corriente(organization_id, numero_recibo)
  WHERE numero_recibo IS NOT NULL;

-- Asigna (o devuelve, si ya existe) el numero de recibo de un movimiento.
--
-- Orden de locks, deliberado y unico para todos los llamadores: primero la
-- fila del movimiento, despues el advisory lock de la organizacion. Al ser
-- siempre el mismo orden no hay ciclo posible entre dos llamadas concurrentes.
--   - El FOR UPDATE sobre la fila serializa dos emisiones del MISMO
--     movimiento: la segunda espera, relee numero_recibo ya asignado y lo
--     devuelve en vez de acuñar otro.
--   - El advisory lock por organizacion serializa dos emisiones de
--     movimientos DISTINTOS de la misma org, que si no leerian el mismo
--     MAX(numero_recibo) y chocarian contra el indice unico de arriba.
CREATE OR REPLACE FUNCTION asignar_numero_recibo_cc(
  p_org_id TEXT,
  p_movimiento_id TEXT
) RETURNS INTEGER AS $$
DECLARE
  v_numero INTEGER;
  v_tipo   TEXT;
BEGIN
  SELECT numero_recibo, tipo INTO v_numero, v_tipo
  FROM cuenta_corriente
  WHERE id = p_movimiento_id AND organization_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movimiento de cuenta corriente no encontrado';
  END IF;

  -- Reimpresion: mismo numero, siempre.
  IF v_numero IS NOT NULL THEN
    RETURN v_numero;
  END IF;

  -- Un recibo acredita dinero recibido. CARGO y USO son debitos (fiado y
  -- consumo de saldo) y DEVOLUCION/AJUSTE no son cobros: ninguno se emite
  -- como recibo.
  IF v_tipo NOT IN ('DEPOSITO', 'PAGO') THEN
    RAISE EXCEPTION 'Solo se emite recibo de movimientos DEPOSITO o PAGO (tipo recibido: %)', v_tipo
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('cc_recibo:' || p_org_id));

  SELECT COALESCE(MAX(numero_recibo), 0) + 1 INTO v_numero
  FROM cuenta_corriente
  WHERE organization_id = p_org_id;

  UPDATE cuenta_corriente SET numero_recibo = v_numero WHERE id = p_movimiento_id;

  RETURN v_numero;
END;
$$ LANGUAGE plpgsql;
