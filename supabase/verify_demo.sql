-- ========================================
-- SCRIPT DE VERIFICACIÓN: Cuenta Demo
-- ========================================
-- Ejecuta este script en Supabase SQL Editor para verificar
-- si la cuenta demo está configurada correctamente

DO $$
DECLARE
  v_org_id TEXT;
  v_org_count INTEGER;
  v_user_count INTEGER;
  v_cliente_count INTEGER;
  v_inventario_count INTEGER;
  v_orden_count INTEGER;
  v_proveedor_count INTEGER;
  v_suscripcion_status TEXT;
  v_suscripcion_end TIMESTAMPTZ;
  v_plan_tipo TEXT;
  rec RECORD;
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'VERIFICACIÓN DE CUENTA DEMO';
  RAISE NOTICE '========================================';
  RAISE NOTICE '';

  -- ========================================
  -- 1. VERIFICAR ORGANIZACIÓN
  -- ========================================
  SELECT id INTO v_org_id
  FROM organizations
  WHERE slug = 'demo';

  IF v_org_id IS NULL THEN
    RAISE NOTICE '❌ ORGANIZACIÓN DEMO NO ENCONTRADA';
    RAISE NOTICE 'Necesitas ejecutar el script demo_setup.sql';
    RETURN;
  ELSE
    RAISE NOTICE '✅ Organización demo encontrada';
    RAISE NOTICE '   ID: %', v_org_id;
    RAISE NOTICE '   Slug: demo';
  END IF;

  -- ========================================
  -- 2. VERIFICAR SUSCRIPCIÓN
  -- ========================================
  SELECT s.status, s.current_period_end, p.tipo
  INTO v_suscripcion_status, v_suscripcion_end, v_plan_tipo
  FROM subscriptions s
  JOIN plans p ON s.plan_id = p.id
  WHERE s.organization_id = v_org_id;

  IF v_suscripcion_status IS NULL THEN
    RAISE NOTICE '❌ NO HAY SUSCRIPCIÓN';
  ELSIF v_plan_tipo = 'PREMIUM' AND v_suscripcion_status = 'ACTIVE' THEN
    RAISE NOTICE '✅ Suscripción Premium activa';
    RAISE NOTICE '   Expira: %', v_suscripcion_end;
  ELSE
    RAISE NOTICE '⚠️  Suscripción: % (%)', v_plan_tipo, v_suscripcion_status;
  END IF;

  -- ========================================
  -- 3. VERIFICAR USUARIOS
  -- ========================================
  SELECT COUNT(*) INTO v_user_count
  FROM users
  WHERE organization_id = v_org_id;

  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'USUARIOS (%)', v_user_count;
  RAISE NOTICE '========================================';

  FOR rec IN (
    SELECT email, nombre, rol, email_verified
    FROM users
    WHERE organization_id = v_org_id
    ORDER BY
      CASE rol
        WHEN 'ADMIN' THEN 1
        WHEN 'TECNICO' THEN 2
        WHEN 'VENDEDOR' THEN 3
      END,
      email
  ) LOOP
    IF rec.email_verified THEN
      RAISE NOTICE '✅ % - % (%)', rec.rol, rec.nombre, rec.email;
    ELSE
      RAISE NOTICE '⚠️  % - % (%) - Email no verificado', rec.rol, rec.nombre, rec.email;
    END IF;
  END LOOP;

  -- Verificar usuario admin específico
  IF EXISTS (
    SELECT 1 FROM users
    WHERE email = 'demo@stapp.com'
    AND organization_id = v_org_id
    AND rol = 'ADMIN'
    AND email_verified = true
  ) THEN
    RAISE NOTICE '';
    RAISE NOTICE '✅ Usuario admin demo@stapp.com configurado correctamente';
  ELSE
    RAISE NOTICE '';
    RAISE NOTICE '❌ Usuario admin demo@stapp.com NO encontrado o mal configurado';
  END IF;

  -- ========================================
  -- 4. VERIFICAR CLIENTES
  -- ========================================
  SELECT COUNT(*) INTO v_cliente_count
  FROM clientes
  WHERE organization_id = v_org_id;

  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'CLIENTES (%)', v_cliente_count;
  RAISE NOTICE '========================================';

  FOR rec IN (
    SELECT nombre, email, telefono
    FROM clientes
    WHERE organization_id = v_org_id
    ORDER BY nombre
  ) LOOP
    RAISE NOTICE '- % (% / %)', rec.nombre, rec.email, rec.telefono;
  END LOOP;

  -- ========================================
  -- 5. VERIFICAR INVENTARIO
  -- ========================================
  SELECT COUNT(*) INTO v_inventario_count
  FROM inventario
  WHERE organization_id = v_org_id;

  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'INVENTARIO (%)', v_inventario_count;
  RAISE NOTICE '========================================';

  FOR rec IN (
    SELECT codigo, nombre, categoria, stock, precio_venta
    FROM inventario
    WHERE organization_id = v_org_id
    ORDER BY categoria, nombre
  ) LOOP
    RAISE NOTICE '- [%] % - Stock: % - $%', rec.codigo, rec.nombre, rec.stock, rec.precio_venta;
  END LOOP;

  -- ========================================
  -- 6. VERIFICAR ÓRDENES DE SERVICIO
  -- ========================================
  SELECT COUNT(*) INTO v_orden_count
  FROM ordenes_servicio
  WHERE organization_id = v_org_id;

  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'ÓRDENES DE SERVICIO (%)', v_orden_count;
  RAISE NOTICE '========================================';

  FOR rec IN (
    SELECT
      os.codigo_orden,
      os.dispositivo,
      os.estado,
      c.nombre as cliente_nombre,
      u.nombre as tecnico_nombre,
      os.presupuesto
    FROM ordenes_servicio os
    LEFT JOIN clientes c ON os.cliente_id = c.id
    LEFT JOIN users u ON os.tecnico_id = u.id
    WHERE os.organization_id = v_org_id
    ORDER BY os.fecha_ingreso DESC
  ) LOOP
    RAISE NOTICE '- % | % | Estado: % | Cliente: % | Técnico: % | $%',
      rec.codigo_orden,
      rec.dispositivo,
      rec.estado,
      rec.cliente_nombre,
      COALESCE(rec.tecnico_nombre, 'Sin asignar'),
      rec.presupuesto;
  END LOOP;

  -- ========================================
  -- 7. VERIFICAR PROVEEDORES
  -- ========================================
  SELECT COUNT(*) INTO v_proveedor_count
  FROM proveedores
  WHERE organization_id = v_org_id;

  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'PROVEEDORES (%)', v_proveedor_count;
  RAISE NOTICE '========================================';

  FOR rec IN (
    SELECT nombre, email, telefono
    FROM proveedores
    WHERE organization_id = v_org_id
    ORDER BY nombre
  ) LOOP
    RAISE NOTICE '- % (% / %)', rec.nombre, rec.email, rec.telefono;
  END LOOP;

  -- ========================================
  -- RESUMEN FINAL
  -- ========================================
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'RESUMEN';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Organización: % (ID: %)',
    (SELECT nombre FROM organizations WHERE id = v_org_id),
    v_org_id;
  RAISE NOTICE 'Suscripción: % (%)', v_plan_tipo, v_suscripcion_status;
  RAISE NOTICE '';
  RAISE NOTICE 'Datos:';
  RAISE NOTICE '- % usuarios', v_user_count;
  RAISE NOTICE '- % clientes', v_cliente_count;
  RAISE NOTICE '- % items de inventario', v_inventario_count;
  RAISE NOTICE '- % órdenes de servicio', v_orden_count;
  RAISE NOTICE '- % proveedores', v_proveedor_count;
  RAISE NOTICE '';

  -- Validar cantidades esperadas
  IF v_user_count >= 5 AND
     v_cliente_count >= 4 AND
     v_inventario_count >= 8 AND
     v_orden_count >= 4 AND
     v_proveedor_count >= 2 THEN
    RAISE NOTICE '✅ LA CUENTA DEMO ESTÁ COMPLETAMENTE CONFIGURADA';
    RAISE NOTICE '';
    RAISE NOTICE 'Credenciales de acceso:';
    RAISE NOTICE '- Email: demo@stapp.com';
    RAISE NOTICE '- Password: Demo2024!';
    RAISE NOTICE '';
    RAISE NOTICE 'Variables de entorno requeridas en .env.local:';
    RAISE NOTICE 'DEMO_EMAIL="demo@stapp.com"';
    RAISE NOTICE 'DEMO_PASSWORD="Demo2024!"';
  ELSE
    RAISE NOTICE '⚠️  LA CUENTA DEMO ESTÁ INCOMPLETA';
    RAISE NOTICE '';
    RAISE NOTICE 'Cantidades esperadas:';
    RAISE NOTICE '- 5+ usuarios (actual: %)', v_user_count;
    RAISE NOTICE '- 4+ clientes (actual: %)', v_cliente_count;
    RAISE NOTICE '- 8+ items inventario (actual: %)', v_inventario_count;
    RAISE NOTICE '- 4+ órdenes (actual: %)', v_orden_count;
    RAISE NOTICE '- 2+ proveedores (actual: %)', v_proveedor_count;
    RAISE NOTICE '';
    RAISE NOTICE 'Ejecuta demo_setup.sql para agregar datos faltantes';
  END IF;

  RAISE NOTICE '========================================';

END $$;
