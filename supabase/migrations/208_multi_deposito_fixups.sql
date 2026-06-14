-- 208_multi_deposito_fixups.sql
-- Correctivos post-aplicación de la migración 206 (multi-depósito Fase 2).
-- Verificación de Task 5 detectó dos defectos en la DB ya migrada:
--
--   1. OVERLOAD de crear_venta_atomica: el DROP de la 206 apuntó a la firma
--      de 19 params, pero la versión stale real era la de 17 params (pre-200,
--      sin p_pagos/p_idempotency_key). Quedaron 2 overloads → PostgREST
--      resuelve la RPC de forma ambigua y las ventas fallan.
--
--   2. INVARIANTE roto en ~12 orgs sin depósito principal: el backfill resync
--      de la 206 hace `CONTINUE WHEN v_principal IS NULL`, así que las orgs
--      creadas DESPUÉS de la 169 (que nunca recibieron un principal, porque el
--      signup no lo crea ni hay trigger) quedaron con inventario_depositos
--      vacío. Peor: sus RPCs de stock hacen RAISE ORG_SIN_DEPOSITO_PRINCIPAL,
--      por lo que esas orgs NO pueden vender/ajustar/comprar.
--
-- Esta migración es IDEMPOTENTE: puede correrse múltiples veces sin daño.
-- Invariante objetivo post-208: inventario.stock = SUM(inventario_depositos.stock)
-- para TODA org con un depósito principal.

-- ============================================================
-- 1. FIX OVERLOAD: dropear la firma stale de 17 params
-- ============================================================
-- Firma exacta observada en pg_proc (DECIMAL == numeric):
--   crear_venta_atomica(text,text,text,text,text,numeric,numeric,text,
--     numeric,numeric,text,text,text,integer,numeric,numeric,jsonb)
-- Tras este DROP queda solo la versión de 20 params (la de la 206).

DROP FUNCTION IF EXISTS crear_venta_atomica(
  TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC, NUMERIC,
  TEXT, TEXT, TEXT, INTEGER, NUMERIC, NUMERIC, JSONB
);

-- ============================================================
-- 2. BACKFILL: depósito "Principal" para orgs que no lo tienen
-- ============================================================
-- Mismo patrón que la 169. El índice parcial único
-- depositos_org_principal_unique lo hace idempotente por construcción.

INSERT INTO depositos (organization_id, nombre, principal, activo)
SELECT o.id, 'Principal', true, true
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM depositos d
  WHERE d.organization_id = o.id
    AND d.principal = true
    AND d.deleted_at IS NULL
);

-- ============================================================
-- 3. FIX DURABLE: trigger que crea el principal en cada org nueva
-- ============================================================
-- Sin esto, la próxima org creada post-migración vuelve a quedar sin
-- principal y rompe en la primera venta. El guard NOT EXISTS lo hace
-- seguro aunque el signup ya cree un depósito por su cuenta.

CREATE OR REPLACE FUNCTION org_crear_deposito_principal()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO depositos (organization_id, nombre, principal, activo)
  SELECT NEW.id, 'Principal', true, true
  WHERE NOT EXISTS (
    SELECT 1 FROM depositos d
    WHERE d.organization_id = NEW.id
      AND d.principal = true
      AND d.deleted_at IS NULL
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS organizations_crear_deposito_principal ON organizations;
CREATE TRIGGER organizations_crear_deposito_principal
  AFTER INSERT ON organizations
  FOR EACH ROW EXECUTE FUNCTION org_crear_deposito_principal();

-- ============================================================
-- 4. RE-RUN RESYNC: ahora ninguna org se saltea
-- ============================================================
-- Copia exacta del bloque resync de la 206. Idempotente: reconcilia
-- SUM(inventario_depositos.stock) contra inventario.stock absorbiendo el
-- delta en el principal; para orgs ya consistentes el delta es 0 (no-op).

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
