-- ========================================
-- 158: Proveedores — logo
-- ========================================
-- Imagen identificativa del proveedor. Se almacena en el bucket público
-- `logos` bajo la ruta proveedores/{orgId}/{provId}.{ext}.
-- ========================================

ALTER TABLE proveedores
  ADD COLUMN IF NOT EXISTS logo_url  TEXT,
  ADD COLUMN IF NOT EXISTS logo_path TEXT;

COMMENT ON COLUMN proveedores.logo_url IS
  'URL pública del logo del proveedor (bucket logos).';
COMMENT ON COLUMN proveedores.logo_path IS
  'Path en bucket logos para poder borrar al reemplazar/eliminar.';
