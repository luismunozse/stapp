-- ========================================
-- Migration 220: FIX — reservas de orden apuntan a tabla inexistente 'ordenes'
-- ========================================
-- INCIDENTE: consumir_reservas_orden y liberar_reservas_orden hacen
-- `SELECT ... FROM ordenes WHERE id = p_orden_id`, pero esa relación NO existe
-- (la tabla es ordenes_servicio). Verificado en prod (pg_class sin filas para
-- 'ordenes'; pg_get_functiondef confirma FROM ordenes en ambas).
--
-- Efecto: al ENTREGAR una orden con repuestos reservados (consumir) o
-- CANCELARLA (liberar), la RPC falla con "relation ordenes does not exist".
--
-- FIX: body LIVE verbatim (obtenido de pg_get_functiondef en prod), único
-- cambio = `FROM ordenes` → `FROM ordenes_servicio`. Misma firma → sin DROP.
-- Todo el dual-write por depósito se preserva intacto.
-- ========================================

CREATE OR REPLACE FUNCTION public.consumir_reservas_orden(
  p_orden_id text, p_user_id text, p_deposito_id text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
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
  FROM ordenes_servicio WHERE id = p_orden_id;

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

    -- Dual-write: deduct physical stock from the target deposit, then
    -- release the corresponding reservation from that same deposit.
    v_deposito_efectivo := descontar_stock_deposito(
      v_rep.inventario_id, v_org_id, p_deposito_id, v_rep.cantidad,
      p_deposito_id IS NOT NULL);
    PERFORM liberar_reserva_deposito(
      v_rep.inventario_id, v_org_id, v_deposito_efectivo, v_cantidad_reservada);

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
$function$;

CREATE OR REPLACE FUNCTION public.liberar_reservas_orden(
  p_orden_id text, p_user_id text, p_deposito_id text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
  v_rep               RECORD;
  v_stock             INTEGER;
  v_stock_reservado   INTEGER;
  v_org_id            TEXT;
  v_count             INTEGER := 0;
  v_cantidad_liberar  INTEGER;
  v_deposito_efectivo TEXT;
BEGIN
  SELECT organization_id INTO v_org_id
  FROM ordenes_servicio WHERE id = p_orden_id;

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

    v_cantidad_liberar := LEAST(v_rep.cantidad, v_stock_reservado);

    IF v_cantidad_liberar > 0 THEN
      UPDATE inventario
      SET stock_reservado = stock_reservado - v_cantidad_liberar
      WHERE id = v_rep.inventario_id;

      -- Dual-write: replicate liberation to per-deposit stock.
      v_deposito_efectivo := liberar_reserva_deposito(
        v_rep.inventario_id, v_org_id, p_deposito_id, v_cantidad_liberar);

      INSERT INTO movimientos_inventario (
        inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
        referencia_id, referencia_tipo, usuario_id, organization_id,
        observaciones, deposito_id
      ) VALUES (
        v_rep.inventario_id, 'LIBERACION_RESERVA', v_cantidad_liberar,
        v_stock, v_stock,
        p_orden_id, 'orden_servicio', p_user_id, v_org_id,
        'Reserva liberada por cancelación de orden',
        v_deposito_efectivo
      );

      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'itemsLiberados', v_count);
END;
$function$;
