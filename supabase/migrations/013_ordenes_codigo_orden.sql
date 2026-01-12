-- ========================================
-- Agregar columna codigo_orden a ordenes_servicio
-- ========================================

-- Agregar columna para código alfanumérico (ej: CEL-0001, PC-0001)
ALTER TABLE ordenes_servicio
ADD COLUMN IF NOT EXISTS codigo_orden TEXT;

-- Índice para búsqueda por código
CREATE INDEX IF NOT EXISTS ordenes_codigo_orden_idx ON ordenes_servicio(organization_id, codigo_orden);

-- Generar códigos para órdenes existentes que no tengan
UPDATE ordenes_servicio
SET codigo_orden = CONCAT(
  CASE tipo_dispositivo
    WHEN 'CELULAR' THEN 'CEL'
    WHEN 'TABLET' THEN 'TAB'
    WHEN 'COMPUTADORA' THEN 'PC'
    WHEN 'CONSOLA' THEN 'CON'
    WHEN 'SMARTWATCH' THEN 'SW'
    WHEN 'TODOS' THEN 'OTR'
    ELSE 'ORD'
  END,
  '-',
  LPAD(numero_orden::TEXT, 4, '0')
)
WHERE codigo_orden IS NULL;
