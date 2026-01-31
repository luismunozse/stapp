# Configuración de Cuenta Demo

Esta guía explica cómo configurar la cuenta demo para que los visitantes puedan probar el sistema sin registrarse.

## 🔍 Verificar si ya tienes la demo configurada

Antes de crear la demo, verifica si ya existe:

1. Abre **Supabase → SQL Editor**
2. Ejecuta el script: **[supabase/verify_demo.sql](supabase/verify_demo.sql)**
3. El script te mostrará:
   - ✅ Estado de la organización y suscripción
   - ✅ Lista completa de usuarios, clientes, inventario, órdenes y proveedores
   - ✅ Validación si está completa o faltan datos

Si el resultado es **"LA CUENTA DEMO ESTÁ COMPLETAMENTE CONFIGURADA"**, salta al [Paso 6](#paso-6-verificar-funcionalidad) para probar el acceso.

Si muestra **"LA CUENTA DEMO ESTÁ INCOMPLETA"** o no existe, continúa con la configuración.

---

## 🚀 Opción Rápida: Script Automatizado

Si quieres configurar todo de una vez, usa el script completo:

1. Genera el hash bcrypt para la contraseña `Demo2024!`:
   - Ve a https://bcrypt-generator.com/ y genera con 10 rounds
   - O usa este hash pre-generado: `$2a$10$rXKj7qZ5YGx.MQp7VhU8xuYxqD9/E.AKqHFl2HpkJ7LqkP0V2W7Zm`

2. Abre el archivo [supabase/demo_setup.sql](supabase/demo_setup.sql)

3. Busca y reemplaza **todas las instancias** de `HASH_PASSWORD_AQUI` con el hash del paso 1

4. En Supabase → SQL Editor → Pega y ejecuta el script completo

5. ¡Listo! Tendrás:
   - ✅ Organización demo
   - ✅ Usuario admin (demo@stapp.com)
   - ✅ 2 técnicos + 1 vendedor
   - ✅ 4 clientes
   - ✅ 8 items de inventario
   - ✅ 4 órdenes de servicio
   - ✅ 2 proveedores
   - ✅ Suscripción Premium permanente

6. Agrega a tu `.env.local`:
   ```env
   DEMO_EMAIL="demo@stapp.com"
   DEMO_PASSWORD="Demo2024!"
   ```

---

## 📝 Opción Manual: Paso a Paso

Si prefieres crear la demo paso a paso o entender cómo funciona, sigue esta guía:

### Paso 1: Crear la Organización Demo en Supabase

1. Abre Supabase y ve a tu proyecto
2. Ve a **SQL Editor**
3. Ejecuta el siguiente script para crear la organización demo:

```sql
-- 1. Crear organización demo
INSERT INTO organizations (
  nombre,
  slug,
  nombre_mostrar,
  email,
  telefono,
  activo
)
VALUES (
  'Demo Organization',
  'demo',
  'STApp Demo',
  'demo@stapp.com',
  '+54 11 5555-5555',
  true
)
RETURNING id;
```

4. **Importante:** Copia el `id` que retorna la query (lo necesitarás en los siguientes pasos)

5. La suscripción se crea automáticamente (por trigger), pero necesitas actualizarla para que nunca expire:

```sql
-- 2. Actualizar suscripción demo para que nunca expire
-- Reemplaza 'ID_ORGANIZACION_DEMO' con el ID del paso anterior
UPDATE subscriptions
SET
  status = 'ACTIVE',
  trial_end = '2099-12-31 23:59:59',
  current_period_end = '2099-12-31 23:59:59',
  plan_id = (SELECT id FROM plans WHERE tipo = 'PREMIUM' LIMIT 1)
WHERE organization_id = 'ID_ORGANIZACION_DEMO';
```

## Paso 2: Hashear la Contraseña

Antes de crear el usuario, necesitas hashear la contraseña. Tienes 3 opciones:

### Opción A: Usando Node.js (recomendado)

```bash
cd /path/to/stapp
node
```

```javascript
const bcrypt = require('bcryptjs');
bcrypt.hash('Demo2024!', 10).then(hash => console.log(hash));
// Copia el hash que se imprime
```

### Opción B: Generador online

Ve a https://bcrypt-generator.com/ y genera un hash para `Demo2024!` con 10 rounds.

### Opción C: Usar un hash pre-generado

Para `Demo2024!` con 10 rounds:
```
$2a$10$rXKj7qZ5YGx.MQp7VhU8xuYxqD9/E.AKqHFl2HpkJ7LqkP0V2W7Zm
```

## Paso 3: Crear el Usuario Demo

Ejecuta en **SQL Editor**:

```sql
-- 3. Crear usuario admin demo
-- Reemplaza 'ID_ORGANIZACION_DEMO' con el ID del Paso 1
-- Reemplaza 'HASH_PASSWORD' con el hash generado en Paso 2
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
  'HASH_PASSWORD',  -- Reemplaza con el hash del Paso 2
  'Usuario Demo',
  'ADMIN',
  'ID_ORGANIZACION_DEMO',  -- Reemplaza con ID del Paso 1
  true
)
RETURNING id;
```

## Paso 4: Poblar con Datos de Ejemplo (Opcional pero Recomendado)

Para que la demo sea más realista y útil, agrega datos de ejemplo. Ejecuta estos scripts en **SQL Editor**:

### Clientes de ejemplo

```sql
-- 4. Crear clientes de ejemplo
-- Reemplaza 'ID_ORGANIZACION_DEMO' con el ID del Paso 1
INSERT INTO clientes (nombre, email, telefono, organization_id)
VALUES
  ('Juan Pérez', 'juan@example.com', '+54 11 1234-5678', 'ID_ORGANIZACION_DEMO'),
  ('María García', 'maria@example.com', '+54 11 2345-6789', 'ID_ORGANIZACION_DEMO'),
  ('Carlos López', 'carlos@example.com', '+54 11 3456-7890', 'ID_ORGANIZACION_DEMO'),
  ('Ana Martínez', 'ana@example.com', '+54 11 4567-8901', 'ID_ORGANIZACION_DEMO')
RETURNING id, nombre;
```

### Técnicos y Vendedores de ejemplo

```sql
-- 5. Crear técnicos de ejemplo
-- Reemplaza 'ID_ORGANIZACION_DEMO' con el ID del Paso 1
-- Usa el mismo hash de contraseña del Paso 2
INSERT INTO users (email, password, nombre, rol, organization_id, email_verified)
VALUES
  ('pedro.tecnico@demo.com', 'HASH_PASSWORD', 'Pedro Técnico', 'TECNICO', 'ID_ORGANIZACION_DEMO', true),
  ('ana.tecnica@demo.com', 'HASH_PASSWORD', 'Ana Técnica', 'TECNICO', 'ID_ORGANIZACION_DEMO', true),
  ('luis.vendedor@demo.com', 'HASH_PASSWORD', 'Luis Vendedor', 'VENDEDOR', 'ID_ORGANIZACION_DEMO', true)
RETURNING id, nombre, rol;
```

### Inventario de ejemplo

```sql
-- 6. Crear items de inventario
-- Reemplaza 'ID_ORGANIZACION_DEMO' con el ID del Paso 1
INSERT INTO inventario (codigo, nombre, descripcion, categoria, tipo_dispositivo, stock, precio_compra, precio_venta, organization_id)
VALUES
  ('PANT-IP12', 'Pantalla iPhone 12', 'Pantalla original iPhone 12', 'Pantallas', 'CELULAR', 5, 15000, 25000, 'ID_ORGANIZACION_DEMO'),
  ('BAT-SAMA52', 'Batería Samsung A52', 'Batería de repuesto Samsung A52', 'Baterías', 'CELULAR', 2, 8000, 15000, 'ID_ORGANIZACION_DEMO'),
  ('CARG-USBC', 'Cargador USB-C', 'Cargador rápido USB-C 20W', 'Accesorios', 'TODOS', 15, 2000, 4000, 'ID_ORGANIZACION_DEMO'),
  ('FLEX-IP', 'Flex de carga iPhone', 'Flex de carga iPhone 11/12/13', 'Repuestos', 'CELULAR', 1, 1500, 3500, 'ID_ORGANIZACION_DEMO'),
  ('MOD-XIAO', 'Módulo táctil Xiaomi', 'Módulo táctil Redmi Note 9', 'Pantallas', 'CELULAR', 8, 12000, 22000, 'ID_ORGANIZACION_DEMO'),
  ('AUR-BT', 'Auriculares Bluetooth', 'Auriculares Bluetooth 5.0', 'Accesorios', 'TODOS', 20, 5000, 9000, 'ID_ORGANIZACION_DEMO')
RETURNING id, nombre, stock;
```

### Órdenes de Servicio de ejemplo

```sql
-- 7. Crear órdenes de servicio de ejemplo
-- Primero, guarda los IDs de clientes y técnicos de los pasos anteriores
-- Luego ejecuta este script reemplazando los IDs correspondientes

INSERT INTO ordenes_servicio (
  codigo_orden,
  numero_orden,
  cliente_id,
  tipo_dispositivo,
  marca,
  dispositivo,
  problema_reportado,
  estado,
  tecnico_id,
  organization_id,
  fecha_ingreso,
  presupuesto
)
VALUES
  -- Orden en reparación
  (
    'CEL-1234',
    1234,
    'ID_CLIENTE_JUAN',  -- Reemplaza con ID de Juan Pérez
    'CELULAR',
    'Apple',
    'iPhone 12 Pro',
    'Pantalla rota, no responde al tacto',
    'EN_REPARACION',
    'ID_TECNICO_PEDRO',  -- Reemplaza con ID de Pedro Técnico
    'ID_ORGANIZACION_DEMO',
    NOW() - INTERVAL '2 days',
    25000
  ),
  -- Orden pendiente
  (
    'CEL-1235',
    1235,
    'ID_CLIENTE_MARIA',  -- Reemplaza con ID de María García
    'CELULAR',
    'Samsung',
    'Galaxy S21',
    'Batería no carga, se apaga solo',
    'RECIBIDO',
    NULL,
    'ID_ORGANIZACION_DEMO',
    NOW() - INTERVAL '1 day',
    15000
  ),
  -- Orden completada
  (
    'PC-1236',
    1236,
    'ID_CLIENTE_CARLOS',  -- Reemplaza con ID de Carlos López
    'COMPUTADORA',
    'Apple',
    'MacBook Air M1',
    'No enciende, posible problema en placa',
    'REPARADO',
    'ID_TECNICO_ANA',  -- Reemplaza con ID de Ana Técnica
    'ID_ORGANIZACION_DEMO',
    NOW() - INTERVAL '5 days',
    35000
  ),
  -- Orden lista para entregar
  (
    'TAB-1237',
    1237,
    'ID_CLIENTE_ANA',  -- Reemplaza con ID de Ana Martínez
    'TABLET',
    'Samsung',
    'Galaxy Tab S7',
    'Pantalla rota',
    'REPARADO',
    'ID_TECNICO_PEDRO',
    'ID_ORGANIZACION_DEMO',
    NOW() - INTERVAL '3 days',
    18000
  )
RETURNING codigo_orden, estado;
```

## Paso 5: Configurar Variables de Entorno

1. Copia el archivo `.env.example` a `.env.local` si no lo has hecho
2. Asegúrate de que estas variables estén configuradas:

```env
DEMO_EMAIL="demo@stapp.com"
DEMO_PASSWORD="Demo2024!"
```

> **Nota:** Puedes cambiar estas credenciales, pero asegúrate de que coincidan con las que creaste en Supabase.

## Paso 6: Verificar Funcionalidad

Hay 3 formas de acceder a la cuenta demo:

### Opción 1: Botón en Landing Page
1. Inicia el servidor de desarrollo:
   ```bash
   npm run dev
   ```

2. Ve a la landing page (http://localhost:3000)

3. Haz clic en el botón **"Probar Demo"**

4. Serás redirigido al dashboard automáticamente

### Opción 2: Link Directo
1. Accede directamente a: http://localhost:3000/demo

2. El sistema iniciará sesión automáticamente y te redirigirá al dashboard

3. Puedes compartir este link: `stapp.com.ar/demo`

### Opción 3: Login Manual
1. Ve a la página de login

2. Ingresa las credenciales:
   - **Email:** demo@stapp.com
   - **Password:** Demo2024!

## Paso 7: Mantenimiento de la Demo

### Reset periódico de datos

Considera crear un script que reinicie los datos de demo periódicamente (cada 24 horas):

```sql
-- Script para limpiar y regenerar datos demo
-- Reemplaza 'ID_ORGANIZACION_DEMO' con el ID de tu organización demo
BEGIN;

-- 1. Limpiar órdenes viejas (mantener solo últimas 10)
DELETE FROM ordenes_servicio
WHERE organization_id = 'ID_ORGANIZACION_DEMO'
AND id NOT IN (
  SELECT id FROM ordenes_servicio
  WHERE organization_id = 'ID_ORGANIZACION_DEMO'
  ORDER BY fecha_ingreso DESC
  LIMIT 10
);

-- 2. Resetear stock a valores iniciales
UPDATE inventario
SET stock = CASE
  WHEN nombre = 'Pantalla iPhone 12' THEN 5
  WHEN nombre = 'Batería Samsung A52' THEN 2
  WHEN nombre = 'Cargador USB-C' THEN 15
  WHEN nombre = 'Flex de carga iPhone' THEN 1
  WHEN nombre = 'Módulo táctil Xiaomi' THEN 8
  WHEN nombre = 'Auriculares Bluetooth' THEN 20
  ELSE stock
END
WHERE organization_id = 'ID_ORGANIZACION_DEMO';

-- 3. Limpiar ventas de más de 30 días
DELETE FROM ventas
WHERE organization_id = 'ID_ORGANIZACION_DEMO'
AND created_at < NOW() - INTERVAL '30 days';

COMMIT;
```

### Script automatizado (Opcional)

Puedes crear una función PostgreSQL que se ejecute periódicamente:

```sql
-- Función para resetear datos demo
CREATE OR REPLACE FUNCTION reset_demo_data()
RETURNS void AS $$
DECLARE
  demo_org_id TEXT;
BEGIN
  -- Obtener ID de organización demo
  SELECT id INTO demo_org_id
  FROM organizations
  WHERE slug = 'demo'
  LIMIT 1;

  IF demo_org_id IS NULL THEN
    RAISE NOTICE 'Demo organization not found';
    RETURN;
  END IF;

  -- Limpiar órdenes viejas
  DELETE FROM ordenes_servicio
  WHERE organization_id = demo_org_id
  AND id NOT IN (
    SELECT id FROM ordenes_servicio
    WHERE organization_id = demo_org_id
    ORDER BY fecha_ingreso DESC
    LIMIT 10
  );

  -- Resetear inventario
  UPDATE inventario
  SET stock = CASE
    WHEN nombre = 'Pantalla iPhone 12' THEN 5
    WHEN nombre = 'Batería Samsung A52' THEN 2
    WHEN nombre = 'Cargador USB-C' THEN 15
    WHEN nombre = 'Flex de carga iPhone' THEN 1
    WHEN nombre = 'Módulo táctil Xiaomi' THEN 8
    WHEN nombre = 'Auriculares Bluetooth' THEN 20
    ELSE stock
  END
  WHERE organization_id = demo_org_id;

  RAISE NOTICE 'Demo data reset completed for organization %', demo_org_id;
END;
$$ LANGUAGE plpgsql;

-- Ejecutar manualmente:
-- SELECT reset_demo_data();
```

Luego puedes programar esta función con pg_cron o un cron job externo que llame al endpoint de tu API.

### Limitar acciones destructivas

Considera agregar validación en el backend para prevenir que la cuenta demo:
- Elimine todos los registros
- Modifique configuración crítica
- Cambie la contraseña

## Características de la Demo

✅ Los visitantes pueden:
- Explorar todas las funcionalidades
- Crear, editar y ver órdenes
- Gestionar clientes e inventario
- Ver reportes y métricas
- Probar el sistema completo

⚠️ Limitaciones recomendadas:
- No permitir cambiar email o contraseña
- Resetear datos cada 24 horas
- Limitar uploads de archivos
- Sesión no persistente (no "recordarme")

## Indicadores Visuales

La cuenta demo incluye badges visuales:
- 🎮 **Badge "Cuenta Demo"** en el sidebar desktop
- **Badge "DEMO"** en el header móvil

Esto ayuda a los usuarios a entender que están en modo demo.

## Seguridad

⚠️ **Importante:**
- La cuenta demo tiene acceso completo al sistema
- Los datos son visibles para todos los que usen la demo
- No incluyas información sensible o real
- Considera agregar rate limiting al endpoint `/api/auth/demo-login`
- Usa una contraseña fuerte incluso para la demo

## Troubleshooting

### Error: "No se pudo iniciar sesión con la cuenta demo"

1. Verifica que el usuario existe en Supabase
2. Verifica que el email coincida con `DEMO_EMAIL` en `.env.local`
3. Verifica que la contraseña esté hasheada correctamente
4. Verifica que la organización esté activa (`activo = true`)
5. Verifica que `email_verified = true`

### La sesión demo no funciona

1. Verifica los logs del servidor
2. Revisa que las credenciales en `.env.local` sean correctas
3. Asegúrate de que NextAuth esté configurado correctamente
4. Verifica que `NEXTAUTH_URL` sea correcto

## Monitoreo

Considera agregar analytics para rastrear:
- Cuántas personas usan la demo
- Qué funcionalidades exploran más
- Tasa de conversión demo → registro
