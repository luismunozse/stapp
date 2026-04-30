-- ============================================
-- 145: Catálogo - destacados + banner hero
-- ============================================
-- Agrega capacidad de destacar items (aparecen primero con badge) y un banner
-- de portada para la página pública.
-- ============================================

-- Item destacado: aparece antes que el resto, con badge visible
ALTER TABLE catalogo_items
  ADD COLUMN IF NOT EXISTS destacado BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS catalogo_items_destacado_idx
  ON catalogo_items(organization_id, destacado, orden)
  WHERE activo = TRUE;

-- Banner de portada de la página pública (URL imagen)
ALTER TABLE catalogo_config
  ADD COLUMN IF NOT EXISTS banner_url TEXT;

COMMENT ON COLUMN catalogo_items.destacado IS 'Items destacados aparecen primero en el catálogo público con badge "Destacado"';
COMMENT ON COLUMN catalogo_config.banner_url IS 'URL de imagen banner para hero de la página pública (opcional)';
