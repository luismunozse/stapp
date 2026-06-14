-- ========================================
-- Migration 222: auto-resolver depósito desde la sucursal (Fase 5 wiring)
-- ========================================
-- Hasta ahora, cuando p_deposito_id era NULL, las RPCs de stock caían al
-- depósito principal de la ORG (get_deposito_principal vía las helpers). Con el
-- modelo principal-por-sucursal (mig 221), una venta/orden en la Sucursal B
-- debe descontar del depósito de B, no del de Casa Central.
--
-- FIX: cuando NO se pasa depósito explícito, resolver el depósito principal de
-- la sucursal correspondiente vía get_deposito_de_sucursal():
--   - crear_venta_atomica  → sucursal = p_sucursal_id
--   - add_repuesto_inventario → sucursal = ordenes_servicio.sucursal_id de la orden
--   - consumir_reservas_orden / liberar_reservas_orden → idem
--
-- Bodies LIVE verbatim (de pg_get_functiondef en prod); único cambio = el
-- depósito efectivo pasado a las helpers (COALESCE(p_deposito_id,
-- get_deposito_de_sucursal(<sucursal>))). El flag strict se mantiene en
-- (p_deposito_id IS NOT NULL): explícito = estricto; auto = drain con fallback,
-- para no romper ventas si la distribución por depósito no alcanza.
--
-- registrar_devolucion_stock NO se incluye (gap #5): requiere el venta_id que
-- la ruta no pasa hoy → va en un PR aparte (RPC + edición de ruta).
--
-- CONSISTENCIA DE RESERVAS: el depósito donde se reserva un repuesto se PERSISTE
-- en repuestos_orden.deposito_id, para que consumir/liberar liberen del MISMO
-- depósito (no recalculen, lo que causaría liberar del depósito equivocado si el
-- principal de la sucursal cambió o si hubo fallback). Reservas viejas sin
-- deposito_id se backfillean al principal de la org (donde se reservaron).
-- ========================================

-- 0. Columna para recordar el depósito donde se reservó cada repuesto.
ALTER TABLE repuestos_orden ADD COLUMN IF NOT EXISTS deposito_id TEXT REFERENCES depositos(id);

-- 0b. Backfill: reservas existentes se hicieron contra el principal de la ORG
--     (comportamiento pre-Fase 5). Setear deposito_id a ese, para que consumir/
--     liberar las cierren en el depósito correcto.
UPDATE repuestos_orden ro
SET deposito_id = get_deposito_principal(os.organization_id)
FROM ordenes_servicio os
WHERE ro.orden_id = os.id
  AND ro.deposito_id IS NULL
  AND ro.inventario_id IS NOT NULL;

-- ============================================================
-- 1. crear_venta_atomica — resolver depósito desde p_sucursal_id
--    (base: mig 218, firma 21 params terminando en p_deposito_id, p_sucursal_id)
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
  -- Fase 5: depósito a usar cuando no se pasa uno explícito = principal de la sucursal
  v_dep_objetivo TEXT;
BEGIN
  v_metodo := p_metodo_pago::metodo_pago_venta;

  -- Resolver el depósito objetivo: explícito, o el principal de la sucursal.
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

      -- Fase 5: usar el depósito objetivo resuelto (explícito o principal de sucursal).
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
            RAISE EXCEPTION 'Series seleccionadas inválidas o no disponibles para "%"',
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
      'Costo de mercadería - Venta #' || v_numero_venta,
      'Egreso automático por costo de productos vendidos',
      p_vendedor_id,
      NOW(),
      FALSE,
      p_sucursal_id
    );
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
-- 2. add_repuesto_inventario — resolver depósito desde la sucursal de la orden
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
  v_repuesto_id       TEXT;
  v_org_id            TEXT;
  v_disponible        INTEGER;
  v_deposito_efectivo TEXT;
  v_suc_id            TEXT;
  v_dep_objetivo      TEXT;
BEGIN
  SELECT stock, stock_reservado, precio_compra, organization_id
  INTO v_stock, v_stock_reservado, v_costo, v_org_id
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
  INSERT INTO repuestos_orden (orden_id, inventario_id, cantidad, precio_unitario, deposito_id)
  VALUES (p_orden_id, p_inventario_id, p_cantidad, COALESCE(v_costo, 0), v_deposito_efectivo)
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

-- ============================================================
-- 3. consumir_reservas_orden — resolver depósito desde la sucursal de la orden
--    (base: mig 220)
-- ============================================================
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
  v_suc_id            TEXT;
  v_dep_objetivo      TEXT;
BEGIN
  SELECT organization_id, sucursal_id INTO v_org_id, v_suc_id
  FROM ordenes_servicio WHERE id = p_orden_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada';
  END IF;

  FOR v_rep IN
    SELECT ro.inventario_id, ro.cantidad, ro.deposito_id
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

    -- Depósito: el que se usó al reservar (persistido); explícito si se pasa;
    -- fallback al principal de la sucursal para reservas legacy sin deposito_id.
    v_dep_objetivo := COALESCE(p_deposito_id, v_rep.deposito_id, get_deposito_de_sucursal(v_suc_id));

    UPDATE inventario
    SET stock = stock - v_rep.cantidad,
        stock_reservado = stock_reservado - v_cantidad_reservada
    WHERE id = v_rep.inventario_id;

    v_deposito_efectivo := descontar_stock_deposito(
      v_rep.inventario_id, v_org_id, v_dep_objetivo, v_rep.cantidad,
      v_dep_objetivo IS NOT NULL);
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

-- ============================================================
-- 4. liberar_reservas_orden — resolver depósito desde la sucursal de la orden
--    (base: mig 220)
-- ============================================================
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
  v_suc_id            TEXT;
  v_dep_objetivo      TEXT;
BEGIN
  SELECT organization_id, sucursal_id INTO v_org_id, v_suc_id
  FROM ordenes_servicio WHERE id = p_orden_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada';
  END IF;

  FOR v_rep IN
    SELECT ro.inventario_id, ro.cantidad, ro.deposito_id
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
      -- Liberar del depósito donde realmente se reservó (persistido); fallback
      -- al principal de la sucursal para reservas legacy sin deposito_id.
      v_dep_objetivo := COALESCE(p_deposito_id, v_rep.deposito_id, get_deposito_de_sucursal(v_suc_id));

      UPDATE inventario
      SET stock_reservado = stock_reservado - v_cantidad_liberar
      WHERE id = v_rep.inventario_id;

      v_deposito_efectivo := liberar_reserva_deposito(
        v_rep.inventario_id, v_org_id, v_dep_objetivo, v_cantidad_liberar);

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
