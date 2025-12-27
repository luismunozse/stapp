-- ========================================
-- Agregar token público para acceso a PDFs
-- ========================================

-- Agregar columna de token público
ALTER TABLE ordenes_servicio
ADD COLUMN IF NOT EXISTS public_token TEXT UNIQUE;

-- Crear índice para búsqueda rápida por token
CREATE UNIQUE INDEX IF NOT EXISTS ordenes_public_token_idx
ON ordenes_servicio(public_token)
WHERE public_token IS NOT NULL;

-- Función para generar tokens únicos
CREATE OR REPLACE FUNCTION generate_public_token()
RETURNS TEXT AS $$
BEGIN
  RETURN encode(gen_random_bytes(16), 'hex');
END;
$$ LANGUAGE plpgsql;

-- Generar tokens para órdenes existentes que no tienen
UPDATE ordenes_servicio
SET public_token = encode(gen_random_bytes(16), 'hex')
WHERE public_token IS NULL;
