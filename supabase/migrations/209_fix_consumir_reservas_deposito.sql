-- 209_fix_consumir_reservas_deposito.sql
-- Fix de review (multi-depósito Fase 2): consumir_reservas_orden liberaba la
-- reserva del depósito donde se drenó el stock FÍSICO (v_deposito_efectivo),
-- no del depósito donde la reserva fue COLOCADA (p_deposito_id, principal-first
-- cuando es NULL). El físico drena por stock DESC y la reserva se coloca por
-- capacidad DESC: pueden diferir. Liberar del depósito equivocado hace que el
-- drain de liberar_reserva_deposito derrame sobre reservas de OTRAS órdenes en
-- otros depósitos. El agregado inventario.stock_reservado queda correcto, pero
-- el detalle por depósito se reasigna entre órdenes (drift silencioso).
--
-- Latente en Fase 2 (las reservas siguen siendo globales/principal-first: el
-- selector de depósito solo gatea ventas POS), pero incorrecto. Se corrige acá
-- como migración append-only porque la 206 ya está aplicada.
--
-- Cambio: liberar_reserva_deposito recibe p_deposito_id (mismo target con que
-- se reservó vía reservar_stock_deposito), no v_deposito_efectivo. El movimiento
-- SALIDA sigue registrando v_deposito_efectivo (ahí ocurrió el egreso físico).
-- Firma sin cambios → CREATE OR REPLACE, sin DROP.

CREATE OR REPLACE FUNCTION consumir_reservas_orden(
  p_orden_id    TEXT,
  p_user_id     TEXT,
  p_deposito_id TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_rep               RECORD;
  v_stock             INTEGER;
  v_stock_reservado   INTEGER;
  v_org_id            TEXT;
  v_count             INTEGER := 0;
  v_cantidad_reservada INTEGER;
  v_deposito_efectivo TEXT;
BEGIN
  SELECT organization_id INTO v_org_id
  FROM ordenes WHERE id = p_orden_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada';
  END IF;

  FOR v_rep IN
    SELECT ro.inventario_id, ro.cantidad
    FROM repuestos_orden ro
    WHERE ro.orden_id = p_orden_id
      AND ro.inventario_id IS NOT NULL
  LOOP
    SELECT stock, stock_reservado INTO v_stock, v_stock_reservado
    FROM inventario
    WHERE id = v_rep.inventario_id
    FOR UPDATE;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_cantidad_reservada := LEAST(v_rep.cantidad, v_stock_reservado);

    UPDATE inventario
    SET stock = stock - v_rep.cantidad,
        stock_reservado = stock_reservado - v_cantidad_reservada
    WHERE id = v_rep.inventario_id;

    -- Dual-write: descuenta físico del depósito target (drain principal-first
    -- cuando p_deposito_id es NULL) y libera la reserva DESDE DONDE FUE COLOCADA
    -- (p_deposito_id), no desde v_deposito_efectivo. Ver cabecera 209.
    v_deposito_efectivo := descontar_stock_deposito(
      v_rep.inventario_id, v_org_id, p_deposito_id, v_rep.cantidad,
      p_deposito_id IS NOT NULL);
    PERFORM liberar_reserva_deposito(
      v_rep.inventario_id, v_org_id, p_deposito_id, v_cantidad_reservada);

    INSERT INTO movimientos_inventario (
      inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
      referencia_id, referencia_tipo, usuario_id, organization_id,
      observaciones, deposito_id
    ) VALUES (
      v_rep.inventario_id, 'SALIDA', v_rep.cantidad,
      v_stock, v_stock - v_rep.cantidad,
      p_orden_id, 'orden_servicio', p_user_id, v_org_id,
      'Consumo de repuesto al entregar orden',
      v_deposito_efectivo
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'itemsConsumidos', v_count);
END;
$$ LANGUAGE plpgsql;
