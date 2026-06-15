-- ========================================
-- Migration 223: venta con saldo pendiente genera deuda en cuenta corriente
-- ========================================
-- Cuando una venta tiene cliente_id y total > monto_abonado, registra el
-- pendiente como deuda en la CC del cliente (saldo_cuenta queda negativo).
-- La anulacion de la venta revierte la deuda (movimiento AJUSTE positivo).
--
-- Partes:
--   A. RPC cargar_deuda_cuenta_corriente — espeja usar_cuenta_corriente
--      pero SIN validacion de saldo (permite negativo).
--   B. crear_venta_atomica — CREATE OR REPLACE con firma IDENTICA a mig 222
--      (21 params). Agrega el hook de deuda justo antes del RETURN final.
--   C. restore_stock_on_cancel — CREATE OR REPLACE (trigger). Agrega la
--      reversa de deuda cuando la venta se anula.
-- ========================================

-- ============================================================
-- A. RPC cargar_deuda_cuenta_corriente
-- ============================================================
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

  -- No se valida saldo minimo: la deuda puede dejar el saldo negativo.
  v_nuevo_saldo := COALESCE(v_saldo_actual, 0) - p_monto;

  INSERT INTO cuenta_corriente (
    organization_id, cliente_id, tipo, monto, saldo_posterior,
    referencia_tipo, referencia_id, usuario_id, observaciones
  ) VALUES (
    p_org_id, p_cliente_id, 'USO', -p_monto, v_nuevo_saldo,
    p_referencia_tipo, p_referencia_id, p_usuario_id,
    'Venta a cuenta corriente (saldo pendiente)'
  ) RETURNING id INTO v_mov_id;

  UPDATE clientes SET saldo_cuenta = v_nuevo_saldo WHERE id = p_cliente_id;

  RETURN jsonb_build_object(
    'id', v_mov_id,
    'saldoAnterior', v_saldo_actual,
    'saldoNuevo', v_nuevo_saldo
  );
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- B. crear_venta_atomica — firma IDENTICA a mig 222 (21 params)
--    Cuerpo verbatim de mig 222 + hook de deuda antes del RETURN.
-- ============================================================
CREATE OR REPLACE FUNCTION crear_venta_atomica(
  p_org_id TEXT,
  p_vendedor_id TEXT,
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
  p_numero_referencia TEXT,
  p_cuotas INTEGER,
  p_recargo_porcentaje DECIMAL,
  p_monto_original DECIMAL,
  p_items JSONB,
  p_pagos JSONB DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL,
  p_deposito_id TEXT DEFAULT NULL,
  p_sucursal_id TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_venta_id TEXT;
  v_numero_venta INTEGER;
  v_item JSONB;
  v_pago JSONB;
  v_item_id TEXT;
  v_inv_stock INTEGER;
  v_inv_nombre TEXT;
  v_inv_costo DECIMAL;
  v_garantia_numero TEXT;
  v_garantias JSONB := '[]'::JSONB;
  v_items_ids JSONB := '[]'::JSONB;
  v_metodo metodo_pago_venta;
  v_total_pagos DECIMAL := 0;
  v_monto_abonado DECIMAL;
  v_estado_pago TEXT;
  v_cc_result JSONB;
  v_total_costo_mercaderia DECIMAL := 0;
  v_inv_id TEXT;
  v_req_total INTEGER;
  v_rows INTEGER;
  v_trackea_series BOOLEAN;
  v_serie_ids_in JSONB;
  v_serie_ids_out TEXT[];
  v_dias_garantia INTEGER;
  v_deposito_efectivo TEXT;
  -- Fase 5: deposito a usar cuando no se pasa uno explicito = principal de la sucursal
  v_dep_objetivo TEXT;
BEGIN
  v_metodo := p_metodo_pago::metodo_pago_venta;

  -- Resolver el deposito objetivo: explicito, o el principal de la sucursal.
  v_dep_objetivo := COALESCE(p_deposito_id, get_deposito_de_sucursal(p_sucursal_id));

  SELECT get_next_sale_number(p_org_id) INTO v_numero_venta;

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

  IF p_pagos IS NOT NULL AND jsonb_array_length(p_pagos) > 0 THEN
    SELECT COALESCE(SUM((p->>'monto')::DECIMAL), 0) INTO v_total_pagos
    FROM jsonb_array_elements(p_pagos) AS p;
    v_monto_abonado := v_total_pagos;
  ELSIF p_pagos IS NOT NULL THEN
    v_monto_abonado := 0;
  ELSE
    v_monto_abonado := p_total;
  END IF;

  IF v_monto_abonado >= p_total THEN
    v_estado_pago := 'PAGADO';
  ELSIF v_monto_abonado > 0 THEN
    v_estado_pago := 'PAGADO_PARCIAL';
  ELSE
    v_estado_pago := 'PENDIENTE';
  END IF;

  INSERT INTO ventas (
    numero_venta, cliente_id, cliente_nombre, cliente_telefono,
    vendedor_id, subtotal, descuento, tipo_descuento, porcentaje_descuento,
    total, metodo_pago, monto_abonado, estado_pago, observaciones, organization_id,
    idempotency_key, sucursal_id
  ) VALUES (
    v_numero_venta,
    NULLIF(p_cliente_id, ''),
    p_cliente_nombre,
    NULLIF(p_cliente_telefono, ''),
    p_vendedor_id,
    p_subtotal,
    p_descuento,
    COALESCE(p_tipo_descuento, 'MONTO'),
    COALESCE(p_porcentaje_descuento, 0),
    p_total,
    v_metodo,
    v_monto_abonado,
    v_estado_pago,
    NULLIF(p_observaciones, ''),
    p_org_id,
    NULLIF(p_idempotency_key, ''),
    p_sucursal_id
  ) RETURNING id INTO v_venta_id;

  IF p_pagos IS NOT NULL AND jsonb_array_length(p_pagos) > 0 THEN
    FOR v_pago IN SELECT * FROM jsonb_array_elements(p_pagos)
    LOOP
      IF (v_pago->>'metodo') = 'CUENTA_CORRIENTE' AND p_cliente_id IS NOT NULL AND p_cliente_id != '' THEN
        SELECT usar_cuenta_corriente(
          p_org_id,
          p_cliente_id,
          (v_pago->>'monto')::DECIMAL,
          'VENTA',
          v_venta_id,
          p_vendedor_id
        ) INTO v_cc_result;
      END IF;

      INSERT INTO pagos_venta (venta_id, monto, metodo_pago, numero_referencia, cuotas, recargo_porcentaje, monto_original)
      VALUES (
        v_venta_id,
        (v_pago->>'monto')::DECIMAL,
        (v_pago->>'metodo')::metodo_pago_venta,
        NULLIF(v_pago->>'referencia', ''),
        (v_pago->>'cuotas')::INTEGER,
        (v_pago->>'recargo')::DECIMAL,
        (v_pago->>'montoOriginal')::DECIMAL
      );
    END LOOP;
  ELSIF p_pagos IS NULL THEN
    INSERT INTO pagos_venta (venta_id, monto, metodo_pago, numero_referencia, cuotas, recargo_porcentaje, monto_original)
    VALUES (
      v_venta_id,
      p_total,
      v_metodo,
      NULLIF(p_numero_referencia, ''),
      p_cuotas,
      p_recargo_porcentaje,
      p_monto_original
    );
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_inv_costo := NULL;
    IF (v_item->>'inventarioId') IS NOT NULL AND (v_item->>'inventarioId') != '' THEN
      SELECT precio_compra INTO v_inv_costo
      FROM inventario
      WHERE id = (v_item->>'inventarioId');
    END IF;

    IF v_inv_costo IS NULL AND (v_item ? 'costo') AND (v_item->>'costo') IS NOT NULL THEN
      v_inv_costo := (v_item->>'costo')::DECIMAL;
    END IF;

    INSERT INTO items_venta (
      venta_id, inventario_id, descripcion, cantidad, precio_unitario, subtotal,
      dias_garantia, descuento, tipo_descuento, porcentaje_descuento,
      costo_unitario_snapshot
    ) VALUES (
      v_venta_id,
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

    v_items_ids := v_items_ids || to_jsonb(v_item_id);

    IF v_inv_costo IS NOT NULL THEN
      v_total_costo_mercaderia := v_total_costo_mercaderia + (v_inv_costo * (v_item->>'cantidad')::INTEGER);
    END IF;

    IF (v_item->>'inventarioId') IS NOT NULL AND (v_item->>'inventarioId') != '' THEN
      INSERT INTO movimientos_inventario (
        inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
        referencia_id, referencia_tipo, usuario_id, organization_id,
        deposito_id
      )
      SELECT
        (v_item->>'inventarioId'),
        'VENTA',
        -(v_item->>'cantidad')::INTEGER,
        stock,
        stock - (v_item->>'cantidad')::INTEGER,
        v_venta_id,
        'VENTA',
        p_vendedor_id,
        p_org_id,
        NULL
      FROM inventario WHERE id = (v_item->>'inventarioId');

      UPDATE inventario
      SET stock = stock - (v_item->>'cantidad')::INTEGER
      WHERE id = (v_item->>'inventarioId')
        AND stock >= (v_item->>'cantidad')::INTEGER;

      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows = 0 THEN
        RAISE EXCEPTION 'Stock insuficiente al descontar item "%"', v_item->>'descripcion'
          USING ERRCODE = 'P0003';
      END IF;

      -- Fase 5: usar el deposito objetivo resuelto (explicito o principal de sucursal).
      v_deposito_efectivo := descontar_stock_deposito(
        (v_item->>'inventarioId'), p_org_id, v_dep_objetivo,
        (v_item->>'cantidad')::INTEGER,
        p_deposito_id IS NOT NULL);

      UPDATE movimientos_inventario
      SET deposito_id = v_deposito_efectivo
      WHERE referencia_id = v_venta_id
        AND inventario_id = (v_item->>'inventarioId')
        AND tipo = 'VENTA'
        AND deposito_id IS NULL;
    END IF;

    IF (v_item->>'inventarioId') IS NOT NULL AND (v_item->>'inventarioId') != '' THEN
      SELECT trackea_series INTO v_trackea_series
      FROM inventario WHERE id = (v_item->>'inventarioId');

      IF COALESCE(v_trackea_series, false) THEN
        v_dias_garantia := COALESCE((v_item->>'diasGarantia')::INTEGER, 0);
        v_serie_ids_in := v_item->'serieIds';
        v_serie_ids_out := ARRAY[]::TEXT[];

        IF v_serie_ids_in IS NOT NULL AND jsonb_typeof(v_serie_ids_in) = 'array'
           AND jsonb_array_length(v_serie_ids_in) > 0 THEN
          IF jsonb_array_length(v_serie_ids_in) <> (v_item->>'cantidad')::INTEGER THEN
            RAISE EXCEPTION 'Cantidad de series (%) no coincide con cantidad del item "%" (%)',
              jsonb_array_length(v_serie_ids_in), v_item->>'descripcion', v_item->>'cantidad'
              USING ERRCODE = '22023';
          END IF;

          SELECT array_agg(s.id) INTO v_serie_ids_out
          FROM inventario_series s
          WHERE s.id IN (SELECT jsonb_array_elements_text(v_serie_ids_in))
            AND s.inventario_id = (v_item->>'inventarioId')
            AND s.organization_id = p_org_id
            AND s.estado = 'DISPONIBLE'
          FOR UPDATE;

          IF v_serie_ids_out IS NULL
             OR array_length(v_serie_ids_out, 1) <> (v_item->>'cantidad')::INTEGER THEN
            RAISE EXCEPTION 'Series seleccionadas invalidas o no disponibles para "%"',
              v_item->>'descripcion'
              USING ERRCODE = 'P0003';
          END IF;
        ELSE
          SELECT array_agg(s.id) INTO v_serie_ids_out
          FROM (
            SELECT id FROM inventario_series
            WHERE inventario_id = (v_item->>'inventarioId')
              AND organization_id = p_org_id
              AND estado = 'DISPONIBLE'
            ORDER BY created_at ASC
            LIMIT (v_item->>'cantidad')::INTEGER
            FOR UPDATE
          ) s;

          IF v_serie_ids_out IS NULL
             OR array_length(v_serie_ids_out, 1) <> (v_item->>'cantidad')::INTEGER THEN
            RAISE EXCEPTION 'Producto serializado "%" sin series suficientes disponibles (necesita %)',
              v_item->>'descripcion', v_item->>'cantidad'
              USING ERRCODE = 'P0003';
          END IF;
        END IF;

        UPDATE inventario_series
          SET estado = CASE WHEN v_dias_garantia > 0 THEN 'GARANTIA_ACTIVA' ELSE 'VENDIDO' END,
              venta_id = v_venta_id,
              cliente_id = NULLIF(p_cliente_id, ''),
              fecha_venta = NOW(),
              fecha_garantia_vence = CASE
                WHEN v_dias_garantia > 0 THEN CURRENT_DATE + v_dias_garantia
                ELSE fecha_garantia_vence END,
              updated_at = NOW()
          WHERE id = ANY(v_serie_ids_out);

        UPDATE movimientos_inventario
          SET serie_ids = v_serie_ids_out
          WHERE referencia_id = v_venta_id
            AND inventario_id = (v_item->>'inventarioId')
            AND tipo = 'VENTA';
      END IF;
    END IF;

    IF COALESCE((v_item->>'diasGarantia')::INTEGER, 0) > 0 THEN
      SELECT get_next_warranty_sale_number(p_org_id) INTO v_garantia_numero;

      INSERT INTO garantias_venta (
        venta_id, item_venta_id, numero_garantia, dias_validez,
        fecha_inicio, fecha_vencimiento, organization_id
      ) VALUES (
        v_venta_id, v_item_id, v_garantia_numero,
        (v_item->>'diasGarantia')::INTEGER,
        NOW(),
        NOW() + ((v_item->>'diasGarantia')::INTEGER || ' days')::INTERVAL,
        p_org_id
      );

      v_garantias := v_garantias || jsonb_build_object(
        'numero', v_garantia_numero,
        'itemId', v_item_id,
        'diasValidez', (v_item->>'diasGarantia')::INTEGER
      );
    END IF;
  END LOOP;

  IF v_total_costo_mercaderia > 0 THEN
    INSERT INTO movimientos_caja (
      organization_id, tipo, monto, metodo_pago, concepto,
      observaciones, usuario_id, fecha, afecta_rentabilidad, sucursal_id
    ) VALUES (
      p_org_id,
      'EGRESO',
      v_total_costo_mercaderia,
      'EFECTIVO',
      'Costo de mercaderia - Venta #' || v_numero_venta,
      'Egreso automatico por costo de productos vendidos',
      p_vendedor_id,
      NOW(),
      FALSE,
      p_sucursal_id
    );
  END IF;

  -- Saldo pendiente -> deuda en cuenta corriente del cliente
  IF p_cliente_id IS NOT NULL AND p_cliente_id != '' AND (p_total - v_monto_abonado) > 0 THEN
    PERFORM cargar_deuda_cuenta_corriente(
      p_org_id, p_cliente_id, (p_total - v_monto_abonado),
      'VENTA', v_venta_id, p_vendedor_id);
  END IF;

  RETURN jsonb_build_object(
    'ventaId', v_venta_id,
    'numeroVenta', v_numero_venta,
    'garantias', v_garantias,
    'items', v_items_ids
  );
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- C. restore_stock_on_cancel — firma sin argumentos (TRIGGER),
--    verbatim de mig 206 + reversa de deuda en anulacion.
-- ============================================================
CREATE OR REPLACE FUNCTION restore_stock_on_cancel()
RETURNS TRIGGER AS $$
DECLARE
  v_item RECORD;
  v_dep_origen TEXT;
  v_saldo DECIMAL;
  v_nuevo DECIMAL;
BEGIN
  IF OLD.estado = 'COMPLETADA' AND NEW.estado = 'ANULADA' THEN
    FOR v_item IN
      SELECT iv.inventario_id, iv.cantidad, i.stock
      FROM items_venta iv
      JOIN inventario i ON i.id = iv.inventario_id
      WHERE iv.venta_id = NEW.id AND iv.inventario_id IS NOT NULL
    LOOP
      -- Look up which deposit the original VENTA movement used for this item.
      SELECT m.deposito_id INTO v_dep_origen
      FROM movimientos_inventario m
      WHERE m.referencia_id = NEW.id AND m.tipo = 'VENTA'
        AND m.inventario_id = v_item.inventario_id
      ORDER BY m.created_at DESC LIMIT 1;

      -- Record movement
      INSERT INTO movimientos_inventario (
        inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
        referencia_id, referencia_tipo, organization_id,
        deposito_id
      ) VALUES (
        v_item.inventario_id, 'ANULACION', v_item.cantidad,
        v_item.stock, v_item.stock + v_item.cantidad,
        NEW.id, 'ANULACION_VENTA', NEW.organization_id,
        v_dep_origen
      );

      -- Restore aggregate stock
      UPDATE inventario SET stock = stock + v_item.cantidad
      WHERE id = v_item.inventario_id;

      -- Dual-write: restore per-deposit stock to the same deposit it was taken from.
      PERFORM incrementar_stock_deposito(
        v_item.inventario_id, NEW.organization_id, v_dep_origen, v_item.cantidad);
    END LOOP;

    -- Revertir deuda en cuenta corriente si la venta tenia saldo pendiente
    IF NEW.cliente_id IS NOT NULL AND (NEW.total - NEW.monto_abonado) > 0 THEN
      SELECT saldo_cuenta INTO v_saldo
      FROM clientes
      WHERE id = NEW.cliente_id
      FOR UPDATE;

      IF v_saldo IS NOT NULL THEN
        v_nuevo := COALESCE(v_saldo, 0) + (NEW.total - NEW.monto_abonado);

        INSERT INTO cuenta_corriente (
          organization_id, cliente_id, tipo, monto, saldo_posterior,
          referencia_tipo, referencia_id, observaciones
        ) VALUES (
          NEW.organization_id, NEW.cliente_id, 'AJUSTE',
          (NEW.total - NEW.monto_abonado), v_nuevo,
          'VENTA', NEW.id,
          'Anulacion de venta a cuenta corriente'
        );

        UPDATE clientes SET saldo_cuenta = v_nuevo WHERE id = NEW.cliente_id;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
