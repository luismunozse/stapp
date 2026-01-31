-- ========================================
-- SCRIPT COMPLETO: Configuración de Cuenta Demo
-- ========================================
--
-- INSTRUCCIONES:
-- 1. Abre Supabase SQL Editor
-- 2. Copia y pega este script COMPLETO
-- 3. Busca y reemplaza '$2a$10$rXKj7qZ5YGx.MQp7VhU8xuYxqD9/E.AKqHFl2HpkJ7LqkP0V2W7Zm' con el hash bcrypt de 'Demo2024!'
--    Genera el hash en: https://bcrypt-generator.com/ (10 rounds)
--    O usa: $2a$10$rXKj7qZ5YGx.MQp7VhU8xuYxqD9/E.AKqHFl2HpkJ7LqkP0V2W7Zm
-- 4. Ejecuta el script
-- 5. Los IDs se crean automáticamente y se usan en las relaciones
--
-- ========================================

-- Variables temporales para IDs
DO $$
DECLARE
  v_org_id TEXT;
  v_user_demo_id TEXT;
  v_tecnico1_id TEXT;
  v_tecnico2_id TEXT;
  v_vendedor1_id TEXT;
  v_cliente1_id TEXT;
  v_cliente2_id TEXT;
  v_cliente3_id TEXT;
  v_cliente4_id TEXT;
BEGIN

-- ========================================
-- 1. CREAR ORGANIZACIÓN DEMO
-- ========================================
INSERT INTO organizations (
  nombre,
  slug,
  nombre_mostrar,
  email,
  telefono,
  direccion,
  activo
)
VALUES (
  'Demo Organization',
  'demo',
  'STApp Demo - Taller de Reparaciones',
  'demo@stapp.com',
  '+54 11 5555-5555',
  'Av. Corrientes 1234, CABA',
  true
)
RETURNING id INTO v_org_id;

RAISE NOTICE 'Organización creada con ID: %', v_org_id;

-- ========================================
-- 2. ACTUALIZAR SUSCRIPCIÓN A PREMIUM PERMANENTE
-- ========================================
-- La suscripción se creó automáticamente por trigger
-- Actualizamos para que sea Premium y nunca expire
UPDATE subscriptions
SET
  status = 'ACTIVE',
  trial_end = '2099-12-31 23:59:59',
  current_period_end = '2099-12-31 23:59:59',
  current_period_start = NOW(),
  plan_id = (SELECT id FROM plans WHERE tipo = 'PREMIUM' LIMIT 1)
WHERE organization_id = v_org_id;

RAISE NOTICE 'Suscripción actualizada a Premium permanente';

-- ========================================
-- 3. CREAR USUARIO ADMIN DEMO
-- ========================================
-- IMPORTANTE: Reemplaza '$2a$10$rXKj7qZ5YGx.MQp7VhU8xuYxqD9/E.AKqHFl2HpkJ7LqkP0V2W7Zm' con el hash real
INSERT INTO users (
  email,
  password,
  nombre,
  rol,
  organization_id,
  email_verified
)
VALUES (
  'demo@stapp.com',
  '$2a$10$rXKj7qZ5YGx.MQp7VhU8xuYxqD9/E.AKqHFl2HpkJ7LqkP0V2W7Zm',  -- ⚠️ REEMPLAZAR CON HASH BCRYPT
  'Usuario Demo',
  'ADMIN',
  v_org_id,
  true
)
RETURNING id INTO v_user_demo_id;

RAISE NOTICE 'Usuario admin demo creado con ID: %', v_user_demo_id;

-- ========================================
-- 4. CREAR TÉCNICOS DE EJEMPLO
-- ========================================
INSERT INTO users (email, password, nombre, rol, organization_id, email_verified)
VALUES
  ('pedro.tecnico@demo.com', '$2a$10$rXKj7qZ5YGx.MQp7VhU8xuYxqD9/E.AKqHFl2HpkJ7LqkP0V2W7Zm', 'Pedro Técnico', 'TECNICO', v_org_id, true)
RETURNING id INTO v_tecnico1_id;

INSERT INTO users (email, password, nombre, rol, organization_id, email_verified)
VALUES
  ('ana.tecnica@demo.com', '$2a$10$rXKj7qZ5YGx.MQp7VhU8xuYxqD9/E.AKqHFl2HpkJ7LqkP0V2W7Zm', 'Ana Técnica', 'TECNICO', v_org_id, true)
RETURNING id INTO v_tecnico2_id;

RAISE NOTICE 'Técnicos creados: Pedro (%), Ana (%)', v_tecnico1_id, v_tecnico2_id;

-- ========================================
-- 5. CREAR VENDEDOR DE EJEMPLO
-- ========================================
INSERT INTO users (email, password, nombre, rol, organization_id, email_verified)
VALUES
  ('luis.vendedor@demo.com', '$2a$10$rXKj7qZ5YGx.MQp7VhU8xuYxqD9/E.AKqHFl2HpkJ7LqkP0V2W7Zm', 'Luis Vendedor', 'VENDEDOR', v_org_id, true)
RETURNING id INTO v_vendedor1_id;

RAISE NOTICE 'Vendedor creado con ID: %', v_vendedor1_id;

-- ========================================
-- 6. CREAR CLIENTES DE EJEMPLO
-- ========================================
INSERT INTO clientes (nombre, email, telefono, organization_id)
VALUES
  ('Juan Pérez', 'juan@example.com', '+54 11 1234-5678', v_org_id)
RETURNING id INTO v_cliente1_id;

INSERT INTO clientes (nombre, email, telefono, organization_id)
VALUES
  ('María García', 'maria@example.com', '+54 11 2345-6789', v_org_id)
RETURNING id INTO v_cliente2_id;

INSERT INTO clientes (nombre, email, telefono, organization_id)
VALUES
  ('Carlos López', 'carlos@example.com', '+54 11 3456-7890', v_org_id)
RETURNING id INTO v_cliente3_id;

INSERT INTO clientes (nombre, email, telefono, organization_id)
VALUES
  ('Ana Martínez', 'ana@example.com', '+54 11 4567-8901', v_org_id)
RETURNING id INTO v_cliente4_id;

RAISE NOTICE 'Clientes creados: Juan (%), María (%), Carlos (%), Ana (%)',
  v_cliente1_id, v_cliente2_id, v_cliente3_id, v_cliente4_id;

-- ========================================
-- 7. CREAR INVENTARIO DE EJEMPLO
-- ========================================
INSERT INTO inventario (codigo, nombre, descripcion, categoria, tipo_dispositivo, stock, precio_compra, precio_venta, organization_id)
VALUES
  ('PANT-IP12', 'Pantalla iPhone 12', 'Pantalla original iPhone 12, incluye táctil', 'Pantallas', 'CELULAR', 5, 15000, 25000, v_org_id),
  ('BAT-SAMA52', 'Batería Samsung A52', 'Batería de repuesto compatible con Samsung Galaxy A52', 'Baterías', 'CELULAR', 2, 8000, 15000, v_org_id),
  ('CARG-USBC', 'Cargador USB-C', 'Cargador rápido USB-C 20W', 'Accesorios', 'TODOS', 15, 2000, 4000, v_org_id),
  ('FLEX-IP', 'Flex de carga iPhone', 'Flex de carga compatible con iPhone 11/12/13', 'Repuestos', 'CELULAR', 1, 1500, 3500, v_org_id),
  ('MOD-XIAO', 'Módulo táctil Xiaomi', 'Módulo táctil para Xiaomi Redmi Note 9', 'Pantallas', 'CELULAR', 8, 12000, 22000, v_org_id),
  ('AUR-BT', 'Auriculares Bluetooth', 'Auriculares inalámbricos Bluetooth 5.0', 'Accesorios', 'TODOS', 20, 5000, 9000, v_org_id),
  ('VID-TEMP', 'Vidrio templado universal', 'Protector de pantalla vidrio templado genérico', 'Accesorios', 'CELULAR', 30, 500, 1500, v_org_id),
  ('FUND-SIL', 'Funda silicona', 'Funda de silicona flexible, varios colores', 'Accesorios', 'CELULAR', 25, 800, 2000, v_org_id);

RAISE NOTICE 'Inventario creado: 8 items';

-- ========================================
-- 8. CREAR ÓRDENES DE SERVICIO DE EJEMPLO
-- ========================================

-- Orden en reparación
INSERT INTO ordenes_servicio (
  codigo_orden,
  numero_orden,
  cliente_id,
  tipo_dispositivo,
  dispositivo,
  marca,
  problema_reportado,
  estado,
  tecnico_id,
  organization_id,
  fecha_ingreso,
  presupuesto
)
VALUES (
  'CEL-1234',
  1234,
  v_cliente1_id,
  'CELULAR',
  'iPhone 12 Pro',
  'Apple',
  'Pantalla rota, no responde al tacto. Cliente menciona que se cayó de 1.5 metros de altura.',
  'EN_REPARACION',
  v_tecnico1_id,
  v_org_id,
  NOW() - INTERVAL '2 days',
  25000
);

-- Orden pendiente (sin técnico asignado aún)
INSERT INTO ordenes_servicio (
  codigo_orden,
  numero_orden,
  cliente_id,
  tipo_dispositivo,
  dispositivo,
  marca,
  problema_reportado,
  estado,
  tecnico_id,
  organization_id,
  fecha_ingreso,
  presupuesto
)
VALUES (
  'CEL-1235',
  1235,
  v_cliente2_id,
  'CELULAR',
  'Galaxy S21',
  'Samsung',
  'Batería no carga correctamente, se apaga al 30%. Autonomía muy reducida.',
  'RECIBIDO',
  NULL,
  v_org_id,
  NOW() - INTERVAL '1 day',
  15000
);

-- Orden completada
INSERT INTO ordenes_servicio (
  codigo_orden,
  numero_orden,
  cliente_id,
  tipo_dispositivo,
  dispositivo,
  marca,
  problema_reportado,
  estado,
  tecnico_id,
  organization_id,
  fecha_ingreso,
  fecha_completado,
  presupuesto,
  costo_final
)
VALUES (
  'PC-1236',
  1236,
  v_cliente3_id,
  'COMPUTADORA',
  'MacBook Air M1',
  'Apple',
  'No enciende, posible problema en placa madre. Se mojó con café.',
  'REPARADO',
  v_tecnico2_id,
  v_org_id,
  NOW() - INTERVAL '5 days',
  NOW() - INTERVAL '1 day',
  35000,
  38000
);

-- Orden lista para entregar
INSERT INTO ordenes_servicio (
  codigo_orden,
  numero_orden,
  cliente_id,
  tipo_dispositivo,
  dispositivo,
  marca,
  problema_reportado,
  estado,
  tecnico_id,
  organization_id,
  fecha_ingreso,
  fecha_completado,
  presupuesto,
  costo_final
)
VALUES (
  'TAB-1237',
  1237,
  v_cliente4_id,
  'TABLET',
  'Galaxy Tab S7',
  'Samsung',
  'Pantalla rota en esquina superior derecha. Touch funciona parcialmente.',
  'REPARADO',
  v_tecnico1_id,
  v_org_id,
  NOW() - INTERVAL '3 days',
  NOW() - INTERVAL '6 hours',
  18000,
  18000
);

RAISE NOTICE 'Órdenes de servicio creadas: 4 órdenes';

-- ========================================
-- 9. CREAR PROVEEDORES DE EJEMPLO
-- ========================================
INSERT INTO proveedores (nombre, email, telefono, direccion, organization_id)
VALUES
  ('Distribuidora Móvil SA', 'ventas@distribuidoramovil.com', '+54 11 4444-5555', 'Av. Corrientes 2000', v_org_id),
  ('Repuestos Tech', 'info@repuestostech.com', '+54 11 5555-6666', 'Av. Rivadavia 3000', v_org_id);

RAISE NOTICE 'Proveedores creados: 2 proveedores';

-- ========================================
-- RESUMEN FINAL
-- ========================================
RAISE NOTICE '========================================';
RAISE NOTICE 'CONFIGURACIÓN DEMO COMPLETADA';
RAISE NOTICE '========================================';
RAISE NOTICE 'Organización ID: %', v_org_id;
RAISE NOTICE 'Usuario admin: demo@stapp.com';
RAISE NOTICE 'Contraseña: Demo2024!';
RAISE NOTICE '';
RAISE NOTICE 'Datos creados:';
RAISE NOTICE '- 5 usuarios (1 admin, 2 técnicos, 1 vendedor)';
RAISE NOTICE '- 4 clientes';
RAISE NOTICE '- 8 items de inventario';
RAISE NOTICE '- 4 órdenes de servicio';
RAISE NOTICE '- 2 proveedores';
RAISE NOTICE '';
RAISE NOTICE 'Suscripción: PREMIUM (activa hasta 2099)';
RAISE NOTICE '========================================';
RAISE NOTICE 'IMPORTANTE: Actualiza las variables de entorno:';
RAISE NOTICE 'DEMO_EMAIL=demo@stapp.com';
RAISE NOTICE 'DEMO_PASSWORD=Demo2024!';
RAISE NOTICE '========================================';

END $$;
