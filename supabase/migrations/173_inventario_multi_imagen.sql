-- ========================================
-- 173: MULTI-IMAGEN POR ITEM DE INVENTARIO
-- ========================================
-- Galería de imágenes por item. La columna inventario.imagen_url / imagen_path
-- queda como cache de "imagen principal" para preservar compatibilidad con
-- todo el frontend / catálogo público / labels que ya la usan.
--
-- Trigger sync_inventario_imagen_principal mantiene la cache:
--   - INSERT con es_principal=true → demote otros, actualiza inventario.imagen_url
--   - UPDATE es_principal de false→true → idem
--   - DELETE de la fila principal → promueve la primera por orden
--   - Si no queda ninguna → inventario.imagen_url/path = NULL
--
-- Backfill: cada item con imagen_url existente obtiene 1 fila principal en
-- inventario_imagenes (orden=0).

-- ========================================
-- 1. TABLA inventario_imagenes
-- ========================================

CREATE TABLE IF NOT EXISTS inventario_imagenes (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  inventario_id TEXT NOT NULL REFERENCES inventario(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  path TEXT NOT NULL,
  orden INTEGER NOT NULL DEFAULT 0,
  es_principal BOOLEAN NOT NULL DEFAULT false,
  alt TEXT,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS inventario_imagenes_inv_idx ON inventario_imagenes(inventario_id);
CREATE INDEX IF NOT EXISTS inventario_imagenes_org_idx ON inventario_imagenes(organization_id);

-- Solo 1 principal por item
CREATE UNIQUE INDEX IF NOT EXISTS inventario_imagenes_principal_unique
  ON inventario_imagenes(inventario_id)
  WHERE es_principal = true;

ALTER TABLE inventario_imagenes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventario_imagenes_select ON inventario_imagenes;
CREATE POLICY inventario_imagenes_select ON inventario_imagenes
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS inventario_imagenes_all_service ON inventario_imagenes;
CREATE POLICY inventario_imagenes_all_service ON inventario_imagenes
  FOR ALL USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS inventario_imagenes_updated_at ON inventario_imagenes;
CREATE TRIGGER inventario_imagenes_updated_at
  BEFORE UPDATE ON inventario_imagenes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ========================================
-- 2. TRIGGER: sincronizar imagen principal con inventario.imagen_url
-- ========================================

CREATE OR REPLACE FUNCTION sync_inventario_imagen_principal()
RETURNS TRIGGER AS $$
DECLARE
  v_inv_id TEXT;
  v_principal RECORD;
BEGIN
  v_inv_id := COALESCE(NEW.inventario_id, OLD.inventario_id);

  -- En UPDATE/INSERT que marca es_principal=true → demote otros
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.es_principal = true THEN
    UPDATE inventario_imagenes
    SET es_principal = false
    WHERE inventario_id = v_inv_id
      AND id <> NEW.id
      AND es_principal = true;
  END IF;

  -- Resolver la principal actual
  SELECT id, url, path INTO v_principal
  FROM inventario_imagenes
  WHERE inventario_id = v_inv_id AND es_principal = true
  LIMIT 1;

  -- Si no hay principal explícita, promover la primera por orden
  IF NOT FOUND THEN
    SELECT id, url, path INTO v_principal
    FROM inventario_imagenes
    WHERE inventario_id = v_inv_id
    ORDER BY orden ASC, created_at ASC
    LIMIT 1;

    IF FOUND THEN
      UPDATE inventario_imagenes
      SET es_principal = true
      WHERE id = v_principal.id;
    END IF;
  END IF;

  -- Sincronizar cache en inventario
  IF FOUND THEN
    UPDATE inventario
    SET imagen_url = v_principal.url,
        imagen_path = v_principal.path
    WHERE id = v_inv_id;
  ELSE
    UPDATE inventario
    SET imagen_url = NULL,
        imagen_path = NULL
    WHERE id = v_inv_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS inventario_imagenes_sync_principal ON inventario_imagenes;
CREATE TRIGGER inventario_imagenes_sync_principal
  AFTER INSERT OR UPDATE OF es_principal OR DELETE ON inventario_imagenes
  FOR EACH ROW EXECUTE FUNCTION sync_inventario_imagen_principal();

-- ========================================
-- 3. BACKFILL: 1 fila principal por item con imagen actual
-- ========================================

INSERT INTO inventario_imagenes (inventario_id, url, path, orden, es_principal, organization_id)
SELECT
  i.id,
  i.imagen_url,
  COALESCE(i.imagen_path, i.imagen_url),
  0,
  true,
  i.organization_id
FROM inventario i
WHERE i.imagen_url IS NOT NULL
  AND i.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM inventario_imagenes ii
    WHERE ii.inventario_id = i.id
  );
