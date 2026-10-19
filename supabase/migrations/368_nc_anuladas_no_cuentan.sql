-- Migration 368: las notas de credito anuladas dejan de contar, y cada NC
-- guarda que numeros de serie devolvio.
--
-- Spec: docs/superpowers/specs/2026-10-07-notas-de-credito-design.md (Anulacion)
-- Plan: docs/superpowers/plans/2026-10-20-notas-credito-pr4-ventas-anular.md (PR4b)
-- Requiere la 367 (envoltorio de 14 parametros) y la 350 (columna anulada).
--
-- Hasta hoy ninguna NC de venta se anula (anulada es false en todas), asi que
-- los lectores de devoluciones_venta suman todas. La 369 trae la anulacion;
-- antes, esta migracion hace que los lectores en SQL ignoren las anuladas:
--   1. registrar_devolucion_nucleo (cuerpo de la 330): sus cinco sumas (ya
--      devuelto por linea, devolucion TOTAL, tope, lo que ya bajo la deuda y el
--      retiro de garantia).
--   2. registrar_pagos_venta_atomica (331): el pendiente que se puede cobrar.
--   3. restore_stock_on_cancel (334): lo devuelto al anular la venta.
--   4. v_comisiones_ventas (333) y el chequeo 4 de v_cc_drift (245).
-- Con anulada = false en todas las filas, cada una hace exactamente lo mismo que
-- su version anterior: aplicarla no cambia nada de lo que ya anda.
--
-- Ademas el nucleo guarda en items_devolucion.series_devueltas las series que
-- retira cada linea, con su estado anterior. Al volver al stock la serie pierde
-- venta_id y cliente_id: sin este registro la anulacion no sabria cuales eran.
--
-- Las funciones y vistas son copias textuales de su ultima version con los
-- cambios marcados "368:" (lo verifica __tests__/notas-credito-migraciones.test.ts).
-- Misma firma: CREATE OR REPLACE conserva los permisos; igual se repiten, solo
-- service_role. Las vistas repiten security_invoker (347): CREATE OR REPLACE
-- VIEW sin la opcion la pierde.
--
-- Sin BEGIN/COMMIT: db-run.mjs y el editor SQL corren el archivo en una sola
-- transaccion. Locks, hasta el final de la transaccion (aplicar fuera del pico
-- del POS): ACCESS EXCLUSIVE sobre items_devolucion (ADD COLUMN nula, sin
-- reescritura) y sobre las dos vistas; SHARE ROW EXCLUSIVE sobre inventario (la
-- FK de la seccion 1b se valida contra items_devolucion, que es chica: mientras
-- tanto no se escribe inventario). lock_timeout acota la ESPERA de esos locks:
-- si aborta por timeout no se aplico nada; re-correr.

SET LOCAL lock_timeout = '3s';

-- ── 0. Requiere la 367 ─────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.registrar_devolucion_atomica(text,text,text,text,text,text,text,text,jsonb,text,text,numeric,text,boolean)') IS NULL THEN
    RAISE EXCEPTION 'Abort: falta el envoltorio de 14 parametros. Aplicar la 367 antes de la 368.';
  END IF;
END $$;

-- ── 1. Series que devolvio cada linea ──────────────────────────────────────
ALTER TABLE items_devolucion ADD COLUMN IF NOT EXISTS series_devueltas JSONB;

COMMENT ON COLUMN items_devolucion.series_devueltas IS
  'Series que retiro esta linea, con su estado anterior: [{id, numero_serie, estado, cliente_id, '
  'fecha_venta, fecha_garantia_vence}]. [] si no habia; NULL en las lineas anteriores a la 368 (no se '
  'sabe cuales). La anulacion de la NC (369) las deja como estaban. Migracion 368.';

-- ── 1b. Purga de un taller que devolvio productos de su inventario ────────
-- items_devolucion.inventario_id (043) es NO ACTION. Al borrar la org (purga de
-- la eliminacion de cuenta), la cascada borra inventario en la generacion 1 y su
-- chequeo NO ACTION contra items_devolucion corre en la 2, ANTES que la cascada
-- devoluciones_venta -> items_devolucion: la purga falla con
--   violates foreign key constraint "items_devolucion_inventario_id_fkey"
-- en todo taller que haya devuelto un producto de su inventario. Mismo arreglo
-- que la 351: SET NULL no depende del orden de la cola de triggers RI. Desde la
-- app un producto con devoluciones no se borra (guards de inventario), asi que
-- el SET NULL solo actua en la purga. Sin IF EXISTS: si el nombre no es el del
-- pre-flight, tiene que fallar fuerte.
ALTER TABLE items_devolucion DROP CONSTRAINT items_devolucion_inventario_id_fkey;
ALTER TABLE items_devolucion ADD CONSTRAINT items_devolucion_inventario_id_fkey
  FOREIGN KEY (inventario_id) REFERENCES inventario(id) ON DELETE SET NULL;

-- ── 2. Nucleo: las anuladas no cuentan y las series quedan registradas ─────
-- Copia textual de 330_devolucion_descuenta_saldo.sql (lineas 45-448) con el
-- nombre que le dio la 356 y los cambios marcados "368:".
CREATE OR REPLACE FUNCTION public.registrar_devolucion_nucleo(
  p_org_id              TEXT,
  p_venta_id            TEXT,
  p_user_id             TEXT,
  p_numero_devolucion   TEXT,
  p_motivo              TEXT,
  p_observaciones       TEXT,
  p_metodo_reembolso    TEXT,
  p_reembolso_referencia TEXT,
  p_items               JSONB,
  p_idempotency_key     TEXT DEFAULT NULL
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
  v_unit_net            DECIMAL;
  elem                  JSONB;
  -- For tipo computation
  v_iv                  RECORD;
  v_total_returned_after INTEGER;
  v_all_fully_returned  BOOLEAN;
  v_new_in_batch        INTEGER;
  -- Refund math (net proportional to venta.total)
  v_neto_total          DECIMAL := 0;
  v_neto_devuelto       DECIMAL := 0;
  v_prior_refunded      DECIMAL := 0;
  v_remaining           DECIMAL := 0;
  v_paid_unit           DECIMAL;
  -- Warranty retirement (Step 6 / 6b)
  v_line_sold           INTEGER;
  v_line_returned       INTEGER;
  v_line_warranty_days  INTEGER;
  -- 330: saldo pendiente, metodo normalizado, idempotencia
  v_existente           devoluciones_venta%ROWTYPE;
  v_inv_id              TEXT;
  v_metodo              TEXT;
  v_aplicado_prev       DECIMAL := 0;
  v_pendiente           DECIMAL := 0;
  v_aplicado            DECIMAL := 0;
  v_reembolso           DECIMAL := 0;
  v_cobertura           DECIMAL := 0;
  -- 368: las series que retira cada linea (paso 6), con su estado anterior
  v_serie_ids           TEXT[];
  v_series              JSONB;
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

  -- 330: reintento del mismo pedido (doble click, red). El FOR UPDATE de arriba
  -- serializa los dos: el segundo llega aca cuando el primero ya commiteo.
  IF NULLIF(p_idempotency_key, '') IS NOT NULL THEN
    SELECT * INTO v_existente
    FROM devoluciones_venta
    WHERE organization_id = p_org_id AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'id', v_existente.id, 'tipo', v_existente.tipo,
        'montoDevolucion', v_existente.monto_devolucion,
        'montoAplicadoDeuda', v_existente.monto_aplicado_deuda,
        'montoReembolso', v_existente.monto_devolucion - v_existente.monto_aplicado_deuda,
        'replayed', true
      );
    END IF;
  END IF;

  -- 330: "credito en tienda" es saldo a favor en la cuenta del cliente. Antes
  -- no movia nada: el cliente se iba con un credito que no quedaba registrado.
  v_metodo := NULLIF(p_metodo_reembolso, '');
  IF v_metodo = 'CREDITO_TIENDA' THEN
    v_metodo := 'CUENTA_CORRIENTE';
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
      AND dv.anulada = false  -- 368: lo que devolvio una NC anulada se puede volver a devolver
      AND id2.item_venta_id = elem->>'itemVentaId';

    v_max_returnable := v_item_original.cantidad - v_already_returned;

    IF (elem->>'cantidad')::integer > v_max_returnable THEN
      RAISE EXCEPTION 'La cantidad a devolver excede lo permitido para "%". Maximo: %',
        v_item_original.descripcion, v_max_returnable;
    END IF;
  END LOOP;

  -- ----------------------------------------------------------------
  -- Step 3: Compute tipo (TOTAL/PARCIAL) and monto_devolucion (NETO)
  -- ----------------------------------------------------------------
  -- Neto total de la venta = Σ (bruto de línea − descuento de línea).
  SELECT COALESCE(SUM(
           (iv.cantidad * iv.precio_unitario)
           - CASE
               WHEN iv.tipo_descuento = 'PORCENTAJE'
                 THEN (iv.cantidad * iv.precio_unitario) * COALESCE(iv.porcentaje_descuento, 0) / 100.0
               ELSE LEAST(COALESCE(iv.descuento, 0), iv.cantidad * iv.precio_unitario)
             END
         ), 0)
  INTO v_neto_total
  FROM items_venta iv
  WHERE iv.venta_id = p_venta_id;

  -- Neto de las unidades devueltas en este batch.
  FOR elem IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_unit_net := devolucion_unit_net(elem->>'itemVentaId', p_venta_id);
    v_neto_devuelto := v_neto_devuelto + v_unit_net * (elem->>'cantidad')::integer;
  END LOOP;

  -- Tipo: check if ALL items_venta will be fully returned after this batch
  v_all_fully_returned := TRUE;
  FOR v_iv IN SELECT id, cantidad FROM items_venta WHERE venta_id = p_venta_id
  LOOP
    SELECT COALESCE(SUM(id3.cantidad), 0)
    INTO v_already_returned
    FROM items_devolucion id3
    JOIN devoluciones_venta dv3 ON dv3.id = id3.devolucion_id
    WHERE dv3.venta_id = p_venta_id
      AND dv3.anulada = false  -- 368
      AND id3.item_venta_id = v_iv.id;

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

  -- Reembolso = porción proporcional de venta.total (pliega global + IVA), con
  -- cap contra lo ya devuelto y true-up exacto en la devolución TOTAL, de modo
  -- que la suma de reembolsos de una venta nunca supere venta.total.
  -- 368: el tope no descuenta lo que acredito una NC anulada.
  SELECT COALESCE(SUM(monto_devolucion), 0) INTO v_prior_refunded
  FROM devoluciones_venta WHERE venta_id = p_venta_id AND anulada = false;

  v_remaining := GREATEST(ROUND(COALESCE(v_venta.total, 0) - v_prior_refunded, 2), 0);

  IF v_tipo = 'TOTAL' THEN
    v_monto_devolucion := v_remaining;
  ELSIF v_neto_total > 0 THEN
    v_monto_devolucion := LEAST(
      ROUND(COALESCE(v_venta.total, 0) * v_neto_devuelto / v_neto_total, 2),
      v_remaining
    );
  ELSE
    v_monto_devolucion := 0;
  END IF;

  -- 330: lo que el cliente todavia debe de esta venta se descuenta primero; solo
  -- se reembolsa lo que exceda. Antes una venta fiada devuelta entera se
  -- "reembolsaba" en efectivo y la deuda seguia en la cuenta del cliente.
  -- 368: lo que bajo una NC anulada se vuelve a deber.
  SELECT COALESCE(SUM(monto_aplicado_deuda), 0) INTO v_aplicado_prev
  FROM devoluciones_venta WHERE venta_id = p_venta_id AND anulada = false;

  v_pendiente := GREATEST(
    COALESCE(v_venta.total, 0) - COALESCE(v_venta.monto_abonado, 0) - v_aplicado_prev, 0);
  v_aplicado := LEAST(v_monto_devolucion, v_pendiente);
  v_reembolso := v_monto_devolucion - v_aplicado;

  IF v_reembolso > 0 AND v_metodo = 'CUENTA_CORRIENTE' AND v_venta.cliente_id IS NULL THEN
    RAISE EXCEPTION 'Para devolver a cuenta corriente la venta tiene que tener un cliente';
  END IF;

  -- ----------------------------------------------------------------
  -- Step 4: INSERT devoluciones_venta
  -- ----------------------------------------------------------------
  INSERT INTO devoluciones_venta (
    venta_id, numero_devolucion, motivo, tipo, monto_devolucion, estado,
    observaciones, procesado_por, organization_id,
    metodo_reembolso, reembolso_referencia, fecha_reembolso, reembolso_procesado_por,
    monto_aplicado_deuda, idempotency_key
  ) VALUES (
    p_venta_id, p_numero_devolucion, p_motivo, v_tipo, v_monto_devolucion, 'COMPLETADA',
    NULLIF(p_observaciones, ''), p_user_id, p_org_id,
    v_metodo::metodo_reembolso,
    NULLIF(p_reembolso_referencia, ''),
    CASE WHEN v_metodo IS NOT NULL AND v_reembolso > 0 THEN now() ELSE NULL END,
    CASE WHEN v_metodo IS NOT NULL AND v_reembolso > 0 THEN p_user_id ELSE NULL END,
    v_aplicado, NULLIF(p_idempotency_key, '')
  ) RETURNING id INTO v_dev_id;

  -- ----------------------------------------------------------------
  -- Step 5: INSERT items_devolucion (precio PAGADO por unidad: neto de línea
  -- escalado por venta.total/neto_total, así los subtotales reconcilian con
  -- monto_devolucion).
  -- ----------------------------------------------------------------
  FOR elem IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_unit_net := devolucion_unit_net(elem->>'itemVentaId', p_venta_id);
    v_paid_unit := CASE
                     WHEN v_neto_total > 0
                       THEN v_unit_net * COALESCE(v_venta.total, 0) / v_neto_total
                     ELSE 0
                   END;

    -- 330: el producto sale del item vendido, no del body (antes se podia
    -- reponer stock de cualquier producto mandando otro inventarioId).
    SELECT inventario_id INTO v_inv_id
    FROM items_venta WHERE id = elem->>'itemVentaId' AND venta_id = p_venta_id;

    INSERT INTO items_devolucion (
      devolucion_id, item_venta_id, inventario_id, cantidad, precio_unitario, subtotal, restaurar_stock
    ) VALUES (
      v_dev_id,
      elem->>'itemVentaId',
      v_inv_id,
      (elem->>'cantidad')::integer,
      ROUND(v_paid_unit, 2),
      ROUND(v_paid_unit * (elem->>'cantidad')::integer, 2),
      (elem->>'restaurarStock')::boolean
    );
  END LOOP;

  -- ----------------------------------------------------------------
  -- Step 6: Stock restoration + retiro de series
  -- ----------------------------------------------------------------
  FOR elem IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT inventario_id INTO v_inv_id
    FROM items_venta WHERE id = elem->>'itemVentaId' AND venta_id = p_venta_id;

    IF v_inv_id IS NULL THEN
      CONTINUE;
    END IF;

    -- fecha_garantia_vence está sobrecargado: registrar_series_ingreso
    -- (175_lotes_series.sql:431) lo estampa en el ALTA con la garantía del
    -- PROVEEDOR, y la venta solo lo pisa cuando la línea llevaba días de
    -- garantía (ELSE fecha_garantia_vence). Si la línea se vendió con 0 días, lo
    -- que hay ahí es del proveedor y borrarlo destruye dato bueno.
    SELECT dias_garantia INTO v_line_warranty_days
    FROM items_venta
    WHERE id = elem->>'itemVentaId' AND venta_id = p_venta_id;

    IF (elem->>'restaurarStock')::boolean THEN
      BEGIN
        PERFORM registrar_devolucion_stock(
          v_inv_id, p_org_id, p_user_id,
          (elem->>'cantidad')::integer, v_dev_id,
          'Devolución ' || p_numero_devolucion || ' - ' || p_motivo,
          NULL, p_venta_id
        );
      EXCEPTION
        WHEN SQLSTATE 'P0002' THEN
          RAISE WARNING 'Devolución %: inventario % no encontrado, stock no restaurado',
            p_numero_devolucion, v_inv_id;
      END;
    END IF;

    -- Las series se retiran con o sin reposición: la unidad dejó de estar en
    -- manos del cliente en ambos casos. `fecha_garantia_vence` se limpia solo
    -- si la puso esta venta — si la serie vuelve al stock con la fecha del
    -- comprador anterior, marcar_serie_vendida (175) la relee al revenderla y
    -- la marca GARANTIA_ACTIVA heredando una garantía que nadie compró.
    -- 368: las series que retira esta linea se eligen primero, con el mismo
    -- criterio de la 330, y se guarda como estaban (items_devolucion.series_devueltas):
    -- la anulacion de la NC (369) las deja exactamente asi.
    SELECT COALESCE(array_agg(s.id), ARRAY[]::TEXT[]),
           COALESCE(jsonb_agg(jsonb_build_object(
             'id', s.id, 'numero_serie', s.numero_serie, 'estado', s.estado,
             'cliente_id', s.cliente_id, 'fecha_venta', s.fecha_venta,
             'fecha_garantia_vence', s.fecha_garantia_vence)), '[]'::jsonb)
    INTO v_serie_ids, v_series
    FROM (
      SELECT id, numero_serie, estado, cliente_id, fecha_venta, fecha_garantia_vence
      FROM inventario_series
      WHERE organization_id = p_org_id
        AND inventario_id   = v_inv_id
        AND venta_id        = p_venta_id
        AND estado::text   IN ('VENDIDO', 'GARANTIA_ACTIVA')
      ORDER BY fecha_venta DESC
      LIMIT (elem->>'cantidad')::integer
      FOR UPDATE
    ) s;

    IF (elem->>'restaurarStock')::boolean THEN
      -- Vuelve a stock: se corta el vínculo con la venta, si no una devolución
      -- posterior de otra línea podría re-elegir la misma serie.
      UPDATE inventario_series
      SET estado = 'DISPONIBLE', fecha_venta = NULL, venta_id = NULL,
          cliente_id = NULL, fecha_garantia_vence = CASE
            WHEN COALESCE(v_line_warranty_days, 0) > 0 THEN NULL
            ELSE fecha_garantia_vence END, updated_at = now()
      WHERE id = ANY(v_serie_ids);
    ELSE
      -- Sin reposición no vuelve al stock vendible: queda DEVUELTO, y se
      -- conserva venta_id como rastro de de dónde salió.
      UPDATE inventario_series
      SET estado = 'DEVUELTO', fecha_garantia_vence = CASE
            WHEN COALESCE(v_line_warranty_days, 0) > 0 THEN NULL
            ELSE fecha_garantia_vence END, updated_at = now()
      WHERE id = ANY(v_serie_ids);
    END IF;

    -- 368: una fila de items_devolucion por elemento: la primera de esta linea
    -- que todavia no tiene series registradas (un mismo item repetido en
    -- p_items llena una fila cada vez).
    UPDATE items_devolucion
    SET series_devueltas = v_series
    WHERE id = (
      SELECT id FROM items_devolucion
      WHERE devolucion_id = v_dev_id
        AND item_venta_id = elem->>'itemVentaId'
        AND series_devueltas IS NULL
      ORDER BY id
      LIMIT 1
    );
  END LOOP;

  -- ----------------------------------------------------------------
  -- Step 6b: Retirar la garantía de las líneas que quedaron 100% devueltas
  -- ----------------------------------------------------------------
  -- Corre DESPUÉS del Step 5, así que items_devolucion ya incluye este batch y
  -- el acumulado se lee de una sola fuente. Solo ACTIVA: una RECLAMADA ya tiene
  -- historia propia y una VENCIDA cumplió su plazo — reescribirlas borraría por
  -- qué terminaron así.
  FOR elem IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT cantidad INTO v_line_sold
    FROM items_venta
    WHERE id = elem->>'itemVentaId' AND venta_id = p_venta_id;

    SELECT COALESCE(SUM(id4.cantidad), 0)
    INTO v_line_returned
    FROM items_devolucion id4
    JOIN devoluciones_venta dv4 ON dv4.id = id4.devolucion_id
    WHERE dv4.venta_id = p_venta_id
      AND dv4.anulada = false  -- 368
      AND id4.item_venta_id = elem->>'itemVentaId';

    IF v_line_sold IS NOT NULL AND v_line_returned >= v_line_sold THEN
      UPDATE garantias_venta
      SET estado = 'ANULADA'
      WHERE organization_id = p_org_id
        AND item_venta_id   = elem->>'itemVentaId'
        AND estado::text    = 'ACTIVA';
    END IF;
  END LOOP;

  -- ----------------------------------------------------------------
  -- Step 7: CC refund — FATAL (no handler → rolls back on failure; fixes H-2)
  -- ----------------------------------------------------------------
  -- 330: primero lo que descuenta la deuda de la venta (compensa su CARGO),
  -- despues el reembolso a cuenta corriente, solo por el excedente.
  IF v_aplicado > 0 AND v_venta.cliente_id IS NOT NULL THEN
    PERFORM devolver_cuenta_corriente(
      p_org_id, v_venta.cliente_id, v_aplicado,
      'VENTA', p_venta_id, p_user_id,
      'Devolucion ' || p_numero_devolucion || ' (descuenta saldo pendiente)', v_venta.sucursal_id
    );
  END IF;

  IF v_reembolso > 0 AND v_metodo = 'CUENTA_CORRIENTE' THEN
    PERFORM devolver_cuenta_corriente(
      p_org_id, v_venta.cliente_id, v_reembolso,
      'VENTA', p_venta_id, p_user_id,
      'Devolucion ' || p_numero_devolucion, v_venta.sucursal_id
    );
  END IF;

  -- 330: estado de pago con lo que la devolucion cubrio del saldo
  IF v_aplicado > 0 THEN
    v_cobertura := COALESCE(v_venta.monto_abonado, 0) + v_aplicado_prev + v_aplicado;
    UPDATE ventas
    SET estado_pago = CASE
          WHEN v_cobertura >= v_venta.total THEN 'PAGADO'
          WHEN v_cobertura > 0 THEN 'PAGADO_PARCIAL'
          ELSE 'PENDIENTE'
        END
    WHERE id = p_venta_id;
  END IF;

  -- ----------------------------------------------------------------
  -- Step 8: Return result
  -- ----------------------------------------------------------------
  RETURN jsonb_build_object(
    'id', v_dev_id, 'tipo', v_tipo, 'montoDevolucion', v_monto_devolucion,
    'montoAplicadoDeuda', v_aplicado, 'montoReembolso', v_reembolso,
    'replayed', false
  );

END;
$function$;

COMMENT ON FUNCTION public.registrar_devolucion_nucleo(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) IS
  'Devolucion de productos de una venta: cuerpo de la 330 (renombrado en la 356). Migracion 368: las NC '
  'anuladas no cuentan en ninguna suma, y cada linea guarda en items_devolucion.series_devueltas las series '
  'que retiro con su estado anterior. Solo la llama registrar_devolucion_atomica.';

REVOKE EXECUTE ON FUNCTION public.registrar_devolucion_nucleo(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_devolucion_nucleo(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT)
  TO service_role;

-- ── 3. Cobros de una venta: lo que bajo una NC anulada se vuelve a deber ────
-- Copia textual de 331_cobros_venta_idempotencia_y_cliente.sql (lineas 33-222)
-- con el cambio marcado "368:".
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
  v_aplicado_dev   DECIMAL := 0;
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

  -- 2. Idempotency claim ANTES de validar el monto (331). Si el primer pedido
  --    ya se cobro, el pendiente bajo y el reintento fallaba con "excede el
  --    pendiente": el cajero veia un error por un cobro que si se hizo y lo
  --    volvia a cargar. La claim va dentro de la transaccion: si algo de abajo
  --    falla, se deshace con todo lo demas.
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

  -- 3. Validate amount. Lo que las devoluciones descontaron del saldo (330)
  --    ya no se debe.
  --    368: salvo lo de una NC anulada, que se vuelve a deber.
  SELECT COALESCE(SUM(monto_aplicado_deuda), 0) INTO v_aplicado_dev
  FROM devoluciones_venta WHERE venta_id = p_venta_id AND anulada = false;

  v_pendiente   := v_venta.total - COALESCE(v_venta.monto_abonado, 0) - v_aplicado_dev;
  v_total_pagos := COALESCE((SELECT SUM((p->>'monto')::DECIMAL) FROM jsonb_array_elements(p_pagos) AS p), 0);

  IF v_total_pagos > v_pendiente + 0.01 THEN
    RAISE EXCEPTION 'El monto total (%) excede el pendiente (%)',
      ROUND(v_total_pagos::NUMERIC, 2), ROUND(GREATEST(v_pendiente, 0)::NUMERIC, 2);
  END IF;

  -- 4. Cliente: siempre el de la venta (331). Antes p_cliente_id le ganaba y
  --    se podia descontar saldo a favor, o acreditar el pago del fiado, en la
  --    cuenta de otro cliente.
  v_cliente_id := v_venta.cliente_id;

  IF v_cliente_id IS NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_pagos) AS p WHERE p->>'metodo' = 'CUENTA_CORRIENTE'
  ) THEN
    RAISE EXCEPTION 'Para cobrar con saldo a favor la venta tiene que tener un cliente';
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
    WHEN v_nuevo_abonado + v_aplicado_dev >= v_venta.total THEN 'PAGADO'
    WHEN v_nuevo_abonado + v_aplicado_dev > 0             THEN 'PAGADO_PARCIAL'
    ELSE                                                       'PENDIENTE'
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
      'pendiente',    GREATEST(v_venta.total - v_nuevo_abonado - v_aplicado_dev, 0)
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

REVOKE EXECUTE ON FUNCTION public.registrar_pagos_venta_atomica(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_pagos_venta_atomica(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT)
  TO service_role;

-- ── 4. Anular una venta: lo devuelto por una NC anulada volvio a salir ─────
-- Copia textual de 334_anular_venta_series_y_garantias.sql (lineas 17-122) con
-- el cambio marcado "368:". Sin el UPDATE de garantias del final de la 334.
CREATE OR REPLACE FUNCTION restore_stock_on_cancel()
RETURNS TRIGGER AS $$
DECLARE
  v_item RECORD;
  v_dep_origen TEXT;
  v_saldo DECIMAL;
  v_nuevo DECIMAL;
  v_neto DECIMAL;
  v_ya_devuelto DECIMAL;
BEGIN
  IF OLD.estado = 'COMPLETADA' AND NEW.estado = 'ANULADA' THEN
    FOR v_item IN
      SELECT iv.inventario_id, iv.cantidad, iv.id AS item_id, iv.dias_garantia, i.stock
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

      -- 334: TODO lo devuelto, no solo lo que volvio al stock. Lo devuelto sin
      -- reponer (roto, descartado) ya no esta en ningun lado: sumarlo al
      -- anular inflaba el stock con unidades que no existen.
      SELECT COALESCE(SUM(id2.cantidad), 0) INTO v_ya_devuelto
      FROM items_devolucion id2
      JOIN devoluciones_venta dv ON dv.id = id2.devolucion_id
      WHERE dv.venta_id = NEW.id
        AND dv.anulada = false  -- 368: lo que devolvio una NC anulada volvio a salir
        AND id2.item_venta_id = v_item.item_id;

      IF GREATEST(v_item.cantidad - v_ya_devuelto, 0) = 0 THEN CONTINUE; END IF;

      -- Record movement
      INSERT INTO movimientos_inventario (
        inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
        referencia_id, referencia_tipo, organization_id,
        deposito_id
      ) VALUES (
        v_item.inventario_id, 'ANULACION', GREATEST(v_item.cantidad - v_ya_devuelto, 0),
        v_item.stock, v_item.stock + GREATEST(v_item.cantidad - v_ya_devuelto, 0),
        NEW.id, 'ANULACION_VENTA', NEW.organization_id,
        v_dep_origen
      );

      -- Restore aggregate stock
      UPDATE inventario SET stock = stock + GREATEST(v_item.cantidad - v_ya_devuelto, 0)
      WHERE id = v_item.inventario_id;

      -- Dual-write: restore per-deposit stock to the same deposit it was taken from.
      -- Cast a INTEGER: incrementar_stock_deposito espera INTEGER y v_ya_devuelto es DECIMAL.
      PERFORM incrementar_stock_deposito(
        v_item.inventario_id, NEW.organization_id, v_dep_origen,
        GREATEST(v_item.cantidad - v_ya_devuelto, 0)::INTEGER);

      -- 334: las series que la venta entrego vuelven a estar disponibles (el
      -- stock ya volvio; sin esto el producto figuraba con stock y sin series
      -- para venderlo). Las ya devueltas no estan en VENDIDO/GARANTIA_ACTIVA.
      -- fecha_garantia_vence solo se limpia si la puso esta venta (mismo
      -- criterio que la devolucion, mig 317).
      UPDATE inventario_series
      SET estado = 'DISPONIBLE', venta_id = NULL, cliente_id = NULL, fecha_venta = NULL,
          fecha_garantia_vence = CASE
            WHEN COALESCE(v_item.dias_garantia, 0) > 0 THEN NULL
            ELSE fecha_garantia_vence END,
          updated_at = NOW()
      WHERE venta_id = NEW.id
        AND inventario_id = v_item.inventario_id
        AND estado::text IN ('VENDIDO', 'GARANTIA_ACTIVA');
    END LOOP;

    -- 334: la venta se deshizo entera: sus garantias no cubren nada. Solo las
    -- ACTIVA: una RECLAMADA o VENCIDA tiene historia propia.
    UPDATE garantias_venta
    SET estado = 'ANULADA'
    WHERE venta_id = NEW.id
      AND estado::text = 'ACTIVA';

    -- Reversa net-zero de TODO lo que la venta movio en cuenta corriente.
    IF NEW.cliente_id IS NOT NULL THEN
      SELECT COALESCE(SUM(monto), 0) INTO v_neto
      FROM cuenta_corriente
      WHERE referencia_id = NEW.id AND referencia_tipo = 'VENTA'
        AND tipo IN ('CARGO','USO','PAGO','DEVOLUCION');

      IF v_neto <> 0 THEN
        SELECT saldo_cuenta INTO v_saldo FROM clientes WHERE id = NEW.cliente_id FOR UPDATE;
        v_nuevo := COALESCE(v_saldo, 0) - v_neto;
        INSERT INTO cuenta_corriente (
          organization_id, cliente_id, tipo, monto, saldo_posterior,
          referencia_tipo, referencia_id, observaciones,
          sucursal_id
        ) VALUES (
          NEW.organization_id, NEW.cliente_id, 'AJUSTE', -v_neto, v_nuevo,
          'VENTA', NEW.id, 'Reversa por anulacion de venta',
          NEW.sucursal_id
        );
        UPDATE clientes SET saldo_cuenta = v_nuevo WHERE id = NEW.cliente_id;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Como toda funcion que se redefine, solo service_role. Es la funcion de un
-- trigger: Postgres no chequea EXECUTE al dispararlo, asi que anular una venta
-- anda igual con cualquier rol que pueda actualizar ventas.
REVOKE EXECUTE ON FUNCTION public.restore_stock_on_cancel()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_stock_on_cancel()
  TO service_role;

-- ── 5. Comision del vendedor ───────────────────────────────────────────────
-- Copia textual de 333_comision_neta_de_devoluciones.sql (lineas 19-48) con el
-- security_invoker de la 347 y el cambio marcado "368:".
CREATE OR REPLACE VIEW v_comisiones_ventas WITH (security_invoker = true) AS
SELECT
  v.id AS venta_id,
  v.organization_id,
  v.vendedor_id,
  v.numero_venta,
  v.cliente_nombre,
  v.estado,
  v.created_at,
  v.total,
  COALESCE(v.porcentaje_comision, 0)::DECIMAL(5,2) AS porcentaje_comision,
  ROUND(
    CASE
      WHEN v.comision_pagada OR COALESCE(v.total, 0) <= 0 OR dev.devuelto = 0
        THEN COALESCE(v.iva_neto, v.total)
      ELSE GREATEST(COALESCE(v.iva_neto, v.total) * (1 - dev.devuelto / v.total), 0)
    END * COALESCE(v.porcentaje_comision, 0) / 100,
    2
  )::DECIMAL(10,2) AS monto_comision,
  v.comision_pagada,
  v.fecha_pago_comision,
  v.comision_pago_notas,
  dev.devuelto::DECIMAL(10,2) AS monto_devuelto
FROM ventas v
CROSS JOIN LATERAL (
  SELECT COALESCE(SUM(d.monto_devolucion), 0) AS devuelto
  FROM devoluciones_venta d
  WHERE d.venta_id = v.id
    AND d.anulada = false  -- 368: una NC anulada no descuenta comision
) dev
WHERE v.estado = 'COMPLETADA';

REVOKE ALL ON public.v_comisiones_ventas FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_comisiones_ventas TO service_role;

-- ── 6. Reconciliacion de cuenta corriente ──────────────────────────────────
-- Copia textual de 245_v_cc_drift.sql (lineas 18-118) con el security_invoker
-- de la 347 y el cambio marcado "368:" en el chequeo 4.
CREATE OR REPLACE VIEW v_cc_drift WITH (security_invoker = true) AS

-- 1. SALDO_DESCUADRADO: el saldo denormalizado (clientes.saldo_cuenta) no coincide
--    con la suma de los movimientos del ledger. Invariante canónico: toda
--    operación de CC actualiza ambos atómicamente; si divergen, algo escribió uno
--    sin el otro (o una falla parcial de un flujo no atómico).
SELECT
  'SALDO_DESCUADRADO'::text                    AS tipo_drift,
  c.organization_id,
  c.id                                         AS cliente_id,
  c.nombre                                     AS cliente_nombre,
  NULL::text                                   AS referencia_tipo,
  NULL::text                                   AS referencia_id,
  COALESCE(c.saldo_cuenta, 0)                  AS valor_documento,
  COALESCE(cc.suma, 0)                         AS valor_ledger,
  COALESCE(c.saldo_cuenta, 0) - COALESCE(cc.suma, 0) AS diferencia
FROM clientes c
LEFT JOIN (
  SELECT cliente_id, SUM(monto) AS suma
  FROM cuenta_corriente
  GROUP BY cliente_id
) cc ON cc.cliente_id = c.id
WHERE ABS(COALESCE(c.saldo_cuenta, 0) - COALESCE(cc.suma, 0)) > 0.01

UNION ALL

-- 2. ORDEN_ENTREGADA_SIN_CARGO: orden entregada con saldo pendiente pero sin
--    movimiento CARGO en el ledger → el fiado nunca se registró (típicamente un
--    cargar_deuda_cuenta_corriente que falló de forma no-fatal en la entrega).
SELECT
  'ORDEN_ENTREGADA_SIN_CARGO'::text,
  o.organization_id,
  o.cliente_id,
  cl.nombre,
  'ORDEN'::text,
  o.id,
  (COALESCE(o.costo_final, 0) - COALESCE(o.descuento_cobro, 0) - COALESCE(o.total_cobrado, 0)) AS valor_documento,
  0::numeric AS valor_ledger,
  (COALESCE(o.costo_final, 0) - COALESCE(o.descuento_cobro, 0) - COALESCE(o.total_cobrado, 0)) AS diferencia
FROM ordenes_servicio o
LEFT JOIN clientes cl ON cl.id = o.cliente_id
WHERE o.estado::text IN ('ENTREGADO', 'ENTREGADO_SIN_REPARACION')
  AND o.cliente_id IS NOT NULL
  AND (COALESCE(o.costo_final, 0) - COALESCE(o.descuento_cobro, 0) - COALESCE(o.total_cobrado, 0)) > 0.01
  AND NOT EXISTS (
    SELECT 1 FROM cuenta_corriente cc
    WHERE cc.referencia_tipo = 'ORDEN' AND cc.referencia_id = o.id AND cc.tipo::text = 'CARGO'
  )

UNION ALL

-- 3. VENTA_PENDIENTE_SIN_CARGO: venta no anulada con saldo pendiente pero sin
--    CARGO en el ledger → el fiado de la venta no se registró.
SELECT
  'VENTA_PENDIENTE_SIN_CARGO'::text,
  v.organization_id,
  v.cliente_id,
  cl.nombre,
  'VENTA'::text,
  v.id,
  (COALESCE(v.total, 0) - COALESCE(v.monto_abonado, 0)) AS valor_documento,
  0::numeric AS valor_ledger,
  (COALESCE(v.total, 0) - COALESCE(v.monto_abonado, 0)) AS diferencia
FROM ventas v
LEFT JOIN clientes cl ON cl.id = v.cliente_id
WHERE v.estado::text <> 'ANULADA'
  AND v.cliente_id IS NOT NULL
  AND (COALESCE(v.total, 0) - COALESCE(v.monto_abonado, 0)) > 0.01
  AND NOT EXISTS (
    SELECT 1 FROM cuenta_corriente cc
    WHERE cc.referencia_tipo = 'VENTA' AND cc.referencia_id = v.id AND cc.tipo::text = 'CARGO'
  )

UNION ALL

-- 4. DEVOLUCION_CC_SIN_CREDITO: devolución completada con reembolso a cuenta
--    corriente pero sin movimiento DEVOLUCION en el ledger → el crédito al cliente
--    nunca se aplicó (devolver_cuenta_corriente que falló de forma no-fatal).
--    Granularidad por venta: si hubo varias devoluciones a CC sobre la misma venta
--    y existe al menos un DEVOLUCION, no se marca (conservador: evita falsos
--    positivos a costa de posibles falsos negativos).
SELECT
  'DEVOLUCION_CC_SIN_CREDITO'::text,
  dv.organization_id,
  v.cliente_id,
  cl.nombre,
  'VENTA'::text,
  dv.venta_id,
  dv.monto_devolucion AS valor_documento,
  0::numeric AS valor_ledger,
  dv.monto_devolucion AS diferencia
FROM devoluciones_venta dv
JOIN ventas v ON v.id = dv.venta_id
LEFT JOIN clientes cl ON cl.id = v.cliente_id
WHERE dv.estado::text = 'COMPLETADA'
  AND dv.anulada = false  -- 368: una NC anulada no acredita nada
  AND dv.metodo_reembolso::text = 'CUENTA_CORRIENTE'
  AND v.cliente_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM cuenta_corriente cc
    WHERE cc.referencia_tipo = 'VENTA' AND cc.referencia_id = dv.venta_id AND cc.tipo::text = 'DEVOLUCION'
  );

REVOKE ALL ON public.v_cc_drift FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_cc_drift TO service_role;
