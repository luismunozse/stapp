-- ========================================
-- Cambiar tipo_dispositivo de ENUM a TEXT en inventario y ordenes_servicio
-- para soportar tipos de dispositivo personalizados
-- ========================================

-- Cambiar la columna tipo_dispositivo de enum a TEXT en inventario
ALTER TABLE inventario
ALTER COLUMN tipo_dispositivo TYPE TEXT USING tipo_dispositivo::TEXT;

ALTER TABLE inventario
ALTER COLUMN tipo_dispositivo DROP NOT NULL;

-- Cambiar la columna tipo_dispositivo de enum a TEXT en ordenes_servicio
ALTER TABLE ordenes_servicio
ALTER COLUMN tipo_dispositivo TYPE TEXT USING tipo_dispositivo::TEXT;

ALTER TABLE ordenes_servicio
ALTER COLUMN tipo_dispositivo DROP NOT NULL;
