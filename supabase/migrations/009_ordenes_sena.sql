-- ========================================
-- Agregar campo seña/adelanto a ordenes
-- ========================================

-- Agregar columna de seña (adelanto/anticipo)
ALTER TABLE ordenes_servicio
ADD COLUMN IF NOT EXISTS sena DECIMAL(10, 2) DEFAULT 0;

-- Comentario descriptivo
COMMENT ON COLUMN ordenes_servicio.sena IS 'Seña o adelanto dejado por el cliente al momento de ingresar el equipo';
