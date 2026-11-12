-- 406: el POS no vende stock reservado.
--
-- PROBLEMA
-- crear_venta_atomica validaba `stock >= solicitado` sin mirar stock_reservado.
-- La reserva la toman las cotizaciones aprobadas (reservar_items_cotizacion),
-- el catalogo publico (reservar_stock_catalogo) y los repuestos asignados a una
-- orden (add_repuesto_inventario / update_repuesto_cantidad). Con stock 3 y 3
-- reservados para una orden, el mostrador podia vender los 3: la orden quedaba
-- esperando un repuesto que ya no estaba y stock_reservado > stock.
--
-- CAMBIO
--   1. crear_venta_atomica: lo vendible es stock - stock_reservado (reservado
--      negativo cuenta como 0). Mismo mensaje y mismo ERRCODE P0003 que antes,
--      con "Disponible" ya neto de reservas. El resto de la funcion queda igual
--      (cuerpo tomado de la definicion en produccion, que es la de la 332).
--   2. convertir_cotizacion_venta_atomica: la cotizacion suelta su propia
--      reserva ANTES de vender, no despues. Si no, con el chequeo nuevo la
--      conversion fallaria por el stock que ella misma aparto. Todo es una sola
--      transaccion: si la venta falla, la liberacion se revierte. Misma firma y
--      mismas llamadas que la 337, solo cambia el orden.
--
-- FUERA DE ALCANCE
--   - El chequeo previo del POS (/api/inventario/check-stock) sigue mirando el
--     stock bruto del deposito: puede decir "hay" y la venta volver con P0003.
--     El mensaje llega tal cual al usuario ("Disponible: N"), asi que se ve por
--     que.
--   - descontar_stock_deposito no se toca: el control fino por deposito sigue
--     igual que antes.
--
-- Re-ejecutable (CREATE OR REPLACE, mismas firmas: no cambian grants ni
-- overloads). Sin BEGIN/COMMIT: db-run.mjs maneja la transaccion.
-- Probes: supabase/migrations/verify/406_probes.sql

CREATE OR REPLACE FUNCTION public.crear_venta_atomica(p_org_id text, p_vendedor_id text, p_cliente_id text, p_cliente_nombre text, p_cliente_telefono text, p_subtotal numeric, p_descuento numeric, p_tipo_descuento text, p_porcentaje_descuento numeric, p_total numeric, p_metodo_pago text, p_observaciones text, p_numero_referencia text, p_cuotas integer, p_recargo_porcentaje numeric, p_monto_original numeric, p_items jsonb, p_pagos jsonb DEFAULT NULL::jsonb, p_idempotency_key text DEFAULT NULL::text, p_deposito_id text DEFAULT NULL::text, p_sucursal_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
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
  -- 332: costo financiero de cada pago
  v_cf_pct DECIMAL;
BEGIN
  v_metodo := p_metodo_pago::metodo_pago_venta;

  -- 332: el cliente tiene que ser de la organizacion. Sin esto se podia cargar
  -- la deuda de una venta (o descontar saldo a favor) a un cliente de otra.
  IF NULLIF(p_cliente_id, '') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM clientes WHERE id = p_cliente_id AND organization_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'Cliente no encontrado';
  END IF;

  -- 332: "saldo a favor" (CUENTA_CORRIENTE) sin cliente quedaba cobrado sin
  -- descontar nada de ningun lado.
  IF NULLIF(p_cliente_id, '') IS NULL AND (
       (p_pagos IS NOT NULL AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(p_pagos) AS p WHERE p->>'metodo' = 'CUENTA_CORRIENTE'))
    OR (p_pagos IS NULL AND p_metodo_pago = 'CUENTA_CORRIENTE')
  ) THEN
    RAISE EXCEPTION 'Para cobrar con saldo a favor la venta tiene que tener un cliente';
  END IF;

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
    -- 406: lo vendible es stock - stock_reservado. La reserva la toman las
    -- cotizaciones aprobadas, el catalogo publico y los repuestos de ordenes;
    -- vender por encima dejaba esas reservas sin mercaderia que las respalde.
    SELECT stock - GREATEST(COALESCE(stock_reservado, 0), 0), nombre
      INTO v_inv_stock, v_inv_nombre
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
          p_vendedor_id,
          p_sucursal_id
        ) INTO v_cc_result;
      END IF;

      -- 332: costo de la terminal (lo que absorbe el comercio). El POS lo pide
      -- en el cobro pero no se guardaba: la rentabilidad lo ignoraba.
      v_cf_pct := NULLIF((v_pago->>'costoFinanciero')::DECIMAL, 0);

      INSERT INTO pagos_venta (
        venta_id, monto, metodo_pago, numero_referencia, cuotas, recargo_porcentaje, monto_original,
        costo_financiero_porcentaje, costo_financiero_monto
      )
      VALUES (
        v_venta_id,
        (v_pago->>'monto')::DECIMAL,
        (v_pago->>'metodo')::metodo_pago_venta,
        NULLIF(v_pago->>'referencia', ''),
        (v_pago->>'cuotas')::INTEGER,
        (v_pago->>'recargo')::DECIMAL,
        (v_pago->>'montoOriginal')::DECIMAL,
        v_cf_pct,
        CASE WHEN v_cf_pct > 0 THEN ROUND((v_pago->>'monto')::DECIMAL * v_cf_pct / 100.0, 2) END
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

  -- NOTA: el egreso automático de COGS en movimientos_caja se eliminó en la mig 230.
  -- Era un asiento contable, no efectivo real, y contaminaba el arqueo de caja.
  -- El costo de mercadería sigue disponible vía items_venta.costo_unitario_snapshot,
  -- que es lo que consumen los reportes de rentabilidad.

  -- Saldo pendiente -> deuda en cuenta corriente del cliente
  IF p_cliente_id IS NOT NULL AND p_cliente_id != '' AND (p_total - v_monto_abonado) > 0 THEN
    PERFORM cargar_deuda_cuenta_corriente(
      p_org_id, p_cliente_id, (p_total - v_monto_abonado),
      'VENTA', v_venta_id, p_vendedor_id, p_sucursal_id);
  END IF;

  RETURN jsonb_build_object(
    'ventaId', v_venta_id,
    'numeroVenta', v_numero_venta,
    'garantias', v_garantias,
    'items', v_items_ids
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.convertir_cotizacion_venta_atomica(p_org_id text, p_vendedor_id text, p_cliente_id text, p_cliente_nombre text, p_cliente_telefono text, p_subtotal numeric, p_descuento numeric, p_tipo_descuento text, p_porcentaje_descuento numeric, p_total numeric, p_metodo_pago text, p_observaciones text, p_numero_referencia text, p_cuotas integer, p_recargo_porcentaje numeric, p_monto_original numeric, p_items jsonb, p_pagos jsonb DEFAULT NULL::jsonb, p_idempotency_key text DEFAULT NULL::text, p_deposito_id text DEFAULT NULL::text, p_sucursal_id text DEFAULT NULL::text, p_cotizacion_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_result        JSONB;
  v_venta_previa  TEXT;
  v_estado_previa TEXT;
  v_origen        TEXT;
BEGIN
  IF p_cotizacion_id IS NOT NULL THEN
    SELECT venta_id, origen INTO v_venta_previa, v_origen
    FROM cotizaciones
    WHERE id = p_cotizacion_id AND organization_id = p_org_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Cotizacion no encontrada';
    END IF;

    IF v_venta_previa IS NOT NULL THEN
      SELECT estado::text INTO v_estado_previa
      FROM ventas
      WHERE id = v_venta_previa AND organization_id = p_org_id;

      IF v_estado_previa IS NOT NULL AND v_estado_previa <> 'ANULADA' THEN
        RAISE EXCEPTION 'COTIZACION_YA_CONVERTIDA: %', v_venta_previa
          USING ERRCODE = 'P0020';
      END IF;
    END IF;
  END IF;

  -- 406: la cotizacion suelta su propia reserva ANTES de vender. crear_venta_
  -- atomica ahora valida contra stock - stock_reservado, y la reserva de esta
  -- misma cotizacion se contaria como ajena: la conversion fallaria justo por
  -- el stock que ella aparto. Todo corre en una transaccion: si la venta
  -- falla, la liberacion se revierte. Se mueve el bloque entero (B/C incluido)
  -- porque liberar_reserva_catalogo restituye las B/C que sigan abiertas: el
  -- consumo tiene que ir antes que esa liberacion, igual que en la 337.
  IF p_cotizacion_id IS NOT NULL THEN
    -- B/C vencidas: la venta no las descuenta, asi que se vuelven a tomar (y
    -- validar) antes de cerrarlas. No-op si la reserva nunca vencio.
    PERFORM retomar_reserva_catalogo_vencida(p_cotizacion_id);

    -- B/C vigentes: cerrar SIN devolver, la venta se quedo el stock.
    PERFORM consumir_reserva_catalogo(
      p_cotizacion_id, 'Reserva consumida por conversión a venta');

    IF v_origen = 'CATALOGO_PUBLICO' THEN
      -- Clase A por el LIBRO: libera exactamente lo pendiente (0 si ya vencio).
      -- liberar_items_cotizacion liberaria la cantidad de la linea sin netear y,
      -- tras el vencimiento, se comeria la reserva de otra cotizacion.
      PERFORM liberar_reserva_catalogo(
        p_cotizacion_id, 'Reserva consumida por conversión a venta');
    ELSE
      PERFORM liberar_items_cotizacion(
        p_cotizacion_id, p_vendedor_id, 'Reserva consumida por conversión a venta');
    END IF;
  END IF;

  v_result := crear_venta_atomica(
    p_org_id, p_vendedor_id, p_cliente_id, p_cliente_nombre, p_cliente_telefono,
    p_subtotal, p_descuento, p_tipo_descuento, p_porcentaje_descuento, p_total,
    p_metodo_pago, p_observaciones, p_numero_referencia, p_cuotas,
    p_recargo_porcentaje, p_monto_original, p_items, p_pagos,
    p_idempotency_key, p_deposito_id, p_sucursal_id
  );

  IF p_cotizacion_id IS NOT NULL THEN
    UPDATE cotizaciones
    SET venta_id = v_result->>'ventaId'
    WHERE id = p_cotizacion_id AND organization_id = p_org_id;
  END IF;

  RETURN v_result;
END;
$function$
;
