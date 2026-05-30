-- ============================================
-- Migration 199: Fix series integrity + oversell guards
-- ============================================
-- This migration does CREATE OR REPLACE on two functions originally defined in
-- already-applied migrations. The original migrations (175_lotes_series.sql and
-- 102_cogs_auto_egreso_en_venta.sql) are NOT edited.
--
-- Fixes:
--   (2) salida_serie: refuse to mark a serie as VENDIDO with no effective
--       venta_id (orphaned VENDIDO), enforcing the invariant documented in
--       migration 175 (lines 22-23: estado 'VENDIDO' implica venta_id NOT NULL).
--   (3) salida_serie: stop silently clamping over-decrements. Raise on aggregate
--       stock <= 0 (clear corruption). Downgrade lote/deposito clamps to
--       RAISE WARNING + GREATEST so a legitimate exit of a serie that has no
--       lote/deposito-counter linkage is not blocked.
--   (4) crear_venta_atomica: validate requested quantity CUMULATIVELY per
--       inventarioId (duplicate line items pointing at the same product could
--       each pass the per-item check and oversell), and guard the stock
--       decrement so it can never go negative.
--   (5) crear_venta_atomica: honor a manual 'costo' snapshot passed per item as
--       fallback when there is no inventario.precio_compra (cotizacion→venta of
--       manual items, migration 182) — MERGED here from the formerly separate
--       199_crear_venta_atomica_costo_manual.sql to avoid two migrations
--       redefining the same function. Both changes now live in this single
--       CREATE OR REPLACE.
--
-- HUMAN-REVIEW ASSUMPTIONS (flagged in PR description):
--   - (2) We treat a non-sale SALIDA (p_tipo='SALIDA', p_venta_id NULL) that
--     would resolve to estado='VENDIDO' as an error. It remains an open product
--     question whether 'SALIDA' should ever map to 'VENDIDO' at all, or to a
--     different terminal estado (e.g. BLOQUEADO/DEVUELTO). This guard only
--     blocks the corrupt case (VENDIDO with no venta_id); it does not change
--     valid VENTA / GARANTIA_ACTIVA / DEVOLUCION paths.
--   - (3) ERRCODE 'P0003' (stock insuficiente) is reused for the aggregate
--     stock<=0 case, consistent with migration 175's header convention.
--   - (4) crear_venta_atomica is reproduced verbatim from migration 102 with
--     only the validation/decrement changes below. Reviewer should diff against
--     102 before db push to confirm no transcription drift.
-- ============================================

-- ============================================
-- salida_serie  (fixes 2 + 3)
-- ============================================
-- Reproduced from migration 175 (section 7) verbatim except:
--   * (2) guard before the UPDATE: require an effective venta_id when the
--     computed estado is 'VENDIDO'.
--   * (3) aggregate stock<=0 now RAISEs P0003 instead of GREATEST clamp;
--     lote/deposito under-flow now RAISE WARNING (kept GREATEST as a floor).

CREATE OR REPLACE FUNCTION salida_serie(
  p_organization_id TEXT,
  p_user_id         TEXT,
  p_inventario_id   TEXT,
  p_serie_id        TEXT,
  p_venta_id        TEXT DEFAULT NULL,
  p_cliente_id      TEXT DEFAULT NULL,
  p_motivo          TEXT DEFAULT NULL,
  p_tipo            TEXT DEFAULT 'VENTA'
) RETURNS JSONB AS $$
DECLARE
  v_serie           inventario_series%ROWTYPE;
  v_inv             inventario%ROWTYPE;
  v_lote            inventario_lotes%ROWTYPE;
  v_stock_anterior  INTEGER;
  v_stock_posterior INTEGER;
  v_mov_id          TEXT;
  v_nuevo_estado    TEXT;
BEGIN
  IF p_tipo NOT IN ('VENTA','SALIDA','DEVOLUCION') THEN
    RAISE EXCEPTION 'Tipo de salida inválido' USING ERRCODE = '22023';
  END IF;

  -- Lock serie
  SELECT * INTO v_serie FROM inventario_series
    WHERE id = p_serie_id
      AND inventario_id = p_inventario_id
      AND organization_id = p_organization_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Serie no encontrada' USING ERRCODE = 'P0002';
  END IF;

  IF v_serie.estado NOT IN ('DISPONIBLE','RESERVADO') THEN
    RAISE EXCEPTION 'Serie no disponible (estado actual: %)', v_serie.estado
      USING ERRCODE = '22023';
  END IF;

  -- Lock item
  SELECT * INTO v_inv FROM inventario
    WHERE id = p_inventario_id
    FOR UPDATE;

  v_nuevo_estado := CASE
    WHEN p_tipo = 'DEVOLUCION' THEN 'DEVUELTO'
    WHEN v_serie.fecha_garantia_vence IS NOT NULL AND v_serie.fecha_garantia_vence >= CURRENT_DATE THEN 'GARANTIA_ACTIVA'
    ELSE 'VENDIDO'
  END;

  -- (2) FIX: no permitir VENDIDO sin venta_id efectivo. La columna venta_id
  -- queda nullable para tolerar imports, pero el invariante (estado 'VENDIDO'
  -- implica venta_id IS NOT NULL) se hace cumplir aquí a nivel RPC.
  IF v_nuevo_estado = 'VENDIDO'
     AND p_venta_id IS NULL
     AND v_serie.venta_id IS NULL THEN
    RAISE EXCEPTION 'No se puede marcar serie VENDIDO sin venta_id'
      USING ERRCODE = '22023';
  END IF;

  UPDATE inventario_series
    SET estado = v_nuevo_estado,
        fecha_venta = NOW(),
        venta_id = COALESCE(p_venta_id, venta_id),
        cliente_id = COALESCE(p_cliente_id, cliente_id),
        notas = COALESCE(NULLIF(BTRIM(p_motivo), ''), notas),
        updated_at = NOW()
    WHERE id = p_serie_id;

  -- Decrementar lote si pertenece
  IF v_serie.lote_id IS NOT NULL THEN
    SELECT * INTO v_lote FROM inventario_lotes
      WHERE id = v_serie.lote_id FOR UPDATE;
    IF FOUND THEN
      -- (3) FIX: detectar under-flow del lote (no debería ocurrir si la serie
      -- DISPONIBLE estaba contabilizada). Warning + floor en GREATEST.
      IF v_lote.cantidad_actual <= 0 THEN
        RAISE WARNING 'salida_serie: lote % (serie %) con cantidad_actual<=0 (%) al egresar; posible corrupción de contadores',
          v_lote.id, p_serie_id, v_lote.cantidad_actual;
      END IF;
      UPDATE inventario_lotes
        SET cantidad_actual = GREATEST(cantidad_actual - 1, 0),
            estado = CASE WHEN cantidad_actual - 1 <= 0 THEN 'AGOTADO' ELSE estado END,
            updated_at = NOW()
        WHERE id = v_lote.id;
    END IF;
  END IF;

  -- Actualizar stock total
  v_stock_anterior := COALESCE(v_inv.stock, 0);

  -- (3) FIX: marcar una serie como egresada implica que existía 1 unidad. Si el
  -- stock agregado ya es <= 0 hay corrupción; RAISE en vez de enmascarar con
  -- GREATEST. ERRCODE P0003 = stock insuficiente (convención de migración 175).
  IF v_stock_anterior <= 0 THEN
    RAISE EXCEPTION 'Stock agregado inconsistente (%) al egresar serie %; no se puede decrementar',
      v_stock_anterior, p_serie_id
      USING ERRCODE = 'P0003';
  END IF;

  v_stock_posterior := v_stock_anterior - 1;

  UPDATE inventario
    SET stock = v_stock_posterior, updated_at = NOW()
    WHERE id = p_inventario_id;

  -- Sync inventario_depositos si tenía depósito asignado
  IF v_serie.deposito_id IS NOT NULL THEN
    -- (3) FIX: warning si el contador del depósito ya está en 0; floor en GREATEST.
    IF EXISTS (
      SELECT 1 FROM inventario_depositos
      WHERE inventario_id = p_inventario_id
        AND deposito_id = v_serie.deposito_id
        AND stock <= 0
    ) THEN
      RAISE WARNING 'salida_serie: inventario_depositos (inv %, dep %) con stock<=0 al egresar serie %; posible corrupción de contadores',
        p_inventario_id, v_serie.deposito_id, p_serie_id;
    END IF;
    UPDATE inventario_depositos
      SET stock = GREATEST(stock - 1, 0), updated_at = NOW()
      WHERE inventario_id = p_inventario_id AND deposito_id = v_serie.deposito_id;
  END IF;

  INSERT INTO movimientos_inventario (
    inventario_id, tipo, cantidad,
    stock_anterior, stock_posterior,
    deposito_id, referencia_id, referencia_tipo,
    lote_id, serie_ids, usuario_id, organization_id, observaciones
  ) VALUES (
    p_inventario_id, p_tipo, 1,
    v_stock_anterior, v_stock_posterior,
    v_serie.deposito_id, p_venta_id, CASE WHEN p_venta_id IS NOT NULL THEN 'VENTA' ELSE 'SALIDA_SERIE' END,
    v_serie.lote_id, ARRAY[p_serie_id], p_user_id, p_organization_id,
    COALESCE(NULLIF(BTRIM(p_motivo), ''), format('Salida serie %s', v_serie.numero_serie))
  )
  RETURNING id INTO v_mov_id;

  RETURN jsonb_build_object(
    'success', true,
    'serieId', p_serie_id,
    'estado', v_nuevo_estado,
    'movimientoId', v_mov_id,
    'stockPosterior', v_stock_posterior
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION salida_serie(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) IS
  'Salida de 1 serie. Decrementa lote (si pertenece) y stock total. Marca AGOTADO si el lote llega a 0. v199: exige venta_id si estado VENDIDO; RAISE en stock agregado<=0; WARNING en under-flow de lote/deposito.';

-- ============================================
-- crear_venta_atomica  (fix 4)
-- ============================================
-- Reproduced from migration 102 verbatim except:
--   * Step 2: cumulative validation per inventarioId (a JSONB running-total map)
--     so duplicate line items for the same product cannot each pass the
--     per-item check and oversell.
--   * Step 6: guarded UPDATE (WHERE stock >= qty) + RAISE if 0 rows affected,
--     so the aggregate stock can never go negative even under concurrency.

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
  p_pagos JSONB DEFAULT NULL
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
    total, metodo_pago, monto_abonado, estado_pago, observaciones, organization_id
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
    p_org_id
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
        referencia_id, referencia_tipo, usuario_id, organization_id
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
        p_org_id
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
      observaciones, usuario_id, fecha, afecta_rentabilidad
    ) VALUES (
      p_org_id,
      'EGRESO',
      v_total_costo_mercaderia,
      'EFECTIVO',
      'Costo de mercadería - Venta #' || v_numero_venta,
      'Egreso automático por costo de productos vendidos',
      p_vendedor_id,
      NOW(),
      FALSE  -- FALSE porque el P&L ya calcula COGS desde costo_unitario_snapshot
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
