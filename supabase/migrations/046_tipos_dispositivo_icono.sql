-- ========================================
-- AGREGAR COLUMNA ICONO A TIPOS_DISPOSITIVO
-- ========================================

-- Agregar columna icono si no existe
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tipos_dispositivo' AND column_name = 'icono'
  ) THEN
    ALTER TABLE tipos_dispositivo ADD COLUMN icono TEXT;
  END IF;
END $$;
