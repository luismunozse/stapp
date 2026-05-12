-- ========================================
-- 155: Catálogo — tracking de vistas + origen de cotizaciones
-- ========================================
-- Tabla de eventos para mostrar stats en panel admin:
--   - Vistas totales del catálogo (por día / semana / mes)
--   - Items más vistos
--   - Conteo aproximado de visitantes únicos (hash IP+UA)
-- Cotizaciones: marcar las generadas desde el catálogo público
-- para diferenciarlas de las creadas internamente.
-- ========================================

CREATE TABLE IF NOT EXISTS catalogo_views (
  id              BIGSERIAL PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  catalogo_slug   TEXT NOT NULL,
  item_id         TEXT REFERENCES catalogo_items(id) ON DELETE SET NULL,
  visitor_hash    TEXT,
  referer         TEXT,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_catalogo_views_org_fecha
  ON catalogo_views(organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_catalogo_views_item
  ON catalogo_views(item_id, created_at DESC)
  WHERE item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_catalogo_views_visitor
  ON catalogo_views(organization_id, visitor_hash, created_at DESC)
  WHERE visitor_hash IS NOT NULL;

-- ========================================
-- cotizaciones.origen — diferenciar fuente
-- ========================================
ALTER TABLE cotizaciones
  ADD COLUMN IF NOT EXISTS origen TEXT;

COMMENT ON COLUMN cotizaciones.origen IS
  'Fuente de la cotización. Ej: CATALOGO_PUBLICO, CLIENT_PORTAL. NULL = creada internamente.';

CREATE INDEX IF NOT EXISTS idx_cotizaciones_origen
  ON cotizaciones(organization_id, origen, created_at DESC)
  WHERE origen IS NOT NULL;
