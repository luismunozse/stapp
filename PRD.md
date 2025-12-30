# PRD - Sistema de Gestión para Servicio Técnico (STApp)

## Resumen Ejecutivo

**STApp** es un sistema de gestión integral diseñado para negocios de servicio técnico (reparación de celulares, computadoras y dispositivos electrónicos). Construido con enfoque mobile-first, permite gestionar órdenes de servicio, inventario, facturación y comunicación con clientes. La aplicación es multi-tenant, permitiendo que múltiples locales operen de forma independiente con aislamiento completo de datos.

---

## 1. Información General

### 1.1 Propósito
Automatizar y optimizar las operaciones de un servicio técnico mediante:
- Gestión completa del ciclo de vida de órdenes de reparación
- Control de inventario y repuestos
- Notificaciones automáticas a clientes (email y WhatsApp)
- Generación de cotizaciones, facturas y garantías
- Reportes y analytics del negocio
- Soporte para múltiples técnicos y asignación de trabajos

### 1.2 Usuarios Objetivo
| Rol | Descripción | Acceso |
|-----|-------------|--------|
| **Administrador** | Dueño/encargado del local | Acceso completo al sistema |
| **Vendedor** | Personal de mostrador/atención | Crear clientes, órdenes, ver inventario |
| **Técnico** | Personal de reparación | Solo órdenes asignadas |
| **Cliente** | Usuario externo | Recibe notificaciones |

---

## 2. Módulos del Sistema

### 2.1 Dashboard
**Métricas principales:**
- Total de órdenes (con contador de pendientes)
- Total de clientes registrados
- Items con stock bajo (< 5 unidades)
- Ingresos del mes (facturas pagadas)

**Alertas:**
- Garantías por vencer (próximos 7 días)
- Items bajo stock mínimo
- Órdenes pendientes de atención

### 2.2 Órdenes de Servicio

#### Estados del flujo:
```
PENDIENTE → EN_REPARACION → COMPLETADO → ENTREGADO
                ↓
        ESPERANDO_REPUESTO
                ↓
            CANCELADO
```

#### Datos de la orden:
| Campo | Descripción |
|-------|-------------|
| Número de orden | Auto-incrementado por organización |
| Cliente | Vinculado al módulo de clientes |
| Tipo de dispositivo | CELULAR, COMPUTADORA, TABLET, CONSOLA, SMARTWATCH |
| Dispositivo | Descripción/modelo |
| Problema reportado | Descripción del cliente |
| Diagnóstico | Observaciones del técnico |
| Técnico asignado | Opcional |
| Presupuesto | Estimación inicial |
| Costo final | Monto real al completar |
| Fecha prometida | Compromiso de entrega |
| Fecha completado | Se setea automáticamente |

#### Funcionalidades:
- CRUD completo de órdenes
- Transiciones de estado con notificaciones automáticas
- Asignación de técnicos
- Documentación fotográfica (ingreso, reparación, entrega)
- Registro de repuestos utilizados con precios
- Checklists personalizables por fase
- Captura de firma digital del cliente
- Historial de notificaciones enviadas

### 2.3 Clientes

#### Datos:
| Campo | Requerido |
|-------|-----------|
| Nombre | Sí |
| Teléfono | Sí |
| Email | No |
| Dirección | No |
| DNI | No |

#### Funcionalidades:
- Búsqueda avanzada (nombre, teléfono, DNI)
- Historial de órdenes por cliente
- Historial de notificaciones
- Prevención de duplicados por email

### 2.4 Inventario

#### Estructura de items:
| Campo | Descripción |
|-------|-------------|
| Código | Único por organización |
| Nombre | Descripción del item |
| Categoría | Clasificación libre |
| Tipo dispositivo | Compatible con CELULAR, COMPUTADORA, etc. o TODOS |
| Stock | Cantidad disponible |
| Precio compra | Costo de adquisición |
| Precio venta | Precio al cliente |
| Proveedor | Referencia opcional |

#### Funcionalidades:
- Alertas de stock bajo (< 5 unidades)
- Cálculo de márgenes de ganancia
- Filtrado por categoría y tipo de dispositivo
- Descuento automático al usar en órdenes

### 2.5 Cotizaciones

#### Estados:
```
BORRADOR → ENVIADA → ACEPTADA/RECHAZADA
```

#### Funcionalidades:
- Numeración automática (COT-0001)
- Vinculadas a órdenes de servicio
- Items con cantidad y precio unitario
- Precio final directo (sin IVA)
- Fecha de vencimiento configurable
- Aprobación con firma digital del cliente
- Envío por email con PDF adjunto
- Generación de PDF con branding de la empresa

### 2.6 Facturación

#### Estados de pago:
```
PENDIENTE → PAGADO_PARCIAL → PAGADO
```

#### Funcionalidades:
- Generación desde órdenes completadas
- Numeración automática (0001-00000001)
- Tres métodos de cálculo:
  - Costo final de la orden
  - Suma de repuestos utilizados
  - Presupuesto estimado
- Precio final directo (sin IVA)
- Registro de pagos parciales
- Métodos de pago: EFECTIVO, TRANSFERENCIA
- Reportes de ingresos mensuales
- Anulación de facturas (solo admin)

### 2.7 Garantías

#### Estados:
```
ACTIVA → VENCIDA
    ↓
RECLAMADA
```

#### Estados de reclamo:
```
PENDIENTE → EN_REVISION → ACEPTADO/RECHAZADO → RESUELTO
```

#### Funcionalidades:
- Creación automática al entregar orden
- Duración configurable (default 30 días)
- Detección automática de vencimiento
- Gestión de reclamos
- Documentación de resolución
- Opción de crear nueva orden por reclamo aceptado
- Alertas en dashboard (vencen en 7 días)

### 2.8 Técnicos

#### Funcionalidades:
- Creación de cuentas con email y contraseña
- Asignación de órdenes
- Estadísticas por técnico:
  - Órdenes activas
  - Órdenes completadas
- Acceso restringido (solo ve sus órdenes asignadas)

### 2.9 Proveedores

#### Datos:
| Campo | Descripción |
|-------|-------------|
| Nombre | Único por organización |
| Teléfono | Contacto principal |
| WhatsApp | Para comunicación directa |
| Email | Correo electrónico |
| Dirección | Ubicación |
| Sitio web | URL |
| Notas | Observaciones |
| Activo | Estado del proveedor |

### 2.10 Sistema de Notificaciones

#### Tipos de notificación:
| Tipo | Descripción | Trigger |
|------|-------------|---------|
| CAMBIO_ESTADO | Cambio de estado de orden | Automático |
| PRESUPUESTO_DEFINIDO | Se define presupuesto | Automático |
| GARANTIA_CREADA | Se crea garantía | Automático |
| RECORDATORIO_RETIRO | Recordar retiro | Cron diario |

#### Canales:
- **EMAIL**: Via Resend (automático)
- **WHATSAPP**: Via links wa.me (manual mejorado)

#### Configuración por organización:
- Habilitar/deshabilitar email
- Habilitar/deshabilitar WhatsApp
- Días para recordatorio de retiro
- Historial completo de notificaciones enviadas

### 2.11 Reportes

#### Disponibles:
- Ingresos mensuales
- Estadísticas de órdenes completadas
- Estado del inventario (items bajo stock)
- Ingresos por rango de fechas
- Tendencias de adquisición de clientes
- Métricas de rendimiento de técnicos

### 2.12 Configuración

#### Ajustes de organización:
- Logo de la empresa (carga y gestión)
- Nombre de la empresa
- Configuración de notificaciones
- Días de recordatorio

#### Plantillas de checklist:
- Items configurables con:
  - Etiqueta
  - Tipo: BOOLEAN, TEXT, SELECT
  - Categoría: CONDICION_FISICA, ACCESORIOS, FUNCIONAL, OTRO
  - Orden/prioridad
  - Requerido
- Soporte para firma digital

---

## 3. Roles y Permisos

### 3.1 Administrador (ADMIN)
| Módulo | Acceso |
|--------|--------|
| Dashboard | Completo |
| Órdenes | CRUD completo |
| Clientes | CRUD completo |
| Inventario | CRUD completo |
| Cotizaciones | CRUD completo |
| Facturación | CRUD completo |
| Garantías | CRUD completo |
| Técnicos | CRUD completo |
| Proveedores | CRUD completo |
| Configuración | Completo |
| Reportes | Completo |

### 3.2 Vendedor (VENDEDOR)
| Módulo | Acceso |
|--------|--------|
| Dashboard | Métricas básicas |
| Órdenes | Crear y ver órdenes |
| Clientes | CRUD completo |
| Inventario | Solo lectura |
| Cotizaciones | Sin acceso |
| Facturación | Sin acceso |
| Garantías | Sin acceso |
| Técnicos | Sin acceso |
| Proveedores | Sin acceso |
| Configuración | Sin acceso |
| Reportes | Sin acceso |

### 3.3 Técnico (TECNICO)
| Módulo | Acceso |
|--------|--------|
| Dashboard | Solo métricas básicas |
| Órdenes | Solo asignadas (lectura + actualización estado) |
| Clientes | Solo de órdenes asignadas |
| Fotos | Agregar a órdenes asignadas |
| Otros módulos | Sin acceso |

---

## 4. Modelo de Datos

### Entidades principales:

```
Organization (Multi-tenant)
├── User (Usuarios del sistema)
├── Cliente (Clientes del negocio)
│   └── OrdenServicio (Órdenes de servicio)
│       ├── RepuestoOrden (Repuestos utilizados)
│       ├── Factura (Facturación)
│       │   └── PagoParcial (Pagos parciales)
│       ├── Cotizacion (Cotizaciones)
│       │   └── ItemCotizacion (Items de cotización)
│       ├── Garantia (Garantías)
│       │   └── ReclamoGarantia (Reclamos)
│       ├── FotoOrden (Fotografías)
│       ├── ChecklistRecepcion (Checklists)
│       └── NotificationLog (Historial de notificaciones)
├── Inventario (Stock de repuestos)
├── Proveedor (Proveedores)
└── ChecklistTemplate (Plantillas de checklist)
```

---

## 5. Stack Tecnológico

### Frontend
| Tecnología | Uso |
|------------|-----|
| Next.js 16 | Framework React con App Router |
| TypeScript | Tipado estático |
| Tailwind CSS | Estilos utilitarios |
| shadcn/ui | Componentes UI (Radix primitives) |
| React Hook Form | Manejo de formularios |
| Zod | Validación de schemas |
| Recharts | Gráficos y visualizaciones |
| Lucide React | Iconos |
| React PDF | Generación de PDFs |
| react-signature-canvas | Captura de firmas |

### Backend
| Tecnología | Uso |
|------------|-----|
| Next.js API Routes | Endpoints REST |
| Supabase | PostgreSQL + Storage + RLS |
| NextAuth.js v5 | Autenticación |
| Inngest | Background jobs y cron |
| bcryptjs | Hash de contraseñas |
| Resend | Servicio de emails |
| Zod | Validación de datos |

---

## 6. Integraciones

### 6.1 Email (Resend)
- Notificaciones automáticas de estado
- Envío de cotizaciones con PDF
- Recordatorios de retiro
- Reset de contraseña

### 6.2 WhatsApp
- Links wa.me para mensajes directos
- Plantillas predefinidas según contexto
- Comunicación con proveedores

### 6.3 PDF
- Cotizaciones con branding
- Comprobantes de recepción de órdenes

### 6.4 MercadoPago
- Pagos de suscripción
- Webhooks para confirmación automática
- Soporte para pagos mensuales y anuales

### 6.5 PWA (Progressive Web App)
- Instalable en dispositivos móviles
- Soporte para Android (prompt automático)
- Soporte para iOS (instrucciones guiadas para "Agregar a inicio")
- Manifest con shortcuts para acciones rápidas
- Service Worker para funcionamiento offline básico

---

## 7. Flujos de Trabajo Principales

### 7.1 Ciclo de Orden de Servicio
```
1. Admin crea orden con datos del cliente y dispositivo
2. Sistema asigna número de orden automático
3. Técnico es asignado (opcional)
4. Técnico actualiza estado: PENDIENTE → EN_REPARACION → COMPLETADO
5. Técnico sube fotos del dispositivo
6. Admin crea cotización si requiere aprobación
7. Cliente aprueba cotización con firma
8. Admin genera factura al completar
9. Factura marcada como pagada
10. Se crea garantía al entregar
11. Notificaciones enviadas en cada paso clave
```

### 7.2 Flujo de Notificaciones
```
1. Admin configura canales habilitados
2. Sistema envía notificaciones automáticas en cambios de estado
3. Emails renderizan plantillas con contexto de la orden
4. Links WhatsApp generados para acción del usuario
5. Cron job ejecuta diariamente para recordatorios
6. Todas las notificaciones quedan logueadas
```

---

## 8. Seguridad

### Autenticación
- Sesiones JWT con NextAuth.js
- Hash de contraseñas con bcryptjs
- Reset de contraseña por email (token 1 hora)
- "Recordarme" extiende sesión a 30 días

### Autorización
- Control de acceso basado en roles (ADMIN/VENDEDOR/TECNICO)
- Aislamiento de datos por organización (multi-tenancy)
- Vendedores pueden crear órdenes y clientes, ver inventario
- Técnicos solo ven órdenes asignadas
- Validación de organización y rol en cada endpoint

### Protección de Datos
- Contraseñas nunca expuestas en respuestas
- Codificación base64 para imágenes
- Validación de tamaño de archivos (2MB logos, 5MB fotos)

---

## 9. Localización

### Argentina
- Moneda: Peso Argentino (ARS)
- Formato fecha: DD/MM/YYYY
- Facturación sin IVA (precio final directo)
- Campo DNI para clientes
- Formato de facturación local

### Idioma
- Español (Argentina) por defecto
- Todas las interfaces, emails y notificaciones en español

### Precios de Suscripción
- Plan Mensual: $14.999 ARS
- Plan Anual: $143.990 ARS (ahorro de 20%)
- Procesador de pago: MercadoPago

---

## 10. Configuración de Despliegue

### Variables de Entorno
```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=    # URL del proyecto Supabase
NEXT_PUBLIC_SUPABASE_ANON_KEY= # Anon key (público)
SUPABASE_SERVICE_ROLE_KEY=   # Service role key (servidor)

# Auth
NEXTAUTH_SECRET=        # Secret para JWT (32+ caracteres)
NEXTAUTH_URL=           # URL de la aplicación

# Email
RESEND_API_KEY=         # API key de Resend
RESEND_DOMAIN=          # Dominio verificado en Resend

# Background Jobs
INNGEST_EVENT_KEY=      # Inngest event key
INNGEST_SIGNING_KEY=    # Inngest signing key

# Cron
CRON_SECRET=            # Token para autenticar cron jobs

# MercadoPago
MERCADOPAGO_ACCESS_TOKEN=    # Access token de producción
NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY= # Public key
MERCADOPAGO_WEBHOOK_SECRET=  # Secret para validar webhooks
```

### Requisitos
- Node.js 18.17+
- Cuenta en Supabase (tier gratuito disponible)
- Cuenta en MercadoPago (para suscripciones)
- Cuenta en Resend (para emails)

---

## 11. Limitaciones Conocidas

1. **Dependencia de Resend**: Sin SMTP alternativo para emails
2. **WhatsApp Web-based**: No usa API oficial de WhatsApp Business
3. **Firmas digitales**: Sin verificación blockchain
4. **Zona horaria única**: Asume Argentina
5. **Sin edición concurrente**: No hay resolución de conflictos en tiempo real

---

## 12. Métricas de Éxito (KPIs)

| Métrica | Descripción |
|---------|-------------|
| Tasa de completado | % de órdenes completadas vs canceladas |
| Tiempo promedio | Días desde ingreso hasta entrega |
| Ingresos mensuales | Total facturado y cobrado |
| Rotación de inventario | Uso de repuestos por período |
| Productividad | Órdenes completadas por técnico |
| Engagement | Tasa de apertura de notificaciones |

---

## 13. Arquitectura Implementada

### 13.1 Multi-Tenant con RLS (Implementado)

Doble protección con Row Level Security en PostgreSQL (Supabase):

```sql
-- Política RLS para cada tabla
ALTER TABLE ordenes_servicio ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ordenes_servicio
  USING (organization_id = auth.jwt()->>'organization_id');
```

**Beneficios:**
- Si se olvida un `where`, la BD igual protege
- Imposible filtrar datos de otro tenant
- Aislamiento garantizado a nivel de base de datos

### 13.2 Jobs en Background (Implementado)

Cola asíncrona con Inngest:

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   API       │────▶│   Inngest   │────▶│   Function  │
│  (Next.js)  │     │   (Queue)   │     │  (Handler)  │
└─────────────┘     └─────────────┘     └─────────────┘
                                              │
                                    ┌─────────┴─────────┐
                                    │                   │
                              ┌─────▼─────┐      ┌─────▼─────┐
                              │  Resend   │      │   Cron    │
                              │  (Email)  │      │  (Daily)  │
                              └───────────┘      └───────────┘
```

**Jobs implementados:**
- Envío de emails (notificaciones, cotizaciones)
- Cron de recordatorios diarios

### 13.3 Almacenamiento de Archivos (Implementado)

Object Storage con Supabase Storage:

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Cliente   │────▶│   API       │────▶│  Supabase   │
│  (upload)   │     │             │     │  Storage    │
└─────────────┘     └─────────────┘     └─────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │   Postgres  │
                    │  (url ref)  │
                    └─────────────┘
```

**Buckets:**
- `fotos-ordenes` - Fotos de dispositivos
- `logos` - Logos de organizaciones
- `firmas` - Firmas digitales

### 13.4 Contadores Atómicos (Implementado)

```typescript
// lib/counters.ts
export async function getNextOrderNumber(orgId: string): Promise<number> {
  const { data } = await supabaseAdmin.rpc('get_next_order_number', {
    org_id: orgId
  })
  return data
}
```

Usa funciones PostgreSQL para garantizar unicidad:
- `get_next_order_number` - Números de orden
- `get_next_quote_number` - Números de cotización (COT-0001)
- `get_next_invoice_number` - Números de factura (0001-00000001)

### 13.5 Sistema de Auditoría (Implementado)

```typescript
// lib/audit.ts
export async function logAudit(params: {
  organizationId: string
  userId: string
  action: 'CREATE' | 'UPDATE' | 'DELETE'
  entity: string
  entityId: string
  changes?: object
})
```

### 13.6 Pool de Conexiones

Supabase incluye PgBouncer por defecto, manejando automáticamente el pooling de conexiones para entornos serverless.

### 13.7 Estructura de Código Actual

```
lib/
├── supabase.ts     # Cliente Supabase (admin + public)
├── auth.ts         # NextAuth config
├── auth-utils.ts   # requireAuth, requireAdmin, getAuthSession
├── storage.ts      # Upload/download de archivos
├── counters.ts     # Contadores atómicos
├── audit.ts        # Sistema de auditoría
├── notifications/  # Sistema de notificaciones
│   ├── index.ts    # NotificationService
│   ├── types.ts    # Tipos
│   └── templates/  # Templates de email/WhatsApp
└── inngest/        # Background jobs
    ├── client.ts   # Cliente Inngest
    └── functions/  # Funciones de background
```

---

## 14. Roadmap Futuro

### Completado (Arquitectura Production-Ready)
- [x] Migrar a PostgreSQL en producción (Supabase)
- [x] Implementar RLS (Row Level Security)
- [x] Migrar fotos/logos a Object Storage (Supabase Storage)
- [x] Implementar cola de jobs (Inngest)
- [x] Agregar índices compuestos para performance
- [x] Implementar contadores por organización
- [x] Agregar auditoría básica (AuditLog)

### Corto plazo
- [x] Integración con MercadoPago (suscripciones)
- [x] PWA con soporte iOS/Android
- [ ] Exportación de reportes a Excel/PDF
- [ ] Subdominios por tenant (guru-tech.stapp.com)
- [ ] Separar Web y Workers

### Mediano plazo
- [ ] Portal de clientes (tracking de órdenes)
- [ ] SMS como canal alternativo
- [ ] Sistema de turnos/citas
- [ ] Soporte multi-idioma
- [ ] App móvil nativa (React Native/Expo)

### Largo plazo
- [ ] API pública para integraciones
- [ ] Marketplace de repuestos
- [ ] IA para diagnóstico asistido
- [ ] Franquicias/multi-sucursal

---

*Documento actualizado: Diciembre 2025*
*Versión: 2.1 - PWA iOS, MercadoPago, eliminación IVA*
