# STApp - Sistema de Gestión

Sistema completo de gestión para servicios técnicos de celulares y computadoras. Diseñado con enfoque mobile-first, fácil de usar y con transparencia entre técnicos y clientes.

## Características

- Gestión completa de órdenes de servicio con estados
- CRUD de clientes con búsqueda avanzada
- Control de inventario con alertas de stock bajo
- Gestión de técnicos y asignación de trabajos
- Sistema de facturación con cálculo automático de IVA (21%)
- Cotizaciones con firma digital y envío por email
- Sistema de garantías con gestión de reclamos
- Sistema de notificaciones (email + WhatsApp)
- Reportes e ingresos con gráficos
- Dashboard con resumen y estadísticas
- Autenticación con roles (Admin/Vendedor/Técnico)
- Multi-tenant con aislamiento de datos por organización
- PWA - Instalable en dispositivos móviles
- UI responsive y mobile-first

## Stack Tecnológico

### Frontend
- **Next.js 16** - Framework React con App Router
- **TypeScript** - Tipado estático
- **Tailwind CSS** - Estilos utilitarios
- **shadcn/ui** - Componentes UI (Radix primitives)
- **React Hook Form + Zod** - Formularios y validación
- **Recharts** - Gráficos
- **Lucide React** - Iconos
- **React PDF** - Generación de PDFs

### Backend
- **Next.js API Routes** - Endpoints REST
- **Supabase** - PostgreSQL + Storage + RLS
- **NextAuth.js v5** - Autenticación
- **Inngest** - Background jobs y cron
- **Resend** - Servicio de emails

## Requisitos

- Node.js 18.17 o superior
- npm o yarn
- Cuenta en [Supabase](https://supabase.com) (tier gratuito disponible)

## Instalación

### 1. Clona el repositorio

```bash
git clone <repo-url>
cd stapp
```

### 2. Instala las dependencias

```bash
npm install
```

### 3. Configura Supabase

1. Crea un proyecto en [supabase.com](https://supabase.com)
2. Ve a **Settings > Database** y copia el connection string
3. Ve a **Settings > API** y copia las keys

### 4. Configura las variables de entorno

```bash
cp .env.example .env
```

Edita `.env` con tus credenciales:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL="https://[tu-ref].supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJ..."
SUPABASE_SERVICE_ROLE_KEY="eyJ..."

# Auth
NEXTAUTH_SECRET="tu-secret-key-aqui"
NEXTAUTH_URL="http://localhost:3000"

# Email (opcional para desarrollo)
RESEND_API_KEY="re_..."
```

### 5. Ejecuta las migraciones SQL

En el **SQL Editor** de Supabase, ejecuta en orden:

1. `supabase/migrations/001_schema.sql` - Schema de tablas
2. `supabase/migrations/002_rls_policies.sql` - Políticas de seguridad
3. `supabase/migrations/003_storage_buckets.sql` - Buckets de storage

### 6. Crea los buckets de Storage

En Supabase Dashboard > Storage, crea:
- `fotos-ordenes` (público)
- `logos` (público)
- `firmas` (público)

### 7. Inicia el servidor de desarrollo

```bash
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000) en tu navegador.

## Estructura del Proyecto

```
stapp/
├── app/                    # Next.js App Router
│   ├── (auth)/            # Rutas de autenticación
│   ├── (dashboard)/       # Rutas protegidas
│   └── api/               # API Routes
├── components/            # Componentes React
│   ├── ui/               # Componentes base (shadcn/ui)
│   ├── layout/           # Layout y navegación
│   └── ...
├── lib/                   # Utilidades y configuración
│   ├── supabase.ts       # Cliente Supabase
│   ├── storage.ts        # Funciones de Storage
│   ├── counters.ts       # Contadores atómicos
│   ├── audit.ts          # Sistema de auditoría
│   ├── notifications/    # Sistema de notificaciones
│   └── inngest/          # Background jobs
├── supabase/
│   └── migrations/       # SQL migrations
├── types/                # Tipos TypeScript
└── public/               # Archivos estáticos
```

## Scripts Disponibles

- `npm run dev` - Inicia el servidor de desarrollo
- `npm run build` - Construye la aplicación para producción
- `npm start` - Inicia el servidor de producción
- `npm run lint` - Ejecuta el linter

## Arquitectura

### Multi-Tenant
- Cada organización tiene sus datos completamente aislados
- Row Level Security (RLS) en PostgreSQL garantiza el aislamiento
- Contadores atómicos por organización (números de orden, factura, etc.)

### Storage
- Fotos de órdenes, logos y firmas almacenados en Supabase Storage
- URLs públicas para fácil acceso
- Políticas de seguridad por organización

### Background Jobs
- Inngest para procesamiento asíncrono
- Envío de emails en background
- Cron jobs para recordatorios diarios

## Características para Argentina

- Formatos de fecha y moneda argentinos (dd/mm/yyyy, $ARS)
- Cálculo automático de IVA 21%
- Campos DNI para clientes
- Numeración de facturas preparada para normativa local

## PWA

La aplicación es una Progressive Web App (PWA) y puede ser instalada en dispositivos móviles.

## Despliegue en Vercel

1. Conecta tu repositorio a Vercel
2. Configura las variables de entorno
3. El cron job está configurado en `vercel.json`

## Licencia

Este proyecto es de código abierto y está disponible bajo la licencia MIT.

## Contribuciones

Las contribuciones son bienvenidas. Por favor, abre un issue o un pull request.

## Soporte

Para soporte, por favor abre un issue en el repositorio.
