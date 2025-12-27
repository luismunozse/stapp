-- ========================================
-- USUARIOS DEMO (para pruebas)
-- ========================================
-- Estos usuarios se crean en la organización demo existente
-- Contraseñas: tecnico123, vendedor123

-- Insertar usuarios demo (requiere que exista la organización y el admin)
-- Primero obtenemos el organization_id del admin existente

DO $$
DECLARE
  demo_org_id TEXT;
BEGIN
  -- Obtener el organization_id del admin demo
  SELECT organization_id INTO demo_org_id
  FROM users
  WHERE email = 'admin@demo.com'
  LIMIT 1;

  -- Si existe la organización demo, crear los usuarios
  IF demo_org_id IS NOT NULL THEN
    -- Técnico demo
    INSERT INTO users (email, password, nombre, rol, organization_id)
    VALUES (
      'tecnico@demo.com',
      '$2a$10$AoTbrJxvzGf.UGPTJ4Ia5Otqk0eXVvwpY10yjWhFP53t0wWZKojIq',
      'Técnico Demo',
      'TECNICO',
      demo_org_id
    )
    ON CONFLICT (email) DO NOTHING;

    -- Vendedor demo
    INSERT INTO users (email, password, nombre, rol, organization_id)
    VALUES (
      'vendedor@demo.com',
      '$2a$10$nVapmMnFewBn4zrkK/VjienzKiluTuw5LWt3m3xE6dl3MXR.53AbC',
      'Vendedor Demo',
      'VENDEDOR',
      demo_org_id
    )
    ON CONFLICT (email) DO NOTHING;

    RAISE NOTICE 'Usuarios demo creados exitosamente en organización %', demo_org_id;
  ELSE
    RAISE NOTICE 'No se encontró admin@demo.com. Crea primero la organización y el admin.';
  END IF;
END $$;
