-- Add sector_id to cotizaciones (same pattern as ordenes_servicio)
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS sector_id TEXT REFERENCES sectores_cliente(id) ON DELETE SET NULL;
