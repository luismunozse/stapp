-- ============================================
-- 193: items_cotizacion ← catalogo_items (link directo)
-- ============================================
-- Hoy items_cotizacion guarda descripción string + opcionalmente inventario_id,
-- pero no tiene link directo al item del catálogo público que originó la línea.
-- Sin ese link no se pueden calcular bundles "comprados juntos" reales.
--
-- Esta migration agrega FK opcional. cotizar/route.ts del catálogo público lo
-- escribe al insertar; cotizaciones creadas internamente (sin catálogo) lo
-- dejan NULL.
-- ============================================

ALTER TABLE items_cotizacion
  ADD COLUMN IF NOT EXISTS catalogo_item_id TEXT
    REFERENCES catalogo_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_items_cotizacion_catalogo_item
  ON items_cotizacion(catalogo_item_id)
  WHERE catalogo_item_id IS NOT NULL;

COMMENT ON COLUMN items_cotizacion.catalogo_item_id IS
  'FK opcional al item del catálogo público. Usado para calcular cross-sell bundle "comprados juntos".';
