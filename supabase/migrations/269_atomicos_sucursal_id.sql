-- ========================================================================
-- Migration 269: Thread sucursal_id through the atomic RPCs' internal
-- fiado-writer calls (cargar_deuda_cuenta_corriente / usar_cuenta_corriente /
-- pagar_fiado_cuenta_corriente / devolver_cuenta_corriente)
-- ========================================================================
-- Gap (discovered while shipping recordatorios-cobro-whatsapp / PR 1.5):
-- mig 268 added p_sucursal_id TEXT DEFAULT NULL to the 4 fiado writers, and
-- PR 1.5 updated the ~10 app-layer TypeScript callers to pass it. However,
-- these same 4 writers are ALSO called from INSIDE 8 atomic SQL RPCs, which
-- are the code that actually runs in production once each RPC migration is
-- applied (the JS fallback paths only fire if Postgres reports the RPC as
-- missing). None of those internal calls passed p_sucursal_id, so every
-- CARGO/USO/PAGO/DEVOLUCION row written through crear_venta_atomica,
-- registrar_pagos_venta_atomica, registrar_cobros_orden_atomica,
-- anular_cobro_orden_atomica, registrar_pago_factura_atomica,
-- anular_factura_atomica, eliminar_factura_atomica, registrar_devolucion_atomica,
-- and crear_nota_credito still landed with cuenta_corriente.sucursal_id = NULL.
--
-- Fix: CREATE OR REPLACE each of the 8 atomic RPCs, changing ONLY the
-- fiado-writer call arguments to pass sucursal_id sourced from the parent
-- row each function already holds (ventas.sucursal_id / ordenes_servicio.
-- sucursal_id, or a derived variable where the parent row isn't already
-- SELECTed in full). No signature changes to any of the 8 RPCs. No other
-- behavioral edits — every function body below is otherwise verbatim from
-- its latest prior CREATE OR REPLACE definition (cited per function).
--
-- Not fixed by this migration (documented, out of scope):
-- - restore_stock_on_cancel trigger (mig 235/244/254): its AJUSTE reversal
--   INSERTs directly into cuenta_corriente, bypassing all 4 fiado-writer
--   functions entirely. Needs its own fix, separate from this threading pass.
-- - Historical rows already written with sucursal_id = NULL are NOT
--   backfilled (same policy as mig 268 — no reliable post-hoc attribution).
-- ========================================================================

-- ============================================================
-- 1. crear_venta_atomica — base: migration 230 (latest CREATE OR REPLACE;
--    supersedes 043/066/078/079/083/090/102/111/199/200/206/210/218/225)
--    Already receives p_sucursal_id as its own parameter (mig 206/210) and
--    persists it on the `ventas` row. Only the two internal fiado-writer
--    calls are changed below to forward that same value.
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
          p_vendedor_id,
          p_sucursal_id
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
$$ LANGUAGE plpgsql;

-- ============================================================
-- 2. registrar_pagos_venta_atomica — base: migration 237 (only prior
--    CREATE OR REPLACE definition). v_venta is `SELECT * INTO v_venta FROM
--    ventas`, so v_venta.sucursal_id is already in scope — no new lookup
--    needed, no DECLARE change.
-- ============================================================
CREATE OR REPLACE FUNCTION registrar_pagos_venta_atomica(
  p_org_id       TEXT,
  p_venta_id     TEXT,
  p_usuario_id   TEXT,
  p_cliente_id   TEXT,
  p_observaciones TEXT,
  p_pagos        JSONB,
  p_idempotency_key TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_venta          RECORD;
  v_pendiente      DECIMAL;
  v_total_pagos    DECIMAL;
  v_cliente_id     TEXT;
  v_pago           JSONB;
  v_pago_id        TEXT;
  v_pago_fecha     TIMESTAMPTZ;
  v_monto          DECIMAL;
  v_metodo         TEXT;
  v_referencia     TEXT;
  v_cuotas         INTEGER;
  v_recargo        DECIMAL;
  v_monto_original DECIMAL;
  v_cf_pct         DECIMAL;
  v_cf_monto       DECIMAL;
  v_pagos_array    JSONB := '[]'::JSONB;
  v_nuevo_abonado  DECIMAL;
  v_estado         TEXT;
  v_response       JSONB;
  v_existing       JSONB;
  v_total_externo  DECIMAL := 0;
BEGIN
  -- 1. Lock and load venta
  SELECT * INTO v_venta
  FROM ventas
  WHERE id = p_venta_id AND organization_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venta no encontrada';
  END IF;

  IF v_venta.estado = 'ANULADA' THEN
    RAISE EXCEPTION 'No se pueden registrar pagos en una venta anulada';
  END IF;

  -- 2. Validate amount
  v_pendiente   := v_venta.total - COALESCE(v_venta.monto_abonado, 0);
  v_total_pagos := COALESCE((SELECT SUM((p->>'monto')::DECIMAL) FROM jsonb_array_elements(p_pagos) AS p), 0);

  IF v_total_pagos > v_pendiente + 0.01 THEN
    RAISE EXCEPTION 'El monto total (%) excede el pendiente (%)',
      ROUND(v_total_pagos::NUMERIC, 2), ROUND(v_pendiente::NUMERIC, 2);
  END IF;

  -- 3. Idempotency claim (INSIDE this transaction — claim+work+seal are atomic)
  IF p_idempotency_key IS NOT NULL THEN
    BEGIN
      INSERT INTO pago_idempotency (organization_id, idempotency_key, venta_id)
        VALUES (p_org_id, p_idempotency_key, p_venta_id);
    EXCEPTION WHEN unique_violation THEN
      -- A committed row always has a non-null response (claim+seal are atomic).
      -- A concurrent in-flight transaction will block here until it commits/rolls back,
      -- then this branch fires and reads the now-committed response.
      SELECT response INTO v_existing
        FROM pago_idempotency
        WHERE organization_id = p_org_id AND idempotency_key = p_idempotency_key;
      RETURN jsonb_build_object('replayed', true, 'response', v_existing);
    END;
  END IF;

  -- 4. Resolve cliente_id
  v_cliente_id := COALESCE(NULLIF(p_cliente_id, ''), v_venta.cliente_id);

  -- 5. Payment loop
  FOR v_pago IN SELECT * FROM jsonb_array_elements(p_pagos)
  LOOP
    v_monto          := (v_pago->>'monto')::DECIMAL;
    v_metodo         := v_pago->>'metodo';
    v_referencia     := NULLIF(v_pago->>'referencia', '');
    v_cuotas         := (v_pago->>'cuotas')::INTEGER;
    v_recargo        := (v_pago->>'recargo')::DECIMAL;
    v_monto_original := (v_pago->>'montoOriginal')::DECIMAL;
    v_cf_pct         := (v_pago->>'costoFinanciero')::DECIMAL;
    v_cf_monto       := CASE WHEN v_cf_pct IS NOT NULL AND v_cf_pct > 0
                              THEN ROUND(v_monto * v_cf_pct / 100.0, 2)
                              ELSE NULL END;

    -- CC: deduct from customer balance (raises on insufficient saldo → full rollback)
    IF v_metodo = 'CUENTA_CORRIENTE' AND v_cliente_id IS NOT NULL THEN
      PERFORM usar_cuenta_corriente(
        p_org_id, v_cliente_id, v_monto,
        'VENTA', p_venta_id, p_usuario_id, v_venta.sucursal_id
      );
    ELSE
      -- Accumulate non-CC for fiado reconciliation
      v_total_externo := v_total_externo + v_monto;
    END IF;

    INSERT INTO pagos_venta (
      venta_id, monto, metodo_pago, numero_referencia, observaciones,
      cuotas, recargo_porcentaje, monto_original,
      costo_financiero_porcentaje, costo_financiero_monto
    ) VALUES (
      p_venta_id, v_monto, v_metodo::metodo_pago_venta, v_referencia, p_observaciones,
      v_cuotas, v_recargo, v_monto_original,
      v_cf_pct, v_cf_monto
    )
    RETURNING id, fecha INTO v_pago_id, v_pago_fecha;

    v_pagos_array := v_pagos_array || jsonb_build_object(
      'id',                      v_pago_id,
      'monto',                   v_monto,
      'metodoPago',              v_metodo,
      'referencia',              v_referencia,
      'fecha',                   v_pago_fecha,
      'cuotas',                  v_cuotas,
      'recargoPorcentaje',       v_recargo,
      'montoOriginal',           v_monto_original,
      'costoFinancieroPorcentaje', v_cf_pct,
      'costoFinancieroMonto',    v_cf_monto
    );
  END LOOP;

  -- 5b. Reconcile fiado: non-CC payments credit the customer's CC balance.
  -- NON-FATAL on purpose: the JS route only logs a fiado error and still records
  -- the payment, so we mirror that exactly. Wrapping in a sub-block keeps a fiado
  -- failure from rolling back the whole (otherwise valid) payment. The pagos +
  -- venta update still commit; the fiado credit is skipped and surfaced as a WARNING.
  IF v_cliente_id IS NOT NULL AND v_total_externo > 0 THEN
    BEGIN
      PERFORM pagar_fiado_cuenta_corriente(
        p_org_id, v_cliente_id, v_total_externo,
        'VENTA', p_venta_id, p_usuario_id, NULL, v_venta.sucursal_id
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Error acreditando pago de fiado (venta %): %', p_venta_id, SQLERRM;
    END;
  END IF;

  -- 6. Update venta
  v_nuevo_abonado := COALESCE(v_venta.monto_abonado, 0) + v_total_pagos;
  v_estado := CASE
    WHEN v_nuevo_abonado >= v_venta.total THEN 'PAGADO'
    WHEN v_nuevo_abonado > 0             THEN 'PAGADO_PARCIAL'
    ELSE                                      'PENDIENTE'
  END;

  UPDATE ventas
    SET monto_abonado = v_nuevo_abonado,
        estado_pago   = v_estado
    WHERE id = p_venta_id;

  -- 7. Build response (same shape as the JS route)
  v_response := jsonb_build_object(
    'pagos', v_pagos_array,
    'venta', jsonb_build_object(
      'montoAbonado', v_nuevo_abonado,
      'estadoPago',   v_estado,
      'pendiente',    v_venta.total - v_nuevo_abonado
    )
  );

  -- 8. Seal idempotency row
  IF p_idempotency_key IS NOT NULL THEN
    UPDATE pago_idempotency
      SET response = v_response
      WHERE organization_id = p_org_id AND idempotency_key = p_idempotency_key;
  END IF;

  RETURN jsonb_build_object('replayed', false, 'response', v_response);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION registrar_pagos_venta_atomica(TEXT,TEXT,TEXT,TEXT,TEXT,JSONB,TEXT) IS
  'Atomic payment batch for /api/ventas/[id]/pagos. '
  'Runs CC deductions (usar_cuenta_corriente), pagos_venta inserts, fiado reconciliation '
  '(pagar_fiado_cuenta_corriente), and ventas update in ONE transaction. '
  'Idempotency claim is inside the same transaction so claim+seal are atomic — '
  'no partial-state window. Returns {replayed: bool, response: {pagos:[], venta:{}}}. '
  'Migration 237. Migration 269: forwards v_venta.sucursal_id to the CC/fiado calls.';

-- ============================================================
-- 3. registrar_cobros_orden_atomica + anular_cobro_orden_atomica —
--    base: migration 242 (only prior CREATE OR REPLACE definition, same
--    file for both). Neither had sucursal_id in scope: extending the
--    existing `ordenes_servicio` lookups each function already does with
--    one more column (sucursal_id) is the "derive from parent row" case.
-- ============================================================
CREATE OR REPLACE FUNCTION registrar_cobros_orden_atomica(
  p_org_id           TEXT,
  p_orden_id         TEXT,
  p_usuario_id       TEXT,
  p_pagos            JSONB,
  p_observaciones    TEXT,
  p_descuento        DECIMAL DEFAULT 0,
  p_idempotency_key  TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_orden            RECORD;
  v_descuento_total  DECIMAL;
  v_pendiente        DECIMAL;
  v_total_pagos      DECIMAL;
  v_total_externo    DECIMAL := 0;
  v_pago             JSONB;
  v_cobro_id         TEXT;
  v_monto            DECIMAL;
  v_metodo           TEXT;
  v_referencia       TEXT;
  v_cuotas           INTEGER;
  v_recargo          DECIMAL;
  v_monto_original   DECIMAL;
  v_cf_pct           DECIMAL;
  v_cf_monto         DECIMAL;
  v_cobros_array     JSONB := '[]'::JSONB;
  v_response         JSONB;
  v_existing         JSONB;
BEGIN
  -- 1. Lock and load orden
  SELECT id, costo_final, total_cobrado, descuento_cobro, cliente_id, estado, sucursal_id
    INTO v_orden
    FROM ordenes_servicio
    WHERE id = p_orden_id AND organization_id = p_org_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada';
  END IF;

  -- 2. Amount validation
  v_descuento_total := COALESCE(v_orden.descuento_cobro, 0) + COALESCE(p_descuento, 0);
  v_pendiente       := COALESCE(v_orden.costo_final, 0) - v_descuento_total - COALESCE(v_orden.total_cobrado, 0);
  v_total_pagos     := COALESCE(
    (SELECT SUM((p->>'monto')::DECIMAL) FROM jsonb_array_elements(p_pagos) AS p),
    0
  );

  IF v_total_pagos > v_pendiente + 0.01 THEN
    RAISE EXCEPTION 'El monto total (%) excede el pendiente (%)',
      ROUND(v_total_pagos::NUMERIC, 2), ROUND(v_pendiente::NUMERIC, 2);
  END IF;

  -- 3. Idempotency claim INSIDE this transaction
  IF p_idempotency_key IS NOT NULL THEN
    BEGIN
      INSERT INTO pago_idempotency (organization_id, idempotency_key, orden_id)
        VALUES (p_org_id, p_idempotency_key, p_orden_id);
    EXCEPTION WHEN unique_violation THEN
      SELECT response INTO v_existing
        FROM pago_idempotency
        WHERE organization_id = p_org_id AND idempotency_key = p_idempotency_key;
      RETURN jsonb_build_object('replayed', true, 'response', v_existing);
    END;
  END IF;

  -- 4. Apply new discount if provided
  IF p_descuento > 0 THEN
    UPDATE ordenes_servicio
      SET descuento_cobro = v_descuento_total
      WHERE id = p_orden_id;
  END IF;

  -- 5. Payment loop
  FOR v_pago IN SELECT * FROM jsonb_array_elements(p_pagos)
  LOOP
    v_monto          := (v_pago->>'monto')::DECIMAL;
    v_metodo         := v_pago->>'metodo';
    v_referencia     := NULLIF(v_pago->>'referencia', '');
    v_cuotas         := (v_pago->>'cuotas')::INTEGER;
    v_recargo        := (v_pago->>'recargo')::DECIMAL;
    v_monto_original := (v_pago->>'montoOriginal')::DECIMAL;
    v_cf_pct         := (v_pago->>'costoFinanciero')::DECIMAL;
    v_cf_monto       := CASE WHEN v_cf_pct IS NOT NULL AND v_cf_pct > 0
                              THEN ROUND(v_monto * v_cf_pct / 100.0, 2)
                              ELSE NULL END;

    -- CC: deduct from customer balance (raises on insufficient saldo → full rollback)
    IF v_metodo = 'CUENTA_CORRIENTE' AND v_orden.cliente_id IS NOT NULL THEN
      PERFORM usar_cuenta_corriente(
        p_org_id, v_orden.cliente_id, v_monto,
        'ORDEN', p_orden_id, p_usuario_id, v_orden.sucursal_id
      );
    ELSE
      v_total_externo := v_total_externo + v_monto;
    END IF;

    INSERT INTO cobros_orden (
      orden_id, organization_id, monto, metodo_pago, numero_referencia, observaciones,
      cuotas, recargo_porcentaje, monto_original,
      costo_financiero_monto, costo_financiero_porcentaje, usuario_id
    ) VALUES (
      p_orden_id, p_org_id, v_monto, v_metodo, v_referencia, p_observaciones,
      v_cuotas, v_recargo, v_monto_original,
      v_cf_monto, v_cf_pct, p_usuario_id
    )
    RETURNING id INTO v_cobro_id;

    v_cobros_array := v_cobros_array || jsonb_build_object(
      'id',     v_cobro_id,
      'monto',  v_monto,
      'metodo', v_metodo,
      'cuotas', v_cuotas
    );
  END LOOP;

  -- 6. Fiado reconciliation: non-CC payments credit the customer's CC balance.
  -- NON-FATAL: mirrors the JS route behavior (log, don't fail).
  IF v_orden.estado IN ('ENTREGADO', 'ENTREGADO_SIN_REPARACION')
     AND v_orden.cliente_id IS NOT NULL
     AND v_total_externo > 0
  THEN
    BEGIN
      PERFORM pagar_fiado_cuenta_corriente(
        p_org_id, v_orden.cliente_id, v_total_externo,
        'ORDEN', p_orden_id, p_usuario_id, NULL, v_orden.sucursal_id
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Error acreditando fiado (orden %): %', p_orden_id, SQLERRM;
    END;
  END IF;

  -- 7. Recalculate cobro state
  PERFORM recalcular_estado_cobro(p_orden_id);

  -- 8. Build response from updated orden
  SELECT
    jsonb_build_object(
      'cobros', v_cobros_array,
      'orden',  jsonb_build_object(
        'totalCobrado', COALESCE(total_cobrado, 0),
        'estadoCobro',  estado_cobro,
        'descuento',    COALESCE(descuento_cobro, 0)
      )
    )
  INTO v_response
  FROM ordenes_servicio
  WHERE id = p_orden_id;

  -- 9. Seal idempotency row
  IF p_idempotency_key IS NOT NULL THEN
    UPDATE pago_idempotency
      SET response = v_response
      WHERE organization_id = p_org_id AND idempotency_key = p_idempotency_key;
  END IF;

  RETURN jsonb_build_object('replayed', false, 'response', v_response);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION registrar_cobros_orden_atomica(TEXT,TEXT,TEXT,JSONB,TEXT,DECIMAL,TEXT) IS
  'Atomic cobros batch for POST /api/ordenes/[id]/cobros. '
  'Runs CC deductions (usar_cuenta_corriente), cobros_orden inserts, fiado reconciliation '
  '(pagar_fiado_cuenta_corriente), and recalcular_estado_cobro in ONE transaction. '
  'Idempotency claim is inside the same transaction so claim+seal are atomic — '
  'no partial-state window. Fixes bug A (non-atomic insert + no idempotency). '
  'Returns {replayed: bool, response: {cobros:[], orden:{}}}. Migration 242. '
  'Migration 269: forwards v_orden.sucursal_id to the CC/fiado calls.';

-- (3) Atomic cobro cancellation
CREATE OR REPLACE FUNCTION anular_cobro_orden_atomica(
  p_org_id     TEXT,
  p_orden_id   TEXT,
  p_cobro_id   TEXT,
  p_usuario_id TEXT,
  p_motivo     TEXT
) RETURNS JSONB AS $$
DECLARE
  v_cobro      RECORD;
  v_cliente_id TEXT;
  v_sucursal_id TEXT;
BEGIN
  -- 1. Lock cobro
  SELECT id, monto, anulado, metodo_pago
    INTO v_cobro
    FROM cobros_orden
    WHERE id = p_cobro_id AND orden_id = p_orden_id AND organization_id = p_org_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cobro no encontrado';
  END IF;

  -- 2. Guard: already cancelled
  IF v_cobro.anulado THEN
    RAISE EXCEPTION 'El cobro ya fue anulado';
  END IF;

  -- 3. Get cliente_id and sucursal_id from the orden
  SELECT cliente_id, sucursal_id INTO v_cliente_id, v_sucursal_id
    FROM ordenes_servicio
    WHERE id = p_orden_id AND organization_id = p_org_id;

  -- 4. FIRST reverse CC credit (FATAL — if this fails, the whole txn rolls back
  --    and anulado=true is never committed, which is exactly the fix for bug B)
  IF v_cobro.metodo_pago = 'CUENTA_CORRIENTE' AND v_cliente_id IS NOT NULL THEN
    PERFORM devolver_cuenta_corriente(
      p_org_id, v_cliente_id, v_cobro.monto,
      'ORDEN', p_orden_id, p_usuario_id,
      'Anulacion de cobro con cuenta corriente', v_sucursal_id
    );
  END IF;

  -- 5. Mark as cancelled (only runs if step 4 succeeded)
  UPDATE cobros_orden
    SET anulado       = true,
        anulado_at    = now(),
        anulado_por   = p_usuario_id,
        anulado_motivo = p_motivo
    WHERE id = p_cobro_id;

  -- 6. Recalculate cobro state
  PERFORM recalcular_estado_cobro(p_orden_id);

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION anular_cobro_orden_atomica(TEXT,TEXT,TEXT,TEXT,TEXT) IS
  'Atomic cobro cancellation for DELETE /api/ordenes/[id]/cobros. '
  'Calls devolver_cuenta_corriente BEFORE committing anulado=true so a '
  'failed devolución rolls back the entire cancellation (fixes bug B). '
  'Migration 242. Migration 269: looks up sucursal_id from the parent orden '
  'and forwards it to devolver_cuenta_corriente.';

-- ============================================================
-- 4. registrar_pago_factura_atomica + anular_factura_atomica +
--    eliminar_factura_atomica — base: migration 248 (latest CREATE OR
--    REPLACE for all three; 248 re-defines registrar_pago_factura_atomica
--    verbatim from 243 plus an ANULADA guard, so 248 — not 243 — is the
--    correct starting point). `facturas` has no sucursal_id column of its
--    own; all three already JOIN ordenes_servicio for org_id/cliente_id, so
--    sucursal_id is added to that same existing join.
-- ============================================================
CREATE OR REPLACE FUNCTION registrar_pago_factura_atomica(
  p_org_id          TEXT,
  p_factura_id      TEXT,
  p_usuario_id      TEXT,
  p_cliente_id      TEXT,
  p_observaciones   TEXT,
  p_pagos           JSONB,
  p_idempotency_key TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_factura        RECORD;
  v_cliente_id     TEXT;
  v_pendiente      DECIMAL;
  v_total_pagos    DECIMAL;
  v_pago           JSONB;
  v_pago_id        TEXT;
  v_pago_fecha     TIMESTAMPTZ;
  v_monto          DECIMAL;
  v_metodo         TEXT;
  v_referencia     TEXT;
  v_cuotas         INTEGER;
  v_recargo        DECIMAL;
  v_monto_original DECIMAL;
  v_cf_pct         DECIMAL;
  v_cf_monto       DECIMAL;
  v_pagos_array    JSONB := '[]'::JSONB;
  v_nuevo_abonado  DECIMAL;
  v_estado         TEXT;
  v_response       JSONB;
  v_existing       JSONB;
BEGIN
  -- 1. Lock factura and resolve org/cliente/sucursal via its orden
  SELECT f.*,
         o.organization_id AS org_id,
         o.cliente_id      AS orden_cliente_id,
         o.sucursal_id     AS orden_sucursal_id
    INTO v_factura
    FROM facturas f
    JOIN ordenes_servicio o ON o.id = f.orden_id
    WHERE f.id = p_factura_id
    FOR UPDATE OF f;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Factura no encontrada';
  END IF;

  IF v_factura.org_id <> p_org_id THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  -- ANULADA guard (added in migration 248)
  IF v_factura.estado_pago::text = 'ANULADA' THEN
    RAISE EXCEPTION 'No se pueden registrar pagos en una factura anulada';
  END IF;

  -- 2. Resolve cliente_id
  v_cliente_id := COALESCE(NULLIF(p_cliente_id, ''), v_factura.orden_cliente_id);

  -- 3. Validate amount
  v_pendiente   := v_factura.total - COALESCE(v_factura.monto_abonado, 0);
  v_total_pagos := COALESCE(
    (SELECT SUM((p->>'monto')::DECIMAL) FROM jsonb_array_elements(p_pagos) AS p),
    0
  );

  IF v_total_pagos > v_pendiente + 0.01 THEN
    RAISE EXCEPTION 'El monto total (%) excede el pendiente (%)',
      ROUND(v_total_pagos::NUMERIC, 2), ROUND(v_pendiente::NUMERIC, 2);
  END IF;

  -- 4. Idempotency claim INSIDE this transaction (claim+work+seal are atomic)
  IF p_idempotency_key IS NOT NULL THEN
    BEGIN
      INSERT INTO pago_idempotency (organization_id, idempotency_key, factura_id)
        VALUES (p_org_id, p_idempotency_key, p_factura_id);
    EXCEPTION WHEN unique_violation THEN
      -- A committed row always has a non-null response (claim+seal are atomic).
      -- A concurrent in-flight transaction will block here until it commits/rolls back,
      -- then this branch fires and reads the now-committed response.
      SELECT response INTO v_existing
        FROM pago_idempotency
        WHERE organization_id = p_org_id AND idempotency_key = p_idempotency_key;
      RETURN jsonb_build_object('replayed', true, 'response', v_existing);
    END;
  END IF;

  -- 5. Payment loop
  FOR v_pago IN SELECT * FROM jsonb_array_elements(p_pagos)
  LOOP
    v_monto          := (v_pago->>'monto')::DECIMAL;
    v_metodo         := v_pago->>'metodo';
    v_referencia     := NULLIF(v_pago->>'referencia', '');
    v_cuotas         := (v_pago->>'cuotas')::INTEGER;
    v_recargo        := (v_pago->>'recargo')::DECIMAL;
    v_monto_original := (v_pago->>'montoOriginal')::DECIMAL;
    v_cf_pct         := (v_pago->>'costoFinanciero')::DECIMAL;
    v_cf_monto       := CASE WHEN v_cf_pct IS NOT NULL AND v_cf_pct > 0
                              THEN ROUND(v_monto * v_cf_pct / 100.0, 2)
                              ELSE NULL END;

    -- CC: deduct from customer balance (raises on insufficient saldo → full rollback)
    -- Note: factura route does NOT do fiado reconciliation.
    IF v_metodo = 'CUENTA_CORRIENTE' AND v_cliente_id IS NOT NULL THEN
      PERFORM usar_cuenta_corriente(
        p_org_id, v_cliente_id, v_monto,
        'FACTURA', p_factura_id, p_usuario_id, v_factura.orden_sucursal_id
      );
    END IF;

    -- pagos_parciales.metodo_pago is type `metodo_pago` (not metodo_pago_venta)
    INSERT INTO pagos_parciales (
      factura_id, monto, metodo_pago, numero_referencia, observaciones,
      cuotas, recargo_porcentaje, monto_original,
      costo_financiero_porcentaje, costo_financiero_monto
    ) VALUES (
      p_factura_id, v_monto, v_metodo::metodo_pago, v_referencia, p_observaciones,
      v_cuotas, v_recargo, v_monto_original,
      v_cf_pct, v_cf_monto
    )
    RETURNING id, fecha INTO v_pago_id, v_pago_fecha;

    v_pagos_array := v_pagos_array || jsonb_build_object(
      'id',                        v_pago_id,
      'monto',                     v_monto,
      'metodoPago',                v_metodo,
      'referencia',                v_referencia,
      'fecha',                     v_pago_fecha,
      'cuotas',                    v_cuotas,
      'recargoPorcentaje',         v_recargo,
      'montoOriginal',             v_monto_original,
      'costoFinancieroPorcentaje', v_cf_pct,
      'costoFinancieroMonto',      v_cf_monto
    );
  END LOOP;

  -- 6. Update factura estado_pago
  v_nuevo_abonado := COALESCE(v_factura.monto_abonado, 0) + v_total_pagos;
  v_estado := CASE
    WHEN v_nuevo_abonado <= 0          THEN 'PENDIENTE'
    WHEN v_nuevo_abonado >= v_factura.total THEN 'PAGADO'
    ELSE                                    'PAGADO_PARCIAL'
  END;

  -- facturas.estado_pago is the enum `estado_pago` (unlike ventas which is TEXT),
  -- so cast explicitly to avoid any text→enum assignment ambiguity.
  UPDATE facturas
    SET monto_abonado = v_nuevo_abonado,
        estado_pago   = v_estado::estado_pago
    WHERE id = p_factura_id;

  -- 7. Build response (same shape as the JS route)
  v_response := jsonb_build_object(
    'pagos',    v_pagos_array,
    'factura',  jsonb_build_object(
      'montoAbonado', v_nuevo_abonado,
      'estadoPago',   v_estado,
      'pendiente',    v_factura.total - v_nuevo_abonado
    )
  );

  -- 8. Seal idempotency row
  IF p_idempotency_key IS NOT NULL THEN
    UPDATE pago_idempotency
      SET response = v_response
      WHERE organization_id = p_org_id AND idempotency_key = p_idempotency_key;
  END IF;

  RETURN jsonb_build_object('replayed', false, 'response', v_response);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION registrar_pago_factura_atomica(TEXT,TEXT,TEXT,TEXT,TEXT,JSONB,TEXT) IS
  'Atomic payment batch for /api/pagos (factura payments). '
  'Runs CC deductions (usar_cuenta_corriente), pagos_parciales inserts, '
  'and facturas update in ONE transaction. '
  'Idempotency claim is inside the same transaction so claim+seal are atomic — '
  'no partial-state window. No fiado reconciliation (factura route does not do it). '
  'Returns {replayed: bool, response: {pagos:[], factura:{}}}. '
  'Migration 248: added ANULADA guard — rejects payments on voided invoices. '
  'Migration 269: forwards orden.sucursal_id (via the existing orden join) to usar_cuenta_corriente.';

-- ============================================================
-- (2) anular_factura_atomica
-- ============================================================
CREATE OR REPLACE FUNCTION anular_factura_atomica(
  p_org_id     TEXT,
  p_factura_id TEXT,
  p_user_id    TEXT
) RETURNS JSONB AS $$
DECLARE
  v_factura RECORD;
  v_pago    RECORD;
BEGIN
  -- Lock factura row; join orden for org_id, cliente_id, and sucursal_id
  SELECT f.*, o.organization_id AS org_id, o.cliente_id AS cliente_id, o.sucursal_id AS orden_sucursal_id
    INTO v_factura
    FROM facturas f
    JOIN ordenes_servicio o ON o.id = f.orden_id
    WHERE f.id = p_factura_id
    FOR UPDATE OF f;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Factura no encontrada';
  END IF;

  IF v_factura.org_id <> p_org_id THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  IF v_factura.estado_pago::text = 'ANULADA' THEN
    RAISE EXCEPTION 'La factura ya esta anulada';
  END IF;

  -- Re-credit CC for each CUENTA_CORRIENTE partial payment
  FOR v_pago IN
    SELECT monto, metodo_pago
      FROM pagos_parciales
      WHERE factura_id = p_factura_id
  LOOP
    IF v_pago.metodo_pago::text = 'CUENTA_CORRIENTE' AND v_factura.cliente_id IS NOT NULL THEN
      PERFORM devolver_cuenta_corriente(
        p_org_id,
        v_factura.cliente_id,
        v_pago.monto,
        'FACTURA',
        p_factura_id,
        p_user_id,
        'Anulacion factura ' || v_factura.numero_factura,
        v_factura.orden_sucursal_id
      );
    END IF;
  END LOOP;

  UPDATE facturas
    SET estado_pago = 'ANULADA'::estado_pago
    WHERE id = p_factura_id;

  RETURN jsonb_build_object('ok', true);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION anular_factura_atomica(TEXT,TEXT,TEXT) IS
  'Voids a factura atomically. Guards: not-found, org mismatch, already-ANULADA. '
  'Re-credits CUENTA_CORRIENTE partial payments via devolver_cuenta_corriente. '
  'Sets estado_pago=ANULADA. Any failure rolls back everything. Migration 248. '
  'Migration 269: forwards orden.sucursal_id (via the existing orden join) to devolver_cuenta_corriente.';

-- ============================================================
-- (3) eliminar_factura_atomica
-- ============================================================
CREATE OR REPLACE FUNCTION eliminar_factura_atomica(
  p_org_id     TEXT,
  p_factura_id TEXT,
  p_user_id    TEXT
) RETURNS JSONB AS $$
DECLARE
  v_factura RECORD;
  v_pago    RECORD;
BEGIN
  -- Lock factura row; join orden for org_id, cliente_id, numero_factura, and sucursal_id
  SELECT f.*, o.organization_id AS org_id, o.cliente_id AS cliente_id, o.sucursal_id AS orden_sucursal_id
    INTO v_factura
    FROM facturas f
    JOIN ordenes_servicio o ON o.id = f.orden_id
    WHERE f.id = p_factura_id
    FOR UPDATE OF f;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Factura no encontrada';
  END IF;

  IF v_factura.org_id <> p_org_id THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  -- Re-credit CC for each CUENTA_CORRIENTE partial payment
  FOR v_pago IN
    SELECT monto, metodo_pago
      FROM pagos_parciales
      WHERE factura_id = p_factura_id
  LOOP
    IF v_pago.metodo_pago::text = 'CUENTA_CORRIENTE' AND v_factura.cliente_id IS NOT NULL THEN
      PERFORM devolver_cuenta_corriente(
        p_org_id,
        v_factura.cliente_id,
        v_pago.monto,
        'FACTURA',
        p_factura_id,
        p_user_id,
        'Eliminacion factura ' || v_factura.numero_factura,
        v_factura.orden_sucursal_id
      );
    END IF;
  END LOOP;

  DELETE FROM pagos_parciales WHERE factura_id = p_factura_id;
  DELETE FROM facturas WHERE id = p_factura_id;

  RETURN jsonb_build_object('ok', true);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION eliminar_factura_atomica(TEXT,TEXT,TEXT) IS
  'Deletes a factura atomically. Guards: not-found, org mismatch. '
  'Re-credits CUENTA_CORRIENTE partial payments via devolver_cuenta_corriente, '
  'then deletes pagos_parciales and the factura in the same transaction. '
  'Any failure (including CC credit failure) rolls back everything. Migration 248. '
  'Migration 269: forwards orden.sucursal_id (via the existing orden join) to devolver_cuenta_corriente.';

-- ============================================================
-- 5. registrar_devolucion_atomica — base: migration 247 (only prior
--    CREATE OR REPLACE definition). v_venta is `ventas%ROWTYPE` via
--    `SELECT * INTO v_venta`, so v_venta.sucursal_id is already in scope —
--    no new lookup needed, no DECLARE change.
-- ============================================================
CREATE OR REPLACE FUNCTION public.registrar_devolucion_atomica(
  p_org_id              TEXT,
  p_venta_id            TEXT,
  p_user_id             TEXT,
  p_numero_devolucion   TEXT,
  p_motivo              TEXT,
  p_observaciones       TEXT,
  p_metodo_reembolso    TEXT,
  p_reembolso_referencia TEXT,
  p_items               JSONB
) RETURNS JSONB
LANGUAGE plpgsql
AS $function$
DECLARE
  v_venta               ventas%ROWTYPE;
  v_dev_id              TEXT;
  v_tipo                TEXT;
  v_monto_devolucion    DECIMAL := 0;
  v_item_original       RECORD;
  v_already_returned    INTEGER;
  v_max_returnable      INTEGER;
  v_precio              DECIMAL;
  elem                  JSONB;
  -- For tipo computation
  v_iv                  RECORD;
  v_total_returned_after INTEGER;
  v_all_fully_returned  BOOLEAN;
  v_new_in_batch        INTEGER;
BEGIN
  -- ----------------------------------------------------------------
  -- Step 1: Lock the sale row to serialize concurrent returns (H-1)
  -- ----------------------------------------------------------------
  SELECT * INTO v_venta
  FROM ventas
  WHERE id = p_venta_id AND organization_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venta no encontrada';
  END IF;

  IF v_venta.estado::text <> 'COMPLETADA' THEN
    RAISE EXCEPTION 'Solo se pueden crear devoluciones para ventas completadas';
  END IF;

  -- ----------------------------------------------------------------
  -- Step 2: Validate each item UNDER the lock
  -- ----------------------------------------------------------------
  FOR elem IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT cantidad, precio_unitario, descripcion
    INTO v_item_original
    FROM items_venta
    WHERE id = elem->>'itemVentaId' AND venta_id = p_venta_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Item de venta no encontrado: %', elem->>'itemVentaId';
    END IF;

    SELECT COALESCE(SUM(id2.cantidad), 0)
    INTO v_already_returned
    FROM items_devolucion id2
    JOIN devoluciones_venta dv ON dv.id = id2.devolucion_id
    WHERE dv.venta_id = p_venta_id
      AND id2.item_venta_id = elem->>'itemVentaId';

    v_max_returnable := v_item_original.cantidad - v_already_returned;

    IF (elem->>'cantidad')::integer > v_max_returnable THEN
      RAISE EXCEPTION 'La cantidad a devolver excede lo permitido para "%". Maximo: %',
        v_item_original.descripcion, v_max_returnable;
    END IF;
  END LOOP;

  -- ----------------------------------------------------------------
  -- Step 3: Compute tipo (TOTAL/PARCIAL) and monto_devolucion
  -- ----------------------------------------------------------------
  -- Accumulate batch amounts and compute monto at same time
  FOR elem IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT precio_unitario INTO v_precio
    FROM items_venta
    WHERE id = elem->>'itemVentaId' AND venta_id = p_venta_id;

    v_monto_devolucion := v_monto_devolucion + (elem->>'cantidad')::integer * v_precio;
  END LOOP;

  -- Tipo: check if ALL items_venta will be fully returned after this batch
  v_all_fully_returned := TRUE;
  FOR v_iv IN SELECT id, cantidad FROM items_venta WHERE venta_id = p_venta_id
  LOOP
    -- already returned before this batch
    SELECT COALESCE(SUM(id3.cantidad), 0)
    INTO v_already_returned
    FROM items_devolucion id3
    JOIN devoluciones_venta dv3 ON dv3.id = id3.devolucion_id
    WHERE dv3.venta_id = p_venta_id
      AND id3.item_venta_id = v_iv.id;

    -- new cantidad in this batch for this item (0 if not in batch)
    SELECT COALESCE((elem2->>'cantidad')::integer, 0)
    INTO v_new_in_batch
    FROM (
      SELECT elem2 FROM jsonb_array_elements(p_items) AS elem2
      WHERE elem2->>'itemVentaId' = v_iv.id
      LIMIT 1
    ) sub;

    v_total_returned_after := v_already_returned + COALESCE(v_new_in_batch, 0);

    IF v_total_returned_after < v_iv.cantidad THEN
      v_all_fully_returned := FALSE;
      EXIT;
    END IF;
  END LOOP;

  v_tipo := CASE WHEN v_all_fully_returned THEN 'TOTAL' ELSE 'PARCIAL' END;

  -- ----------------------------------------------------------------
  -- Step 4: INSERT devoluciones_venta
  -- ----------------------------------------------------------------
  INSERT INTO devoluciones_venta (
    venta_id,
    numero_devolucion,
    motivo,
    tipo,
    monto_devolucion,
    estado,
    observaciones,
    procesado_por,
    organization_id,
    metodo_reembolso,
    reembolso_referencia,
    fecha_reembolso,
    reembolso_procesado_por
  ) VALUES (
    p_venta_id,
    p_numero_devolucion,
    p_motivo,
    v_tipo,
    v_monto_devolucion,
    'COMPLETADA',
    NULLIF(p_observaciones, ''),
    p_user_id,
    p_org_id,
    NULLIF(p_metodo_reembolso, '')::metodo_reembolso,
    NULLIF(p_reembolso_referencia, ''),
    CASE WHEN NULLIF(p_metodo_reembolso, '') IS NOT NULL THEN now() ELSE NULL END,
    CASE WHEN NULLIF(p_metodo_reembolso, '') IS NOT NULL THEN p_user_id ELSE NULL END
  ) RETURNING id INTO v_dev_id;

  -- ----------------------------------------------------------------
  -- Step 5: INSERT items_devolucion
  -- ----------------------------------------------------------------
  FOR elem IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT precio_unitario INTO v_precio
    FROM items_venta
    WHERE id = elem->>'itemVentaId' AND venta_id = p_venta_id;

    INSERT INTO items_devolucion (
      devolucion_id,
      item_venta_id,
      inventario_id,
      cantidad,
      precio_unitario,
      subtotal,
      restaurar_stock
    ) VALUES (
      v_dev_id,
      elem->>'itemVentaId',
      NULLIF(elem->>'inventarioId', ''),
      (elem->>'cantidad')::integer,
      v_precio,
      (elem->>'cantidad')::integer * v_precio,
      (elem->>'restaurarStock')::boolean
    );
  END LOOP;

  -- ----------------------------------------------------------------
  -- Step 6: Stock restoration (per item; P0002 = tolerated, others propagate)
  -- ----------------------------------------------------------------
  FOR elem IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    IF (elem->>'restaurarStock')::boolean AND NULLIF(elem->>'inventarioId', '') IS NOT NULL THEN
      BEGIN
        PERFORM registrar_devolucion_stock(
          elem->>'inventarioId',
          p_org_id,
          p_user_id,
          (elem->>'cantidad')::integer,
          v_dev_id,
          'Devolución ' || p_numero_devolucion || ' - ' || p_motivo,
          NULL,
          p_venta_id
        );

        -- Reset series: mark sold serials for this item+sale back to DISPONIBLE
        UPDATE inventario_series
        SET
          estado      = 'DISPONIBLE',
          fecha_venta = NULL,
          venta_id    = NULL,
          cliente_id  = NULL,
          updated_at  = now()
        WHERE id IN (
          SELECT id
          FROM inventario_series
          WHERE organization_id = p_org_id
            AND inventario_id   = elem->>'inventarioId'
            AND venta_id        = p_venta_id
            AND estado::text   IN ('VENDIDO', 'GARANTIA_ACTIVA')
          ORDER BY fecha_venta DESC
          LIMIT (elem->>'cantidad')::integer
        );

      EXCEPTION
        WHEN SQLSTATE 'P0002' THEN
          RAISE WARNING 'Devolución %: inventario % no encontrado, stock no restaurado',
            p_numero_devolucion, elem->>'inventarioId';
        -- All other exceptions propagate → full rollback
      END;
    END IF;
  END LOOP;

  -- ----------------------------------------------------------------
  -- Step 7: CC refund — FATAL (no handler → rolls back on failure; fixes H-2)
  -- ----------------------------------------------------------------
  IF NULLIF(p_metodo_reembolso, '') = 'CUENTA_CORRIENTE' AND v_venta.cliente_id IS NOT NULL THEN
    PERFORM devolver_cuenta_corriente(
      p_org_id,
      v_venta.cliente_id,
      v_monto_devolucion,
      'VENTA',
      p_venta_id,
      p_user_id,
      'Devolucion ' || p_numero_devolucion,
      v_venta.sucursal_id
    );
  END IF;

  -- ----------------------------------------------------------------
  -- Step 8: Return result
  -- ----------------------------------------------------------------
  RETURN jsonb_build_object(
    'id',              v_dev_id,
    'tipo',            v_tipo,
    'montoDevolucion', v_monto_devolucion
  );

END;
$function$;

COMMENT ON FUNCTION public.registrar_devolucion_atomica(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB) IS
  'Atomic return registration with FOR UPDATE lock on venta. '
  'Fixes H-1 (TOCTOU: concurrent returns both passing validation) and '
  'H-2 (non-atomic writes: CC refund swallowed, items_devolucion partial failure). '
  'Migration 247. Migration 269: forwards v_venta.sucursal_id to devolver_cuenta_corriente.';

-- ============================================================
-- 6. crear_nota_credito — base: migration 235 (latest CREATE OR REPLACE;
--    supersedes 186/214). Already derives v_sucursal_id from the parent
--    venta/orden for its OWN notas_credito row — it just never forwarded
--    that value to the CC call. Reuses the existing v_sucursal_id variable,
--    no new DECLARE needed.
-- ============================================================
CREATE OR REPLACE FUNCTION crear_nota_credito(
  p_org_id           TEXT,
  p_venta_id         TEXT,
  p_orden_id         TEXT,
  p_motivo           TEXT,
  p_monto            NUMERIC,
  p_metodo_devolucion TEXT,
  p_notas            TEXT,
  p_user_id          TEXT,
  p_items            JSONB
)
RETURNS JSON AS $$
DECLARE
  v_nc_id     TEXT;
  v_numero    TEXT;
  v_item      JSONB;
  v_inv_id    TEXT;
  v_cant      INTEGER;
  v_restock   BOOLEAN;
  v_sucursal_id TEXT;
  v_cliente_id TEXT;
BEGIN
  -- Derive sucursal_id from parent (single source of truth)
  IF p_venta_id IS NOT NULL THEN
    SELECT sucursal_id INTO v_sucursal_id FROM ventas WHERE id = p_venta_id;
  ELSIF p_orden_id IS NOT NULL THEN
    SELECT sucursal_id INTO v_sucursal_id FROM ordenes_servicio WHERE id = p_orden_id;
  END IF;

  v_numero := get_next_nota_credito_number(p_org_id);

  INSERT INTO notas_credito (
    organization_id, numero, venta_id, orden_id, motivo, monto,
    metodo_devolucion, user_id, notas, sucursal_id
  ) VALUES (
    p_org_id, v_numero, p_venta_id, p_orden_id, p_motivo, p_monto,
    p_metodo_devolucion, p_user_id, p_notas, v_sucursal_id
  )
  RETURNING id INTO v_nc_id;

  -- Acreditar a cuenta corriente si el reembolso es a CC
  IF p_metodo_devolucion = 'CUENTA_CORRIENTE' THEN
    IF p_venta_id IS NOT NULL THEN
      SELECT cliente_id INTO v_cliente_id FROM ventas WHERE id = p_venta_id;
    ELSIF p_orden_id IS NOT NULL THEN
      SELECT cliente_id INTO v_cliente_id FROM ordenes_servicio WHERE id = p_orden_id;
    END IF;
    IF v_cliente_id IS NOT NULL THEN
      PERFORM devolver_cuenta_corriente(p_org_id, v_cliente_id, p_monto,
        'NOTA_CREDITO', v_nc_id, p_user_id, 'Nota de credito', v_sucursal_id);
    END IF;
  END IF;

  IF p_items IS NOT NULL THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      v_inv_id  := v_item->>'inventario_id';
      v_cant    := (v_item->>'cantidad')::INTEGER;
      v_restock := COALESCE((v_item->>'restock')::BOOLEAN, TRUE);

      INSERT INTO items_nota_credito (
        nota_credito_id, item_venta_id, inventario_id,
        descripcion, cantidad, precio_unitario, restock
      ) VALUES (
        v_nc_id,
        v_item->>'item_venta_id',
        v_inv_id,
        v_item->>'descripcion',
        v_cant,
        (v_item->>'precio_unitario')::NUMERIC,
        v_restock
      );

      -- Restock atomico
      IF v_restock AND v_inv_id IS NOT NULL THEN
        UPDATE inventario SET stock = stock + v_cant WHERE id = v_inv_id;
        INSERT INTO movimientos_inventario (
          inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
          referencia_id, referencia_tipo, observaciones, organization_id, usuario_id
        )
        SELECT
          v_inv_id, 'DEVOLUCION', v_cant, stock - v_cant, stock,
          v_nc_id, 'nota_credito',
          'Restock por nota de crédito ' || v_numero, p_org_id, p_user_id
        FROM inventario WHERE id = v_inv_id;
      END IF;
    END LOOP;
  END IF;

  RETURN json_build_object('success', true, 'id', v_nc_id, 'numero', v_numero);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION crear_nota_credito(TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, JSONB) IS
  'Crea nota de crédito con items y restock atómico. sucursal_id derivado in-RPC del padre (venta o orden). Si metodo_devolucion = CUENTA_CORRIENTE, acredita via devolver_cuenta_corriente. Migration 269: now forwards the already-derived v_sucursal_id to devolver_cuenta_corriente.';
