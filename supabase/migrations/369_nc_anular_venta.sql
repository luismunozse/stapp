-- Migration 369: anular una nota de credito de venta.
--
-- Spec: docs/superpowers/specs/2026-10-07-notas-de-credito-design.md (Anulacion)
-- Plan: docs/superpowers/plans/2026-10-20-notas-credito-pr4-ventas-anular.md (PR4c)
-- Requiere la 368 (series_devueltas; los lectores ya ignoran las anuladas) y la
-- 367 (movimientos_caja.devolucion_id con su indice unico por tipo).
--
-- anular_devolucion_venta deja la venta, el stock, las series, las garantias,
-- la cuenta corriente y la caja como estaban antes de la NC, en una sola
-- transaccion, y marca la NC anulada: queda visible y su numero no se reusa.
--
-- Bloqueos (no cambia nada): motivo vacio; venta anulada; NC del historial
-- (DEV-); no es la NC activa mas reciente de la venta (LIFO: el calculo de una
-- NC TOTAL y la garantia por linea dependen de las anteriores); devolvio
-- productos con serie antes de la 368; no hay stock en el deposito para volver
-- a descontar; una serie ya no esta como la dejo la NC.
-- Reintento (doble click, red): una NC ya anulada devuelve lo hecho, sin
-- revertir dos veces.
--
-- Reversas:
--   stock     sale de nuevo lo que la NC repuso, del mismo deposito (sus
--             movimientos DEVOLUCION), con un movimiento ANULACION negativo.
--   series    vuelven al estado guardado en items_devolucion.series_devueltas.
--   garantia  ANULADA -> ACTIVA si la linea deja de estar devuelta entera.
--   deuda     estado_pago se recalcula sin la NC.
--   cuenta    un CARGO por cada credito que hizo la NC (lo que bajo la deuda y
--   corriente el saldo a favor), con referencia a la VENTA: si despues se anula
--             la venta, la 334 lo neta junto con el resto.
--   caja      el egreso en efectivo vuelve como INGRESO enlazado a la NC (el
--             indice unico de la 367 admite uno). Una NC sin egreso enlazado
--             (la ruta lo grababa, antes del PR3b) busca el que grabo la ruta,
--             "Devolución NC-...", por el mismo monto y posterior a la NC, y lo
--             enlaza; si no hay ninguno no entra plata y la respuesta lo avisa
--             (efectivoSinEgreso).
--
-- Sin BEGIN/COMMIT. Sin tablas, columnas ni FK nuevas.

-- ── 0. Requiere la 368 ─────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'items_devolucion'
                   AND column_name = 'series_devueltas') THEN
    RAISE EXCEPTION 'Abort: falta items_devolucion.series_devueltas. Aplicar la 368 antes de la 369.';
  END IF;
END $$;

CREATE FUNCTION public.anular_devolucion_venta(
  p_org_id        TEXT,
  p_venta_id      TEXT,
  p_devolucion_id TEXT,
  p_user_id       TEXT,
  p_motivo        TEXT
) RETURNS JSONB
LANGUAGE plpgsql
AS $function$
DECLARE
  v_venta       ventas%ROWTYPE;
  v_dev         devoluciones_venta%ROWTYPE;
  v_motivo      TEXT := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  v_reembolso   DECIMAL;
  v_ultima_id   TEXT;
  v_ultima      TEXT;
  v_nombre      TEXT;
  v_linea       RECORD;
  v_serie       JSONB;
  v_actual      inventario_series%ROWTYPE;
  v_mov         RECORD;
  v_stock       INTEGER;
  v_dep         TEXT;
  v_disponible  INTEGER;
  v_serie_ids   TEXT[];
  v_vendidas    INTEGER;
  v_otras       INTEGER;
  v_filas       INTEGER;
  v_unidades    INTEGER := 0;
  v_series      INTEGER := 0;
  v_garantias   INTEGER := 0;
  v_cc          DECIMAL := 0;
  v_cargo       JSONB;
  v_cobertura   DECIMAL;
  v_egreso      movimientos_caja%ROWTYPE;
  v_sesion_id   TEXT;
  v_ingreso_id  TEXT;
  v_sin_egreso  BOOLEAN := false;
BEGIN
  -- 1. El mismo lock que toman la emision (367) y los cobros (331): una
  --    anulacion y otra NC, o dos anulaciones, de la misma venta se serializan.
  SELECT * INTO v_venta FROM ventas
  WHERE id = p_venta_id AND organization_id = p_org_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venta no encontrada';
  END IF;

  SELECT * INTO v_dev FROM devoluciones_venta
  WHERE id = p_devolucion_id AND venta_id = p_venta_id AND organization_id = p_org_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nota de crédito no encontrada';
  END IF;
  v_reembolso := v_dev.monto_devolucion - v_dev.monto_aplicado_deuda;

  -- 2. Ya anulada: lo hecho la primera vez, sin revertir otra vez.
  IF v_dev.anulada THEN
    SELECT id INTO v_ingreso_id FROM movimientos_caja
    WHERE devolucion_id = v_dev.id AND tipo = 'INGRESO';
    RETURN jsonb_build_object(
      'id', v_dev.id, 'numero', v_dev.numero_devolucion, 'ventaId', p_venta_id,
      'anuladaAt', v_dev.anulada_at,
      'montoDevolucion', v_dev.monto_devolucion, 'montoAplicadoDeuda', v_dev.monto_aplicado_deuda,
      'montoReembolso', v_reembolso, 'metodoReembolso', v_dev.metodo_reembolso::TEXT,
      'movimientoCajaId', v_ingreso_id,
      'efectivoSinEgreso', COALESCE(v_dev.metodo_reembolso::TEXT = 'EFECTIVO' AND v_reembolso > 0
                                    AND v_ingreso_id IS NULL, false),
      'replayed', true);
  END IF;

  -- 3. Bloqueos
  IF v_motivo IS NULL THEN
    RAISE EXCEPTION 'El motivo de la anulación es obligatorio';
  END IF;
  IF v_venta.estado::TEXT = 'ANULADA' THEN
    RAISE EXCEPTION 'La venta está anulada: sus notas de crédito ya no se pueden anular';
  END IF;
  IF v_dev.numero_devolucion NOT LIKE 'NC-%' THEN
    RAISE EXCEPTION 'Las devoluciones anteriores a las notas de crédito (DEV-) no se pueden anular';
  END IF;

  -- LIFO por numero. El NC- se asigna adentro de la transaccion que emite, con
  -- la venta bloqueada (367): dentro de una venta sigue el orden de emision.
  -- created_at no sirve: es now(), el inicio de la transaccion, y una que empezo
  -- antes pudo esperar el lock y emitir despues. Todos tienen el mismo ancho
  -- (NC-000123) y las DEV- quedan debajo; COLLATE "C" compara por bytes.
  SELECT id, numero_devolucion INTO v_ultima_id, v_ultima
  FROM devoluciones_venta
  WHERE venta_id = p_venta_id AND anulada = false
  ORDER BY numero_devolucion COLLATE "C" DESC
  LIMIT 1;
  IF v_ultima_id IS DISTINCT FROM v_dev.id THEN
    RAISE EXCEPTION 'Solo se puede anular la nota de crédito más reciente de la venta: primero anulá la %', v_ultima;
  END IF;

  -- Antes de la 368 no quedaba registro de que series volvieron.
  SELECT iv.descripcion INTO v_nombre
  FROM items_devolucion idv
  JOIN items_venta iv ON iv.id = idv.item_venta_id
  WHERE idv.devolucion_id = v_dev.id
    AND idv.inventario_id IS NOT NULL
    AND idv.series_devueltas IS NULL
    AND EXISTS (SELECT 1 FROM inventario_series s
                WHERE s.inventario_id = idv.inventario_id AND s.organization_id = p_org_id)
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'La nota de crédito devolvió "%" antes de que el sistema guardara qué números de serie volvían: no se puede anular', v_nombre;
  END IF;

  -- 4. Locks en el orden de la venta (332) y de la emision (368): primero los
  --    productos que la NC repuso, despues sus series y su stock por deposito.
  PERFORM 1 FROM inventario
  WHERE organization_id = p_org_id
    AND id IN (SELECT m.inventario_id FROM movimientos_inventario m
               WHERE m.referencia_id = v_dev.id AND m.tipo = 'DEVOLUCION' AND m.organization_id = p_org_id)
  ORDER BY id
  FOR UPDATE;

  -- 5. Series: vuelven al estado que guardo la NC (368). Antes que el stock: una
  --    serie revendida tambien bajo el stock, y el mensaje tiene que nombrar la
  --    serie, no la falta de stock.
  FOR v_linea IN
    SELECT idv.restaurar_stock, idv.series_devueltas
    FROM items_devolucion idv
    WHERE idv.devolucion_id = v_dev.id
      AND jsonb_array_length(COALESCE(idv.series_devueltas, '[]'::jsonb)) > 0
  LOOP
    FOR v_serie IN SELECT * FROM jsonb_array_elements(v_linea.series_devueltas)
    LOOP
      SELECT * INTO v_actual FROM inventario_series
      WHERE id = v_serie->>'id' AND organization_id = p_org_id
      FOR UPDATE;
      -- La NC la dejo DISPONIBLE y sin venta (volvio al stock) o DEVUELTO con la
      -- venta (no volvio). Si ya no esta asi, se vendio, se reservo o se borro.
      IF NOT FOUND
         OR (COALESCE(v_linea.restaurar_stock, false)
             AND NOT (v_actual.estado = 'DISPONIBLE' AND v_actual.venta_id IS NULL))
         OR (NOT COALESCE(v_linea.restaurar_stock, false)
             AND NOT (v_actual.estado = 'DEVUELTO' AND v_actual.venta_id IS NOT DISTINCT FROM p_venta_id)) THEN
        RAISE EXCEPTION 'La serie % ya no está como la dejó la nota de crédito (se volvió a vender, se reservó o se borró): no se puede anular',
          COALESCE(v_serie->>'numero_serie', v_serie->>'id');
      END IF;

      UPDATE inventario_series
      SET estado = v_serie->>'estado',
          venta_id = p_venta_id,
          cliente_id = (SELECT c.id FROM clientes c WHERE c.id = v_serie->>'cliente_id'),
          fecha_venta = (v_serie->>'fecha_venta')::TIMESTAMPTZ,
          fecha_garantia_vence = (v_serie->>'fecha_garantia_vence')::DATE,
          updated_at = now()
      WHERE id = v_actual.id;
      v_series := v_series + 1;
    END LOOP;
  END LOOP;

  -- 6. Stock: lo que la NC repuso sale de nuevo, del mismo deposito.
  FOR v_mov IN
    SELECT m.inventario_id, m.deposito_id, SUM(m.cantidad)::INTEGER AS cantidad
    FROM movimientos_inventario m
    WHERE m.referencia_id = v_dev.id AND m.tipo = 'DEVOLUCION' AND m.organization_id = p_org_id
    GROUP BY m.inventario_id, m.deposito_id
    ORDER BY m.inventario_id, m.deposito_id
  LOOP
    SELECT stock, nombre INTO v_stock, v_nombre FROM inventario
    WHERE id = v_mov.inventario_id AND organization_id = p_org_id
    FOR UPDATE;
    v_dep := COALESCE(v_mov.deposito_id, get_deposito_principal(p_org_id));
    SELECT stock - stock_reservado INTO v_disponible FROM inventario_depositos
    WHERE inventario_id = v_mov.inventario_id AND deposito_id = v_dep
    FOR UPDATE;
    IF COALESCE(v_disponible, 0) < v_mov.cantidad OR COALESCE(v_stock, 0) < v_mov.cantidad THEN
      RAISE EXCEPTION 'No hay stock de "%" en % para volver a descontar lo que devolvió la nota de crédito: hay %, hacen falta %',
        v_nombre, COALESCE((SELECT nombre FROM depositos WHERE id = v_dep), 'el depósito principal'),
        GREATEST(COALESCE(v_disponible, 0), 0), v_mov.cantidad;
    END IF;

    SELECT COALESCE(array_agg(s->>'id'), ARRAY[]::TEXT[]) INTO v_serie_ids
    FROM items_devolucion idv, jsonb_array_elements(COALESCE(idv.series_devueltas, '[]'::jsonb)) s
    WHERE idv.devolucion_id = v_dev.id AND idv.inventario_id = v_mov.inventario_id
      AND COALESCE(idv.restaurar_stock, false);

    UPDATE inventario SET stock = stock - v_mov.cantidad, updated_at = now()
    WHERE id = v_mov.inventario_id;
    v_dep := descontar_stock_deposito(v_mov.inventario_id, p_org_id, v_mov.deposito_id, v_mov.cantidad, true);

    INSERT INTO movimientos_inventario (
      inventario_id, tipo, cantidad, stock_anterior, stock_posterior, referencia_id, referencia_tipo,
      observaciones, usuario_id, organization_id, deposito_id, serie_ids
    ) VALUES (
      v_mov.inventario_id, 'ANULACION', -v_mov.cantidad, v_stock, v_stock - v_mov.cantidad, v_dev.id,
      'ANULACION_DEVOLUCION_VENTA', 'Anulación de la nota de crédito ' || v_dev.numero_devolucion,
      p_user_id, p_org_id, v_dep, NULLIF(v_serie_ids, ARRAY[]::TEXT[])
    );
    v_unidades := v_unidades + v_mov.cantidad;
  END LOOP;

  -- 7. Garantia: la linea que la NC dejo devuelta entera vuelve a estar vendida.
  --    Solo esa NC la pudo pasar a ANULADA (la venta no esta anulada).
  FOR v_linea IN
    SELECT idv.item_venta_id, SUM(idv.cantidad)::INTEGER AS cantidad
    FROM items_devolucion idv
    WHERE idv.devolucion_id = v_dev.id
    GROUP BY idv.item_venta_id
  LOOP
    SELECT cantidad INTO v_vendidas FROM items_venta
    WHERE id = v_linea.item_venta_id AND venta_id = p_venta_id;

    SELECT COALESCE(SUM(id2.cantidad), 0) INTO v_otras
    FROM items_devolucion id2
    JOIN devoluciones_venta dv2 ON dv2.id = id2.devolucion_id
    WHERE dv2.venta_id = p_venta_id AND dv2.anulada = false AND dv2.id <> v_dev.id
      AND id2.item_venta_id = v_linea.item_venta_id;

    IF v_vendidas IS NOT NULL AND v_otras < v_vendidas AND v_otras + v_linea.cantidad >= v_vendidas THEN
      UPDATE garantias_venta SET estado = 'ACTIVA'
      WHERE organization_id = p_org_id AND item_venta_id = v_linea.item_venta_id AND estado::TEXT = 'ANULADA';
      GET DIAGNOSTICS v_filas = ROW_COUNT;
      v_garantias := v_garantias + v_filas;
    END IF;
  END LOOP;

  -- 8. Cuenta corriente: un CARGO por cada credito que hizo la NC (330 paso 7 y
  --    367), con referencia a la venta. Si el cliente ya uso el saldo a favor,
  --    queda debiendo (spec).
  IF v_venta.cliente_id IS NOT NULL AND v_dev.monto_aplicado_deuda > 0 THEN
    v_cargo := cargar_deuda_cuenta_corriente(
      p_org_id, v_venta.cliente_id, v_dev.monto_aplicado_deuda, 'VENTA', p_venta_id, p_user_id, v_venta.sucursal_id);
    UPDATE cuenta_corriente
    SET observaciones = 'Anulación de la nota de crédito ' || v_dev.numero_devolucion || ' (vuelve la deuda de la venta)'
    WHERE id = v_cargo->>'id';
    v_cc := v_cc + v_dev.monto_aplicado_deuda;
  END IF;
  IF v_venta.cliente_id IS NOT NULL AND v_reembolso > 0 AND v_dev.metodo_reembolso::TEXT = 'CUENTA_CORRIENTE' THEN
    v_cargo := cargar_deuda_cuenta_corriente(
      p_org_id, v_venta.cliente_id, v_reembolso, 'VENTA', p_venta_id, p_user_id, v_venta.sucursal_id);
    UPDATE cuenta_corriente
    SET observaciones = 'Anulación de la nota de crédito ' || v_dev.numero_devolucion || ' (sale el saldo a favor)'
    WHERE id = v_cargo->>'id';
    v_cc := v_cc + v_reembolso;
  END IF;

  -- 9. La deuda vuelve: estado_pago sin esta NC. La NC lo toco solo si bajo deuda.
  IF v_dev.monto_aplicado_deuda > 0 THEN
    SELECT COALESCE(v_venta.monto_abonado, 0) + COALESCE(SUM(monto_aplicado_deuda), 0) INTO v_cobertura
    FROM devoluciones_venta
    WHERE venta_id = p_venta_id AND anulada = false AND id <> v_dev.id;
    UPDATE ventas
    SET estado_pago = CASE
          WHEN v_cobertura >= v_venta.total THEN 'PAGADO'
          WHEN v_cobertura > 0 THEN 'PAGADO_PARCIAL'
          ELSE 'PENDIENTE'
        END
    WHERE id = p_venta_id;
  END IF;

  -- 10. Caja: el efectivo que salio vuelve a entrar, enlazado a la NC.
  IF v_dev.metodo_reembolso::TEXT = 'EFECTIVO' AND v_reembolso > 0 THEN
    SELECT * INTO v_egreso FROM movimientos_caja
    WHERE devolucion_id = v_dev.id AND tipo = 'EGRESO';
    IF NOT FOUND THEN
      -- Sin egreso enlazado: lo grababa la ruta, fuera de la RPC, con este
      -- concepto (antes del PR3b). La regla es "no hay egreso enlazado", no la
      -- fecha de la NC: la 367 pudo estar aplicada con la ruta vieja en produccion.
      -- La ruta lo grababa por el reintegro exacto y despues de la RPC (otro
      -- pedido, mas tarde): un egreso manual con el mismo texto, por otro monto o
      -- anterior a la NC, no es ese.
      SELECT * INTO v_egreso FROM movimientos_caja
      WHERE organization_id = p_org_id AND tipo = 'EGRESO' AND devolucion_id IS NULL
        AND metodo_pago = 'EFECTIVO' AND concepto = 'Devolución ' || v_dev.numero_devolucion
        AND monto = v_reembolso AND created_at >= v_dev.created_at
      ORDER BY created_at, id
      LIMIT 1
      FOR UPDATE;
      IF FOUND THEN
        UPDATE movimientos_caja SET devolucion_id = v_dev.id WHERE id = v_egreso.id;
      END IF;
    END IF;

    IF v_egreso.id IS NOT NULL THEN
      -- La caja abierta de la sucursal de la venta AHORA; nunca una cerrada ni
      -- la de otra sucursal. Sin caja abierta queda sin sesion, como el egreso.
      SELECT id INTO v_sesion_id FROM sesiones_caja
      WHERE organization_id = p_org_id AND sucursal_id = v_venta.sucursal_id AND estado = 'ABIERTA'
      LIMIT 1;
      INSERT INTO movimientos_caja (
        organization_id, sesion_caja_id, tipo, monto, metodo_pago, concepto, observaciones,
        usuario_id, afecta_rentabilidad, sucursal_id, origen, devolucion_id
      ) VALUES (
        p_org_id, v_sesion_id, 'INGRESO', v_egreso.monto, 'EFECTIVO',
        'Anulación de nota de crédito ' || v_dev.numero_devolucion || ' - Venta V'
          || LPAD(v_venta.numero_venta::TEXT, GREATEST(length(v_venta.numero_venta::TEXT), 4), '0'),
        'Vuelve a la caja el efectivo que se le había devuelto al cliente',
        p_user_id, false, COALESCE(v_venta.sucursal_id, v_egreso.sucursal_id), 'DEVOLUCION', v_dev.id
      ) RETURNING id INTO v_ingreso_id;
    ELSE
      -- No hay egreso que revertir (el de la ruta fallo): un ingreso dejaria la
      -- caja con un sobrante. La respuesta lo avisa.
      v_sin_egreso := true;
    END IF;
  END IF;

  -- 11. La NC queda anulada: visible, con su numero, sin efecto.
  UPDATE devoluciones_venta
  SET anulada = true, anulada_at = now(), anulada_por = p_user_id, anulada_motivo = v_motivo, updated_at = now()
  WHERE id = v_dev.id;

  RETURN jsonb_build_object(
    'id', v_dev.id, 'numero', v_dev.numero_devolucion, 'ventaId', p_venta_id, 'anuladaAt', now(),
    'montoDevolucion', v_dev.monto_devolucion, 'montoAplicadoDeuda', v_dev.monto_aplicado_deuda,
    'montoReembolso', v_reembolso, 'metodoReembolso', v_dev.metodo_reembolso::TEXT,
    'unidadesDescontadas', v_unidades, 'seriesRestauradas', v_series, 'garantiasReactivadas', v_garantias,
    'cargoCuentaCorriente', v_cc, 'movimientoCajaId', v_ingreso_id, 'efectivoSinEgreso', v_sin_egreso,
    'replayed', false);
END;
$function$;

COMMENT ON FUNCTION public.anular_devolucion_venta(TEXT, TEXT, TEXT, TEXT, TEXT) IS
  'Anula una nota de credito de venta (devoluciones_venta): solo la activa mas reciente (LIFO), solo NC-, '
  'con motivo. Revierte stock (mismo deposito), series (series_devueltas), garantia, cuenta corriente (CARGO '
  'con referencia a la venta), estado_pago y caja (INGRESO enlazado). Reintento idempotente. Solo '
  'service_role; la llama POST /api/ventas/[id]/devolucion/[devolucionId]/anular (ADMIN). Migracion 369.';

REVOKE EXECUTE ON FUNCTION public.anular_devolucion_venta(TEXT, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anular_devolucion_venta(TEXT, TEXT, TEXT, TEXT, TEXT)
  TO service_role;
