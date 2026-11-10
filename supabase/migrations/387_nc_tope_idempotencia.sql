-- Migration 387: notas de credito de ordenes con tope de lo cobrado e
-- idempotencia. Marcador: nc_tope_idempotencia
--
-- Base: crear_nota_credito de la 269 (ultimo CREATE OR REPLACE; supersede
-- 186/214/235). Cambia solo esto:
--
--   1. Bloquea la orden (FOR UPDATE, acotada a la organizacion) antes de nada.
--      Dos NC simultaneas de la misma orden se serializan aca, y un reintento
--      con la misma clave espera a que el primero confirme y lo ve.
--   2. Tope: la suma de las NC activas (anulada = false) de la orden mas la
--      nueva no puede superar lo cobrado de la orden. "Cobrado" es
--      total_cobrado_orden() (345): GREATEST(cobros_orden no anulados, pagos
--      parciales de la factura no anulada). Es la misma fuente que
--      recalcular_estado_cobro escribe en ordenes_servicio.total_cobrado (lo que
--      el front muestra como totalCobrado), calculada en vivo despues del lock en
--      vez de leer la columna, que puede estar desactualizada. Error: P0040.
--   3. p_idempotency_key (columna e indice unico de la 350): un reintento con la
--      misma clave devuelve la NC ya creada con 'replayed' = true y no escribe
--      nada (ni NC, ni cuenta corriente, ni stock). Clave de otra orden: P0041.
--   4. sucursal_id y cliente_id salen de la fila bloqueada. La rama de venta se
--      va: desde la 350 el CHECK notas_credito_solo_ordenes la rechazaba igual.
--
-- Firma nueva = la de la 269 + p_idempotency_key TEXT DEFAULT NULL al final. Se
-- borra la vieja: con las dos, PostgREST no puede elegir para una llamada con
-- los 9 parametros con nombre. El codigo actual (9 parametros) sigue andando
-- contra la funcion nueva por el DEFAULT: la migracion va ANTES que el codigo.
--
-- Permisos: la 269 no tenia REVOKE/GRANT (quedaba ejecutable por anon y
-- authenticated). La unica que la llama es la ruta, con service_role: se cierra
-- como las RPC de devolucion (356).
--
-- Sin BEGIN/COMMIT: db-run.mjs envuelve el archivo en una transaccion.

DROP FUNCTION IF EXISTS crear_nota_credito(TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, JSONB);

CREATE OR REPLACE FUNCTION crear_nota_credito(
  p_org_id            TEXT,
  p_venta_id          TEXT,
  p_orden_id          TEXT,
  p_motivo            TEXT,
  p_monto             NUMERIC,
  p_metodo_devolucion TEXT,
  p_notas             TEXT,
  p_user_id           TEXT,
  p_items             JSONB,
  p_idempotency_key   TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  v_nc_id       TEXT;
  v_numero      TEXT;
  v_item        JSONB;
  v_inv_id      TEXT;
  v_cant        INTEGER;
  v_restock     BOOLEAN;
  v_sucursal_id TEXT;
  v_cliente_id  TEXT;
  v_cobrado     NUMERIC;
  v_previas     NUMERIC;
  v_existente   RECORD;
BEGIN
  IF p_venta_id IS NOT NULL OR p_orden_id IS NULL THEN
    RAISE EXCEPTION 'La nota de crédito tiene que ser de una orden' USING ERRCODE = '22023';
  END IF;

  -- 1. Lock de la orden. Lo primero: el resto se lee despues, en sentencias
  --    aparte, para ver lo confirmado mientras se esperaba el lock.
  SELECT sucursal_id, cliente_id INTO v_sucursal_id, v_cliente_id
  FROM ordenes_servicio WHERE id = p_orden_id AND organization_id = p_org_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada' USING ERRCODE = 'P0002';
  END IF;

  -- 2. Reintento del mismo pedido
  IF NULLIF(p_idempotency_key, '') IS NOT NULL THEN
    SELECT id, numero, orden_id INTO v_existente
    FROM notas_credito
    WHERE organization_id = p_org_id AND idempotency_key = p_idempotency_key;

    IF FOUND THEN
      IF v_existente.orden_id IS DISTINCT FROM p_orden_id THEN
        RAISE EXCEPTION 'La clave de idempotencia ya se usó en otra orden' USING ERRCODE = 'P0041';
      END IF;
      RETURN json_build_object(
        'success', true, 'id', v_existente.id, 'numero', v_existente.numero, 'replayed', true
      );
    END IF;
  END IF;

  -- 3. Tope: NC activas de la orden + esta <= lo cobrado
  v_cobrado := COALESCE(total_cobrado_orden(p_orden_id), 0);

  SELECT COALESCE(SUM(monto), 0) INTO v_previas
  FROM notas_credito WHERE orden_id = p_orden_id AND anulada = false;

  IF v_previas + p_monto > v_cobrado THEN
    RAISE EXCEPTION 'La nota de crédito supera lo cobrado de la orden. Cobrado: %, en otras notas de crédito: %, disponible: %',
      ROUND(v_cobrado, 2), ROUND(v_previas, 2), ROUND(GREATEST(v_cobrado - v_previas, 0), 2)
      USING ERRCODE = 'P0040';
  END IF;

  v_numero := get_next_nota_credito_number(p_org_id);

  INSERT INTO notas_credito (
    organization_id, numero, venta_id, orden_id, motivo, monto,
    metodo_devolucion, user_id, notas, sucursal_id, idempotency_key
  ) VALUES (
    p_org_id, v_numero, NULL, p_orden_id, p_motivo, p_monto,
    p_metodo_devolucion, p_user_id, p_notas, v_sucursal_id, NULLIF(p_idempotency_key, '')
  )
  RETURNING id INTO v_nc_id;

  -- Acreditar a cuenta corriente si el reembolso es a CC
  IF p_metodo_devolucion = 'CUENTA_CORRIENTE' AND v_cliente_id IS NOT NULL THEN
    PERFORM devolver_cuenta_corriente(p_org_id, v_cliente_id, p_monto,
      'NOTA_CREDITO', v_nc_id, p_user_id, 'Nota de credito', v_sucursal_id);
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

REVOKE EXECUTE ON FUNCTION crear_nota_credito(TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, JSONB, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION crear_nota_credito(TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, JSONB, TEXT)
  TO service_role;

COMMENT ON FUNCTION crear_nota_credito(TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, JSONB, TEXT) IS
  'Crea la nota de credito de una orden con items y restock atomico. Bloquea la orden; '
  'rechaza (P0040) si las NC activas de la orden mas esta superan total_cobrado_orden(); '
  'p_idempotency_key devuelve la NC ya creada (replayed). Si metodo_devolucion = '
  'CUENTA_CORRIENTE, acredita via devolver_cuenta_corriente con la sucursal de la orden. '
  'Migracion 387 (base: 269).';
