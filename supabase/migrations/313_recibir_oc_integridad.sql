-- ============================================================
-- Migración 313: integridad de la recepción de órdenes de compra
--
-- Recibir mercadería mueve stock, pero las invariantes vivían solo en el
-- diálogo. El RPC anterior (206) tenía cuatro agujeros:
--
--   1. No filtraba `inventario` por organization_id. El inventarioId lo manda
--      el cliente, así que un admin podía sumarle stock a un artículo de OTRA
--      organización. (adjust_stock_atomic sí filtra; acá se había salteado.)
--   2. Sin clave de idempotencia: un reenvío volvía a sumar cantidad y stock.
--      Las recepciones totales quedaban protegidas de casualidad porque el
--      estado pasaba a RECIBIDA y la ruta rechazaba el segundo intento; las
--      PARCIALES no, porque RECIBIDA_PARCIAL sigue siendo recibible.
--   3. La validación de estado vivía en la ruta, fuera de la transacción:
--      dos recepciones concurrentes leían ENVIADA y las dos aplicaban.
--   4. Un itemId ajeno a la OC hacía CONTINUE y devolvía success:true con un
--      itemsRecibidos más chico. Mercadería sin registrar, en silencio.
--
-- Lo que NO cambia (decisión de producto): se sigue pudiendo recibir MÁS de lo
-- pedido. El tope superior sano queda en el schema de la ruta.
--
-- DROP previo obligatorio: agregar parámetros crea un overload que rompe la
-- resolución de PostgREST (mismo criterio que la 206).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Registro de idempotencia
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recepciones_oc_idempotencia (
  id               TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id  TEXT NOT NULL,
  orden_compra_id  TEXT NOT NULL REFERENCES ordenes_compra(id) ON DELETE CASCADE,
  request_id       TEXT NOT NULL,
  resultado        JSONB NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- El UNIQUE es el corazón de la idempotencia: el segundo INSERT con el mismo
-- request_id espera a que la primera transacción commitee y después choca, en
-- vez de aplicar el movimiento dos veces.
CREATE UNIQUE INDEX IF NOT EXISTS recepciones_oc_idem_unq
  ON recepciones_oc_idempotencia (organization_id, request_id);

CREATE INDEX IF NOT EXISTS recepciones_oc_idem_oc_idx
  ON recepciones_oc_idempotencia (orden_compra_id);

COMMENT ON TABLE recepciones_oc_idempotencia IS
  'Una fila por recepción aceptada. Permite que un reintento devuelva el '
  'resultado original en vez de volver a sumar stock.';

-- ------------------------------------------------------------
-- 2. RPC
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS recibir_orden_compra(TEXT, TEXT, JSONB, TEXT);

CREATE OR REPLACE FUNCTION recibir_orden_compra(
  p_oc_id           TEXT,
  p_user_id         TEXT,
  p_items           JSONB,   -- [{itemId, cantidadRecibida, inventarioId?}]
  p_organization_id TEXT,
  p_request_id      TEXT,
  p_deposito_id     TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_item              JSONB;
  v_ioc               RECORD;
  v_inv_id            TEXT;
  v_inv_stock         INTEGER;
  v_estado            TEXT;
  v_cantidad          INTEGER;
  v_total_pedida      INTEGER := 0;
  v_total_recibida    INTEGER := 0;
  v_nuevo_estado      TEXT;
  v_count             INTEGER := 0;
  v_deposito_efectivo TEXT;
  v_resultado         JSONB;
  v_previo            JSONB;
BEGIN
  -- Idempotencia primero. Si este request ya se aplicó, devolvemos el mismo
  -- resultado sin tocar nada. Si hay otro corriendo con el mismo id, este
  -- INSERT espera el commit del otro y después cae en el EXCEPTION de abajo.
  SELECT resultado INTO v_previo
  FROM recepciones_oc_idempotencia
  WHERE organization_id = p_organization_id
    AND request_id = p_request_id;

  IF FOUND THEN
    RETURN v_previo || jsonb_build_object('repetido', true);
  END IF;

  -- Lock de la OC: serializa recepciones concurrentes sobre la misma orden y
  -- hace que el chequeo de estado valga dentro de la transacción, no antes.
  SELECT estado INTO v_estado
  FROM ordenes_compra
  WHERE id = p_oc_id
    AND organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden de compra no encontrada'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_estado NOT IN ('ENVIADA', 'RECIBIDA_PARCIAL') THEN
    RAISE EXCEPTION 'La orden de compra está en estado %', v_estado
      USING ERRCODE = 'P0014';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_cantidad := (v_item->>'cantidadRecibida')::INTEGER;

    IF v_cantidad IS NULL OR v_cantidad <= 0 THEN
      RAISE EXCEPTION 'Cantidad recibida inválida'
        USING ERRCODE = '22023';
    END IF;

    SELECT ioc.*
    INTO v_ioc
    FROM items_orden_compra ioc
    WHERE ioc.id = (v_item->>'itemId')
      AND ioc.orden_compra_id = p_oc_id
    FOR UPDATE;

    -- Antes era CONTINUE: la recepción devolvía éxito y el ítem no se
    -- registraba. Ahora aborta toda la transacción.
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El ítem % no pertenece a esta orden de compra', (v_item->>'itemId')
        USING ERRCODE = 'P0012';
    END IF;

    v_inv_id := COALESCE(v_item->>'inventarioId', v_ioc.inventario_id);

    IF v_inv_id IS NOT NULL THEN
      -- El filtro por organización es lo que cierra la escritura cross-tenant:
      -- el inventarioId viene del cliente.
      SELECT stock INTO v_inv_stock
      FROM inventario
      WHERE id = v_inv_id
        AND organization_id = p_organization_id
        AND deleted_at IS NULL
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'El artículo % no pertenece a tu organización', v_inv_id
          USING ERRCODE = 'P0013';
      END IF;

      IF v_ioc.inventario_id IS NULL THEN
        UPDATE items_orden_compra
        SET inventario_id = v_inv_id
        WHERE id = v_ioc.id;
      END IF;

      UPDATE inventario
      SET stock = stock + v_cantidad,
          updated_at = NOW()
      WHERE id = v_inv_id;

      v_deposito_efectivo := incrementar_stock_deposito(
        v_inv_id, p_organization_id, p_deposito_id, v_cantidad);

      INSERT INTO movimientos_inventario (
        inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
        referencia_id, referencia_tipo, usuario_id, organization_id, observaciones,
        deposito_id
      ) VALUES (
        v_inv_id, 'COMPRA_RECIBIDA', v_cantidad,
        v_inv_stock, v_inv_stock + v_cantidad,
        p_oc_id, 'ORDEN_COMPRA', p_user_id, p_organization_id,
        'Recepción de orden de compra',
        v_deposito_efectivo
      );
    END IF;

    UPDATE items_orden_compra
    SET cantidad_recibida = cantidad_recibida + v_cantidad
    WHERE id = v_ioc.id;

    v_count := v_count + 1;
  END LOOP;

  SELECT SUM(cantidad_pedida), SUM(cantidad_recibida)
  INTO v_total_pedida, v_total_recibida
  FROM items_orden_compra
  WHERE orden_compra_id = p_oc_id;

  IF v_total_recibida >= v_total_pedida THEN
    v_nuevo_estado := 'RECIBIDA';
  ELSIF v_total_recibida > 0 THEN
    v_nuevo_estado := 'RECIBIDA_PARCIAL';
  ELSE
    v_nuevo_estado := 'ENVIADA';
  END IF;

  UPDATE ordenes_compra
  SET estado = v_nuevo_estado,
      fecha_recepcion_real = CASE
        WHEN v_nuevo_estado = 'RECIBIDA' THEN NOW()
        ELSE fecha_recepcion_real
      END
  WHERE id = p_oc_id;

  v_resultado := jsonb_build_object(
    'success', true,
    'itemsRecibidos', v_count,
    'nuevoEstado', v_nuevo_estado
  );

  INSERT INTO recepciones_oc_idempotencia (
    organization_id, orden_compra_id, request_id, resultado
  ) VALUES (
    p_organization_id, p_oc_id, p_request_id, v_resultado
  );

  RETURN v_resultado;

EXCEPTION
  WHEN unique_violation THEN
    -- Otro request con el mismo request_id ganó la carrera. Esta transacción
    -- se descarta entera (nada de lo de arriba quedó aplicado) y devolvemos
    -- el resultado que dejó el ganador.
    SELECT resultado INTO v_previo
    FROM recepciones_oc_idempotencia
    WHERE organization_id = p_organization_id
      AND request_id = p_request_id;

    IF FOUND THEN
      RETURN v_previo || jsonb_build_object('repetido', true);
    END IF;
    RAISE;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION recibir_orden_compra(TEXT, TEXT, JSONB, TEXT, TEXT, TEXT) IS
  'Recibe ítems de una OC e incrementa stock por depósito, en una transacción. '
  'Idempotente por (organization_id, request_id): un reintento devuelve el '
  'resultado original con repetido=true en vez de sumar de nuevo. '
  'Valida estado y scope de organización DENTRO de la transacción. '
  'Permite recibir más de lo pedido (decisión de producto).';
