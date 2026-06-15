-- ========================================
-- Migration 224: devolución repone en el depósito ORIGINAL de la venta (gap #5)
-- ========================================
-- registrar_devolucion_stock reponía con p_deposito_id (NULL → principal de la
-- org). Con multi-sucursal, una devolución debe reponer en el MISMO depósito
-- de donde salió la venta original, no en Casa Central.
--
-- FIX: nuevo parámetro p_venta_id. Cuando no se pasa depósito explícito, se
-- resuelve el depósito del movimiento VENTA original (referencia_id = venta,
-- inventario_id, tipo='VENTA'); fallback al principal de la sucursal de la
-- venta; fallback final al principal de la org (vía incrementar_stock_deposito
-- con NULL). Backward-compatible: callers sin p_venta_id mantienen el
-- comportamiento anterior (p_venta_id default NULL → resuelve por p_deposito_id).
--
-- Body LIVE verbatim (de pg_get_functiondef en prod); único cambio = resolución
-- del depósito objetivo. Se dropea la firma de 7 params antes de crear la de 8
-- para evitar overloads ambiguos en PostgREST.
-- ========================================

DROP FUNCTION IF EXISTS registrar_devolucion_stock(
  text, text, text, integer, text, text, text
);

CREATE OR REPLACE FUNCTION public.registrar_devolucion_stock(
  p_inventario_id text,
  p_org_id text,
  p_user_id text,
  p_cantidad integer,
  p_referencia_id text,
  p_observaciones text DEFAULT NULL::text,
  p_deposito_id text DEFAULT NULL::text,
  p_venta_id text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
  v_stock_anterior    INTEGER;
  v_deposito_efectivo TEXT;
  v_dep_objetivo      TEXT;
BEGIN
  IF p_cantidad <= 0 THEN
    RAISE EXCEPTION 'p_cantidad debe ser mayor a cero, recibido: %', p_cantidad USING ERRCODE = 'P0003';
  END IF;

  SELECT stock INTO v_stock_anterior
  FROM inventario
  WHERE id = p_inventario_id AND organization_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item de inventario no encontrado' USING ERRCODE = 'P0002';
  END IF;

  -- Resolver el depósito objetivo: explícito > depósito de la venta original >
  -- principal de la sucursal de la venta > (NULL → principal de la org).
  v_dep_objetivo := p_deposito_id;

  IF v_dep_objetivo IS NULL AND p_venta_id IS NOT NULL THEN
    SELECT deposito_id INTO v_dep_objetivo
    FROM movimientos_inventario
    WHERE referencia_id = p_venta_id
      AND inventario_id = p_inventario_id
      AND tipo = 'VENTA'
      AND deposito_id IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_dep_objetivo IS NULL THEN
      SELECT get_deposito_de_sucursal(sucursal_id) INTO v_dep_objetivo
      FROM ventas WHERE id = p_venta_id;
    END IF;
  END IF;

  UPDATE inventario
  SET stock = stock + p_cantidad, updated_at = NOW()
  WHERE id = p_inventario_id;

  -- Dual-write: reponer el stock por depósito en el depósito resuelto.
  v_deposito_efectivo := incrementar_stock_deposito(
    p_inventario_id, p_org_id, v_dep_objetivo, p_cantidad);

  INSERT INTO movimientos_inventario (
    inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
    referencia_id, referencia_tipo, observaciones, usuario_id,
    organization_id, deposito_id
  ) VALUES (
    p_inventario_id, 'DEVOLUCION', p_cantidad, v_stock_anterior,
    v_stock_anterior + p_cantidad, p_referencia_id, 'devolucion_venta',
    p_observaciones, p_user_id, p_org_id, v_deposito_efectivo
  );

  RETURN jsonb_build_object(
    'stockAnterior',   v_stock_anterior,
    'stockPosterior',  v_stock_anterior + p_cantidad,
    'depositoId',      v_deposito_efectivo
  );
END;
$function$;
