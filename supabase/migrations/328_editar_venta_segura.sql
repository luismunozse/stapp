-- Migration 328: editar una venta sin romper lo que ya cuelga de ella.
--
-- editar_venta_atomica (253) borraba los items y los volvia a crear sin mirar
-- nada mas. Problemas:
--   1. Editaba ventas con factura electronica (CAE), remito, devoluciones,
--      nota de credito, comision ya liquidada o productos con numero de serie.
--      Los items_devolucion y las series quedaban apuntando a items borrados.
--   2. No tocaba monto_abonado / estado_pago ni la cuenta corriente: subir el
--      total de una venta pagada la dejaba "PAGADO" con plata sin cobrar, y en
--      una fiada la deuda del cliente seguia siendo la vieja.
--   3. Perdia items_venta.costo_unitario_snapshot (rentabilidad en 0).
--   4. Con p_deposito_id NULL descontaba del deposito principal de la ORG en
--      vez del de la sucursal de la venta (crear_venta_atomica usa la sucursal).
--   5. Las garantias se reemitian con numero nuevo y con fecha de hoy.
--   6. No validaba que el cliente fuera de la organizacion.
--
-- Ahora, en la misma transaccion:
--   - Rechaza (P0021) las ventas que no se pueden editar.
--   - El nuevo total no puede ser menor a lo cobrado; con saldo pendiente el
--     cliente no se puede cambiar (la deuda esta en su cuenta).
--   - Recalcula estado_pago y ajusta la deuda del cliente por la diferencia
--     (movimiento CARGO, que la anulacion de la venta revierte junto al resto).
--   - Conserva el costo y el numero de garantia de los productos que siguen,
--     y las garantias arrancan en la fecha de la venta.
--   - Descuenta del deposito de la sucursal de la venta.
--
-- Misma firma que la 253: es seguro aplicar antes o despues del deploy (la
-- ruta valida lo mismo y, sin esta migracion, recalcula estado_pago y la
-- deuda ella misma).

CREATE OR REPLACE FUNCTION editar_venta_atomica(
  p_org_id TEXT,
  p_user_id TEXT,
  p_venta_id TEXT,
  p_cliente_id TEXT,
  p_cliente_nombre TEXT,
  p_cliente_telefono TEXT,
  p_subtotal DECIMAL,
  p_descuento DECIMAL,
  p_tipo_descuento TEXT,
  p_porcentaje_descuento DECIMAL,
  p_total DECIMAL,
  p_metodo_pago TEXT,
  p_observaciones TEXT,
  p_items JSONB,
  p_deposito_id TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_venta ventas%ROWTYPE;
  v_old_item RECORD;
  v_item JSONB;
  v_item_id TEXT;
  v_inv_stock INTEGER;
  v_inv_nombre TEXT;
  v_inv_costo DECIMAL;
  v_garantia_numero TEXT;
  v_metodo metodo_pago_venta;
  v_garantias JSONB := '[]'::JSONB;
  v_deposito_efectivo TEXT;
  v_dep_origen TEXT;
  v_dep_objetivo TEXT;
  v_inv_id TEXT;
  v_req_total INTEGER;
  v_cliente_id TEXT;
  v_abonado DECIMAL;
  v_pend_old DECIMAL;
  v_pend_new DECIMAL;
  v_delta DECIMAL;
  v_estado_pago TEXT;
  v_saldo DECIMAL;
  v_nuevo_saldo DECIMAL;
  v_clave TEXT;
  v_costos JSONB;
  v_numeros JSONB;
  v_lista JSONB;
BEGIN
  v_metodo := p_metodo_pago::metodo_pago_venta;
  v_cliente_id := NULLIF(p_cliente_id, '');

  SELECT * INTO v_venta
  FROM ventas
  WHERE id = p_venta_id AND organization_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venta no encontrada: %', p_venta_id;
  END IF;

  IF v_venta.estado::text = 'ANULADA' THEN
    RAISE EXCEPTION 'No se puede editar una venta anulada';
  END IF;

  -- ------------------------------------------------------------------
  -- 1. Lo que impide editar (mismo orden y textos que lib/ventas/bloqueos.ts)
  -- ------------------------------------------------------------------
  IF EXISTS (SELECT 1 FROM comprobantes_fiscales
             WHERE venta_id = p_venta_id AND estado IN ('pendiente', 'emitido')) THEN
    RAISE EXCEPTION 'VENTA_NO_EDITABLE: La venta tiene una factura electrónica emitida.'
      USING ERRCODE = 'P0021';
  END IF;
  IF EXISTS (SELECT 1 FROM facturas WHERE venta_id = p_venta_id) THEN
    RAISE EXCEPTION 'VENTA_NO_EDITABLE: La venta tiene un remito generado.'
      USING ERRCODE = 'P0021';
  END IF;
  IF EXISTS (SELECT 1 FROM devoluciones_venta WHERE venta_id = p_venta_id) THEN
    RAISE EXCEPTION 'VENTA_NO_EDITABLE: La venta tiene devoluciones registradas.'
      USING ERRCODE = 'P0021';
  END IF;
  IF EXISTS (SELECT 1 FROM notas_credito WHERE venta_id = p_venta_id AND NOT anulada) THEN
    RAISE EXCEPTION 'VENTA_NO_EDITABLE: La venta tiene una nota de crédito.'
      USING ERRCODE = 'P0021';
  END IF;
  IF COALESCE(v_venta.comision_pagada, false) THEN
    RAISE EXCEPTION 'VENTA_NO_EDITABLE: La comisión de esta venta ya se liquidó al vendedor.'
      USING ERRCODE = 'P0021';
  END IF;
  IF EXISTS (SELECT 1 FROM inventario_series WHERE venta_id = p_venta_id) THEN
    RAISE EXCEPTION 'VENTA_NO_EDITABLE: La venta tiene productos con número de serie.'
      USING ERRCODE = 'P0021';
  END IF;

  -- Los productos con numero de serie se venden desde el POS, que asigna las
  -- series; esta funcion no las maneja.
  SELECT i.nombre INTO v_inv_nombre
  FROM jsonb_array_elements(p_items) AS it
  JOIN inventario i ON i.id = (it->>'inventarioId')
  WHERE i.organization_id = p_org_id AND COALESCE(i.trackea_series, false)
  LIMIT 1;
  IF v_inv_nombre IS NOT NULL THEN
    RAISE EXCEPTION 'VENTA_NO_EDITABLE: "%" tiene número de serie: vendelo desde el POS.', v_inv_nombre
      USING ERRCODE = 'P0021';
  END IF;

  IF v_cliente_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM clientes WHERE id = v_cliente_id AND organization_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'Cliente no encontrado';
  END IF;

  -- ------------------------------------------------------------------
  -- 2. Cobros: lo cobrado no cambia; el saldo pendiente se recalcula
  -- ------------------------------------------------------------------
  v_abonado := COALESCE(v_venta.monto_abonado, 0);
  IF p_total < v_abonado THEN
    RAISE EXCEPTION 'VENTA_NO_EDITABLE: El nuevo total (%) es menor a lo ya cobrado (%). Para devolver dinero registrá una devolución.',
      ROUND(p_total::NUMERIC, 2), ROUND(v_abonado::NUMERIC, 2)
      USING ERRCODE = 'P0021';
  END IF;
  v_pend_old := GREATEST(v_venta.total - v_abonado, 0);
  v_pend_new := GREATEST(p_total - v_abonado, 0);

  IF v_pend_old > 0 AND v_venta.cliente_id IS NOT NULL
     AND v_cliente_id IS DISTINCT FROM v_venta.cliente_id THEN
    RAISE EXCEPTION 'VENTA_NO_EDITABLE: La venta tiene saldo pendiente en la cuenta del cliente: no se puede cambiar el cliente.'
      USING ERRCODE = 'P0021';
  END IF;

  v_estado_pago := CASE
    WHEN v_abonado >= p_total THEN 'PAGADO'
    WHEN v_abonado > 0 THEN 'PAGADO_PARCIAL'
    ELSE 'PENDIENTE'
  END;

  -- ------------------------------------------------------------------
  -- 3. Lo que se conserva de los items viejos: costo y numero de garantia,
  --    por producto (o por descripcion si es un item libre).
  -- ------------------------------------------------------------------
  SELECT COALESCE(jsonb_object_agg(clave, costo), '{}'::JSONB) INTO v_costos
  FROM (
    SELECT DISTINCT ON (1)
      COALESCE(iv.inventario_id, 'desc:' || lower(COALESCE(iv.descripcion, ''))) AS clave,
      iv.costo_unitario_snapshot AS costo
    FROM items_venta iv
    WHERE iv.venta_id = p_venta_id AND iv.costo_unitario_snapshot IS NOT NULL
    ORDER BY 1, iv.id
  ) c;

  SELECT COALESCE(jsonb_object_agg(clave, numeros), '{}'::JSONB) INTO v_numeros
  FROM (
    SELECT COALESCE(iv.inventario_id, 'desc:' || lower(COALESCE(iv.descripcion, ''))) AS clave,
           jsonb_agg(g.numero_garantia ORDER BY g.created_at, g.numero_garantia) AS numeros
    FROM garantias_venta g
    JOIN items_venta iv ON iv.id = g.item_venta_id
    WHERE g.venta_id = p_venta_id
    GROUP BY 1
  ) n;

  -- ------------------------------------------------------------------
  -- 4. Devolver el stock de los items viejos al deposito del que salieron
  -- ------------------------------------------------------------------
  FOR v_old_item IN
    SELECT iv.inventario_id, iv.cantidad, i.stock
    FROM items_venta iv
    LEFT JOIN inventario i ON i.id = iv.inventario_id
    WHERE iv.venta_id = p_venta_id AND iv.inventario_id IS NOT NULL
  LOOP
    SELECT m.deposito_id INTO v_dep_origen
    FROM movimientos_inventario m
    WHERE m.referencia_id = p_venta_id AND m.tipo = 'VENTA'
      AND m.inventario_id = v_old_item.inventario_id
    ORDER BY m.created_at DESC LIMIT 1;

    INSERT INTO movimientos_inventario (
      inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
      referencia_id, referencia_tipo, usuario_id, organization_id, observaciones,
      deposito_id
    ) VALUES (
      v_old_item.inventario_id, 'ANULACION', v_old_item.cantidad,
      v_old_item.stock, v_old_item.stock + v_old_item.cantidad,
      p_venta_id, 'EDICION_VENTA', p_user_id, p_org_id,
      'Restauración por edición de venta',
      v_dep_origen
    );

    UPDATE inventario SET stock = stock + v_old_item.cantidad
    WHERE id = v_old_item.inventario_id;

    PERFORM incrementar_stock_deposito(
      v_old_item.inventario_id, p_org_id, v_dep_origen, v_old_item.cantidad);
  END LOOP;

  DELETE FROM garantias_venta WHERE venta_id = p_venta_id;
  DELETE FROM items_venta WHERE venta_id = p_venta_id;

  -- ------------------------------------------------------------------
  -- 5. Cabecera
  -- ------------------------------------------------------------------
  UPDATE ventas SET
    cliente_id = v_cliente_id,
    cliente_nombre = p_cliente_nombre,
    cliente_telefono = NULLIF(p_cliente_telefono, ''),
    subtotal = p_subtotal,
    descuento = p_descuento,
    tipo_descuento = COALESCE(p_tipo_descuento, 'MONTO'),
    porcentaje_descuento = COALESCE(p_porcentaje_descuento, 0),
    total = p_total,
    metodo_pago = v_metodo,
    estado_pago = v_estado_pago,
    observaciones = NULLIF(p_observaciones, ''),
    updated_at = NOW()
  WHERE id = p_venta_id AND organization_id = p_org_id;

  -- ------------------------------------------------------------------
  -- 6. Stock de los items nuevos (acumulado por producto)
  -- ------------------------------------------------------------------
  v_dep_objetivo := COALESCE(p_deposito_id, get_deposito_de_sucursal(v_venta.sucursal_id));

  FOR v_inv_id, v_req_total IN
    SELECT (it->>'inventarioId'),
           SUM((it->>'cantidad')::INTEGER)
    FROM jsonb_array_elements(p_items) AS it
    WHERE (it->>'inventarioId') IS NOT NULL AND (it->>'inventarioId') != ''
    GROUP BY (it->>'inventarioId')
  LOOP
    SELECT stock, nombre INTO v_inv_stock, v_inv_nombre
    FROM inventario
    WHERE id = v_inv_id
      AND organization_id = p_org_id
      AND deleted_at IS NULL
    FOR UPDATE;

    IF v_inv_stock IS NULL THEN
      RAISE EXCEPTION 'Producto no encontrado: %', v_inv_id;
    END IF;

    IF v_inv_stock < v_req_total THEN
      RAISE EXCEPTION 'Stock insuficiente para "%". Disponible: %, solicitado: %',
        v_inv_nombre, v_inv_stock, v_req_total
        USING ERRCODE = 'P0003';
    END IF;
  END LOOP;

  -- ------------------------------------------------------------------
  -- 7. Items nuevos, movimientos y garantias
  -- ------------------------------------------------------------------
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_clave := COALESCE(NULLIF(v_item->>'inventarioId', ''), 'desc:' || lower(COALESCE(v_item->>'descripcion', '')));

    v_inv_costo := (v_costos->>v_clave)::DECIMAL;
    IF v_inv_costo IS NULL AND NULLIF(v_item->>'inventarioId', '') IS NOT NULL THEN
      SELECT precio_compra INTO v_inv_costo
      FROM inventario WHERE id = (v_item->>'inventarioId');
    END IF;

    INSERT INTO items_venta (
      venta_id, inventario_id, descripcion, cantidad, precio_unitario, subtotal,
      dias_garantia, descuento, tipo_descuento, porcentaje_descuento,
      costo_unitario_snapshot
    ) VALUES (
      p_venta_id,
      NULLIF(v_item->>'inventarioId', ''),
      v_item->>'descripcion',
      (v_item->>'cantidad')::INTEGER,
      (v_item->>'precioUnitario')::DECIMAL,
      (v_item->>'cantidad')::INTEGER * (v_item->>'precioUnitario')::DECIMAL,
      COALESCE((v_item->>'diasGarantia')::INTEGER, 0),
      COALESCE((v_item->>'descuento')::DECIMAL, 0),
      COALESCE(v_item->>'tipoDescuento', 'MONTO'),
      COALESCE((v_item->>'porcentajeDescuento')::DECIMAL, 0),
      v_inv_costo
    ) RETURNING id INTO v_item_id;

    IF NULLIF(v_item->>'inventarioId', '') IS NOT NULL THEN
      INSERT INTO movimientos_inventario (
        inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
        referencia_id, referencia_tipo, usuario_id, organization_id,
        deposito_id
      )
      SELECT
        (v_item->>'inventarioId'), 'VENTA', -(v_item->>'cantidad')::INTEGER,
        stock, stock - (v_item->>'cantidad')::INTEGER,
        p_venta_id, 'VENTA', p_user_id, p_org_id,
        NULL
      FROM inventario WHERE id = (v_item->>'inventarioId');

      UPDATE inventario SET stock = stock - (v_item->>'cantidad')::INTEGER
      WHERE id = (v_item->>'inventarioId');

      v_deposito_efectivo := descontar_stock_deposito(
        (v_item->>'inventarioId'), p_org_id, v_dep_objetivo,
        (v_item->>'cantidad')::INTEGER,
        p_deposito_id IS NOT NULL);

      UPDATE movimientos_inventario
      SET deposito_id = v_deposito_efectivo
      WHERE referencia_id = p_venta_id
        AND inventario_id = (v_item->>'inventarioId')
        AND tipo = 'VENTA'
        AND deposito_id IS NULL;
    END IF;

    IF COALESCE((v_item->>'diasGarantia')::INTEGER, 0) > 0 THEN
      v_lista := v_numeros->v_clave;
      IF v_lista IS NOT NULL AND jsonb_array_length(v_lista) > 0 THEN
        v_garantia_numero := v_lista->>0;
        v_numeros := jsonb_set(v_numeros, ARRAY[v_clave], v_lista - 0);
      ELSE
        SELECT get_next_warranty_sale_number(p_org_id) INTO v_garantia_numero;
      END IF;

      INSERT INTO garantias_venta (
        venta_id, item_venta_id, numero_garantia, dias_validez,
        fecha_inicio, fecha_vencimiento, organization_id
      ) VALUES (
        p_venta_id, v_item_id, v_garantia_numero,
        (v_item->>'diasGarantia')::INTEGER,
        v_venta.created_at,
        v_venta.created_at + ((v_item->>'diasGarantia')::INTEGER || ' days')::INTERVAL,
        p_org_id
      );

      v_garantias := v_garantias || jsonb_build_object(
        'numero', v_garantia_numero,
        'itemId', v_item_id,
        'diasValidez', (v_item->>'diasGarantia')::INTEGER
      );
    END IF;
  END LOOP;

  -- ------------------------------------------------------------------
  -- 8. Deuda del cliente. Mismo cliente: la diferencia de saldo pendiente.
  --    Cliente nuevo (la venta no tenia deuda en ninguna cuenta, ver el
  --    control del paso 2): todo el saldo pendiente.
  -- ------------------------------------------------------------------
  v_delta := 0;
  IF v_cliente_id IS NOT NULL THEN
    v_delta := CASE
      WHEN v_venta.cliente_id IS NOT DISTINCT FROM v_cliente_id THEN v_pend_new - v_pend_old
      ELSE v_pend_new
    END;
  END IF;
  IF v_delta <> 0 THEN
    SELECT saldo_cuenta INTO v_saldo
    FROM clientes WHERE id = v_cliente_id AND organization_id = p_org_id
    FOR UPDATE;

    v_nuevo_saldo := COALESCE(v_saldo, 0) - v_delta;

    INSERT INTO cuenta_corriente (
      organization_id, cliente_id, tipo, monto, saldo_posterior,
      referencia_tipo, referencia_id, usuario_id, observaciones,
      sucursal_id
    ) VALUES (
      p_org_id, v_cliente_id, 'CARGO', -v_delta, v_nuevo_saldo,
      'VENTA', p_venta_id, p_user_id,
      'Ajuste por edición de la venta',
      v_venta.sucursal_id
    );

    UPDATE clientes SET saldo_cuenta = v_nuevo_saldo WHERE id = v_cliente_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'garantias', v_garantias,
    'estadoPago', v_estado_pago,
    'montoAbonado', v_abonado,
    'ajusteCuentaCorriente', v_delta
  );
END;
$$ LANGUAGE plpgsql;
