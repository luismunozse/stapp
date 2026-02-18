-- ========================================
-- Re-poblar tipos de dispositivo base para todas las organizaciones
-- Esto es seguro gracias a ON CONFLICT DO NOTHING
-- ========================================

-- Re-ejecutar la función para cada organización existente
DO $$
DECLARE
  org_record RECORD;
BEGIN
  FOR org_record IN SELECT id FROM organizations LOOP
    PERFORM poblar_tipos_dispositivo_base(org_record.id);
  END LOOP;
END $$;
