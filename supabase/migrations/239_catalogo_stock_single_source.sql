-- 239_catalogo_stock_single_source.sql
--
-- Fix: reservar_stock_catalogo descontaba stock por DOBLE cuando un item base
-- tenía inventario_id Y catalogo_items.stock no nulo a la vez. Ambos bloques
-- (inventario e items) corrían en secuencia sin exclusión mutua.
--
-- Efecto del bug:
--   * Descuento espurio en catalogo_items.stock además del de inventario.
--   * Falsos "Stock insuficiente": el storefront muestra inventario.stock pero
--     el RPC también validaba catalogo_items.stock, que podía tener un valor
--     viejo/menor cargado por inline-edit del admin.
--
-- Regla: si el item está linkeado a inventario (inventario_id IS NOT NULL),
-- inventario es la ÚNICA fuente de verdad y catalogo_items.stock se ignora.
-- Solo cuando NO hay link, catalogo_items.stock manda. Esto deja sin efecto a
-- los datos ya sucios (stock no nulo en items linkeados) sin necesidad de
-- backfill: la columna simplemente deja de descontarse.

CREATE OR REPLACE FUNCTION reservar_stock_catalogo(
  p_organization_id TEXT,
  p_items JSONB
) RETURNS BOOLEAN AS $$
DECLARE
  v_item        JSONB;
  v_item_id     TEXT;
  v_variante_id TEXT;
  v_cantidad    INTEGER;
  v_stock       INTEGER;
  v_inv_id      TEXT;
  v_inv_stock   INTEGER;
  v_nombre      TEXT;
  v_var_stock   INTEGER;
  v_var_etq     TEXT;
BEGIN
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_item_id     := v_item->>'item_id';
    v_variante_id := NULLIF(v_item->>'variante_id', '');
    v_cantidad    := (v_item->>'cantidad')::INTEGER;

    IF v_cantidad <= 0 THEN
      RAISE EXCEPTION 'Cantidad inválida: %', v_cantidad
        USING ERRCODE = '22023';
    END IF;

    -- ============ Variante ============
    IF v_variante_id IS NOT NULL THEN
      SELECT stock, etiqueta INTO v_var_stock, v_var_etq
        FROM catalogo_variantes
        WHERE id = v_variante_id
          AND item_id = v_item_id
          AND organization_id = p_organization_id
          AND activo = TRUE
        FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Variante % no encontrada o inactiva', v_variante_id
          USING ERRCODE = 'P0002';
      END IF;

      IF v_var_stock IS NOT NULL THEN
        IF v_var_stock < v_cantidad THEN
          RAISE EXCEPTION 'Stock insuficiente para variante "%" (disponible: %)', v_var_etq, v_var_stock
            USING ERRCODE = 'P0003';
        END IF;
        UPDATE catalogo_variantes
          SET stock = stock - v_cantidad
          WHERE id = v_variante_id;
      END IF;
      CONTINUE;
    END IF;

    -- ============ Item base (legacy path) ============
    SELECT stock, inventario_id, nombre
      INTO v_stock, v_inv_id, v_nombre
      FROM catalogo_items
      WHERE id = v_item_id
        AND organization_id = p_organization_id
        AND activo = TRUE
      FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Item % no encontrado o inactivo', v_item_id
        USING ERRCODE = 'P0002';
    END IF;

    -- Fuente de verdad única: inventario si está linkeado, si no catalogo_items.stock.
    IF v_inv_id IS NOT NULL THEN
      SELECT stock INTO v_inv_stock
        FROM inventario
        WHERE id = v_inv_id
        FOR UPDATE;

      IF v_inv_stock IS NOT NULL AND v_inv_stock < v_cantidad THEN
        RAISE EXCEPTION 'Stock insuficiente para "%" (disponible: %)', v_nombre, v_inv_stock
          USING ERRCODE = 'P0003';
      END IF;

      UPDATE inventario
        SET stock = GREATEST(0, stock - v_cantidad)
        WHERE id = v_inv_id;
    ELSIF v_stock IS NOT NULL THEN
      IF v_stock < v_cantidad THEN
        RAISE EXCEPTION 'Stock insuficiente para "%" (disponible: %)', v_nombre, v_stock
          USING ERRCODE = 'P0003';
      END IF;

      UPDATE catalogo_items
        SET stock = stock - v_cantidad
        WHERE id = v_item_id;
    END IF;
  END LOOP;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION reservar_stock_catalogo IS
  'Reserva stock de catálogo de forma atómica (FOR UPDATE). Fuente de verdad única por item: variante > inventario (si linkeado) > catalogo_items.stock. v239: corrige doble decremento inventario+items.';

-- Re-aplicar el hardening de la migración 197 para que esta migración sea
-- self-contained: solo service_role puede ejecutar la RPC (nunca anon/public).
REVOKE EXECUTE ON FUNCTION reservar_stock_catalogo(TEXT, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION reservar_stock_catalogo(TEXT, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION reservar_stock_catalogo(TEXT, JSONB) TO service_role;
