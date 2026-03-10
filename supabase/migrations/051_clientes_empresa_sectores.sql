-- Soporte para clientes empresa con sectores

-- Agregar campos de empresa a clientes
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS tipo_cliente TEXT DEFAULT 'INDIVIDUAL' CHECK (tipo_cliente IN ('INDIVIDUAL', 'EMPRESA'));
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS razon_social TEXT;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS cuit TEXT;

-- Tabla de sectores para clientes empresa
CREATE TABLE IF NOT EXISTS sectores_cliente (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  cliente_id TEXT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  contacto_nombre TEXT,
  contacto_telefono TEXT,
  contacto_email TEXT,
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(cliente_id, nombre)
);

CREATE INDEX IF NOT EXISTS sectores_cliente_cliente_idx ON sectores_cliente(cliente_id);

-- Agregar sector_id a ordenes_servicio
ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS sector_id TEXT REFERENCES sectores_cliente(id) ON DELETE SET NULL;
