# Servicio Técnico - Sistema de Gestión

Sistema completo de gestión para servicios técnicos de celulares y computadoras en Argentina. Diseñado con enfoque mobile-first, fácil de usar y con transparencia entre técnicos y clientes.

## Características

- ✅ Gestión completa de órdenes de servicio con estados
- ✅ CRUD de clientes con búsqueda avanzada
- ✅ Control de inventario con alertas de stock bajo
- ✅ Gestión de técnicos y asignación de trabajos
- ✅ Sistema de facturación con cálculo automático de IVA (21%)
- ✅ Reportes e ingresos con gráficos
- ✅ Dashboard con resumen y estadísticas
- ✅ Autenticación con roles (Admin/Técnico)
- ✅ PWA - Instalable en dispositivos móviles
- ✅ UI responsive y mobile-first

## Stack Tecnológico

- **Next.js 16** - Framework React con App Router
- **TypeScript** - Tipado estático
- **Tailwind CSS** - Estilos utilitarios
- **Prisma** - ORM para base de datos
- **SQLite/PostgreSQL** - Base de datos
- **NextAuth.js v5** - Autenticación
- **React Hook Form + Zod** - Formularios y validación
- **Recharts** - Gráficos
- **Lucide React** - Iconos

## Requisitos

- Node.js 18.17 o superior
- npm o yarn

## Instalación

1. Clona el repositorio o descarga el proyecto

2. Instala las dependencias:
```bash
npm install
```

3. Configura las variables de entorno:
```bash
cp .env.example .env
```

Edita el archivo `.env` y configura:
```
DATABASE_URL="file:./dev.db"
NEXTAUTH_SECRET="tu-secret-key-aqui"
NEXTAUTH_URL="http://localhost:3000"
```

4. Genera el cliente de Prisma y ejecuta las migraciones:
```bash
npm run db:generate
npm run db:push
```

5. (Opcional) Carga datos de ejemplo:
```bash
npm run db:seed
```

6. Inicia el servidor de desarrollo:
```bash
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000) en tu navegador.

## Credenciales de Prueba

Después de ejecutar el seed, puedes usar:

- **Administrador**: admin@serviciotecnico.com / admin123
- **Técnico**: tecnico@serviciotecnico.com / tecnico123

## Estructura del Proyecto

```
serviciotecnicoapp/
├── app/                    # Next.js App Router
│   ├── (auth)/            # Rutas de autenticación
│   ├── (dashboard)/       # Rutas protegidas
│   └── api/               # API Routes
├── components/            # Componentes React
│   ├── ui/               # Componentes base (shadcn/ui)
│   ├── layout/           # Layout y navegación
│   ├── clientes/         # Componentes de clientes
│   ├── ordenes/          # Componentes de órdenes
│   └── ...
├── lib/                   # Utilidades y configuración
├── prisma/                # Schema y migraciones
└── public/                # Archivos estáticos
```

## Scripts Disponibles

- `npm run dev` - Inicia el servidor de desarrollo
- `npm run build` - Construye la aplicación para producción
- `npm start` - Inicia el servidor de producción
- `npm run db:generate` - Genera el cliente de Prisma
- `npm run db:push` - Sincroniza el schema con la base de datos
- `npm run db:migrate` - Crea una nueva migración
- `npm run db:seed` - Carga datos de ejemplo
- `npm run db:studio` - Abre Prisma Studio

## Características para Argentina

- Formatos de fecha y moneda argentinos (dd/mm/yyyy, $ARS)
- Cálculo automático de IVA 21%
- Campos DNI para clientes
- Numeración de facturas preparada para normativa local

## PWA

La aplicación es una Progressive Web App (PWA) y puede ser instalada en dispositivos móviles. Los usuarios verán un prompt de instalación cuando sea posible.

## Licencia

Este proyecto es de código abierto y está disponible bajo la licencia MIT.

## Contribuciones

Las contribuciones son bienvenidas. Por favor, abre un issue o un pull request.

## Soporte

Para soporte, por favor abre un issue en el repositorio.

