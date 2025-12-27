# Guía de Configuración Rápida

## Requisitos Previos

- Node.js 18.17 o superior
- Cuenta en [Supabase](https://supabase.com) (tier gratuito disponible)

## Pasos para iniciar el proyecto

### 1. Instalar dependencias

```bash
npm install
```

### 2. Crear proyecto en Supabase

1. Ve a [supabase.com](https://supabase.com) y crea una cuenta
2. Crea un nuevo proyecto
3. Espera a que se aprovisione (1-2 minutos)

### 3. Configurar variables de entorno

Copia `.env.example` a `.env`:

```bash
cp .env.example .env
```

Edita `.env` con las credenciales de Supabase:

```env
# Supabase (obtener de Settings > API)
NEXT_PUBLIC_SUPABASE_URL="https://[tu-ref].supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJ..."
SUPABASE_SERVICE_ROLE_KEY="eyJ..."

# Auth
NEXTAUTH_SECRET="cambia-este-secret-en-produccion"
NEXTAUTH_URL="http://localhost:3000"
```

Para generar un NEXTAUTH_SECRET seguro:
```bash
# Linux/Mac
openssl rand -base64 32

# Windows (usando Node.js)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### 4. Ejecutar migraciones SQL

En el **SQL Editor** de Supabase Dashboard, ejecuta en orden:

1. Abre `supabase/migrations/001_schema.sql` y ejecuta todo el contenido
2. Abre `supabase/migrations/002_rls_policies.sql` y ejecuta todo el contenido
3. Abre `supabase/migrations/003_storage_buckets.sql` y ejecuta todo el contenido

### 5. Crear buckets de Storage

En Supabase Dashboard > Storage:

1. Click en "New bucket"
2. Crea estos buckets (marcar como públicos):
   - `fotos-ordenes`
   - `logos`
   - `firmas`

### 6. Crear usuario inicial (opcional)

En el SQL Editor de Supabase, ejecuta:

```sql
-- Crear organización de prueba
INSERT INTO organizations (id, nombre, slug, nombre_mostrar, activo)
VALUES (
  gen_random_uuid(),
  'Servicio Técnico Demo',
  'demo',
  'Servicio Técnico Demo',
  true
);

-- Crear usuario admin (password: admin123)
INSERT INTO users (id, organization_id, email, nombre, password, role)
SELECT
  gen_random_uuid(),
  id,
  'admin@demo.com',
  'Administrador',
  '$2a$10$rQnR6h.OqL5e5M3KJq5OOeyD3x5Q5o3x5Q5o3x5Q5o3x5Q5o3x5Q5',
  'ADMIN'
FROM organizations WHERE slug = 'demo';
```

### 7. Iniciar servidor de desarrollo

```bash
npm run dev
```

### 8. Abrir en navegador

- Ve a http://localhost:3000
- Inicia sesión con las credenciales creadas

## Estructura de módulos

| Módulo | Descripción |
|--------|-------------|
| **Dashboard** | Resumen general del negocio |
| **Órdenes** | Gestión completa de órdenes de servicio |
| **Clientes** | CRUD de clientes |
| **Técnicos** | Vista de técnicos y estadísticas |
| **Inventario** | Control de stock de repuestos |
| **Proveedores** | Gestión de proveedores |
| **Cotizaciones** | Presupuestos con firma digital |
| **Facturación** | Generación y gestión de facturas |
| **Garantías** | Control de garantías y reclamos |
| **Reportes** | Estadísticas e ingresos |
| **Configuración** | Ajustes de la organización |

## Arquitectura

### Base de Datos
- **Supabase PostgreSQL** con Row Level Security (RLS)
- Aislamiento completo de datos por organización
- Contadores atómicos para números de orden/factura

### Storage
- **Supabase Storage** para archivos
- Fotos de órdenes, logos, firmas digitales
- URLs públicas con políticas de acceso

### Background Jobs
- **Inngest** para procesamiento asíncrono
- Envío de emails en background
- Cron jobs para recordatorios

## Características PWA

- La app es instalable en dispositivos móviles
- Funciona offline básico (service worker)
- Se adapta a diferentes tamaños de pantalla

## Solución de Problemas

### Error de conexión a Supabase
- Verifica que las variables de entorno estén correctas
- Asegúrate de usar el Service Role Key (no el anon key) para `SUPABASE_SERVICE_ROLE_KEY`

### Error de RLS
- Verifica que ejecutaste `002_rls_policies.sql`
- El usuario debe pertenecer a una organización

### Fotos no cargan
- Verifica que creaste los buckets de storage
- Ejecuta `003_storage_buckets.sql` para las políticas
