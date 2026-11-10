-- Rollback de la 387 (nc_tope_idempotencia): vuelve crear_nota_credito al
-- cuerpo y la firma de la 269 (9 parametros, sin tope ni idempotencia).
--
-- No pierde datos: las NC creadas con la 387 conservan su idempotency_key (la
-- columna es de la 350). Antes de aplicarlo, desplegar el codigo anterior: el
-- actual llama con p_idempotency_key y contra la firma de 9 parametros falla.
--
-- La 269 no tenia REVOKE/GRANT: la funcion recreada queda con los permisos por
-- defecto, como estaba.
--
-- Sin BEGIN/COMMIT: db-run.mjs envuelve el archivo en una transaccion.

DROP FUNCTION IF EXISTS crear_nota_credito(TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, JSONB, TEXT);

-- Cuerpo verbatim de la 269 (seccion 6).
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
