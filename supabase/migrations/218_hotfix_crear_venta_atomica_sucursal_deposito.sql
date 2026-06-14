-- ========================================
-- Migration 218: HOTFIX — POS caído (crear_venta_atomica sin p_sucursal_id)
-- ========================================
-- INCIDENTE: la ruta app/api/ventas/route.ts envía p_sucursal_id Y p_deposito_id,
-- pero la versión LIVE de crear_venta_atomica (la de 206_multi_deposito_fase2)
-- solo declara p_deposito_id. PostgREST no encuentra una función que matchee el
-- set de params → error PGRST202 "Could not find the function ... in the schema
-- cache" → toda venta del POS falla.
--
-- Cómo se llegó acá: dos archivos "206" redefinieron la función en paralelo:
--   - 206_crear_venta_atomica_sucursal.sql → +p_sucursal_id, SIN dual-write depósito
--   - 206_multi_deposito_fase2.sql        → +p_deposito_id + dual-write, SIN sucursal
-- Quedó viva la segunda (verificado en pg_proc). La ruta espera AMBOS params.
--
-- FIX: tomar la versión LIVE (206_multi_deposito_fase2, con dual-write a
-- inventario_depositos) y agregarle p_sucursal_id, sin tocar nada más:
--   (1) nuevo último parámetro: p_sucursal_id TEXT DEFAULT NULL
--   (2) sucursal_id en INSERT INTO ventas
--   (3) sucursal_id en el egreso COGS de movimientos_caja
-- TODO el dual-write por depósito (descontar_stock_deposito, deposito_id en
-- movimientos_inventario) se preserva VERBATIM. La resolución automática del
-- depósito a partir de la sucursal NO se incluye acá (es mejora de Fase 5);
-- este hotfix solo restablece la firma para levantar el POS y stampear sucursal.
--
-- Firma live a dropear (20 params terminando en p_deposito_id).
-- ========================================

DROP FUNCTION IF EXISTS crear_venta_atomica(
  TEXT, TEXT, TEXT, TEXT, TEXT, DECIMAL, DECIMAL, TEXT, DECIMAL, DECIMAL,
  TEXT, TEXT, TEXT, INTEGER, DECIMAL, DECIMAL, JSONB, JSONB, TEXT, TEXT
);

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
  -- (A) series
  v_trackea_series BOOLEAN;
  v_serie_ids_in JSONB;
  v_serie_ids_out TEXT[];
  v_dias_garantia INTEGER;
  -- multi-deposito
  v_deposito_efectivo TEXT;
BEGIN
  v_metodo := p_metodo_pago::metodo_pago_venta;

  -- 1. Get next sale number atomically
  SELECT get_next_sale_number(p_org_id) INTO v_numero_venta;

  -- 2. Validate stock for ALL items with row locks (CUMULATIVE per inventarioId).
  -- FIX (4): aggregate requested cantidad per inventarioId first, then validate
  -- the running total against the locked stock. Two line items for the same
  -- product (each cantidad<=stock individually) could otherwise both pass and
  -- oversell. The FOR UPDATE lock is held until commit, serializing concurrent
  -- sales of the same row.
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

  -- 3. Determine monto_abonado and estado_pago
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

  -- 4. Create the sale
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

  -- 5. Create payment records
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

  -- 6. Insert items, deduct stock, create movements, create warranties
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    -- Leer costo de compra actual para snapshot.
    -- Prioridad: para items linkeados, inventario.precio_compra (snapshot vivo).
    -- Fallback: el 'costo' pasado en p_items (snapshot histórico de la cotización,
    -- migration 182) — clave para items manuales sin inventario_id que de otro
    -- modo quedarían con costo NULL e inflarían el margen en reportes.
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

    -- Acumular costo total de mercadería vendida
    IF v_inv_costo IS NOT NULL THEN
      v_total_costo_mercaderia := v_total_costo_mercaderia + (v_inv_costo * (v_item->>'cantidad')::INTEGER);
    END IF;

    -- Deduct stock and record movement
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
        NULL  -- populated below after descontar_stock_deposito resolves the effective deposit
      FROM inventario WHERE id = (v_item->>'inventarioId');

      -- FIX (4): guarded decrement. The row is already locked from step 2; the
      -- WHERE stock >= qty + 0-rows check is a defense-in-depth net so the
      -- aggregate stock can never go negative (e.g. if step-2 aggregation ever
      -- drifted from the per-item loop here).
      UPDATE inventario
      SET stock = stock - (v_item->>'cantidad')::INTEGER
      WHERE id = (v_item->>'inventarioId')
        AND stock >= (v_item->>'cantidad')::INTEGER;

      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows = 0 THEN
        RAISE EXCEPTION 'Stock insuficiente al descontar item "%"', v_item->>'descripcion'
          USING ERRCODE = 'P0003';
      END IF;

      -- Dual-write: deduct per-deposit stock. strict=true when deposit is explicit.
      v_deposito_efectivo := descontar_stock_deposito(
        (v_item->>'inventarioId'), p_org_id, p_deposito_id,
        (v_item->>'cantidad')::INTEGER,
        p_deposito_id IS NOT NULL);

      -- Back-fill deposito_id on the movement we just inserted.
      UPDATE movimientos_inventario
      SET deposito_id = v_deposito_efectivo
      WHERE referencia_id = v_venta_id
        AND inventario_id = (v_item->>'inventarioId')
        AND tipo = 'VENTA'
        AND deposito_id IS NULL;
    END IF;

    -- (A) Consumo de series para items serializados.
    -- Se ejecuta SOLO si el item está linkeado y su inventario.trackea_series.
    -- NO se llama salida_serie: el stock agregado y el movimiento ya se
    -- manejan arriba; salida_serie los duplicaría. Aquí solo se marcan las
    -- filas inventario_series como vendidas y se ajusta su garantía.
    IF (v_item->>'inventarioId') IS NOT NULL AND (v_item->>'inventarioId') != '' THEN
      SELECT trackea_series INTO v_trackea_series
      FROM inventario WHERE id = (v_item->>'inventarioId');

      IF COALESCE(v_trackea_series, false) THEN
        v_dias_garantia := COALESCE((v_item->>'diasGarantia')::INTEGER, 0);
        v_serie_ids_in := v_item->'serieIds';
        v_serie_ids_out := ARRAY[]::TEXT[];

        IF v_serie_ids_in IS NOT NULL AND jsonb_typeof(v_serie_ids_in) = 'array'
           AND jsonb_array_length(v_serie_ids_in) > 0 THEN
          -- Override: usar las series elegidas por el cajero. Validar count,
          -- pertenencia y estado DISPONIBLE bajo lock.
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
          -- Auto FIFO: tomar las N más viejas DISPONIBLE.
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

        -- Marcar cada serie como vendida. diasGarantia POS manda: si > 0,
        -- recalcula fecha_garantia_vence = hoy + dias y estado GARANTIA_ACTIVA.
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

        -- Registrar las series consumidas en el movimiento del item.
        UPDATE movimientos_inventario
          SET serie_ids = v_serie_ids_out
          WHERE referencia_id = v_venta_id
            AND inventario_id = (v_item->>'inventarioId')
            AND tipo = 'VENTA';
      END IF;
    END IF;

    -- Create warranty if applicable
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

  -- 7. Registrar egreso automático por costo de mercadería vendida
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
      FALSE,  -- FALSE porque el P&L ya calcula COGS desde costo_unitario_snapshot
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

COMMENT ON FUNCTION crear_venta_atomica(
  TEXT, TEXT, TEXT, TEXT, TEXT, DECIMAL, DECIMAL, TEXT, DECIMAL, DECIMAL,
  TEXT, TEXT, TEXT, INTEGER, DECIMAL, DECIMAL, JSONB, JSONB, TEXT, TEXT, TEXT
) IS
  'Crea venta atómica. v218: combina dual-write por depósito (v206: '
  'descontar_stock_deposito + deposito_id en movimientos_inventario) con '
  'p_sucursal_id (stamp en ventas.sucursal_id + egreso COGS). Restablece la '
  'firma que la ruta espera (p_deposito_id + p_sucursal_id) tras el conflicto '
  'de las dos migraciones 206. p_deposito_id NOT NULL = validación estricta; '
  'NULL = global + drain principal.';
