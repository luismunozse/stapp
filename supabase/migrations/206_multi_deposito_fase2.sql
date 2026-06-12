-- 206_multi_deposito_fase2.sql
-- Fase 2 multi-depósito: las RPCs de stock (venta, reserva, ajuste, compra)
-- escriben en inventario.stock (agregado) Y en inventario_depositos (detalle).
-- Contrato: p_deposito_id explícito = validación estricta en ese depósito;
-- NULL = validación global (comportamiento previo) + drain principal-primero.
-- Invariante post-migración: inventario.stock = SUM(inventario_depositos.stock).
-- Numeración: 204/205 reservadas por PRs en vuelo (#11 labor-cost, #13 api-v1).

-- ============================================================
-- 1. HELPERS
-- ============================================================

CREATE OR REPLACE FUNCTION get_deposito_principal(p_org_id TEXT)
RETURNS TEXT AS $$
  SELECT id FROM depositos
  WHERE organization_id = p_org_id AND principal = true AND deleted_at IS NULL
  LIMIT 1;
$$ LANGUAGE sql STABLE;

-- Asegura que exista la fila (inventario, deposito).
CREATE OR REPLACE FUNCTION asegurar_fila_deposito(
  p_inventario_id TEXT,
  p_deposito_id TEXT,
  p_org_id TEXT
) RETURNS VOID AS $$
BEGIN
  INSERT INTO inventario_depositos (inventario_id, deposito_id, stock, stock_reservado, organization_id)
  VALUES (p_inventario_id, p_deposito_id, 0, 0, p_org_id)
  ON CONFLICT (inventario_id, deposito_id) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- Descuenta stock físico de inventario_depositos.
-- strict=true: solo del depósito target, error P0010 si no alcanza (stock - reservado).
-- strict=false: drain — target primero, luego otros por stock DESC. Asume que la
--   validación global ya pasó en la RPC llamadora; clampea reservado por fila
--   para respetar CHECK (stock_reservado <= stock).
-- Retorna el deposito_id donde se descontó la mayor parte (para el movimiento).
CREATE OR REPLACE FUNCTION descontar_stock_deposito(
  p_inventario_id TEXT,
  p_org_id TEXT,
  p_deposito_id TEXT,      -- NULL → principal
  p_cantidad INTEGER,
  p_strict BOOLEAN
) RETURNS TEXT AS $$
DECLARE
  v_target TEXT;
  v_restante INTEGER := p_cantidad;
  v_row RECORD;
  v_quitar INTEGER;
  v_principal_descuento INTEGER := 0;
  v_dep_resultado TEXT;
BEGIN
  v_target := COALESCE(p_deposito_id, get_deposito_principal(p_org_id));
  IF v_target IS NULL THEN
    RAISE EXCEPTION 'ORG_SIN_DEPOSITO_PRINCIPAL: %', p_org_id USING ERRCODE = 'P0011';
  END IF;

  PERFORM asegurar_fila_deposito(p_inventario_id, v_target, p_org_id);

  IF p_strict THEN
    SELECT * INTO v_row FROM inventario_depositos
    WHERE inventario_id = p_inventario_id AND deposito_id = v_target
    FOR UPDATE;
    IF (v_row.stock - v_row.stock_reservado) < p_cantidad THEN
      RAISE EXCEPTION 'STOCK_INSUFICIENTE_DEPOSITO: disponible % en depósito, solicitado %',
        (v_row.stock - v_row.stock_reservado), p_cantidad USING ERRCODE = 'P0010';
    END IF;
    UPDATE inventario_depositos
    SET stock = stock - p_cantidad,
        stock_reservado = LEAST(stock_reservado, stock - p_cantidad),
        updated_at = NOW()
    WHERE inventario_id = p_inventario_id AND deposito_id = v_target;
    RETURN v_target;
  END IF;

  -- Pre-lock ordenado por deposito_id (mismo orden que transferir_stock_atomic)
  -- para evitar deadlocks; el orden de PREFERENCIA se aplica recién en el loop.
  PERFORM 1 FROM inventario_depositos
  WHERE inventario_id = p_inventario_id
  ORDER BY deposito_id
  FOR UPDATE;

  -- Drain: target primero, luego otros por stock DESC.
  FOR v_row IN
    SELECT idep.deposito_id, idep.stock
    FROM inventario_depositos idep
    WHERE idep.inventario_id = p_inventario_id AND idep.stock > 0
    ORDER BY (idep.deposito_id = v_target) DESC, idep.stock DESC, idep.deposito_id
  LOOP
    EXIT WHEN v_restante <= 0;
    v_quitar := LEAST(v_row.stock, v_restante);
    UPDATE inventario_depositos
    SET stock = stock - v_quitar,
        stock_reservado = LEAST(stock_reservado, stock - v_quitar),
        updated_at = NOW()
    WHERE inventario_id = p_inventario_id AND deposito_id = v_row.deposito_id;
    IF v_quitar > v_principal_descuento THEN
      v_principal_descuento := v_quitar;
      v_dep_resultado := v_row.deposito_id;
    END IF;
    v_restante := v_restante - v_quitar;
  END LOOP;

  -- Si el detalle no alcanzó (desync histórico), absorber el resto en el target.
  -- La validación global ya garantizó stock total; esto solo corrige detalle stale.
  IF v_restante > 0 THEN
    RAISE WARNING 'descontar_stock_deposito: detalle insuficiente, absorbiendo restante. inventario=% org=% restante=%',
      p_inventario_id, p_org_id, v_restante;
    UPDATE inventario_depositos
    SET stock = GREATEST(stock - v_restante, 0),
        stock_reservado = LEAST(stock_reservado, GREATEST(stock - v_restante, 0)),
        updated_at = NOW()
    WHERE inventario_id = p_inventario_id AND deposito_id = v_target;
  END IF;

  RETURN COALESCE(v_dep_resultado, v_target);
END;
$$ LANGUAGE plpgsql;

-- Incrementa stock físico en un depósito (entradas: compra, anulación, devolución, ajuste +).
CREATE OR REPLACE FUNCTION incrementar_stock_deposito(
  p_inventario_id TEXT,
  p_org_id TEXT,
  p_deposito_id TEXT,      -- NULL → principal
  p_cantidad INTEGER
) RETURNS TEXT AS $$
DECLARE
  v_target TEXT;
BEGIN
  v_target := COALESCE(p_deposito_id, get_deposito_principal(p_org_id));
  IF v_target IS NULL THEN
    RAISE EXCEPTION 'ORG_SIN_DEPOSITO_PRINCIPAL: %', p_org_id USING ERRCODE = 'P0011';
  END IF;
  PERFORM asegurar_fila_deposito(p_inventario_id, v_target, p_org_id);
  UPDATE inventario_depositos
  SET stock = stock + p_cantidad, updated_at = NOW()
  WHERE inventario_id = p_inventario_id AND deposito_id = v_target;
  RETURN v_target;
END;
$$ LANGUAGE plpgsql;

-- Reserva en el detalle por depósito. strict análogo a descontar_stock_deposito.
-- CHECK (stock_reservado <= stock) limita cuánto se puede reservar por fila;
-- en modo drain, reparte la reserva entre filas con capacidad (stock - reservado).
CREATE OR REPLACE FUNCTION reservar_stock_deposito(
  p_inventario_id TEXT,
  p_org_id TEXT,
  p_deposito_id TEXT,
  p_cantidad INTEGER,
  p_strict BOOLEAN
) RETURNS TEXT AS $$
DECLARE
  v_target TEXT;
  v_restante INTEGER := p_cantidad;
  v_row RECORD;
  v_poner INTEGER;
BEGIN
  v_target := COALESCE(p_deposito_id, get_deposito_principal(p_org_id));
  IF v_target IS NULL THEN
    RAISE EXCEPTION 'ORG_SIN_DEPOSITO_PRINCIPAL: %', p_org_id USING ERRCODE = 'P0011';
  END IF;
  PERFORM asegurar_fila_deposito(p_inventario_id, v_target, p_org_id);

  IF p_strict THEN
    SELECT * INTO v_row FROM inventario_depositos
    WHERE inventario_id = p_inventario_id AND deposito_id = v_target
    FOR UPDATE;
    IF (v_row.stock - v_row.stock_reservado) < p_cantidad THEN
      RAISE EXCEPTION 'STOCK_INSUFICIENTE_DEPOSITO: disponible % en depósito, solicitado %',
        (v_row.stock - v_row.stock_reservado), p_cantidad USING ERRCODE = 'P0010';
    END IF;
    UPDATE inventario_depositos
    SET stock_reservado = stock_reservado + p_cantidad, updated_at = NOW()
    WHERE inventario_id = p_inventario_id AND deposito_id = v_target;
    RETURN v_target;
  END IF;

  -- Pre-lock ordenado por deposito_id (mismo orden que transferir_stock_atomic)
  -- para evitar deadlocks; el orden de PREFERENCIA se aplica recién en el loop.
  PERFORM 1 FROM inventario_depositos
  WHERE inventario_id = p_inventario_id
  ORDER BY deposito_id
  FOR UPDATE;

  FOR v_row IN
    SELECT idep.deposito_id, (idep.stock - idep.stock_reservado) AS capacidad
    FROM inventario_depositos idep
    WHERE idep.inventario_id = p_inventario_id AND (idep.stock - idep.stock_reservado) > 0
    ORDER BY (idep.deposito_id = v_target) DESC, capacidad DESC, idep.deposito_id
  LOOP
    EXIT WHEN v_restante <= 0;
    v_poner := LEAST(v_row.capacidad, v_restante);
    UPDATE inventario_depositos
    SET stock_reservado = stock_reservado + v_poner, updated_at = NOW()
    WHERE inventario_id = p_inventario_id AND deposito_id = v_row.deposito_id;
    v_restante := v_restante - v_poner;
  END LOOP;
  -- Si v_restante > 0: la reserva global excede el detalle (desync). No forzar:
  -- el CHECK lo impide. El agregado en inventario.stock_reservado sigue siendo
  -- la fuente para validación global; el detalle queda parcial. Aceptado.
  IF v_restante > 0 THEN
    RAISE WARNING 'reservar_stock_deposito: capacidad insuficiente en detalle, reserva parcial. inventario=% org=% sin_asignar=%',
      p_inventario_id, p_org_id, v_restante;
  END IF;
  RETURN v_target;
END;
$$ LANGUAGE plpgsql;

-- Libera reserva en el detalle. Drena de filas con reservado > 0 (target primero).
CREATE OR REPLACE FUNCTION liberar_reserva_deposito(
  p_inventario_id TEXT,
  p_org_id TEXT,
  p_deposito_id TEXT,
  p_cantidad INTEGER
) RETURNS TEXT AS $$
DECLARE
  v_target TEXT;
  v_restante INTEGER := p_cantidad;
  v_row RECORD;
  v_quitar INTEGER;
BEGIN
  v_target := COALESCE(p_deposito_id, get_deposito_principal(p_org_id));
  IF v_target IS NULL THEN
    RAISE EXCEPTION 'ORG_SIN_DEPOSITO_PRINCIPAL: %', p_org_id USING ERRCODE = 'P0011';
  END IF;
  -- Pre-lock ordenado por deposito_id (mismo orden que transferir_stock_atomic)
  -- para evitar deadlocks; el orden de PREFERENCIA se aplica recién en el loop.
  PERFORM 1 FROM inventario_depositos
  WHERE inventario_id = p_inventario_id
  ORDER BY deposito_id
  FOR UPDATE;

  FOR v_row IN
    SELECT idep.deposito_id, idep.stock_reservado
    FROM inventario_depositos idep
    WHERE idep.inventario_id = p_inventario_id AND idep.stock_reservado > 0
    ORDER BY (idep.deposito_id = v_target) DESC, idep.stock_reservado DESC, idep.deposito_id
  LOOP
    EXIT WHEN v_restante <= 0;
    v_quitar := LEAST(v_row.stock_reservado, v_restante);
    UPDATE inventario_depositos
    SET stock_reservado = stock_reservado - v_quitar, updated_at = NOW()
    WHERE inventario_id = p_inventario_id AND deposito_id = v_row.deposito_id;
    v_restante := v_restante - v_quitar;
  END LOOP;
  RETURN v_target;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 2. RESYNC BACKFILL: SUM(inventario_depositos.stock) = inventario.stock
-- ============================================================
DO $$
DECLARE
  v_item RECORD;
  v_principal TEXT;
  v_suma INTEGER;
  v_delta INTEGER;
  v_row RECORD;
  v_quitar INTEGER;
BEGIN
  FOR v_item IN
    SELECT i.id, i.organization_id, i.stock, i.stock_reservado
    FROM inventario i
  LOOP
    v_principal := get_deposito_principal(v_item.organization_id);
    CONTINUE WHEN v_principal IS NULL;

    PERFORM asegurar_fila_deposito(v_item.id, v_principal, v_item.organization_id);

    SELECT COALESCE(SUM(stock), 0) INTO v_suma
    FROM inventario_depositos WHERE inventario_id = v_item.id;

    v_delta := v_item.stock - v_suma;  -- >0: faltante en detalle; <0: sobrante

    IF v_delta > 0 THEN
      UPDATE inventario_depositos
      SET stock = stock + v_delta, updated_at = NOW()
      WHERE inventario_id = v_item.id AND deposito_id = v_principal;
    ELSIF v_delta < 0 THEN
      v_delta := -v_delta;
      -- Reducir principal primero, luego otros de mayor a menor.
      FOR v_row IN
        SELECT deposito_id, stock FROM inventario_depositos
        WHERE inventario_id = v_item.id AND stock > 0
        ORDER BY (deposito_id = v_principal) DESC, stock DESC, deposito_id
      LOOP
        EXIT WHEN v_delta <= 0;
        v_quitar := LEAST(v_row.stock, v_delta);
        UPDATE inventario_depositos
        SET stock = stock - v_quitar,
            stock_reservado = LEAST(stock_reservado, stock - v_quitar),
            updated_at = NOW()
        WHERE inventario_id = v_item.id AND deposito_id = v_row.deposito_id;
        v_delta := v_delta - v_quitar;
      END LOOP;
    END IF;

    -- Resync de reservas: borrar detalle y re-asignar inventario.stock_reservado
    -- al principal (clampeado por capacidad), spill a otros si no entra.
    UPDATE inventario_depositos SET stock_reservado = 0, updated_at = NOW()
    WHERE inventario_id = v_item.id AND stock_reservado <> 0;

    IF v_item.stock_reservado > 0 THEN
      v_delta := v_item.stock_reservado;
      FOR v_row IN
        SELECT deposito_id, stock FROM inventario_depositos
        WHERE inventario_id = v_item.id AND stock > 0
        ORDER BY (deposito_id = v_principal) DESC, stock DESC, deposito_id
      LOOP
        EXIT WHEN v_delta <= 0;
        v_quitar := LEAST(v_row.stock, v_delta);
        UPDATE inventario_depositos
        SET stock_reservado = v_quitar, updated_at = NOW()
        WHERE inventario_id = v_item.id AND deposito_id = v_row.deposito_id;
        v_delta := v_delta - v_quitar;
      END LOOP;
      -- v_delta > 0 acá = reservas huérfanas (reservado > stock total). Quedan
      -- solo en el agregado, igual que hoy. No forzar al detalle.
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- 3. RPCs DE AJUSTE Y COMPRA
-- Redefine adjust_stock_atomic, aplicar_ajuste_inventario y
-- recibir_orden_compra para que también escriban stock por
-- depósito en inventario_depositos.
-- Contrato heredado: p_deposito_id IS NOT NULL → validación
-- estricta en ese depósito; NULL → comportamiento global previo
-- + drain principal-primero.
-- DROP previo obligatorio para evitar sobrecarga (overload) que
-- rompe la resolución de PostgREST.
-- ============================================================

DROP FUNCTION IF EXISTS adjust_stock_atomic(TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION adjust_stock_atomic(
  p_inventario_id    TEXT,
  p_organization_id  TEXT,
  p_user_id          TEXT,
  p_mode             TEXT,
  p_value            INTEGER,
  p_motivo           TEXT DEFAULT NULL,
  p_tipo             TEXT DEFAULT 'AJUSTE',
  p_referencia_tipo  TEXT DEFAULT 'AJUSTE_MANUAL',
  p_deposito_id      TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_stock_anterior   INTEGER;
  v_stock_posterior  INTEGER;
  v_cantidad         INTEGER;
  v_mov_id           TEXT;
  v_deposito_efectivo TEXT;
BEGIN
  IF p_mode NOT IN ('absolute', 'delta') THEN
    RAISE EXCEPTION 'Modo inválido: %', p_mode
      USING ERRCODE = '22023';
  END IF;

  IF p_tipo NOT IN ('AJUSTE', 'ENTRADA') THEN
    RAISE EXCEPTION 'Tipo inválido: %', p_tipo
      USING ERRCODE = '22023';
  END IF;

  -- Lock the row to serialize concurrent adjustments.
  SELECT stock
    INTO v_stock_anterior
    FROM inventario
    WHERE id = p_inventario_id
      AND organization_id = p_organization_id
      AND deleted_at IS NULL
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF p_mode = 'absolute' THEN
    v_stock_posterior := p_value;
  ELSE
    v_stock_posterior := v_stock_anterior + p_value;
  END IF;

  IF v_stock_posterior < 0 THEN
    RAISE EXCEPTION 'El stock no puede quedar negativo'
      USING ERRCODE = 'P0003';
  END IF;

  IF v_stock_posterior = v_stock_anterior THEN
    RETURN jsonb_build_object(
      'stock', v_stock_anterior,
      'changed', false,
      'stockAnterior', v_stock_anterior,
      'stockPosterior', v_stock_anterior,
      'movimientoId', NULL
    );
  END IF;

  v_cantidad := v_stock_posterior - v_stock_anterior;

  UPDATE inventario
     SET stock = v_stock_posterior,
         updated_at = NOW()
   WHERE id = p_inventario_id;

  IF v_stock_posterior > v_stock_anterior THEN
    v_deposito_efectivo := incrementar_stock_deposito(
      p_inventario_id, p_organization_id, p_deposito_id,
      v_stock_posterior - v_stock_anterior);
  ELSE
    v_deposito_efectivo := descontar_stock_deposito(
      p_inventario_id, p_organization_id, p_deposito_id,
      v_stock_anterior - v_stock_posterior,
      p_deposito_id IS NOT NULL);
  END IF;

  INSERT INTO movimientos_inventario (
    inventario_id, tipo, cantidad,
    stock_anterior, stock_posterior,
    referencia_tipo, observaciones,
    usuario_id, organization_id,
    deposito_id
  ) VALUES (
    p_inventario_id, p_tipo, v_cantidad,
    v_stock_anterior, v_stock_posterior,
    p_referencia_tipo,
    COALESCE(p_motivo, 'Ajuste rápido desde lista'),
    p_user_id, p_organization_id,
    v_deposito_efectivo
  )
  RETURNING id INTO v_mov_id;

  RETURN jsonb_build_object(
    'stock', v_stock_posterior,
    'changed', true,
    'stockAnterior', v_stock_anterior,
    'stockPosterior', v_stock_posterior,
    'movimientoId', v_mov_id
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION adjust_stock_atomic(TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT) IS
  'Ajuste atómico de stock con lock por fila. Update + movimiento auditable en una transacción. '
  'p_deposito_id IS NOT NULL = validación estricta en ese depósito; NULL = global + drain principal-primero. '
  'ERRCODE: P0002 no encontrado, P0003 stock negativo, 22023 modo/tipo inválido.';

-- ------------------------------------------------------------

DROP FUNCTION IF EXISTS aplicar_ajuste_inventario(TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, BOOLEAN, TEXT);

CREATE OR REPLACE FUNCTION aplicar_ajuste_inventario(
  p_inventario_id       TEXT,
  p_tipo                TEXT,
  p_direccion           TEXT,
  p_cantidad            INTEGER,
  p_motivo              TEXT,
  p_comprobante_url     TEXT,
  p_afecta_rentabilidad BOOLEAN,
  p_user_id             TEXT,
  p_deposito_id         TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  v_stock              INTEGER;
  v_org_id             TEXT;
  v_precio_compra      NUMERIC;
  v_ajuste_id          TEXT;
  v_delta              INTEGER;
  v_nuevo_stock        INTEGER;
  v_deposito_efectivo  TEXT;
BEGIN
  SELECT stock, organization_id, precio_compra
  INTO v_stock, v_org_id, v_precio_compra
  FROM inventario
  WHERE id = p_inventario_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Item no encontrado');
  END IF;

  v_delta := CASE WHEN p_direccion = 'SALIDA' THEN -p_cantidad ELSE p_cantidad END;
  v_nuevo_stock := v_stock + v_delta;

  IF v_nuevo_stock < 0 THEN
    RETURN json_build_object('error', format('Stock insuficiente. Stock actual: %s', v_stock));
  END IF;

  INSERT INTO ajustes_inventario (
    organization_id, inventario_id, tipo, direccion, cantidad,
    costo_unitario_snapshot, motivo, comprobante_url, user_id, afecta_rentabilidad
  ) VALUES (
    v_org_id, p_inventario_id, p_tipo, p_direccion, p_cantidad,
    COALESCE(v_precio_compra, 0), p_motivo, p_comprobante_url, p_user_id, p_afecta_rentabilidad
  )
  RETURNING id INTO v_ajuste_id;

  UPDATE inventario SET stock = v_nuevo_stock WHERE id = p_inventario_id;

  IF p_direccion = 'ENTRADA' THEN
    v_deposito_efectivo := incrementar_stock_deposito(
      p_inventario_id, v_org_id, p_deposito_id, p_cantidad);
  ELSE
    v_deposito_efectivo := descontar_stock_deposito(
      p_inventario_id, v_org_id, p_deposito_id, p_cantidad,
      p_deposito_id IS NOT NULL);
  END IF;

  INSERT INTO movimientos_inventario (
    inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
    referencia_id, referencia_tipo, observaciones, organization_id, usuario_id,
    deposito_id
  ) VALUES (
    p_inventario_id, 'AJUSTE', p_cantidad, v_stock, v_nuevo_stock,
    v_ajuste_id, 'ajuste_inventario',
    format('Ajuste %s %s: %s', p_tipo, p_direccion, COALESCE(p_motivo, 'sin motivo')),
    v_org_id, p_user_id,
    v_deposito_efectivo
  );

  RETURN json_build_object('success', true, 'id', v_ajuste_id, 'nuevoStock', v_nuevo_stock);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION aplicar_ajuste_inventario(TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, BOOLEAN, TEXT, TEXT) IS
  'Aplica ajuste de inventario (merma, rotura, etc.) y escribe stock por depósito. '
  'p_deposito_id IS NOT NULL = validación estricta; NULL = global + drain principal-primero.';

-- ------------------------------------------------------------

DROP FUNCTION IF EXISTS recibir_orden_compra(TEXT, TEXT, JSONB);

CREATE OR REPLACE FUNCTION recibir_orden_compra(
  p_oc_id       TEXT,
  p_user_id     TEXT,
  p_items       JSONB,  -- [{itemId, cantidadRecibida, inventarioId?}]
  p_deposito_id TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_item          JSONB;
  v_ioc           RECORD;
  v_inv_id        TEXT;
  v_inv_stock     INTEGER;
  v_org_id        TEXT;
  v_total_pedida  INTEGER := 0;
  v_total_recibida INTEGER := 0;
  v_nuevo_estado  TEXT;
  v_count         INTEGER := 0;
  v_deposito_efectivo TEXT;
BEGIN
  SELECT organization_id INTO v_org_id
  FROM ordenes_compra WHERE id = p_oc_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden de compra no encontrada';
  END IF;

  -- Process each received item
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    -- Get the OC item
    SELECT ioc.*
    INTO v_ioc
    FROM items_orden_compra ioc
    WHERE ioc.id = (v_item->>'itemId')
      AND ioc.orden_compra_id = p_oc_id
    FOR UPDATE;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    -- Resolve inventario_id: use provided one, or fall back to existing
    v_inv_id := COALESCE(v_item->>'inventarioId', v_ioc.inventario_id);

    -- Link item to inventory if not yet linked
    IF v_inv_id IS NOT NULL AND v_ioc.inventario_id IS NULL THEN
      UPDATE items_orden_compra
      SET inventario_id = v_inv_id
      WHERE id = (v_item->>'itemId');
    END IF;

    -- Update received quantity
    UPDATE items_orden_compra
    SET cantidad_recibida = cantidad_recibida + (v_item->>'cantidadRecibida')::INTEGER
    WHERE id = (v_item->>'itemId');

    -- Increment inventory stock if linked
    IF v_inv_id IS NOT NULL THEN
      SELECT stock INTO v_inv_stock
      FROM inventario WHERE id = v_inv_id
      FOR UPDATE;

      UPDATE inventario
      SET stock = stock + (v_item->>'cantidadRecibida')::INTEGER
      WHERE id = v_inv_id;

      v_deposito_efectivo := incrementar_stock_deposito(
        v_inv_id, v_org_id, p_deposito_id,
        (v_item->>'cantidadRecibida')::INTEGER);

      -- Record movement
      INSERT INTO movimientos_inventario (
        inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
        referencia_id, referencia_tipo, usuario_id, organization_id, observaciones,
        deposito_id
      ) VALUES (
        v_inv_id, 'COMPRA_RECIBIDA', (v_item->>'cantidadRecibida')::INTEGER,
        v_inv_stock, v_inv_stock + (v_item->>'cantidadRecibida')::INTEGER,
        p_oc_id, 'ORDEN_COMPRA', p_user_id, v_org_id,
        'Recepción de orden de compra',
        v_deposito_efectivo
      );
    END IF;

    v_count := v_count + 1;
  END LOOP;

  -- Calculate new state
  SELECT
    SUM(cantidad_pedida), SUM(cantidad_recibida)
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
      fecha_recepcion_real = CASE WHEN v_nuevo_estado = 'RECIBIDA' THEN NOW() ELSE fecha_recepcion_real END
  WHERE id = p_oc_id;

  RETURN jsonb_build_object(
    'success', true,
    'itemsRecibidos', v_count,
    'nuevoEstado', v_nuevo_estado
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION recibir_orden_compra(TEXT, TEXT, JSONB, TEXT) IS
  'Recibe ítems de una orden de compra e incrementa stock por depósito. '
  'p_deposito_id IS NOT NULL = ingreso al depósito indicado; NULL = principal-primero.';
