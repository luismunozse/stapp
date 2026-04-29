-- ============================================
-- 143: Catálogo público de productos y servicios
-- ============================================
-- Permite a cada organización publicar un catálogo en una URL pública
-- (/catalogo/[slug]) con productos y servicios. Los clientes pueden navegar,
-- agregar al carrito y enviar una solicitud que crea una cotización tipo
-- PRESUPUESTO en el sistema.
--
-- Tablas:
--   catalogo_config       1:1 con organizations (config + slug + flag activo)
--   catalogo_categorias   N agrupadores por org (drag-reorder)
--   catalogo_items        N items (PRODUCTO | SERVICIO) por org
--
-- Stock:
--   - tipo SERVICIO: stock = NULL (no aplica)
--   - tipo PRODUCTO: stock NULL = sin tracking, 0 = agotado, n = disponible
--   - inventario_id (opcional): si linkeado, source of truth = inventario.stock
-- ============================================

-- ========================================
-- catalogo_config
-- ========================================
CREATE TABLE IF NOT EXISTS catalogo_config (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  slug            TEXT NOT NULL UNIQUE,
  titulo          TEXT,
  descripcion     TEXT,
  color_primary   TEXT DEFAULT '#2563eb',
  whatsapp        TEXT,
  activo          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT catalogo_slug_format
    CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])?$')
);

CREATE INDEX IF NOT EXISTS catalogo_config_slug_idx ON catalogo_config(slug) WHERE activo = TRUE;

-- ========================================
-- catalogo_categorias
-- ========================================
CREATE TABLE IF NOT EXISTS catalogo_categorias (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  nombre          TEXT NOT NULL,
  descripcion     TEXT,
  imagen_url      TEXT,
  orden           INTEGER NOT NULL DEFAULT 0,
  activo          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS catalogo_categorias_org_idx
  ON catalogo_categorias(organization_id, orden)
  WHERE activo = TRUE;

-- ========================================
-- catalogo_items
-- ========================================
CREATE TABLE IF NOT EXISTS catalogo_items (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  categoria_id    TEXT REFERENCES catalogo_categorias(id) ON DELETE SET NULL,
  inventario_id   TEXT REFERENCES inventario(id) ON DELETE SET NULL,
  tipo            TEXT NOT NULL CHECK (tipo IN ('PRODUCTO','SERVICIO')),
  nombre          TEXT NOT NULL,
  descripcion     TEXT,
  precio          DECIMAL(10,2) CHECK (precio IS NULL OR precio >= 0),
  precio_hasta    DECIMAL(10,2) CHECK (precio_hasta IS NULL OR precio_hasta >= 0),
  imagen_url      TEXT,
  imagenes        TEXT[] NOT NULL DEFAULT '{}',
  etiquetas       TEXT[] NOT NULL DEFAULT '{}',
  stock           INTEGER CHECK (stock IS NULL OR stock >= 0),
  activo          BOOLEAN NOT NULL DEFAULT TRUE,
  orden           INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT catalogo_items_servicio_sin_stock
    CHECK (tipo = 'PRODUCTO' OR stock IS NULL),
  CONSTRAINT catalogo_items_rango_valido
    CHECK (precio_hasta IS NULL OR precio IS NULL OR precio_hasta >= precio)
);

CREATE INDEX IF NOT EXISTS catalogo_items_org_idx
  ON catalogo_items(organization_id, orden)
  WHERE activo = TRUE;

CREATE INDEX IF NOT EXISTS catalogo_items_categoria_idx
  ON catalogo_items(categoria_id)
  WHERE activo = TRUE;

CREATE INDEX IF NOT EXISTS catalogo_items_inventario_idx
  ON catalogo_items(inventario_id)
  WHERE inventario_id IS NOT NULL;

-- ========================================
-- updated_at triggers
-- ========================================
CREATE OR REPLACE FUNCTION catalogo_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS catalogo_config_updated_at ON catalogo_config;
CREATE TRIGGER catalogo_config_updated_at
  BEFORE UPDATE ON catalogo_config
  FOR EACH ROW EXECUTE FUNCTION catalogo_set_updated_at();

DROP TRIGGER IF EXISTS catalogo_categorias_updated_at ON catalogo_categorias;
CREATE TRIGGER catalogo_categorias_updated_at
  BEFORE UPDATE ON catalogo_categorias
  FOR EACH ROW EXECUTE FUNCTION catalogo_set_updated_at();

DROP TRIGGER IF EXISTS catalogo_items_updated_at ON catalogo_items;
CREATE TRIGGER catalogo_items_updated_at
  BEFORE UPDATE ON catalogo_items
  FOR EACH ROW EXECUTE FUNCTION catalogo_set_updated_at();

-- ========================================
-- Helper: generar slug desde nombre de organización
-- ========================================
-- Normaliza un texto a slug URL-friendly: lowercase, sin acentos, sin espacios.
-- Si ya existe en catalogo_config, agrega sufijo numérico hasta encontrar uno libre.
CREATE OR REPLACE FUNCTION generar_slug_catalogo(p_texto TEXT)
RETURNS TEXT AS $$
DECLARE
  base_slug TEXT;
  candidato TEXT;
  contador  INTEGER := 0;
BEGIN
  -- Normalizar: lowercase, quitar acentos, reemplazar no-alfanum por guiones
  base_slug := lower(unaccent(coalesce(p_texto, 'catalogo')));
  base_slug := regexp_replace(base_slug, '[^a-z0-9]+', '-', 'g');
  base_slug := regexp_replace(base_slug, '^-+|-+$', '', 'g');
  base_slug := substring(base_slug FROM 1 FOR 48);

  IF base_slug = '' OR base_slug IS NULL THEN
    base_slug := 'catalogo';
  END IF;

  candidato := base_slug;

  WHILE EXISTS (SELECT 1 FROM catalogo_config WHERE slug = candidato) LOOP
    contador := contador + 1;
    candidato := base_slug || '-' || contador;
  END LOOP;

  RETURN candidato;
END;
$$ LANGUAGE plpgsql;

-- unaccent extension (suele estar instalada, IF NOT EXISTS por seguridad)
CREATE EXTENSION IF NOT EXISTS unaccent;

-- ========================================
-- RLS
-- ========================================
ALTER TABLE catalogo_config     ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogo_categorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogo_items      ENABLE ROW LEVEL SECURITY;

-- catalogo_config: org propia full access
CREATE POLICY "Org puede ver su catalogo_config"
  ON catalogo_config FOR SELECT
  USING (organization_id = public.get_current_organization_id());

CREATE POLICY "Org puede gestionar su catalogo_config"
  ON catalogo_config FOR ALL
  USING (organization_id = public.get_current_organization_id());

-- catalogo_categorias: org propia full access
CREATE POLICY "Org puede ver sus catalogo_categorias"
  ON catalogo_categorias FOR SELECT
  USING (organization_id = public.get_current_organization_id());

CREATE POLICY "Org puede gestionar sus catalogo_categorias"
  ON catalogo_categorias FOR ALL
  USING (organization_id = public.get_current_organization_id());

-- catalogo_items: org propia full access
CREATE POLICY "Org puede ver sus catalogo_items"
  ON catalogo_items FOR SELECT
  USING (organization_id = public.get_current_organization_id());

CREATE POLICY "Org puede gestionar sus catalogo_items"
  ON catalogo_items FOR ALL
  USING (organization_id = public.get_current_organization_id());

-- ========================================
-- Lectura pública (anon) para catálogos activos
-- ========================================
-- Lectura pública por slug solo si el catálogo está activo.
-- Las rutas /api/public/catalogo/[slug] usan el cliente anon de Supabase.

CREATE POLICY "Publico puede leer catalogo_config activo"
  ON catalogo_config FOR SELECT
  TO anon
  USING (activo = TRUE);

CREATE POLICY "Publico puede leer catalogo_categorias de catalogos activos"
  ON catalogo_categorias FOR SELECT
  TO anon
  USING (
    activo = TRUE
    AND organization_id IN (
      SELECT organization_id FROM catalogo_config WHERE activo = TRUE
    )
  );

CREATE POLICY "Publico puede leer catalogo_items de catalogos activos"
  ON catalogo_items FOR SELECT
  TO anon
  USING (
    activo = TRUE
    AND organization_id IN (
      SELECT organization_id FROM catalogo_config WHERE activo = TRUE
    )
  );

-- ========================================
-- Comentarios
-- ========================================
COMMENT ON TABLE  catalogo_config     IS 'Configuración del catálogo público por organización (1:1)';
COMMENT ON TABLE  catalogo_categorias IS 'Categorías para agrupar items del catálogo público';
COMMENT ON TABLE  catalogo_items      IS 'Productos y servicios publicados en el catálogo público';
COMMENT ON COLUMN catalogo_config.slug IS 'Identificador URL-friendly único: /catalogo/[slug]';
COMMENT ON COLUMN catalogo_items.tipo  IS 'PRODUCTO (con stock opcional) o SERVICIO (sin stock)';
COMMENT ON COLUMN catalogo_items.stock IS 'NULL = sin tracking, 0 = agotado, n = disponible. Solo para tipo PRODUCTO.';
COMMENT ON COLUMN catalogo_items.inventario_id IS 'Si linkeado, el stock real lo dicta inventario.stock (sync en checkout)';
COMMENT ON COLUMN catalogo_items.precio IS 'Precio base. NULL = "Consultar precio". Si precio_hasta también: rango "Desde X hasta Y"';
