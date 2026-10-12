-- ========================================
-- Migration 291: seed inventario_depositos al crear item + resync drift
-- ========================================
-- Bug: todos los caminos de creación de items (alta manual POST /api/inventario,
-- carga en lista bulk-create, import CSV/XLSX, catálogo import-inventario,
-- seed demo) insertan inventario.stock directo SIN sembrar el detalle en
-- inventario_depositos. El item nace violando la invariante:
--   inventario.stock = SUM(inventario_depositos.stock)
-- Síntoma en prod: editar el stock para abajo en una org con sucursal/depósito
-- entra al modo estricto de descontar_stock_deposito, ve 0 disponible en el
-- detalle y falla con P0010 STOCK_INSUFICIENTE_DEPOSITO (500 al usuario).
--
-- Fix en dos partes:
--   1. Trigger AFTER INSERT en inventario: si el item nace con stock > 0 y la
--      org tiene depósito principal, siembra la fila de detalle. Cubre todos
--      los caminos de creación de una sola vez (ningún camino de creación
--      escribe inventario_depositos hoy, verificado — no hay double-count).
--   2. Resync idempotente del drift existente (mismo patrón probado de las
--      migraciones 208/223): absorbe la diferencia en el depósito principal.
--
-- Numeración: 289/290 reservadas por PR #267 en vuelo.
-- Idempotente: CREATE OR REPLACE + DROP TRIGGER IF EXISTS + resync recalcula.
-- ========================================

-- 1. Trigger de seed al crear
CREATE OR REPLACE FUNCTION seed_deposito_inicial()
RETURNS TRIGGER AS $$
DECLARE
  v_principal TEXT;
BEGIN
  IF NEW.stock IS NULL OR NEW.stock <= 0 THEN
    RETURN NEW;
  END IF;
  v_principal := get_deposito_principal(NEW.organization_id);
  -- Org sin depósito principal: comportamiento global previo, sin detalle.
  IF v_principal IS NULL THEN
    RETURN NEW;
  END IF;
  INSERT INTO inventario_depositos (inventario_id, deposito_id, stock, stock_reservado, organization_id)
  VALUES (NEW.id, v_principal, NEW.stock, 0, NEW.organization_id)
  ON CONFLICT (inventario_id, deposito_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS inventario_seed_deposito ON inventario;
CREATE TRIGGER inventario_seed_deposito
  AFTER INSERT ON inventario
  FOR EACH ROW
  EXECUTE FUNCTION seed_deposito_inicial();

COMMENT ON FUNCTION seed_deposito_inicial() IS
  'v291: siembra inventario_depositos (depósito principal) cuando un item nace con stock > 0. Mantiene la invariante inventario.stock = SUM(inventario_depositos.stock) para todos los caminos de creación.';

-- 2. Resync del drift existente (idéntico patrón a migración 223, idempotente)
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
    WHERE i.deleted_at IS NULL
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
