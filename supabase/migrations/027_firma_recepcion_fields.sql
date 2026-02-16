-- Campos para firma de recepcion en ordenes_servicio
-- El cliente firma al dejar su equipo para reparacion
ALTER TABLE ordenes_servicio
ADD COLUMN IF NOT EXISTS firma_cliente_recepcion TEXT,
ADD COLUMN IF NOT EXISTS firma_cliente_recepcion_mime TEXT;
