-- Permitir cotizaciones standalone (sin orden de servicio)
ALTER TABLE cotizaciones ALTER COLUMN orden_id DROP NOT NULL;

-- Agregar cliente_id para cotizaciones standalone
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS cliente_id TEXT REFERENCES clientes(id) ON DELETE SET NULL;

-- Index para buscar cotizaciones por cliente
CREATE INDEX IF NOT EXISTS cotizaciones_cliente_idx ON cotizaciones(cliente_id);
