# Guía de Configuración Rápida

## Pasos para iniciar el proyecto

1. **Instalar dependencias:**
   ```bash
   npm install
   ```

2. **Configurar variables de entorno:**
   - Copia `.env.example` a `.env`
   - Edita `.env` y configura:
     ```
     DATABASE_URL="file:./dev.db"
     NEXTAUTH_SECRET="cambia-este-secret-en-produccion"
     NEXTAUTH_URL="http://localhost:3000"
     ```

3. **Configurar base de datos:**
   ```bash
   npm run db:generate
   npm run db:push
   npm run db:seed
   ```

4. **Iniciar servidor de desarrollo:**
   ```bash
   npm run dev
   ```

5. **Abrir en navegador:**
   - Ve a http://localhost:3000
   - Usa las credenciales del seed:
     - Admin: admin@serviciotecnico.com / admin123
     - Técnico: tecnico@serviciotecnico.com / tecnico123

## Notas importantes

- La base de datos SQLite se creará automáticamente en `prisma/dev.db`
- Para producción, cambia a PostgreSQL y actualiza `DATABASE_URL`
- El `NEXTAUTH_SECRET` debe ser una cadena aleatoria segura en producción
- Para generar un secret: `openssl rand -base64 32`

## Estructura de módulos

- **Dashboard**: Resumen general del negocio
- **Órdenes**: Gestión completa de órdenes de servicio
- **Clientes**: CRUD de clientes
- **Técnicos**: Vista de técnicos y estadísticas
- **Inventario**: Control de stock de repuestos
- **Facturación**: Generación y gestión de facturas
- **Reportes**: Estadísticas e ingresos

## Características PWA

- La app es instalable en dispositivos móviles
- Funciona offline básico (service worker)
- Se adapta a diferentes tamaños de pantalla

