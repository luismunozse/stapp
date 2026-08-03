-- Migration 284: editar la cantidad de un repuesto ya cargado en una orden, y
-- corregir el borrado de repuestos en órdenes ya cerradas.
--
-- CONTEXTO
--
-- Hasta ahora repuestos_orden sólo soportaba alta (add_repuesto_inventario) y
-- baja (remove_repuesto_inventario). Corregir una cantidad obligaba a borrar y
-- volver a cargar: dos movimientos de inventario y dos reservas para arreglar
-- un tipeo.
--
-- BUG QUE ESTA MIGRACION CORRIGE
--
-- consumir_reservas_orden (al entregar) y liberar_reservas_orden (al cancelar)
-- NO dejan marca en las filas de repuestos_orden. Después de cerrar la orden,
-- la fila se ve idéntica a la de una orden abierta, así que
-- remove_repuesto_inventario aplicaba siempre la misma rama:
--
--   stock_reservado := stock_reservado - LEAST(cantidad, stock_reservado)
--
-- El LEAST evita el negativo, pero la reserva que descuenta puede pertenecer a
-- OTRA orden abierta sobre el mismo item. Borrar un repuesto de una orden ya
-- entregada le robaba la reserva a un trabajo en curso, en silencio, y el stock
-- físico descontado al entregar no volvía nunca.
--
-- El estado de la orden es la única fuente confiable para saber qué pasó con la
-- reserva, así que ambas funciones lo consultan:
--
--   * Orden abierta      -> la reserva sigue viva: liberarla (comportamiento previo).
--   * ENTREGADO*         -> consumir_reservas_orden ya descontó el stock físico y
--                           bajó la reserva: hay que DEVOLVER la unidad al stock
--                           (movimiento DEVOLUCION). No tocar stock_reservado.
--   * CANCELADO          -> liberar_reservas_orden ya liberó la reserva y el stock
--                           nunca se descontó: no tocar nada.

-- ============================================================
-- 1. update_repuesto_cantidad
--    Ajusta la reserva por el delta en vez de borrar y recrear.
--    Sólo opera sobre órdenes abiertas: en una orden cerrada la reserva ya no
--    existe y "cambiar la cantidad" no tiene una semántica única (¿devuelve al
--    stock? ¿lo saca de nuevo?). Para esos casos el camino es borrar el repuesto.
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_repuesto_cantidad(
  p_repuesto_id   TEXT,
  p_cantidad_nueva INTEGER,
  p_user_id       TEXT DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
  v_inventario_id     TEXT;
  v_cantidad_actual   INTEGER;
  v_orden_id          TEXT;
  v_dep_repuesto      TEXT;
  v_estado            TEXT;
  v_org_id            TEXT;
  v_suc_id            TEXT;
  v_stock             INTEGER;
  v_stock_reservado   INTEGER;
  v_disponible        INTEGER;
  v_delta             INTEGER;
  v_liberar           INTEGER;
  v_dep_objetivo      TEXT;
  v_deposito_efectivo TEXT;
BEGIN
  IF p_cantidad_nueva IS NULL OR p_cantidad_nueva < 1 THEN
    RETURN json_build_object('error', 'La cantidad debe ser al menos 1');
  END IF;

  SELECT inventario_id, cantidad, orden_id, deposito_id
  INTO v_inventario_id, v_cantidad_actual, v_orden_id, v_dep_repuesto
  FROM repuestos_orden
  WHERE id = p_repuesto_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Repuesto no encontrado');
  END IF;

  SELECT estado, organization_id, sucursal_id
  INTO v_estado, v_org_id, v_suc_id
  FROM ordenes_servicio
  WHERE id = v_orden_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Orden no encontrada');
  END IF;

  IF v_estado IN ('ENTREGADO', 'ENTREGADO_SIN_REPARACION', 'ENTREGADO_SIN_COBRO', 'CANCELADO') THEN
    RETURN json_build_object(
      'error', 'No se puede cambiar la cantidad en una orden cerrada',
      'code', 'ORDEN_CERRADA'
    );
  END IF;

  -- Repuesto manual (sin inventario): no mueve stock.
  IF v_inventario_id IS NULL THEN
    UPDATE repuestos_orden SET cantidad = p_cantidad_nueva WHERE id = p_repuesto_id;
    RETURN json_build_object('success', true, 'cantidad', p_cantidad_nueva);
  END IF;

  v_delta := p_cantidad_nueva - v_cantidad_actual;

  IF v_delta = 0 THEN
    RETURN json_build_object('success', true, 'cantidad', p_cantidad_nueva);
  END IF;

  SELECT stock, stock_reservado
  INTO v_stock, v_stock_reservado
  FROM inventario
  WHERE id = v_inventario_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Item no encontrado');
  END IF;

  -- Depósito: el que se usó al reservar (persistido en la fila); fallback al de
  -- la sucursal de la orden para reservas legacy sin deposito_id.
  v_dep_objetivo := COALESCE(v_dep_repuesto, get_deposito_de_sucursal(v_suc_id));

  IF v_delta > 0 THEN
    v_disponible := v_stock - v_stock_reservado;

    IF v_disponible < v_delta THEN
      RETURN json_build_object(
        'error', format('Stock insuficiente. Disponible: %s', v_disponible),
        'code', 'STOCK_INSUFICIENTE'
      );
    END IF;

    UPDATE inventario
    SET stock_reservado = stock_reservado + v_delta
    WHERE id = v_inventario_id;

    v_deposito_efectivo := reservar_stock_deposito(
      v_inventario_id, v_org_id, v_dep_objetivo, v_delta, false);

    INSERT INTO movimientos_inventario (
      inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
      referencia_id, referencia_tipo, usuario_id, organization_id,
      observaciones, deposito_id
    ) VALUES (
      v_inventario_id, 'RESERVA', v_delta, v_stock, v_stock,
      v_orden_id, 'orden_servicio', p_user_id, v_org_id,
      'Ajuste de cantidad de repuesto en orden de servicio',
      v_deposito_efectivo
    );
  ELSE
    v_liberar := LEAST(-v_delta, v_stock_reservado);

    IF v_liberar > 0 THEN
      UPDATE inventario
      SET stock_reservado = stock_reservado - v_liberar
      WHERE id = v_inventario_id;

      v_deposito_efectivo := liberar_reserva_deposito(
        v_inventario_id, v_org_id, v_dep_objetivo, v_liberar);

      INSERT INTO movimientos_inventario (
        inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
        referencia_id, referencia_tipo, usuario_id, organization_id,
        observaciones, deposito_id
      ) VALUES (
        v_inventario_id, 'LIBERACION_RESERVA', v_liberar, v_stock, v_stock,
        v_orden_id, 'orden_servicio', p_user_id, v_org_id,
        'Ajuste de cantidad de repuesto en orden de servicio',
        v_deposito_efectivo
      );
    END IF;
  END IF;

  UPDATE repuestos_orden
  SET cantidad = p_cantidad_nueva,
      -- Persistir el depósito efectivo si la fila era legacy (deposito_id NULL),
      -- para que consumir/liberar cierren la reserva en el MISMO depósito.
      deposito_id = COALESCE(deposito_id, v_deposito_efectivo)
  WHERE id = p_repuesto_id;

  RETURN json_build_object('success', true, 'cantidad', p_cantidad_nueva);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.update_repuesto_cantidad(TEXT, INTEGER, TEXT) IS
  'Ajusta la cantidad de un repuesto de orden moviendo sólo el delta de reserva. Rechaza órdenes cerradas.';

-- ============================================================
-- 2. remove_repuesto_inventario — consciente del estado de la orden
--    Base: mig 206 (línea 1556). Se conserva la firma y el comportamiento para
--    órdenes abiertas; se agregan las ramas de orden entregada y cancelada.
-- ============================================================
CREATE OR REPLACE FUNCTION remove_repuesto_inventario(
  p_repuesto_id TEXT,
  p_deposito_id TEXT DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
  v_inventario_id     TEXT;
  v_cantidad          INTEGER;
  v_orden_id          TEXT;
  v_dep_repuesto      TEXT;
  v_estado            TEXT;
  v_stock             INTEGER;
  v_stock_reservado   INTEGER;
  v_org_id            TEXT;
  v_suc_id            TEXT;
  v_cantidad_liberar  INTEGER;
  v_dep_objetivo      TEXT;
  v_deposito_efectivo TEXT;
BEGIN
  -- Leer el estado ANTES de borrar: una vez borrada la fila ya no se puede
  -- resolver a qué orden pertenecía.
  SELECT ro.inventario_id, ro.cantidad, ro.orden_id, ro.deposito_id,
         os.estado, os.organization_id, os.sucursal_id
  INTO v_inventario_id, v_cantidad, v_orden_id, v_dep_repuesto,
       v_estado, v_org_id, v_suc_id
  FROM repuestos_orden ro
  LEFT JOIN ordenes_servicio os ON os.id = ro.orden_id
  WHERE ro.id = p_repuesto_id
  FOR UPDATE OF ro;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Repuesto no encontrado');
  END IF;

  DELETE FROM repuestos_orden WHERE id = p_repuesto_id;

  -- Repuesto manual: nada que devolver al inventario.
  IF v_inventario_id IS NULL THEN
    RETURN json_build_object('success', true);
  END IF;

  SELECT stock, stock_reservado, organization_id
  INTO v_stock, v_stock_reservado, v_org_id
  FROM inventario
  WHERE id = v_inventario_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', true);
  END IF;

  v_dep_objetivo := COALESCE(p_deposito_id, v_dep_repuesto, get_deposito_de_sucursal(v_suc_id));

  IF v_estado IN ('ENTREGADO', 'ENTREGADO_SIN_REPARACION', 'ENTREGADO_SIN_COBRO') THEN
    -- La reserva ya se consumió y el stock físico se descontó al entregar.
    -- Tocar stock_reservado acá le robaría la reserva a otra orden abierta:
    -- lo correcto es devolver la unidad al stock, que es lo que pasó de verdad
    -- (el repuesto no se usó).
    UPDATE inventario
    SET stock = stock + v_cantidad
    WHERE id = v_inventario_id;

    v_deposito_efectivo := incrementar_stock_deposito(
      v_inventario_id, v_org_id, v_dep_objetivo, v_cantidad);

    INSERT INTO movimientos_inventario (
      inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
      referencia_id, referencia_tipo, observaciones, organization_id,
      deposito_id
    ) VALUES (
      v_inventario_id, 'DEVOLUCION', v_cantidad, v_stock, v_stock + v_cantidad,
      v_orden_id, 'orden_servicio',
      'Repuesto removido de orden entregada - devuelto al stock',
      v_org_id,
      v_deposito_efectivo
    );

    RETURN json_build_object('success', true, 'devueltoAlStock', v_cantidad);
  END IF;

  IF v_estado = 'CANCELADO' THEN
    -- liberar_reservas_orden ya liberó la reserva al cancelar y el stock físico
    -- nunca se descontó. No hay nada que ajustar.
    RETURN json_build_object('success', true);
  END IF;

  -- Orden abierta: la reserva sigue viva, se libera (comportamiento previo).
  v_cantidad_liberar := LEAST(v_cantidad, v_stock_reservado);

  IF v_cantidad_liberar > 0 THEN
    UPDATE inventario
    SET stock_reservado = stock_reservado - v_cantidad_liberar
    WHERE id = v_inventario_id;

    v_deposito_efectivo := liberar_reserva_deposito(
      v_inventario_id, v_org_id, v_dep_objetivo, v_cantidad_liberar);

    INSERT INTO movimientos_inventario (
      inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
      referencia_id, referencia_tipo, observaciones, organization_id,
      deposito_id
    ) VALUES (
      v_inventario_id, 'LIBERACION_RESERVA', v_cantidad_liberar, v_stock, v_stock,
      v_orden_id, 'orden_servicio',
      'Reserva liberada - repuesto removido de orden de servicio',
      v_org_id,
      v_deposito_efectivo
    );
  END IF;

  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION remove_repuesto_inventario(TEXT, TEXT) IS
  'Borra un repuesto de orden ajustando el inventario según el estado de la orden: libera reserva (abierta), devuelve al stock (entregada) o no hace nada (cancelada).';
