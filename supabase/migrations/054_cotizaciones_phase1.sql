-- Cotizaciones Phase 1: standalone, descuentos, IVA, unidades, validez, términos

-- 1. Organizations: config de cotizaciones
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS iva_porcentaje DECIMAL(5,2) DEFAULT 0;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS cotizacion_validez_dias INTEGER DEFAULT 30;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS cotizacion_terminos TEXT;

-- 2. Cotizaciones: nuevos campos
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS descuento_global_tipo TEXT DEFAULT 'porcentaje'
  CHECK (descuento_global_tipo IN ('porcentaje', 'fijo'));
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS descuento_global_valor DECIMAL(10,2) DEFAULT 0;
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS iva_porcentaje DECIMAL(5,2) DEFAULT 0;
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS terminos TEXT;
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS organization_id TEXT REFERENCES organizations(id);

-- Backfill organization_id desde ordenes_servicio
UPDATE cotizaciones c
SET organization_id = os.organization_id
FROM ordenes_servicio os
WHERE c.orden_id = os.id
  AND c.organization_id IS NULL;

-- Index para buscar cotizaciones por organization_id
CREATE INDEX IF NOT EXISTS cotizaciones_organization_idx ON cotizaciones(organization_id);

-- 3. Items cotización: unidad y descuento por item
ALTER TABLE items_cotizacion ADD COLUMN IF NOT EXISTS unidad TEXT DEFAULT 'Unidad';
ALTER TABLE items_cotizacion ADD COLUMN IF NOT EXISTS descuento_tipo TEXT DEFAULT 'porcentaje'
  CHECK (descuento_tipo IN ('porcentaje', 'fijo'));
ALTER TABLE items_cotizacion ADD COLUMN IF NOT EXISTS descuento_valor DECIMAL(10,2) DEFAULT 0;
