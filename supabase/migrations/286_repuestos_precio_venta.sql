-- Migration 286: separar costo y precio de venta en los repuestos de una orden.
--
-- CONTEXTO
--
-- repuestos_orden.precio_unitario guarda el COSTO: add_repuesto_inventario lo
-- copia de inventario.precio_compra, y los tres reportes de rentabilidad
-- (rentabilidad, rentabilidad-tecnicos, tendencia-financiera) lo leen como
-- costo — sus variables se llaman literalmente costoRepuestos.
--
-- Al cliente los repuestos se le cobran a PRECIO DE VENTA, no a costo, asi que
-- hace falta el segundo numero. Se agrega una columna nueva en vez de
-- reinterpretar la existente: cambiarle el significado a precio_unitario
-- habria dado margen cero en todos los reportes historicos.
--
-- Las filas viejas quedan en NULL y no suman: ninguna orden ya cerrada cambia
-- de precio por esta migracion.

ALTER TABLE repuestos_orden
  ADD COLUMN IF NOT EXISTS precio_venta_unitario DECIMAL(10,2);

COMMENT ON COLUMN repuestos_orden.precio_unitario IS
  'COSTO unitario del repuesto (precio_compra al momento de cargarlo). Lo usan los reportes de rentabilidad.';
COMMENT ON COLUMN repuestos_orden.precio_venta_unitario IS
  'Precio de VENTA unitario: lo que se le cobra al cliente. NULL en filas anteriores a la migracion 286.';

-- Backfill solo de ordenes ABIERTAS. Las cerradas ya tienen su costo_final
-- decidido y nada lo recalcula, asi que tocarlas no aportaria y solo agregaria
-- riesgo. Las abiertas, en cambio, se van a entregar con la pantalla nueva y
-- necesitan un precio de venta sensato: el vigente del item.
UPDATE repuestos_orden ro
SET precio_venta_unitario = i.precio_venta
FROM inventario i, ordenes_servicio os
WHERE ro.inventario_id = i.id
  AND os.id = ro.orden_id
  AND ro.precio_venta_unitario IS NULL
  AND os.estado NOT IN ('ENTREGADO', 'ENTREGADO_SIN_REPARACION', 'ENTREGADO_SIN_COBRO', 'CANCELADO');

-- ============================================================
-- add_repuesto_inventario — capturar tambien el precio de venta
-- Base: mig 222 (linea 416). Unico cambio: se lee inventario.precio_venta y se
-- persiste en la columna nueva. El resto es identico.
-- ============================================================
CREATE OR REPLACE FUNCTION public.add_repuesto_inventario(
  p_orden_id text, p_inventario_id text, p_cantidad integer, p_deposito_id text DEFAULT NULL::text
)
RETURNS json
LANGUAGE plpgsql
AS $function$
DECLARE
  v_stock             INTEGER;
  v_stock_reservado   INTEGER;
  v_costo             NUMERIC;
  v_precio_venta      NUMERIC;
  v_repuesto_id       TEXT;
  v_org_id            TEXT;
  v_disponible        INTEGER;
  v_deposito_efectivo TEXT;
  v_suc_id            TEXT;
  v_dep_objetivo      TEXT;
BEGIN
  SELECT stock, stock_reservado, precio_compra, precio_venta, organization_id
  INTO v_stock, v_stock_reservado, v_costo, v_precio_venta, v_org_id
  FROM inventario
  WHERE id = p_inventario_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Item no encontrado');
  END IF;

  v_disponible := v_stock - v_stock_reservado;

  IF v_disponible < p_cantidad THEN
    RETURN json_build_object('error', format('Stock insuficiente. Disponible: %s', v_disponible));
  END IF;

  -- Fase 5: resolver el depósito de la sucursal de la orden cuando no es explícito.
  SELECT sucursal_id INTO v_suc_id FROM ordenes_servicio WHERE id = p_orden_id;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Orden no encontrada');
  END IF;
  v_dep_objetivo := COALESCE(p_deposito_id, get_deposito_de_sucursal(v_suc_id));

  UPDATE inventario
  SET stock_reservado = stock_reservado + p_cantidad
  WHERE id = p_inventario_id;

  -- Reservar en el detalle por depósito; capturar el depósito EFECTIVO usado.
  v_deposito_efectivo := reservar_stock_deposito(
    p_inventario_id, v_org_id, v_dep_objetivo, p_cantidad, false);

  -- Persistir el depósito efectivo en el repuesto, para que consumir/liberar
  -- cierren la reserva en el MISMO depósito (no recalculen).
  -- El precio se congela al momento de cargar el repuesto (costo Y venta): si
  -- despues cambia la lista de precios, lo cargado en la orden no se mueve.
  INSERT INTO repuestos_orden (
    orden_id, inventario_id, cantidad, precio_unitario, precio_venta_unitario, deposito_id
  )
  VALUES (
    p_orden_id, p_inventario_id, p_cantidad,
    COALESCE(v_costo, 0), COALESCE(v_precio_venta, 0), v_deposito_efectivo
  )
  RETURNING id INTO v_repuesto_id;

  INSERT INTO movimientos_inventario (
    inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
    referencia_id, referencia_tipo, observaciones, organization_id,
    deposito_id
  ) VALUES (
    p_inventario_id, 'RESERVA', p_cantidad, v_stock, v_stock,
    p_orden_id, 'orden_servicio',
    'Repuesto reservado para orden de servicio',
    v_org_id,
    v_deposito_efectivo
  );

  RETURN json_build_object('success', true, 'id', v_repuesto_id);
END;
$function$;
