-- ========================================
-- 157: Proveedores — lead time, pedido mínimo, rating, tags,
--      contactos extra, adjuntos y catálogo de referencia.
-- ========================================

-- ---------- 1) Campos extra en proveedores ----------
ALTER TABLE proveedores
  ADD COLUMN IF NOT EXISTS lead_time_dias INTEGER,
  ADD COLUMN IF NOT EXISTS pedido_minimo  NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS rating         SMALLINT,
  ADD COLUMN IF NOT EXISTS tags           TEXT[];

ALTER TABLE proveedores DROP CONSTRAINT IF EXISTS proveedores_lead_time_chk;
ALTER TABLE proveedores ADD CONSTRAINT proveedores_lead_time_chk
  CHECK (lead_time_dias IS NULL OR lead_time_dias >= 0);

ALTER TABLE proveedores DROP CONSTRAINT IF EXISTS proveedores_pedido_minimo_chk;
ALTER TABLE proveedores ADD CONSTRAINT proveedores_pedido_minimo_chk
  CHECK (pedido_minimo IS NULL OR pedido_minimo >= 0);

ALTER TABLE proveedores DROP CONSTRAINT IF EXISTS proveedores_rating_chk;
ALTER TABLE proveedores ADD CONSTRAINT proveedores_rating_chk
  CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5));

CREATE INDEX IF NOT EXISTS idx_proveedores_tags
  ON proveedores USING GIN (tags)
  WHERE tags IS NOT NULL;

COMMENT ON COLUMN proveedores.lead_time_dias IS
  'Días promedio de entrega desde emisión del pedido.';
COMMENT ON COLUMN proveedores.pedido_minimo IS
  'Monto mínimo de pedido aceptado por el proveedor.';
COMMENT ON COLUMN proveedores.rating IS
  'Calificación interna 1-5 (5 = excelente).';
COMMENT ON COLUMN proveedores.tags IS
  'Etiquetas libres (rubros, modalidades): repuestos, accesorios, mayorista, etc.';

-- ---------- 2) Contactos extra ----------
CREATE TABLE IF NOT EXISTS proveedor_contactos (
  id              TEXT PRIMARY KEY DEFAULT generate_cuid(),
  proveedor_id    TEXT NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  nombre          TEXT NOT NULL,
  cargo           TEXT,
  telefono        TEXT,
  whatsapp        TEXT,
  email           TEXT,
  notas           TEXT,
  principal       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proveedor_contactos_prov
  ON proveedor_contactos(proveedor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_proveedor_contactos_org
  ON proveedor_contactos(organization_id);

DROP TRIGGER IF EXISTS proveedor_contactos_updated_at ON proveedor_contactos;
CREATE TRIGGER proveedor_contactos_updated_at
  BEFORE UPDATE ON proveedor_contactos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---------- 3) Adjuntos (PDF / archivos) ----------
CREATE TABLE IF NOT EXISTS proveedor_adjuntos (
  id              TEXT PRIMARY KEY DEFAULT generate_cuid(),
  proveedor_id    TEXT NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  nombre          TEXT NOT NULL,
  descripcion     TEXT,
  file_url        TEXT NOT NULL,
  file_path       TEXT NOT NULL,
  mime            TEXT,
  size_bytes      BIGINT,
  uploaded_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proveedor_adjuntos_prov
  ON proveedor_adjuntos(proveedor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_proveedor_adjuntos_org
  ON proveedor_adjuntos(organization_id);

-- ---------- 4) Catálogo de referencia ----------
-- Items que el proveedor ofrece. Puede vincularse opcionalmente a un item
-- del inventario propio. Se mantiene `precio_referencia` con fecha de
-- última actualización para detectar listas de precios desactualizadas.
CREATE TABLE IF NOT EXISTS proveedor_catalogo_items (
  id                 TEXT PRIMARY KEY DEFAULT generate_cuid(),
  proveedor_id       TEXT NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
  organization_id    TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  inventario_id      TEXT REFERENCES inventario(id) ON DELETE SET NULL,
  codigo_proveedor   TEXT,
  nombre             TEXT NOT NULL,
  descripcion        TEXT,
  precio_referencia  NUMERIC(12,2),
  moneda             TEXT DEFAULT 'ARS',
  unidad             TEXT,
  notas              TEXT,
  precio_actualizado_at TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proveedor_catalogo_prov
  ON proveedor_catalogo_items(proveedor_id, nombre);

CREATE INDEX IF NOT EXISTS idx_proveedor_catalogo_org
  ON proveedor_catalogo_items(organization_id);

CREATE INDEX IF NOT EXISTS idx_proveedor_catalogo_inv
  ON proveedor_catalogo_items(inventario_id)
  WHERE inventario_id IS NOT NULL;

ALTER TABLE proveedor_catalogo_items DROP CONSTRAINT IF EXISTS proveedor_catalogo_precio_chk;
ALTER TABLE proveedor_catalogo_items ADD CONSTRAINT proveedor_catalogo_precio_chk
  CHECK (precio_referencia IS NULL OR precio_referencia >= 0);

DROP TRIGGER IF EXISTS proveedor_catalogo_items_updated_at ON proveedor_catalogo_items;
CREATE TRIGGER proveedor_catalogo_items_updated_at
  BEFORE UPDATE ON proveedor_catalogo_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Trigger para sellar precio_actualizado_at cuando cambia el precio.
CREATE OR REPLACE FUNCTION proveedor_catalogo_precio_touch()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.precio_referencia IS NOT NULL AND NEW.precio_actualizado_at IS NULL THEN
      NEW.precio_actualizado_at := NOW();
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.precio_referencia IS DISTINCT FROM OLD.precio_referencia THEN
      NEW.precio_actualizado_at := NOW();
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS proveedor_catalogo_precio_stamp ON proveedor_catalogo_items;
CREATE TRIGGER proveedor_catalogo_precio_stamp
  BEFORE INSERT OR UPDATE ON proveedor_catalogo_items
  FOR EACH ROW EXECUTE FUNCTION proveedor_catalogo_precio_touch();

-- ---------- 5) Bucket adjuntos ----------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'proveedor-adjuntos',
  'proveedor-adjuntos',
  false,
  10485760, -- 10MB
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'text/plain'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public          = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
