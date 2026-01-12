-- ========================================
-- TIPOS DE DISPOSITIVO PERSONALIZADOS
-- ========================================

-- Tabla de tipos de dispositivo personalizados por organización
CREATE TABLE tipos_dispositivo (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  codigo TEXT NOT NULL,
  nombre TEXT NOT NULL,
  prefijo_orden TEXT NOT NULL,
  icono TEXT,
  activo BOOLEAN DEFAULT TRUE,
  es_base BOOLEAN DEFAULT FALSE,
  orden INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(organization_id, codigo)
);

CREATE INDEX tipos_dispositivo_org_idx ON tipos_dispositivo(organization_id);
CREATE INDEX tipos_dispositivo_org_activo_idx ON tipos_dispositivo(organization_id, activo);

CREATE TRIGGER tipos_dispositivo_updated_at
  BEFORE UPDATE ON tipos_dispositivo
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Función para poblar tipos base a una organización
CREATE OR REPLACE FUNCTION poblar_tipos_dispositivo_base(org_id TEXT)
RETURNS VOID AS $$
BEGIN
  INSERT INTO tipos_dispositivo (organization_id, codigo, nombre, prefijo_orden, es_base, orden)
  VALUES
    (org_id, 'CELULAR', 'Celular', 'CEL', TRUE, 1),
    (org_id, 'COMPUTADORA', 'Computadora', 'PC', TRUE, 2),
    (org_id, 'TABLET', 'Tablet', 'TAB', TRUE, 3),
    (org_id, 'CONSOLA', 'Consola', 'CONS', TRUE, 4),
    (org_id, 'SMARTWATCH', 'Smartwatch', 'SW', TRUE, 5),
    (org_id, 'TODOS', 'Todos los dispositivos', 'ORD', TRUE, 99)
  ON CONFLICT (organization_id, codigo) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- Poblar tipos base para TODAS las organizaciones existentes
DO $$
DECLARE
  org_record RECORD;
BEGIN
  FOR org_record IN SELECT id FROM organizations LOOP
    PERFORM poblar_tipos_dispositivo_base(org_record.id);
  END LOOP;
END $$;

-- Trigger para poblar tipos base en nuevas organizaciones
CREATE OR REPLACE FUNCTION on_organization_created_tipos()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM poblar_tipos_dispositivo_base(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_organization_tipos_dispositivo
  AFTER INSERT ON organizations
  FOR EACH ROW EXECUTE FUNCTION on_organization_created_tipos();

-- Agregar columna tipo_dispositivo_id a ordenes_servicio
ALTER TABLE ordenes_servicio
ADD COLUMN tipo_dispositivo_id TEXT REFERENCES tipos_dispositivo(id);

-- Agregar columna tipo_dispositivo_id a inventario
ALTER TABLE inventario
ADD COLUMN tipo_dispositivo_id TEXT REFERENCES tipos_dispositivo(id);

-- Migrar datos existentes de ordenes_servicio
UPDATE ordenes_servicio os
SET tipo_dispositivo_id = td.id
FROM tipos_dispositivo td
WHERE td.organization_id = os.organization_id
  AND td.codigo = os.tipo_dispositivo::TEXT
  AND os.tipo_dispositivo_id IS NULL;

-- Migrar datos existentes de inventario
UPDATE inventario i
SET tipo_dispositivo_id = td.id
FROM tipos_dispositivo td
WHERE td.organization_id = i.organization_id
  AND td.codigo = i.tipo_dispositivo::TEXT
  AND i.tipo_dispositivo_id IS NULL;

-- Índices para las nuevas columnas
CREATE INDEX ordenes_tipo_dispositivo_id_idx ON ordenes_servicio(tipo_dispositivo_id);
CREATE INDEX inventario_tipo_dispositivo_id_idx ON inventario(tipo_dispositivo_id);
