-- 206_multi_deposito_fase2.sql
-- Fase 2 multi-depósito: las RPCs de stock (venta, reserva, ajuste, compra)
-- escriben en inventario.stock (agregado) Y en inventario_depositos (detalle).
-- Contrato: p_deposito_id explícito = validación estricta en ese depósito;
-- NULL = validación global (comportamiento previo) + drain principal-primero.
-- Invariante post-migración: inventario.stock = SUM(inventario_depositos.stock).

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

  -- Drain: target primero, luego otros por stock DESC.
  FOR v_row IN
    SELECT idep.deposito_id, idep.stock
    FROM inventario_depositos idep
    WHERE idep.inventario_id = p_inventario_id AND idep.stock > 0
    ORDER BY (idep.deposito_id = v_target) DESC, idep.stock DESC, idep.deposito_id
    FOR UPDATE
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

  FOR v_row IN
    SELECT idep.deposito_id, (idep.stock - idep.stock_reservado) AS capacidad
    FROM inventario_depositos idep
    WHERE idep.inventario_id = p_inventario_id AND (idep.stock - idep.stock_reservado) > 0
    ORDER BY (idep.deposito_id = v_target) DESC, capacidad DESC, idep.deposito_id
    FOR UPDATE
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
  FOR v_row IN
    SELECT idep.deposito_id, idep.stock_reservado
    FROM inventario_depositos idep
    WHERE idep.inventario_id = p_inventario_id AND idep.stock_reservado > 0
    ORDER BY (idep.deposito_id = v_target) DESC, idep.stock_reservado DESC, idep.deposito_id
    FOR UPDATE
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
