# WhatsApp por sucursal — Diseño

**Fecha:** 2026-07-02
**Estado:** Aprobado (diseño) — pendiente plan de implementación

## Problema

Cuando una organización tiene varias sucursales, cada sucursal suele tener su propio
número de teléfono. Hoy la app envía TODO el WhatsApp (automático y manual) desde un
único número por organización. Un cliente atendido en la Sucursal B recibe avisos
automáticos desde el número de Casa Central, lo cual confunde y rompe la identidad de
cada local.

El objetivo: que cada sucursal pueda **sincronizar su propio WhatsApp** (escaneando un
QR) y que los **envíos automáticos** salgan desde el número de la sucursal a la que
pertenece la orden/venta.

## Decisiones tomadas (brainstorming)

1. **Modelo Central + override.** El WhatsApp actual de la org queda como "Casa Central".
   Cada sucursal opcionalmente conecta el suyo. Las sucursales sin número propio usan el
   central. Compatible hacia atrás y adopción gradual.
2. **Solo QR / Evolution por sucursal.** Cada sucursal se conecta escaneando un QR (flujo
   Evolution API, una instancia por sucursal). No se usa la API oficial de Meta a nivel
   sucursal. El central puede seguir siendo Meta **o** Evolution, sin cambios.
3. **Solo salida automática.** El número de la sucursal se usa para MANDAR (cambios de
   estado, presupuestos, recordatorios por cron, etc.). No se capturan respuestas
   entrantes por sucursal (sin bandeja de entrada). Fuera de alcance.
4. **Caída → central.** Si una sucursal tiene WhatsApp conectado pero en el momento del
   envío está desconectada (estado ≠ `open`), el mensaje sale igual desde el central.
   Prioriza que el cliente reciba el aviso. Decisión revisable.
5. **Sin flag de plan nuevo.** Se reusa la feature existente `whatsapp_notifications` +
   el límite existente `limite_sucursales`. Solo lo ven orgs con la feature y con más de
   una sucursal.

## Estado actual (contexto)

- **WhatsApp es 100% per-organización.** Tabla `whatsapp_config` con una fila por org
  (`organization_id UNIQUE`). Dos proveedores seleccionables por columna `provider`:
  `meta` (Cloud API, `lib/whatsapp/client.ts`) y `evolution` (self-hosted Baileys/QR,
  `lib/whatsapp/providers/evolution.ts`).
- **Evolution ya usa un servidor compartido** vía ENV (`EVOLUTION_BASE_URL`,
  `EVOLUTION_API_KEY`, en `lib/whatsapp/platform-config.ts`). Cada org tiene una instancia
  `stapp-org-{organizationId}` (`buildInstanceName`). El QR/estado vive en `whatsapp_config`
  (`evolution_instance_name`, `evolution_connection_state`, `evolution_last_qr_at`).
- **Dispatcher central:** `lib/whatsapp/providers/index.ts` (`sendWhatsAppText`,
  `sendWhatsAppTemplate`) carga `whatsapp_config` de la org y rutea al backend.
- **Envíos automáticos:** todos pasan por `queueNotification` (`lib/notifications/queue.ts`)
  → `sendNotificationDirect` (`lib/notifications/send-direct.ts`). Triggers en:
  `app/api/ordenes/route.ts`, `app/api/ordenes/[id]/route.ts`,
  `app/api/ordenes/[id]/entregar/route.ts`, `app/api/garantias/route.ts`,
  rutas públicas de aprobación de presupuesto/cotización, y crons
  `app/api/cron/recordatorios/route.ts` y `turnos-recordatorios/route.ts`.
  **Ninguno pasa `sucursal_id`.**
- **Sucursales:** tabla `sucursales` (`201_sucursales_tabla.sql`) con campo `telefono`
  (hoy solo display, no conectado a envíos). `sucursal_id` ya existe en `ordenes_servicio`,
  `ventas`, `sesiones_caja`, `movimientos_caja`, `depositos`, `users`. Resolución de
  sucursal activa en `lib/sucursal.ts` (rol + `users.sucursal_id` + cookie
  `stapp-sucursal-activa`).
- **Cotizaciones NO tienen `sucursal_id`.** Sus envíos caerán al central (ver Límites).

## Arquitectura de la solución

### 1. Modelo de datos

Nueva tabla `sucursal_whatsapp_config` (aísla lo nuevo; `whatsapp_config` central queda
intacto):

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `organization_id` | uuid FK | not null |
| `sucursal_id` | uuid FK → `sucursales` | **UNIQUE** (una config por sucursal) |
| `evolution_instance_name` | text | `stapp-org-{org}-suc-{suc}` |
| `evolution_connection_state` | text | `open` / `connecting` / `close` / null |
| `evolution_last_qr_at` | timestamptz | null |
| `activo` | boolean | default true |
| `created_at` / `updated_at` | timestamptz | |

RLS: mismo patrón que `whatsapp_config` (scoping por `organization_id`). Índice por
`(organization_id, sucursal_id)`.

**Alternativa descartada (B):** agregar `sucursal_id` nullable a `whatsapp_config` y
mover el UNIQUE a `(org, sucursal)`. Descartada por tocar la tabla/constraints del envío
central (riesgo sobre lo que hoy funciona) y dejar columnas de Meta sin uso en filas de
sucursal.

### 2. Ruteo del emisor (corazón del cambio)

Nuevo resolver, p.ej. `lib/whatsapp/resolve-sender.ts`:

```
resolveWhatsAppSender(organizationId, sucursalId?) -> SenderConfig
  1. si sucursalId presente:
       cfg = SELECT * FROM sucursal_whatsapp_config WHERE org, sucursal
       si cfg && cfg.activo && cfg.evolution_connection_state === 'open':
         return { provider: 'evolution', instanceName: cfg.evolution_instance_name }
  2. fallback: config central de whatsapp_config (comportamiento actual, sin cambios)
  3. si central no configurado: fallback wa.me (sin cambios)
```

- El `instanceName` de la sucursal se pasa al cliente Evolution existente (ya acepta
  `instanceName`). `sendWhatsAppText` se extiende con un override opcional de instancia
  (o recibe el `SenderConfig` resuelto) para no romper el path central.
- **Threading de `sucursal_id`:** el `sucursal_id` del entity (orden/venta) viaja desde el
  trigger → `queueNotification` (nuevo campo opcional `sucursalId`) → `send-direct.ts` →
  resolver. Órdenes y ventas ya tienen la columna; se lee ahí.

### 3. Aprovisionamiento (rutas + UI)

- **Rutas:** extender el flujo Evolution para operar por sucursal. Opción preferida: rutas
  anidadas `app/api/sucursales/[id]/whatsapp/connect|qr|logout` (o parametrizar las
  existentes `app/api/whatsapp/evolution/*` con `sucursalId`). Reusan la lógica de
  provisión de instancia contra el servidor Evolution compartido, con
  `instanceName = stapp-org-{org}-suc-{suc}`.
- **UI:** en la config de cada sucursal (`app/(dashboard)/configuracion/sucursales`),
  por sucursal: botón **"Conectar WhatsApp"** → genera instancia + muestra **QR** + poll de
  estado de conexión + **"Desconectar"**. Reusa el componente de QR/estado del setup
  Evolution actual (`components/configuracion/whatsapp-setup.tsx`) parametrizado por
  sucursal.

### 4. Planes / gating

Sin cambios de esquema de planes. Se enforce con lo existente:
- `hasPlanFeature(orgId, 'whatsapp_notifications')` en las rutas nuevas (mismo 403
  `FEATURE_REQUIRED` que las rutas Evolution actuales).
- La UI por sucursal solo aparece cuando la org tiene la feature y >1 sucursal.

### 5. Rate limiting

Reusar el rate-limit existente de envíos, pero considerar la clave por instancia/sucursal
para no compartir cuota entre números distintos. (Detalle a resolver en implementación;
no cambia el diseño.)

## Manejo de errores / edge cases

- **Sucursal desconectada al enviar** → cae al central (decisión 4).
- **Sucursal sin config** → central (modelo override).
- **Central sin configurar** → fallback `wa.me` (sin cambios).
- **Entity sin `sucursal_id`** (p.ej. cotizaciones hoy, datos viejos) → central.
- **Instancia Evolution huérfana** (org borra sucursal): `sucursal_whatsapp_config` con FK
  a `sucursales`; al soft-delete de la sucursal, marcar `activo=false` y (opcional) logout
  de la instancia. Definir en tasks.

## Testing

- **Resolver (unit):** sucursal `open` → instancia de sucursal; sucursal inactiva o estado
  ≠ open → central; sin `sucursal_id` → central; central ausente → wa.me.
- **Threading:** un envío automático de una orden de la Sucursal B usa la instancia de B.
- **Migración:** la tabla nueva se crea, RLS aplica, no afecta `whatsapp_config`.
- **Gating:** rutas nuevas devuelven 403 sin `whatsapp_notifications`.

## Límites conocidos (fuera de alcance, a propósito)

- **Cotizaciones** no tienen `sucursal_id` → sus envíos salen del central. Se puede
  extender agregando la columna más adelante.
- **Inbound / respuestas** por sucursal: fuera de alcance (decisión 3).
- **Meta oficial por sucursal:** fuera de alcance (decisión 2). Solo QR/Evolution.

## Descomposición sugerida (para la fase de plan)

Cambio mediano; probable entrega en PRs encadenados:

1. **Backend / ruteo:** migración `sucursal_whatsapp_config` + resolver + threading de
   `sucursal_id` por `queueNotification`/`send-direct` + tests del resolver.
2. **Aprovisionamiento:** rutas connect/qr/logout por sucursal + gating.
3. **UI:** sección "Conectar WhatsApp" por sucursal con QR y estado.
