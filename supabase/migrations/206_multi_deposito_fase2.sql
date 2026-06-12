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

-- ============================================================
-- 4. RPCs DE VENTA
-- Redefine crear_venta_atomica, editar_venta_atomica y
-- restore_stock_on_cancel para dual-write por depósito.
-- Contrato heredado: p_deposito_id IS NOT NULL → validación
-- estricta en ese depósito; NULL → comportamiento global previo
-- + drain principal-primero.
-- ============================================================

-- Drop the current v200 signature to avoid an overload when we add p_deposito_id.
DROP FUNCTION IF EXISTS crear_venta_atomica(
  TEXT, TEXT, TEXT, TEXT, TEXT, DECIMAL, DECIMAL, TEXT, DECIMAL, DECIMAL,
  TEXT, TEXT, TEXT, INTEGER, DECIMAL, DECIMAL, JSONB, JSONB, TEXT
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
  p_deposito_id TEXT DEFAULT NULL
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
    idempotency_key
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
    NULLIF(p_idempotency_key, '')
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

COMMENT ON FUNCTION crear_venta_atomica(
  TEXT, TEXT, TEXT, TEXT, TEXT, DECIMAL, DECIMAL, TEXT, DECIMAL, DECIMAL,
  TEXT, TEXT, TEXT, INTEGER, DECIMAL, DECIMAL, JSONB, JSONB, TEXT, TEXT
) IS
  'Crea venta atómica. v206: dual-write por depósito — descontar_stock_deposito '
  'después del UPDATE agregado; deposito_id en movimientos_inventario. '
  'p_deposito_id IS NOT NULL = validación estricta en ese depósito; NULL = global + drain.';

-- ------------------------------------------------------------

-- Drop the current editar_venta_atomica signature to add p_deposito_id without overload.
DROP FUNCTION IF EXISTS editar_venta_atomica(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DECIMAL, DECIMAL, TEXT, DECIMAL, DECIMAL,
  TEXT, TEXT, JSONB
);

CREATE OR REPLACE FUNCTION editar_venta_atomica(
  p_org_id TEXT,
  p_user_id TEXT,
  p_venta_id TEXT,
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
  p_items JSONB,
  p_deposito_id TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_old_item RECORD;
  v_item JSONB;
  v_item_id TEXT;
  v_inv_stock INTEGER;
  v_inv_nombre TEXT;
  v_garantia_numero TEXT;
  v_metodo metodo_pago_venta;
  v_garantias JSONB := '[]'::JSONB;
  -- multi-deposito
  v_deposito_efectivo TEXT;
  v_dep_origen TEXT;
BEGIN
  v_metodo := p_metodo_pago::metodo_pago_venta;

  -- 1. Restore stock for old items + record ANULACION movements
  FOR v_old_item IN
    SELECT iv.inventario_id, iv.cantidad, i.stock, i.nombre
    FROM items_venta iv
    LEFT JOIN inventario i ON i.id = iv.inventario_id
    WHERE iv.venta_id = p_venta_id AND iv.inventario_id IS NOT NULL
  LOOP
    -- Look up which deposit the original VENTA movement used for this item.
    SELECT m.deposito_id INTO v_dep_origen
    FROM movimientos_inventario m
    WHERE m.referencia_id = p_venta_id AND m.tipo = 'VENTA'
      AND m.inventario_id = v_old_item.inventario_id
    ORDER BY m.created_at DESC LIMIT 1;

    INSERT INTO movimientos_inventario (
      inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
      referencia_id, referencia_tipo, usuario_id, organization_id, observaciones,
      deposito_id
    ) VALUES (
      v_old_item.inventario_id, 'ANULACION', v_old_item.cantidad,
      v_old_item.stock, v_old_item.stock + v_old_item.cantidad,
      p_venta_id, 'EDICION_VENTA', p_user_id, p_org_id,
      'Restauración por edición de venta',
      v_dep_origen
    );

    UPDATE inventario SET stock = stock + v_old_item.cantidad
    WHERE id = v_old_item.inventario_id;

    -- Dual-write: restore per-deposit stock to the same deposit it was taken from.
    PERFORM incrementar_stock_deposito(
      v_old_item.inventario_id, p_org_id, v_dep_origen, v_old_item.cantidad);
  END LOOP;

  -- 2. Delete old items and warranties
  DELETE FROM garantias_venta WHERE venta_id = p_venta_id;
  DELETE FROM items_venta WHERE venta_id = p_venta_id;

  -- 3. Update sale header
  UPDATE ventas SET
    cliente_id = NULLIF(p_cliente_id, ''),
    cliente_nombre = p_cliente_nombre,
    cliente_telefono = NULLIF(p_cliente_telefono, ''),
    subtotal = p_subtotal,
    descuento = p_descuento,
    tipo_descuento = COALESCE(p_tipo_descuento, 'MONTO'),
    porcentaje_descuento = COALESCE(p_porcentaje_descuento, 0),
    total = p_total,
    metodo_pago = v_metodo,
    observaciones = NULLIF(p_observaciones, ''),
    updated_at = NOW()
  WHERE id = p_venta_id AND organization_id = p_org_id;

  -- 4. Validate stock for new items with row locks (skip deleted items)
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    IF (v_item->>'inventarioId') IS NOT NULL AND (v_item->>'inventarioId') != '' THEN
      SELECT stock, nombre INTO v_inv_stock, v_inv_nombre
      FROM inventario
      WHERE id = (v_item->>'inventarioId')
        AND organization_id = p_org_id
        AND deleted_at IS NULL
      FOR UPDATE;

      IF v_inv_stock IS NULL THEN
        RAISE EXCEPTION 'Producto no encontrado: %', v_item->>'descripcion';
      END IF;

      IF v_inv_stock < (v_item->>'cantidad')::INTEGER THEN
        RAISE EXCEPTION 'Stock insuficiente para "%". Disponible: %', v_inv_nombre, v_inv_stock;
      END IF;
    END IF;
  END LOOP;

  -- 5. Insert new items, deduct stock, record VENTA movements, create warranties
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO items_venta (
      venta_id, inventario_id, descripcion, cantidad, precio_unitario, subtotal,
      dias_garantia, descuento, tipo_descuento, porcentaje_descuento
    ) VALUES (
      p_venta_id,
      NULLIF(v_item->>'inventarioId', ''),
      v_item->>'descripcion',
      (v_item->>'cantidad')::INTEGER,
      (v_item->>'precioUnitario')::DECIMAL,
      (v_item->>'cantidad')::INTEGER * (v_item->>'precioUnitario')::DECIMAL,
      COALESCE((v_item->>'diasGarantia')::INTEGER, 0),
      COALESCE((v_item->>'descuento')::DECIMAL, 0),
      COALESCE(v_item->>'tipoDescuento', 'MONTO'),
      COALESCE((v_item->>'porcentajeDescuento')::DECIMAL, 0)
    ) RETURNING id INTO v_item_id;

    IF (v_item->>'inventarioId') IS NOT NULL AND (v_item->>'inventarioId') != '' THEN
      INSERT INTO movimientos_inventario (
        inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
        referencia_id, referencia_tipo, usuario_id, organization_id,
        deposito_id
      )
      SELECT
        (v_item->>'inventarioId'), 'VENTA', -(v_item->>'cantidad')::INTEGER,
        stock, stock - (v_item->>'cantidad')::INTEGER,
        p_venta_id, 'VENTA', p_user_id, p_org_id,
        NULL  -- populated below after descontar_stock_deposito resolves the effective deposit
      FROM inventario WHERE id = (v_item->>'inventarioId');

      UPDATE inventario SET stock = stock - (v_item->>'cantidad')::INTEGER
      WHERE id = (v_item->>'inventarioId');

      -- Dual-write: deduct per-deposit stock. strict=true when deposit is explicit.
      v_deposito_efectivo := descontar_stock_deposito(
        (v_item->>'inventarioId'), p_org_id, p_deposito_id,
        (v_item->>'cantidad')::INTEGER,
        p_deposito_id IS NOT NULL);

      -- Back-fill deposito_id on the movement we just inserted.
      UPDATE movimientos_inventario
      SET deposito_id = v_deposito_efectivo
      WHERE referencia_id = p_venta_id
        AND inventario_id = (v_item->>'inventarioId')
        AND tipo = 'VENTA'
        AND deposito_id IS NULL;
    END IF;

    IF COALESCE((v_item->>'diasGarantia')::INTEGER, 0) > 0 THEN
      SELECT get_next_warranty_sale_number(p_org_id) INTO v_garantia_numero;

      INSERT INTO garantias_venta (
        venta_id, item_venta_id, numero_garantia, dias_validez,
        fecha_inicio, fecha_vencimiento, organization_id
      ) VALUES (
        p_venta_id, v_item_id, v_garantia_numero,
        (v_item->>'diasGarantia')::INTEGER,
        NOW(), NOW() + ((v_item->>'diasGarantia')::INTEGER || ' days')::INTERVAL,
        p_org_id
      );

      v_garantias := v_garantias || jsonb_build_object(
        'numero', v_garantia_numero,
        'itemId', v_item_id,
        'diasValidez', (v_item->>'diasGarantia')::INTEGER
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'garantias', v_garantias);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION editar_venta_atomica(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DECIMAL, DECIMAL, TEXT, DECIMAL, DECIMAL,
  TEXT, TEXT, JSONB, TEXT
) IS
  'Edita venta atómica. v206: restaura stock al depósito de origen del movimiento '
  'VENTA original; descuenta nuevos items al depósito indicado (o drain si NULL). '
  'p_deposito_id IS NOT NULL = validación estricta en ese depósito; NULL = global + drain.';

-- ------------------------------------------------------------
-- restore_stock_on_cancel: trigger function — signature unchanged, no DROP needed.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION restore_stock_on_cancel()
RETURNS TRIGGER AS $$
DECLARE
  v_item RECORD;
  v_dep_origen TEXT;
BEGIN
  IF OLD.estado = 'COMPLETADA' AND NEW.estado = 'ANULADA' THEN
    FOR v_item IN
      SELECT iv.inventario_id, iv.cantidad, i.stock
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

      -- Record movement
      INSERT INTO movimientos_inventario (
        inventario_id, tipo, cantidad, stock_anterior, stock_posterior,
        referencia_id, referencia_tipo, organization_id,
        deposito_id
      ) VALUES (
        v_item.inventario_id, 'ANULACION', v_item.cantidad,
        v_item.stock, v_item.stock + v_item.cantidad,
        NEW.id, 'ANULACION_VENTA', NEW.organization_id,
        v_dep_origen
      );

      -- Restore aggregate stock
      UPDATE inventario SET stock = stock + v_item.cantidad
      WHERE id = v_item.inventario_id;

      -- Dual-write: restore per-deposit stock to the same deposit it was taken from.
      PERFORM incrementar_stock_deposito(
        v_item.inventario_id, NEW.organization_id, v_dep_origen, v_item.cantidad);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger body updated via CREATE OR REPLACE FUNCTION above.
-- No need to recreate the trigger: trigger_restore_stock_on_cancel already
-- points to this function and remains valid.

-- ============================================================
-- 5. INDICE DE SOPORTE
-- ============================================================
-- Cubre el backfill de deposito_id en movimientos VENTA y el lookup de
-- deposito de origen en anulacion/edicion (referencia_id + inventario_id + tipo).
CREATE INDEX IF NOT EXISTS movimientos_inv_ref_inv_tipo_idx
  ON movimientos_inventario (referencia_id, inventario_id, tipo);
