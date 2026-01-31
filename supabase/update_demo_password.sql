-- ========================================
-- ACTUALIZAR CONTRASEÑA USUARIO DEMO
-- ========================================
-- Script para actualizar la contraseña del usuario demo si ya existe

DO $$
DECLARE
  v_user_id TEXT;
  v_updated_count INTEGER;
BEGIN
  -- Verificar si el usuario demo existe
  SELECT id INTO v_user_id
  FROM users
  WHERE email = 'demo@stapp.com';

  IF v_user_id IS NULL THEN
    RAISE NOTICE '❌ Usuario demo@stapp.com NO EXISTE';
    RAISE NOTICE 'Ejecuta demo_setup.sql para crear la cuenta demo completa';
  ELSE
    RAISE NOTICE '✅ Usuario demo@stapp.com encontrado con ID: %', v_user_id;
    RAISE NOTICE '';
    RAISE NOTICE 'Actualizando contraseña...';

    -- Actualizar contraseña con el hash correcto
    UPDATE users
    SET
      password = '$2a$10$rXKj7qZ5YGx.MQp7VhU8xuYxqD9/E.AKqHFl2HpkJ7LqkP0V2W7Zm',
      email_verified = true
    WHERE id = v_user_id;

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;

    IF v_updated_count > 0 THEN
      RAISE NOTICE '✅ Contraseña actualizada correctamente';
      RAISE NOTICE '';
      RAISE NOTICE 'Credenciales de acceso:';
      RAISE NOTICE '- Email: demo@stapp.com';
      RAISE NOTICE '- Password: Demo2024!';
      RAISE NOTICE '';
      RAISE NOTICE 'Hash bcrypt usado: $2a$10$rXKj7qZ5YGx.MQp7VhU8xuYxqD9/E.AKqHFl2HpkJ7LqkP0V2W7Zm';
    ELSE
      RAISE NOTICE '⚠️  No se pudo actualizar la contraseña';
    END IF;
  END IF;
END $$;
