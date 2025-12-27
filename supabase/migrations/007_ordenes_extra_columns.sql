-- ========================================
-- Agregar columnas extras a ordenes_servicio
-- ========================================

ALTER TABLE ordenes_servicio
ADD COLUMN IF NOT EXISTS marca TEXT,
ADD COLUMN IF NOT EXISTS color TEXT,
ADD COLUMN IF NOT EXISTS imei TEXT,
ADD COLUMN IF NOT EXISTS accesorios TEXT,
ADD COLUMN IF NOT EXISTS password_dispositivo TEXT;

-- Índice para búsqueda por IMEI
CREATE INDEX IF NOT EXISTS ordenes_imei_idx ON ordenes_servicio(imei) WHERE imei IS NOT NULL;
