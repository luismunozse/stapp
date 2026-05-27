-- ============================================
-- 194: catalogo_categorias.slug (SEO landing por categoría)
-- ============================================
-- Permite URLs /catalogo/[slug]/c/[categoria-slug] indexables para SEO.
-- Cada categoría tiene slug único por organización, autogenerado desde el
-- nombre al crear/renombrar si el admin no lo edita manualmente.
-- ============================================

ALTER TABLE catalogo_categorias
  ADD COLUMN IF NOT EXISTS slug TEXT;

-- Constraint formato URL-friendly (igual que catalogo_config)
ALTER TABLE catalogo_categorias
  DROP CONSTRAINT IF EXISTS catalogo_categorias_slug_format;
ALTER TABLE catalogo_categorias
  ADD CONSTRAINT catalogo_categorias_slug_format
    CHECK (slug IS NULL OR slug ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$');

-- Unicidad por organización
CREATE UNIQUE INDEX IF NOT EXISTS catalogo_categorias_org_slug_unique
  ON catalogo_categorias(organization_id, slug)
  WHERE slug IS NOT NULL;

-- Backfill desde nombre
DO $$
DECLARE
  r RECORD;
  base_slug TEXT;
  candidato TEXT;
  contador INTEGER;
BEGIN
  FOR r IN SELECT id, organization_id, nombre FROM catalogo_categorias WHERE slug IS NULL LOOP
    base_slug := lower(unaccent(coalesce(r.nombre, 'categoria')));
    base_slug := regexp_replace(base_slug, '[^a-z0-9]+', '-', 'g');
    base_slug := regexp_replace(base_slug, '^-+|-+$', '', 'g');
    base_slug := substring(base_slug FROM 1 FOR 60);
    IF base_slug = '' OR base_slug IS NULL THEN base_slug := 'categoria'; END IF;

    candidato := base_slug;
    contador := 0;
    WHILE EXISTS (
      SELECT 1 FROM catalogo_categorias
      WHERE organization_id = r.organization_id AND slug = candidato
    ) LOOP
      contador := contador + 1;
      candidato := base_slug || '-' || contador;
    END LOOP;

    UPDATE catalogo_categorias SET slug = candidato WHERE id = r.id;
  END LOOP;
END $$;

COMMENT ON COLUMN catalogo_categorias.slug IS
  'Identificador URL-friendly único por org. Usado en /catalogo/[slug]/c/[slug].';
