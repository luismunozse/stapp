-- ========================================
-- 158: Variantes de items del catálogo
-- ========================================
-- Permite que un item del catálogo tenga múltiples variantes
-- (ej: "Negro 64GB", "Blanco 128GB"). Cada variante puede tener
-- precio + stock + imagen propios. Si un item tiene variantes:
--   - El precio del item base se ignora (se usa variante.precio)
--   - El stock total = SUM(variantes.stock)
--   - El cliente DEBE elegir una variante para agregar al carrito
-- ========================================

CREATE TABLE IF NOT EXISTS catalogo_variantes (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id  TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  item_id          TEXT NOT NULL REFERENCES catalogo_items(id) ON DELETE CASCADE,
  etiqueta         TEXT NOT NULL,
  sku              TEXT,
  precio           DECIMAL(10,2) CHECK (precio IS NULL OR precio >= 0),
  stock            INTEGER CHECK (stock IS NULL OR stock >= 0),
  imagen_url       TEXT,
  activo           BOOLEAN NOT NULL DEFAULT TRUE,
  orden            INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT catalogo_variantes_etiqueta_len CHECK (length(etiqueta) BETWEEN 1 AND 80)
);

CREATE INDEX IF NOT EXISTS idx_catalogo_variantes_item
  ON catalogo_variantes(item_id, orden)
  WHERE activo = TRUE;

CREATE INDEX IF NOT EXISTS idx_catalogo_variantes_org
  ON catalogo_variantes(organization_id);

CREATE TRIGGER catalogo_variantes_updated_at
  BEFORE UPDATE ON catalogo_variantes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ========================================
-- items_cotizacion: referencia a variante elegida
-- ========================================
ALTER TABLE items_cotizacion
  ADD COLUMN IF NOT EXISTS variante_id TEXT REFERENCES catalogo_variantes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS variante_etiqueta TEXT;

COMMENT ON COLUMN items_cotizacion.variante_id IS
  'Variante del catálogo elegida por el cliente (NULL = item sin variantes).';
COMMENT ON COLUMN items_cotizacion.variante_etiqueta IS
  'Snapshot de la etiqueta de la variante por si la variante es borrada/modificada luego.';

-- ========================================
-- RPC: reservar_stock_catalogo — extensión para soporte de variantes
-- ========================================
-- Misma signature que la versión 144 (BOOLEAN return) para retro-compat.
-- p_items: [{ item_id, cantidad, variante_id? }]
-- Lógica:
--   - variante_id presente → bloquea + decrementa variante.stock
--   - sino, comportamiento legacy: stock propio del item / inventario linkeado

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
    END IF;

    IF v_stock IS NOT NULL THEN
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
