-- Campos para firma de entrega en ordenes_servicio
ALTER TABLE ordenes_servicio
ADD COLUMN IF NOT EXISTS fecha_entrega TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS firma_cliente_entrega TEXT,
ADD COLUMN IF NOT EXISTS firma_cliente_entrega_mime TEXT,
ADD COLUMN IF NOT EXISTS firma_encargado_entrega TEXT,
ADD COLUMN IF NOT EXISTS firma_encargado_entrega_mime TEXT,
ADD COLUMN IF NOT EXISTS entregado_por_user_id TEXT REFERENCES users(id),
ADD COLUMN IF NOT EXISTS notas_entrega TEXT;

-- Indice para busquedas por fecha de entrega
CREATE INDEX IF NOT EXISTS idx_ordenes_fecha_entrega ON ordenes_servicio(fecha_entrega);
