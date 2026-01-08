-- ========================================
-- IMPORTACIONES (Import History)
-- ========================================

CREATE TYPE tipo_entidad_importacion AS ENUM ('CLIENTES', 'INVENTARIO');

CREATE TABLE importaciones (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),

  -- Metadata del archivo
  entity_type tipo_entidad_importacion NOT NULL,
  filename TEXT NOT NULL,
  file_path TEXT NOT NULL, -- Path en Storage bucket
  file_size INTEGER NOT NULL, -- bytes

  -- Resultados de la importación
  total_rows INTEGER NOT NULL,
  success_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0, -- Duplicados
  error_count INTEGER NOT NULL DEFAULT 0,

  -- Detalles de errores (JSON array)
  errors_detail JSONB DEFAULT '[]'::jsonb,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX importaciones_organization_id_idx ON importaciones(organization_id);
CREATE INDEX importaciones_user_id_idx ON importaciones(user_id);
CREATE INDEX importaciones_entity_type_idx ON importaciones(entity_type);
CREATE INDEX importaciones_created_at_idx ON importaciones(created_at DESC);

-- Ejemplo de errors_detail:
-- [
--   {"row": 5, "error": "Teléfono inválido: debe tener 10 dígitos", "data": {"nombre": "Juan", "telefono": "123"}},
--   {"row": 12, "error": "Ya existe un cliente con ese teléfono", "data": {"nombre": "María", "telefono": "1234567890"}}
-- ]
