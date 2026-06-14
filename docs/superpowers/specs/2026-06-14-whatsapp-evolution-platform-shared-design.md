# WhatsApp Evolution — Servidor compartido de plataforma (zero-config por tenant)

**Fecha:** 2026-06-14
**Estado:** Diseño aprobado

## Problema

Hoy cada organización (tenant) debe configurar a mano `baseUrl`, `instanceName` y `apiKey` de Evolution en `Configuración → WhatsApp` (`app/api/whatsapp/config/route.ts:113-178`). Esto está pensado como "trae tu propio Evolution", pero el modelo de negocio es **un único servidor Evolution self-hosted de plataforma** (ya desplegado en `https://evo.stapp.com.ar`). Pedirle URL + API key a cada tenant es fricción innecesaria, propenso a error (el tenant no tiene esos datos) y de soporte alto.

## Objetivo

El tenant solo ve **"Conectar WhatsApp"** → escanea un QR con el número de su taller → queda conectado y notificando. Sin provider, sin URL, sin API key. El servidor Evolution es infra compartida; **cada org vincula su propio número** (instancia separada).

## Decisiones (cerradas)

1. **Server compartido, número por org.** baseUrl + apiKey son de plataforma; cada org tiene su propia instancia (`stapp-org-{organizationId}`) y vincula su propio número. Los mensajes salen del número del taller.
2. **UI del tenant: solo "Conectar WhatsApp" (QR).** Sin pestañas Meta/Evolution, sin campos URL/key. Meta sale de la vista del tenant; el backend lo sigue soportando para orgs que ya lo tengan configurado.
3. **Conectar = activar.** Al detectar estado `open`, el backend activa solo el flag de notificaciones WhatsApp de la org. El plan Profesional sigue gateando (feature pago, sin cambios).
4. **`instanceName` autogenerado** = `stapp-org-{organizationId}` (estable, único, no editable por el tenant).
5. **Desconectar apaga el flag** (simétrico).

## Arquitectura

### Config de plataforma
- Env vars (Vercel): `EVOLUTION_BASE_URL`, `EVOLUTION_API_KEY`.
- Helper nuevo `getPlatformEvolutionConfig(): { baseUrl, apiKey } | null` (en `lib/whatsapp/providers/evolution.ts` o `lib/whatsapp/platform-config.ts`).
- Si falta el env → toda operación Evolution devuelve error claro "WhatsApp no disponible (configuración de plataforma)".

### Datos por org (`whatsapp_config`, sin cambio de schema)
- `provider = 'evolution'`
- `evolution_instance_name = stapp-org-{orgId}` (autogenerado al conectar si falta)
- `evolution_connection_state`, `is_configured`, `is_verified`
- `evolution_base_url` / `evolution_api_key_encrypted`: **quedan sin uso** para el flujo nuevo (no se leen ni escriben). No se borran columnas.

### Resolución de credenciales (send path)
`getEvolutionCreds(config)` (`lib/whatsapp/providers/index.ts:46-56`) cambia a:
- `baseUrl` + `apiKey` ← `getPlatformEvolutionConfig()` (env), NO de la DB.
- `instanceName` ← `config.evolution_instance_name` (DB).
- Efecto: **todas las orgs con provider=evolution migran solas** al server compartido. Las que hayan pareado contra otro server deberán re-parear (caso marginal, pocas orgs).

### Rutas backend
- **`POST /api/whatsapp/evolution/connect`** (reemplaza el "guardar config" de Evolution): resuelve env + instanceName autogenerado, `createInstance` (idempotente) + `connectInstance` → devuelve `{ state, qrBase64, pairingCode }`. Upsert `whatsapp_config` con provider=evolution + instanceName + is_configured=true. Gate de plan `whatsapp_notifications`.
- **`GET /api/whatsapp/evolution/qr`** (poll de estado): lee env + instanceName de DB; si `state === 'open'` → marca `is_verified=true` Y **activa notificaciones WhatsApp** de la org (auto-enable).
- **`POST /api/whatsapp/evolution/logout`**: env + instance; desconecta; marca state=close, is_verified=false, y **apaga** el flag de notificaciones.
- La rama Evolution de `PUT /api/whatsapp/config` (que pedía baseUrl/instanceName/apiKey) se elimina del uso del tenant.

### UI del tenant (`components/configuracion/whatsapp-setup.tsx`)
- Reemplaza pestañas + campos por un flujo único:
  - Estado desconectado → botón **"Conectar WhatsApp"** → `POST connect` → muestra QR + pairing code → polling `GET qr` hasta `open`.
  - Estado conectado → "Conectado ✅ (número vinculado)" + botón **Desconectar**.
- No muestra provider, URL ni API key.
- Copy en español neutro del proyecto.

### Flag de notificaciones
- El flag vive en `organizations.notificaciones_whatsapp` (BOOLEAN, `DEFAULT TRUE` — `supabase/migrations/001_schema.sql:112`). Lo escribe `/api/notificaciones/config:56` y lo lee `lib/notifications/send-direct.ts:261`. Misma columna en ambos lados, sin mismatch.
- Como el default es TRUE, el auto-enable es en la práctica un "asegurar TRUE" (cubre el caso de un tenant que lo apagó). El gate que realmente bloquea hoy NO es este flag (ya viene true) sino la **conexión** (instancia no `open`) y el **plan**.
- Auto-enable/disable lo hace el backend de connect-state/logout directamente sobre `organizations.notificaciones_whatsapp` (no requiere acción del tenant).

## Manejo de errores
- Env de plataforma ausente → 503/400 con mensaje "WhatsApp no disponible".
- Sin plan Profesional → 403 (`whatsapp_notifications`), como hoy.
- `createInstance` idempotente (re-conectar no duplica).
- Falla de red contra Evolution → error propagado con mensaje claro, sin romper el resto de la config.

## Testing (vitest, patrón `__tests__/api/*` + helpers)
- `connect`: autogenera `instanceName = stapp-org-{id}`; usa env creds; 403 sin plan; 400/503 si falta env; upsert correcto. Cliente Evolution mockeado.
- `qr` poll: cuando state=`open`, setea is_verified Y activa el flag de notificaciones.
- `logout`: apaga el flag.
- `getEvolutionCreds`: lee baseUrl/apiKey del env, instance de la DB; null si falta env.
- Regresión: orgs con provider=meta siguen enviando por Meta (send path intacto).

## Fuera de alcance (otros planes)
- Trigger de **orden creada → WhatsApp** (gap real, requiere `queueNotification` en `POST /api/ordenes`).
- **Recordatorio por WhatsApp** (cron hoy solo email).
- **Opt-out/consentimiento** por cliente.
- Re-exponer Meta en algún panel (superadmin).

## Archivos afectados (estimado)
- `lib/whatsapp/providers/evolution.ts` o nuevo `lib/whatsapp/platform-config.ts` — helper env.
- `lib/whatsapp/providers/index.ts` — `getEvolutionCreds` lee env.
- `app/api/whatsapp/evolution/connect/route.ts` — nueva.
- `app/api/whatsapp/evolution/qr/route.ts` — env + auto-enable.
- `app/api/whatsapp/evolution/logout/route.ts` — env + auto-disable.
- `app/api/whatsapp/config/route.ts` — quitar rama Evolution del flujo tenant.
- `components/configuracion/whatsapp-setup.tsx` — UI nueva.
- Tests correspondientes.
- `.env.example` — documentar las 2 env vars.
