# WhatsApp por sucursal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cada sucursal pueda conectar su propio WhatsApp por QR y que los envíos automáticos salgan desde el número de la sucursal a la que pertenece la orden, cayendo al número central cuando la sucursal no tiene número o está desconectada.

**Architecture:** Tabla nueva `sucursal_whatsapp_config` (aísla lo per-sucursal; `whatsapp_config` central queda intacto). Un resolver `resolveWhatsAppSender(orgId, sucursalId)` decide instancia-de-sucursal vs central. El `sucursal_id` de la orden viaja por `queueNotification` → `sendNotificationDirect` → `sendWhatsAppText` (con override de instancia). Aprovisionamiento por QR reusa el cliente Evolution existente con `instanceName = stapp-org-{org}-suc-{suc}`.

**Tech Stack:** Next.js (App Router) + Supabase (Postgres, RLS) + Evolution API (Baileys self-hosted, servidor compartido por ENV) + Vitest.

## Global Constraints

- **IDs son `TEXT` (cuid), NO uuid.** `organizations.id`, `sucursales.id`, `sucursal_id` son TEXT. Toda FK/columna nueva usa TEXT. (Ref: `201_sucursales_tabla.sql`.)
- **Migraciones idempotentes** (`CREATE TABLE IF NOT EXISTS`, `DROP POLICY IF EXISTS` antes de `CREATE POLICY`), molde `201_sucursales_tabla.sql`. Próximo número: **265**.
- **RLS** en tablas nuevas: policy `SELECT` por `organization_id = current_setting('app.organization_id', true)` + policy `FOR ALL USING (true) WITH CHECK (true)` para el service role. Trigger `update_updated_at`.
- **Evolution servidor compartido**: `baseUrl`/`apiKey` vienen de `getPlatformEvolutionConfig()` (ENV `EVOLUTION_BASE_URL`/`EVOLUTION_API_KEY`). El tenant nunca los ve. Identidad = `instanceName`.
- **Gating de plan**: rutas nuevas devuelven 403 `{ error, code: "FEATURE_REQUIRED", feature: "whatsapp_notifications" }` cuando `hasPlanFeature(orgId, "whatsapp_notifications")` es false. Sin flag de plan nuevo.
- **Idioma de artefactos**: identificadores/comentarios en español neutro (el repo ya está en español). UI en español rioplatense como el resto.
- **Tests**: Vitest. `@/lib/supabase` está globalmente mockeado en `vitest.setup.ts` (`supabaseAdmin.from()` devuelve chain `select/insert/update/delete/eq/single`). Comando: `npx vitest run <archivo>`.
- **Decisión de caída**: si la sucursal tiene config pero `evolution_connection_state !== "open"` (o `activo=false`), el envío cae al central.
- **Commits**: conventional commits, sin `Co-Authored-By`.

---

## File Structure

**Slice 1 — Backend / ruteo (PR #1):**
- Create: `supabase/migrations/265_sucursal_whatsapp_config.sql` — tabla + RLS + trigger.
- Modify: `lib/whatsapp/platform-config.ts` — agregar `buildSucursalInstanceName`.
- Create: `lib/whatsapp/resolve-sender.ts` — `resolveWhatsAppSender`.
- Create: `lib/whatsapp/__tests__/resolve-sender.test.ts` — tests del resolver.
- Modify: `lib/whatsapp/providers/index.ts` — `sendWhatsAppText` acepta override de instancia.
- Create: `lib/whatsapp/__tests__/send-instance-override.test.ts` — test del override.
- Modify: `lib/notifications/queue.ts` — agregar `sucursalId?` al param.
- Modify: `lib/notifications/send-direct.ts` — threading + resolver + gate.
- Modify: `app/api/ordenes/[id]/route.ts` — pasar `orden.sucursal_id` en los 2 `queueNotification`.
- Modify: `app/api/ordenes/route.ts` — pasar `sucursal_id` en el `queueNotification` de creación.
- Modify: `app/api/ordenes/[id]/entregar/route.ts` — pasar `sucursal_id`.

**Slice 2 — Aprovisionamiento por sucursal (PR #2):**
- Create: `lib/whatsapp/sucursal-config.ts` — helpers de lectura/upsert de `sucursal_whatsapp_config`.
- Create: `app/api/sucursales/[id]/whatsapp/connect/route.ts` — POST crear instancia + QR.
- Create: `app/api/sucursales/[id]/whatsapp/qr/route.ts` — POST QR / GET poll estado.
- Create: `app/api/sucursales/[id]/whatsapp/logout/route.ts` — POST desconectar.

**Slice 3 — UI (PR #3):**
- Create: `components/configuracion/sucursal-whatsapp-card.tsx` — card conectar/QR/estado por sucursal.
- Modify: `app/(dashboard)/configuracion/sucursales/page.tsx` — montar la card por sucursal.

---

## SLICE 1 — Backend / ruteo (PR #1)

### Task 1: Migración `sucursal_whatsapp_config`

**Files:**
- Create: `supabase/migrations/265_sucursal_whatsapp_config.sql`

**Interfaces:**
- Produces: tabla `sucursal_whatsapp_config` con columnas `id TEXT PK`, `organization_id TEXT`, `sucursal_id TEXT UNIQUE`, `evolution_instance_name TEXT`, `evolution_connection_state TEXT`, `evolution_last_qr_at TIMESTAMPTZ`, `activo BOOLEAN`, `created_at`, `updated_at`.

- [ ] **Step 1: Escribir la migración completa**

```sql
-- ========================================
-- 265: sucursal_whatsapp_config — WhatsApp por sucursal (Evolution/QR)
-- ========================================
-- Config de WhatsApp por sucursal. El whatsapp_config central (per-org) queda
-- intacto: esta tabla solo guarda la instancia Evolution de cada sucursal.
-- Molde: 201_sucursales_tabla.sql. IDs son TEXT (cuid). Idempotente.

CREATE TABLE IF NOT EXISTS sucursal_whatsapp_config (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sucursal_id TEXT NOT NULL REFERENCES sucursales(id) ON DELETE CASCADE,
  evolution_instance_name TEXT,
  evolution_connection_state TEXT,
  evolution_last_qr_at TIMESTAMPTZ,
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Una config por sucursal
CREATE UNIQUE INDEX IF NOT EXISTS sucursal_whatsapp_config_sucursal_unique
  ON sucursal_whatsapp_config(sucursal_id);

CREATE INDEX IF NOT EXISTS sucursal_whatsapp_config_org_idx
  ON sucursal_whatsapp_config(organization_id);

ALTER TABLE sucursal_whatsapp_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sucursal_whatsapp_config_select ON sucursal_whatsapp_config;
CREATE POLICY sucursal_whatsapp_config_select ON sucursal_whatsapp_config
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS sucursal_whatsapp_config_all_service ON sucursal_whatsapp_config;
CREATE POLICY sucursal_whatsapp_config_all_service ON sucursal_whatsapp_config
  FOR ALL USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS sucursal_whatsapp_config_updated_at ON sucursal_whatsapp_config;
CREATE TRIGGER sucursal_whatsapp_config_updated_at
  BEFORE UPDATE ON sucursal_whatsapp_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMENT ON TABLE sucursal_whatsapp_config IS
  'WhatsApp (Evolution/QR) por sucursal. El central per-org sigue en whatsapp_config.';
COMMENT ON COLUMN sucursal_whatsapp_config.evolution_instance_name IS
  'Instancia Evolution de la sucursal: stapp-org-{org}-suc-{suc}.';
COMMENT ON COLUMN sucursal_whatsapp_config.evolution_connection_state IS
  'open | connecting | close | qr — ultimo estado reportado.';
```

- [ ] **Step 2: Verificar sintaxis buscando dependencias existentes**

Run: `rg -n "generate_cuid|update_updated_at" supabase/migrations/201_sucursales_tabla.sql`
Expected: ambas funciones aparecen usadas en 201 (confirmando que existen en el schema).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/265_sucursal_whatsapp_config.sql
git commit -m "feat(whatsapp): tabla sucursal_whatsapp_config"
```

---

### Task 2: Helper `buildSucursalInstanceName`

**Files:**
- Modify: `lib/whatsapp/platform-config.ts`
- Test: `lib/whatsapp/__tests__/platform-config.test.ts` (create)

**Interfaces:**
- Consumes: nada.
- Produces: `buildSucursalInstanceName(organizationId: string, sucursalId: string): string` → `stapp-org-{org}-suc-{suc}`.

- [ ] **Step 1: Escribir el test que falla**

```typescript
// lib/whatsapp/__tests__/platform-config.test.ts
import { describe, it, expect } from 'vitest'
import { buildSucursalInstanceName } from '../platform-config'

describe('buildSucursalInstanceName', () => {
  it('compone instancia por org y sucursal', () => {
    expect(buildSucursalInstanceName('org1', 'suc9')).toBe('stapp-org-org1-suc-suc9')
  })
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run lib/whatsapp/__tests__/platform-config.test.ts`
Expected: FAIL — `buildSucursalInstanceName is not a function` / no export.

- [ ] **Step 3: Implementar el helper**

En `lib/whatsapp/platform-config.ts`, después de `buildInstanceName`, agregar:

```typescript
/**
 * Nombre de instancia estable y único por sucursal. No editable por el tenant.
 */
export function buildSucursalInstanceName(organizationId: string, sucursalId: string): string {
  return `stapp-org-${organizationId}-suc-${sucursalId}`
}
```

- [ ] **Step 4: Correr el test**

Run: `npx vitest run lib/whatsapp/__tests__/platform-config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/whatsapp/platform-config.ts lib/whatsapp/__tests__/platform-config.test.ts
git commit -m "feat(whatsapp): helper buildSucursalInstanceName"
```

---

### Task 3: Resolver `resolveWhatsAppSender`

**Files:**
- Create: `lib/whatsapp/resolve-sender.ts`
- Test: `lib/whatsapp/__tests__/resolve-sender.test.ts`

**Interfaces:**
- Consumes: `supabaseAdmin` de `@/lib/supabase`.
- Produces:
  - `interface ResolvedSender { scope: "sucursal" | "central"; instanceName?: string }`
  - `resolveWhatsAppSender(organizationId: string, sucursalId?: string | null): Promise<ResolvedSender>`
  - Regla: devuelve `{ scope: "sucursal", instanceName }` solo si hay fila para `(org, sucursal)` con `activo=true` y `evolution_connection_state === "open"`; en cualquier otro caso `{ scope: "central" }`.

- [ ] **Step 1: Escribir los tests que fallan**

```typescript
// lib/whatsapp/__tests__/resolve-sender.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { supabaseAdmin } from '@/lib/supabase'
import { resolveWhatsAppSender } from '../resolve-sender'

function mockConfigRow(row: any) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
  }
  vi.mocked(supabaseAdmin.from).mockReturnValue(chain as any)
}

describe('resolveWhatsAppSender', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sin sucursalId -> central (no consulta)', async () => {
    const r = await resolveWhatsAppSender('org1', null)
    expect(r).toEqual({ scope: 'central' })
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('sucursal open + activo -> usa la instancia de la sucursal', async () => {
    mockConfigRow({ activo: true, evolution_connection_state: 'open', evolution_instance_name: 'stapp-org-org1-suc-suc9' })
    const r = await resolveWhatsAppSender('org1', 'suc9')
    expect(r).toEqual({ scope: 'sucursal', instanceName: 'stapp-org-org1-suc-suc9' })
  })

  it('sucursal desconectada -> central', async () => {
    mockConfigRow({ activo: true, evolution_connection_state: 'close', evolution_instance_name: 'x' })
    const r = await resolveWhatsAppSender('org1', 'suc9')
    expect(r).toEqual({ scope: 'central' })
  })

  it('sucursal inactiva -> central', async () => {
    mockConfigRow({ activo: false, evolution_connection_state: 'open', evolution_instance_name: 'x' })
    const r = await resolveWhatsAppSender('org1', 'suc9')
    expect(r).toEqual({ scope: 'central' })
  })

  it('sin fila de config -> central', async () => {
    mockConfigRow(null)
    const r = await resolveWhatsAppSender('org1', 'suc9')
    expect(r).toEqual({ scope: 'central' })
  })
})
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `npx vitest run lib/whatsapp/__tests__/resolve-sender.test.ts`
Expected: FAIL — no existe `../resolve-sender`.

- [ ] **Step 3: Implementar el resolver**

```typescript
// lib/whatsapp/resolve-sender.ts
/**
 * Resuelve desde qué número de WhatsApp mandar un envío automático.
 * - Si la orden pertenece a una sucursal con WhatsApp propio conectado (open),
 *   se usa la instancia de esa sucursal.
 * - En cualquier otro caso (sin sucursal, sin config, inactiva o desconectada),
 *   se cae al número central per-organización (whatsapp_config).
 */
import { supabaseAdmin } from "@/lib/supabase"

export interface ResolvedSender {
  scope: "sucursal" | "central"
  instanceName?: string
}

export async function resolveWhatsAppSender(
  organizationId: string,
  sucursalId?: string | null
): Promise<ResolvedSender> {
  if (!sucursalId) return { scope: "central" }

  const { data } = await supabaseAdmin
    .from("sucursal_whatsapp_config")
    .select("activo, evolution_connection_state, evolution_instance_name")
    .eq("organization_id", organizationId)
    .eq("sucursal_id", sucursalId)
    .maybeSingle()

  if (
    data &&
    data.activo &&
    data.evolution_connection_state === "open" &&
    data.evolution_instance_name
  ) {
    return { scope: "sucursal", instanceName: data.evolution_instance_name }
  }

  return { scope: "central" }
}
```

- [ ] **Step 4: Correr los tests**

Run: `npx vitest run lib/whatsapp/__tests__/resolve-sender.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/whatsapp/resolve-sender.ts lib/whatsapp/__tests__/resolve-sender.test.ts
git commit -m "feat(whatsapp): resolver de emisor por sucursal con fallback central"
```

---

### Task 4: `sendWhatsAppText` con override de instancia

**Files:**
- Modify: `lib/whatsapp/providers/index.ts:73-102`
- Test: `lib/whatsapp/__tests__/send-instance-override.test.ts`

**Interfaces:**
- Consumes: `getPlatformEvolutionConfig`, `evoSendText`, `loadOrgCountry` (interno).
- Produces: nueva firma
  `sendWhatsAppText(organizationId: string, to: string, text: string, opts?: { instanceNameOverride?: string }): Promise<SendResult>`.
  Cuando `opts.instanceNameOverride` está presente, envía por Evolution con la instancia dada usando creds de plataforma, sin leer `whatsapp_config`. Sin `opts`, comportamiento actual intacto.

- [ ] **Step 1: Escribir el test que falla**

```typescript
// lib/whatsapp/__tests__/send-instance-override.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/whatsapp/platform-config', () => ({
  getPlatformEvolutionConfig: () => ({ baseUrl: 'https://evo.test', apiKey: 'k' }),
  buildInstanceName: (o: string) => `stapp-org-${o}`,
  buildSucursalInstanceName: (o: string, s: string) => `stapp-org-${o}-suc-${s}`,
}))

const evoSendText = vi.fn().mockResolvedValue({ success: true, messageId: 'm1' })
vi.mock('@/lib/whatsapp/providers/evolution', () => ({
  sendText: (...args: any[]) => evoSendText(...args),
}))

describe('sendWhatsAppText con instanceNameOverride', () => {
  beforeEach(() => vi.clearAllMocks())

  it('usa la instancia override sin leer whatsapp_config', async () => {
    const { sendWhatsAppText } = await import('../providers')
    const res = await sendWhatsAppText('org1', '+5491111', 'hola', {
      instanceNameOverride: 'stapp-org-org1-suc-suc9',
    })
    expect(res.success).toBe(true)
    expect(res.provider).toBe('evolution')
    // primer arg de evoSendText son las creds con la instancia override
    expect(evoSendText.mock.calls[0][0].instanceName).toBe('stapp-org-org1-suc-suc9')
  })
})
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `npx vitest run lib/whatsapp/__tests__/send-instance-override.test.ts`
Expected: FAIL — la firma actual ignora el 4º argumento (o `evoSendText` no recibe la instancia override).

- [ ] **Step 3: Implementar el override**

En `lib/whatsapp/providers/index.ts`, reemplazar la firma y el cuerpo inicial de `sendWhatsAppText` (líneas 73-102):

```typescript
export async function sendWhatsAppText(
  organizationId: string,
  to: string,
  text: string,
  opts?: { instanceNameOverride?: string }
): Promise<SendResult> {
  // Override por sucursal: enviar por Evolution con una instancia específica,
  // usando las credenciales de plataforma. No lee whatsapp_config (central).
  if (opts?.instanceNameOverride) {
    const platform = getPlatformEvolutionConfig()
    if (!platform) {
      return { success: false, error: "Plataforma Evolution no configurada", provider: "evolution" }
    }
    const countryCode = await loadOrgCountry(organizationId)
    const creds = {
      baseUrl: platform.baseUrl,
      instanceName: opts.instanceNameOverride,
      apiKey: platform.apiKey,
    }
    const result = await evoSendText(creds, to, text, countryCode)
    return { ...result, provider: "evolution" }
  }

  const config = await loadConfig(organizationId)
  if (!config || !config.is_configured) {
    return { success: false, error: "WhatsApp no configurado" }
  }

  const provider: WhatsAppProvider = config.provider || "meta"
  const countryCode = await loadOrgCountry(organizationId)

  if (provider === "evolution") {
    const creds = getEvolutionCreds(config)
    if (!creds) {
      return { success: false, error: "Evolution API incompleta (URL/instancia/api key)", provider }
    }
    const result = await evoSendText(creds, to, text, countryCode)
    return { ...result, provider }
  }

  // Meta default
  if (!config.phone_number_id || !config.access_token_encrypted) {
    return { success: false, error: "Meta credenciales incompletas", provider }
  }
  const accessToken = decrypt(config.access_token_encrypted)
  const result = await metaSendText(config.phone_number_id, accessToken, to, text, countryCode)
  return { ...result, provider }
}
```

(Agregar `getPlatformEvolutionConfig` al import existente de `@/lib/whatsapp/platform-config` en la cabecera del archivo.)

- [ ] **Step 4: Correr el test**

Run: `npx vitest run lib/whatsapp/__tests__/send-instance-override.test.ts`
Expected: PASS.

- [ ] **Step 5: Verificar que no rompí el resto del módulo**

Run: `npx vitest run lib/whatsapp/`
Expected: PASS (incluye tests previos del provider si existen).

- [ ] **Step 6: Commit**

```bash
git add lib/whatsapp/providers/index.ts lib/whatsapp/__tests__/send-instance-override.test.ts
git commit -m "feat(whatsapp): sendWhatsAppText acepta override de instancia por sucursal"
```

---

### Task 5: Threading de `sucursalId` en el envío + gate

**Files:**
- Modify: `lib/notifications/queue.ts` — agregar `sucursalId?: string | null` al param.
- Modify: `lib/notifications/send-direct.ts:8-71` (tipo + firma) y `:142-219` (bloque WhatsApp).
- Test: `lib/notifications/__tests__/send-direct-sucursal.test.ts` (create).

**Interfaces:**
- Consumes: `resolveWhatsAppSender` (Task 3), `sendWhatsAppText` override (Task 4).
- Produces: `NotificationParams.sucursalId?: string | null`; el envío WhatsApp usa la instancia de la sucursal cuando el resolver la devuelve, y permite enviar por API aun si el central no está configurado.

- [ ] **Step 1: Agregar `sucursalId` al param de `queueNotification`**

En `lib/notifications/queue.ts`, dentro del objeto `params`, agregar tras `organizationId`:

```typescript
  organizationId: string
  sucursalId?: string | null
  ordenId?: string
```

- [ ] **Step 2: Agregar `sucursalId` al tipo de `send-direct`**

En `lib/notifications/send-direct.ts`, en `interface NotificationParams`, agregar tras `organizationId: string`:

```typescript
  organizationId: string
  sucursalId?: string | null
```

Y en el destructuring de `sendNotificationDirect` (línea ~72):

```typescript
  const { organizationId, sucursalId, ordenId, garantiaId, clienteId, tipo, context } = params
```

- [ ] **Step 3: Escribir el test que falla (routing por sucursal)**

```typescript
// lib/notifications/__tests__/send-direct-sucursal.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const sendWhatsAppText = vi.fn().mockResolvedValue({ success: true, messageId: 'm', provider: 'evolution' })
vi.mock('@/lib/whatsapp/providers', () => ({ sendWhatsAppText: (...a: any[]) => sendWhatsAppText(...a) }))

const resolveWhatsAppSender = vi.fn()
vi.mock('@/lib/whatsapp/resolve-sender', () => ({
  resolveWhatsAppSender: (...a: any[]) => resolveWhatsAppSender(...a),
}))

// Silenciar el resto de canales; controlamos supabaseAdmin.from por tabla.
import { supabaseAdmin } from '@/lib/supabase'

function wireSupabase(overrides: Record<string, any>) {
  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    const row = overrides[table] ?? null
    return {
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: row, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
    } as any
  })
}

const baseContext = {
  organizationName: 'Org',
  cliente: { id: 'c1', nombre: 'Ana', email: null, telefono: '+5491111' },
  orden: { id: 'o1', numeroOrden: 1, dispositivo: 'iPhone', estado: 'REPARADO' },
}

describe('sendNotificationDirect routing por sucursal', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sucursal open -> manda con instanceNameOverride aunque el central no exista', async () => {
    resolveWhatsAppSender.mockResolvedValue({ scope: 'sucursal', instanceName: 'stapp-org-org1-suc-suc9' })
    wireSupabase({
      organizations: { notificaciones_email: false, notificaciones_whatsapp: true, plantillas_whatsapp: null, pais: 'AR' },
      clientes: { acepta_whatsapp: true },
      whatsapp_config: null, // central sin configurar
      users: null,
    })
    const { sendNotificationDirect } = await import('../send-direct')
    await sendNotificationDirect({
      organizationId: 'org1', sucursalId: 'suc9', clienteId: 'c1', tipo: 'CAMBIO_ESTADO', context: baseContext as any,
    })
    expect(sendWhatsAppText).toHaveBeenCalledTimes(1)
    expect(sendWhatsAppText.mock.calls[0][3]).toEqual({ instanceNameOverride: 'stapp-org-org1-suc-suc9' })
  })

  it('sin sucursal conectada -> cae al central (sin override)', async () => {
    resolveWhatsAppSender.mockResolvedValue({ scope: 'central' })
    wireSupabase({
      organizations: { notificaciones_email: false, notificaciones_whatsapp: true, plantillas_whatsapp: null, pais: 'AR' },
      clientes: { acepta_whatsapp: true },
      whatsapp_config: { provider: 'evolution', is_configured: true, is_verified: true, evolution_connection_state: 'open' },
      users: null,
    })
    const { sendNotificationDirect } = await import('../send-direct')
    await sendNotificationDirect({
      organizationId: 'org1', sucursalId: 'suc9', clienteId: 'c1', tipo: 'CAMBIO_ESTADO', context: baseContext as any,
    })
    expect(sendWhatsAppText).toHaveBeenCalledTimes(1)
    expect(sendWhatsAppText.mock.calls[0][3]).toBeUndefined()
  })
})
```

- [ ] **Step 4: Correr para verificar que falla**

Run: `npx vitest run lib/notifications/__tests__/send-direct-sucursal.test.ts`
Expected: FAIL — `send-direct` todavía no llama al resolver ni pasa el override.

- [ ] **Step 5: Implementar el routing en el bloque WhatsApp**

En `lib/notifications/send-direct.ts`, reemplazar el bloque `if (orgConfig.notificaciones_whatsapp && ...)` (líneas ~142-219). Cambios clave: (a) resolver la sucursal, (b) `canSendViaApi` incluye el caso sucursal, (c) pasar el override a `sendWhatsAppText`.

```typescript
  if (orgConfig.notificaciones_whatsapp && context.cliente.telefono && aceptaWhatsapp) {
    try {
      const { resolveWhatsAppSender } = await import("@/lib/whatsapp/resolve-sender")
      const sender = await resolveWhatsAppSender(organizationId, sucursalId)

      const { data: waConfig } = await supabaseAdmin
        .from("whatsapp_config")
        .select("provider, is_configured, is_verified, evolution_connection_state")
        .eq("organization_id", organizationId)
        .single()

      const provider = (waConfig?.provider || "meta") as "meta" | "evolution"
      const canSendCentralApi =
        waConfig?.is_configured &&
        (provider === "evolution"
          ? waConfig.evolution_connection_state === "open"
          : waConfig.is_verified)

      // La sucursal conectada puede enviar por API aunque el central no esté configurado.
      const canSendViaApi = sender.scope === "sucursal" || !!canSendCentralApi

      if (canSendViaApi) {
        const { sendWhatsAppText } = await import("@/lib/whatsapp/providers")

        const resolvedText = resolvePlantillaForTipo(tipo, context, orgConfig.plantillas_whatsapp)
        const fallbackText = resolvedText ?? generateWhatsAppMessage(tipo, context)

        const result = await sendWhatsAppText(
          organizationId,
          context.cliente.telefono,
          fallbackText,
          sender.scope === "sucursal" ? { instanceNameOverride: sender.instanceName } : undefined
        )

        await supabaseAdmin.from("notification_logs").insert({
          organization_id: organizationId,
          orden_id: ordenId,
          garantia_id: garantiaId,
          cliente_id: clienteId,
          tipo,
          canal: "WHATSAPP",
          estado: result.success ? "ENVIADO" : "FALLIDO",
          destinatario: context.cliente.telefono,
          contenido: fallbackText,
          metadata: JSON.stringify({ messageId: result.messageId, viaApi: true, provider: result.provider, senderScope: sender.scope }),
          error_message: result.error || null,
        })

        if (result.success) {
          await supabaseAdmin.from("whatsapp_messages").insert({
            organization_id: organizationId,
            whatsapp_message_id: result.messageId,
            phone_number: context.cliente.telefono,
            status: "sent",
          })
        }
      } else {
        const resolvedText = resolvePlantillaForTipo(tipo, context, orgConfig.plantillas_whatsapp)
        const message = resolvedText ?? generateWhatsAppMessage(tipo, context)
        const { formatPhoneForWhatsApp } = await import("@/lib/notifications/whatsapp-templates")
        const formattedPhone = formatPhoneForWhatsApp(context.cliente.telefono, orgConfig.pais)
        const whatsappUrl = `https://wa.me/${formattedPhone}?text=${encodeURIComponent(message)}`

        await supabaseAdmin.from("notification_logs").insert({
          organization_id: organizationId,
          orden_id: ordenId,
          garantia_id: garantiaId,
          cliente_id: clienteId,
          tipo,
          canal: "WHATSAPP",
          estado: "PENDIENTE",
          destinatario: context.cliente.telefono,
          contenido: message,
          metadata: JSON.stringify({ whatsappUrl }),
        })
      }
    } catch (error) {
      console.error("sendNotificationDirect: WhatsApp error", error)
    }
  }
```

- [ ] **Step 6: Correr el test**

Run: `npx vitest run lib/notifications/__tests__/send-direct-sucursal.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add lib/notifications/queue.ts lib/notifications/send-direct.ts lib/notifications/__tests__/send-direct-sucursal.test.ts
git commit -m "feat(whatsapp): rutear envio automatico por sucursal con fallback central"
```

---

### Task 6: Wire de los triggers de órdenes

**Files:**
- Modify: `app/api/ordenes/[id]/route.ts:399` y `:432` (2 llamadas `queueNotification`).
- Modify: `app/api/ordenes/route.ts` (llamada de creación).
- Modify: `app/api/ordenes/[id]/entregar/route.ts` (llamada de entrega).

**Interfaces:**
- Consumes: `queueNotification` con `sucursalId?` (Task 5). El objeto `orden` en estos routes ya trae `sucursal_id` (se selecciona con `*`).
- Produces: cada envío automático de orden lleva el `sucursal_id` de la orden.

- [ ] **Step 1: `ordenes/[id]/route.ts` — agregar `sucursalId` a ambas llamadas**

En la llamada `CAMBIO_ESTADO` (línea ~399) agregar tras `organizationId`:

```typescript
      queueNotification({
        organizationId: organizationId!,
        sucursalId: (orden as any).sucursal_id ?? null,
        ordenId: id,
```

Repetir idéntico en la llamada `PRESUPUESTO_DEFINIDO` (línea ~432): agregar `sucursalId: (orden as any).sucursal_id ?? null,` tras `organizationId`.

- [ ] **Step 2: `ordenes/route.ts` — agregar `sucursalId` a la llamada de creación**

Run: `rg -n "queueNotification" app/api/ordenes/route.ts`
En la llamada encontrada, agregar `sucursalId` leyendo el `sucursal_id` de la orden recién creada (la variable de la orden insertada; el objeto ya tiene la columna). Ejemplo:

```typescript
      queueNotification({
        organizationId: organizationId!,
        sucursalId: (nuevaOrden as any).sucursal_id ?? null,
        ordenId: nuevaOrden.id,
        // ...resto igual
```

(Usar el nombre real de la variable de la orden creada en ese archivo — confirmar con el `rg` del inicio del step.)

- [ ] **Step 3: `entregar/route.ts` — agregar `sucursalId`**

Run: `rg -n "queueNotification|sucursal_id|\.select\(" app/api/ordenes/[id]/entregar/route.ts`
En la llamada `queueNotification`, agregar `sucursalId: (orden as any).sucursal_id ?? null,`. Si el `select` de la orden en ese archivo no incluye `sucursal_id`, agregarlo a la lista de columnas (o cambiar a `*` si ya usa columnas explícitas).

- [ ] **Step 4: Typecheck**

Run: `./node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: sin errores nuevos en esos 3 archivos.

- [ ] **Step 5: Commit**

```bash
git add app/api/ordenes/
git commit -m "feat(whatsapp): pasar sucursal_id de la orden a los envios automaticos"
```

---

### Task 7: Cierre de Slice 1 (verificación + PR)

- [ ] **Step 1: Correr toda la suite de whatsapp/notifications**

Run: `npx vitest run lib/whatsapp/ lib/notifications/`
Expected: PASS.

- [ ] **Step 2: Typecheck global**

Run: `./node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: sin errores nuevos.

- [ ] **Step 3: Fresh review + PR** (regla de PR: revisión fresca antes de abrir)

Abrir PR #1 con base `main`. Título: `feat(whatsapp): ruteo de envios automaticos por sucursal (backend)`. Nota en el body: la migración 265 debe aplicarse en Supabase antes de mergear a producción; sin la tabla, el resolver cae siempre a central (comportamiento actual, no rompe).

---

## SLICE 2 — Aprovisionamiento por sucursal (PR #2)

### Task 8: Helper de config por sucursal

**Files:**
- Create: `lib/whatsapp/sucursal-config.ts`
- Test: `lib/whatsapp/__tests__/sucursal-config.test.ts`

**Interfaces:**
- Consumes: `supabaseAdmin`.
- Produces:
  - `getSucursalWhatsAppConfig(orgId, sucursalId): Promise<{ evolution_instance_name: string | null; evolution_connection_state: string | null; activo: boolean } | null>`
  - `upsertSucursalWhatsAppState(orgId, sucursalId, instanceName, state, opts?: { qr?: boolean }): Promise<void>`

- [ ] **Step 1: Test que falla**

```typescript
// lib/whatsapp/__tests__/sucursal-config.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { supabaseAdmin } from '@/lib/supabase'
import { upsertSucursalWhatsAppState } from '../sucursal-config'

describe('upsertSucursalWhatsAppState', () => {
  beforeEach(() => vi.clearAllMocks())

  it('hace upsert con onConflict sucursal_id', async () => {
    const upsert = vi.fn().mockResolvedValue({ data: null, error: null })
    vi.mocked(supabaseAdmin.from).mockReturnValue({ upsert } as any)
    await upsertSucursalWhatsAppState('org1', 'suc9', 'stapp-org-org1-suc-suc9', 'open', { qr: true })
    expect(supabaseAdmin.from).toHaveBeenCalledWith('sucursal_whatsapp_config')
    const [row, opts] = upsert.mock.calls[0]
    expect(row.organization_id).toBe('org1')
    expect(row.sucursal_id).toBe('suc9')
    expect(row.evolution_instance_name).toBe('stapp-org-org1-suc-suc9')
    expect(row.evolution_connection_state).toBe('open')
    expect(row.evolution_last_qr_at).toBeTruthy()
    expect(opts).toEqual({ onConflict: 'sucursal_id' })
  })
})
```

- [ ] **Step 2: Correr para ver fallar**

Run: `npx vitest run lib/whatsapp/__tests__/sucursal-config.test.ts`
Expected: FAIL — no existe el módulo.

- [ ] **Step 3: Implementar**

```typescript
// lib/whatsapp/sucursal-config.ts
import { supabaseAdmin } from "@/lib/supabase"

export interface SucursalWhatsAppRow {
  evolution_instance_name: string | null
  evolution_connection_state: string | null
  activo: boolean
}

export async function getSucursalWhatsAppConfig(
  organizationId: string,
  sucursalId: string
): Promise<SucursalWhatsAppRow | null> {
  const { data } = await supabaseAdmin
    .from("sucursal_whatsapp_config")
    .select("evolution_instance_name, evolution_connection_state, activo")
    .eq("organization_id", organizationId)
    .eq("sucursal_id", sucursalId)
    .maybeSingle()
  return (data as SucursalWhatsAppRow | null) ?? null
}

export async function upsertSucursalWhatsAppState(
  organizationId: string,
  sucursalId: string,
  instanceName: string,
  state: string,
  opts?: { qr?: boolean }
): Promise<void> {
  await supabaseAdmin.from("sucursal_whatsapp_config").upsert(
    {
      organization_id: organizationId,
      sucursal_id: sucursalId,
      evolution_instance_name: instanceName,
      evolution_connection_state: state,
      activo: true,
      ...(opts?.qr ? { evolution_last_qr_at: new Date().toISOString() } : {}),
    },
    { onConflict: "sucursal_id" }
  )
}
```

- [ ] **Step 4: Correr el test**

Run: `npx vitest run lib/whatsapp/__tests__/sucursal-config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/whatsapp/sucursal-config.ts lib/whatsapp/__tests__/sucursal-config.test.ts
git commit -m "feat(whatsapp): helpers de config de whatsapp por sucursal"
```

---

### Task 9: Ruta `connect` por sucursal

**Files:**
- Create: `app/api/sucursales/[id]/whatsapp/connect/route.ts`

**Interfaces:**
- Consumes: `requireAdmin`, `hasPlanFeature`, `getPlatformEvolutionConfig`, `buildSucursalInstanceName` (Task 2), `createInstance`, `connectInstance` (evolution), `upsertSucursalWhatsAppState` (Task 8), `assertSucursalEnOrg` de `lib/sucursal.ts` (validar que la sucursal es de la org).
- Produces: `POST` → `{ state, qrBase64, pairingCode, error }`.

- [ ] **Step 1: Confirmar el helper de validación de sucursal**

Run: `rg -n "export function assert|export async function assert|EnOrg|getPrincipal" lib/sucursal.ts`
Expected: encontrar el nombre real del helper que valida que una sucursal pertenece a la org. Usar ese nombre exacto en el código (abajo se asume `assertSucursalEnOrg(organizationId, sucursalId)`; si el nombre difiere, ajustarlo).

- [ ] **Step 2: Implementar la ruta**

```typescript
// app/api/sucursales/[id]/whatsapp/connect/route.ts
import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { hasPlanFeature } from "@/lib/subscriptions"
import { getPlatformEvolutionConfig, buildSucursalInstanceName } from "@/lib/whatsapp/platform-config"
import { createInstance, connectInstance } from "@/lib/whatsapp/providers/evolution"
import { upsertSucursalWhatsAppState } from "@/lib/whatsapp/sucursal-config"
import { supabaseAdmin } from "@/lib/supabase"

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error
    const { id: sucursalId } = await params

    const hasFeature = await hasPlanFeature(organizationId!, "whatsapp_notifications")
    if (!hasFeature) {
      return NextResponse.json(
        { error: "Requiere plan Profesional", code: "FEATURE_REQUIRED", feature: "whatsapp_notifications" },
        { status: 403 }
      )
    }

    // La sucursal debe pertenecer a la org (evita IDOR).
    const { data: suc } = await supabaseAdmin
      .from("sucursales")
      .select("id")
      .eq("id", sucursalId)
      .eq("organization_id", organizationId!)
      .is("deleted_at", null)
      .maybeSingle()
    if (!suc) {
      return NextResponse.json({ error: "Sucursal no encontrada" }, { status: 404 })
    }

    const platform = getPlatformEvolutionConfig()
    if (!platform) {
      return NextResponse.json(
        { error: "WhatsApp no disponible (configuración de plataforma incompleta)", code: "PLATFORM_UNCONFIGURED" },
        { status: 503 }
      )
    }

    const instanceName = buildSucursalInstanceName(organizationId!, sucursalId)
    const creds = { baseUrl: platform.baseUrl, instanceName, apiKey: platform.apiKey }

    const created = await createInstance(creds)
    if (!created.success) {
      return NextResponse.json({ error: `No se pudo crear instancia: ${created.error}` }, { status: 502 })
    }

    const result = await connectInstance(creds)
    await upsertSucursalWhatsAppState(organizationId!, sucursalId, instanceName, result.state, {
      qr: !!result.qrBase64,
    })

    return NextResponse.json({
      state: result.state,
      qrBase64: result.qrBase64 || null,
      pairingCode: result.pairingCode || null,
      error: result.error || null,
    })
  } catch (err) {
    console.error("Error connect Evolution sucursal:", err)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `./node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: sin errores en el archivo nuevo.

- [ ] **Step 4: Commit**

```bash
git add app/api/sucursales/[id]/whatsapp/connect/route.ts
git commit -m "feat(whatsapp): ruta connect de whatsapp por sucursal"
```

---

### Task 10: Rutas `qr` (POST QR / GET poll) y `logout`

**Files:**
- Create: `app/api/sucursales/[id]/whatsapp/qr/route.ts`
- Create: `app/api/sucursales/[id]/whatsapp/logout/route.ts`

**Interfaces:**
- Consumes: igual que Task 9 + `getConnectionState`, `logoutInstance` (evolution).
- Produces: `qr` POST/GET → `{ state, qrBase64?, pairingCode?, error }` / `{ state, error }`; `logout` POST → `{ success, error }`.

- [ ] **Step 1: Implementar `qr/route.ts`**

```typescript
// app/api/sucursales/[id]/whatsapp/qr/route.ts
import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { hasPlanFeature } from "@/lib/subscriptions"
import { getPlatformEvolutionConfig, buildSucursalInstanceName } from "@/lib/whatsapp/platform-config"
import { connectInstance, getConnectionState } from "@/lib/whatsapp/providers/evolution"
import { upsertSucursalWhatsAppState } from "@/lib/whatsapp/sucursal-config"

async function guard(sucursalId: string) {
  const { error, organizationId } = await requireAdmin()
  if (error) return { error }
  const hasFeature = await hasPlanFeature(organizationId!, "whatsapp_notifications")
  if (!hasFeature) {
    return {
      error: NextResponse.json(
        { error: "Requiere plan Profesional", code: "FEATURE_REQUIRED", feature: "whatsapp_notifications" },
        { status: 403 }
      ),
    }
  }
  const { data: suc } = await supabaseAdmin
    .from("sucursales")
    .select("id")
    .eq("id", sucursalId)
    .eq("organization_id", organizationId!)
    .is("deleted_at", null)
    .maybeSingle()
  if (!suc) return { error: NextResponse.json({ error: "Sucursal no encontrada" }, { status: 404 }) }
  const platform = getPlatformEvolutionConfig()
  if (!platform) {
    return {
      error: NextResponse.json({ error: "WhatsApp no disponible (plataforma)", code: "PLATFORM_UNCONFIGURED" }, { status: 503 }),
    }
  }
  const instanceName = buildSucursalInstanceName(organizationId!, sucursalId)
  return { organizationId: organizationId!, creds: { baseUrl: platform.baseUrl, instanceName, apiKey: platform.apiKey }, instanceName }
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const g = await guard(id)
    if (g.error) return g.error
    const result = await connectInstance(g.creds!)
    await upsertSucursalWhatsAppState(g.organizationId!, id, g.instanceName!, result.state, { qr: !!result.qrBase64 })
    return NextResponse.json({
      state: result.state,
      qrBase64: result.qrBase64 || null,
      pairingCode: result.pairingCode || null,
      error: result.error || null,
    })
  } catch (err) {
    console.error("Error QR Evolution sucursal:", err)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const g = await guard(id)
    if (g.error) return g.error
    const state = await getConnectionState(g.creds!)
    await upsertSucursalWhatsAppState(g.organizationId!, id, g.instanceName!, state.state)
    return NextResponse.json({ state: state.state, error: state.error || null })
  } catch (err) {
    console.error("Error poll Evolution sucursal:", err)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
```

- [ ] **Step 2: Implementar `logout/route.ts`**

```typescript
// app/api/sucursales/[id]/whatsapp/logout/route.ts
import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { getPlatformEvolutionConfig, buildSucursalInstanceName } from "@/lib/whatsapp/platform-config"
import { logoutInstance } from "@/lib/whatsapp/providers/evolution"

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error
    const { id: sucursalId } = await params

    const { data: suc } = await supabaseAdmin
      .from("sucursales")
      .select("id")
      .eq("id", sucursalId)
      .eq("organization_id", organizationId!)
      .is("deleted_at", null)
      .maybeSingle()
    if (!suc) return NextResponse.json({ error: "Sucursal no encontrada" }, { status: 404 })

    const platform = getPlatformEvolutionConfig()
    if (!platform) {
      return NextResponse.json({ error: "WhatsApp no disponible (plataforma)", code: "PLATFORM_UNCONFIGURED" }, { status: 503 })
    }

    const result = await logoutInstance({
      baseUrl: platform.baseUrl,
      instanceName: buildSucursalInstanceName(organizationId!, sucursalId),
      apiKey: platform.apiKey,
    })

    await supabaseAdmin
      .from("sucursal_whatsapp_config")
      .update({ evolution_connection_state: "close" })
      .eq("organization_id", organizationId!)
      .eq("sucursal_id", sucursalId)

    return NextResponse.json({ success: result.success, error: result.error || null })
  } catch (err) {
    console.error("Error logout Evolution sucursal:", err)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `./node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: sin errores.

- [ ] **Step 4: Commit + PR #2**

```bash
git add app/api/sucursales/[id]/whatsapp/
git commit -m "feat(whatsapp): rutas qr y logout de whatsapp por sucursal"
```

Fresh review y abrir PR #2 (base: rama de PR #1 si se usa cadena, o `main`).

---

## SLICE 3 — UI (PR #3)

### Task 11: Card "Conectar WhatsApp" por sucursal

**Files:**
- Create: `components/configuracion/sucursal-whatsapp-card.tsx`

**Interfaces:**
- Consumes: rutas de Slice 2 (`/api/sucursales/{id}/whatsapp/connect|qr|logout`).
- Produces: componente `<SucursalWhatsAppCard sucursalId={string} />` que muestra estado (Conectado / Desconectado), botón Conectar (abre QR), poll de estado mientras conecta, y botón Desconectar.

- [ ] **Step 1: Implementar el componente**

```tsx
// components/configuracion/sucursal-whatsapp-card.tsx
"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Loader2, MessageCircle, RefreshCw } from "lucide-react"

type State = "open" | "connecting" | "close" | "qr" | "unknown"

export function SucursalWhatsAppCard({ sucursalId }: { sucursalId: string }) {
  const [state, setState] = useState<State>("unknown")
  const [qr, setQr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPoll = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }, [])

  const poll = useCallback(async () => {
    const res = await fetch(`/api/sucursales/${sucursalId}/whatsapp/qr`, { method: "GET" })
    if (!res.ok) return
    const d = await res.json()
    setState(d.state)
    if (d.state === "open") { setQr(null); stopPoll() }
  }, [sucursalId, stopPoll])

  const connect = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/sucursales/${sucursalId}/whatsapp/connect`, { method: "POST" })
      const d = await res.json()
      if (!res.ok) { setError(d.error || "Error al conectar"); return }
      setState(d.state)
      setQr(d.qrBase64 || null)
      if (d.state !== "open") {
        stopPoll()
        pollRef.current = setInterval(poll, 3000)
      }
    } finally {
      setLoading(false)
    }
  }, [sucursalId, poll, stopPoll])

  const logout = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      await fetch(`/api/sucursales/${sucursalId}/whatsapp/logout`, { method: "POST" })
      setState("close"); setQr(null); stopPoll()
    } finally {
      setLoading(false)
    }
  }, [sucursalId, stopPoll])

  useEffect(() => {
    // Estado inicial
    poll()
    return () => stopPoll()
  }, [poll, stopPoll])

  const connected = state === "open"

  return (
    <div className="rounded-lg border p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <MessageCircle className="h-4 w-4 text-green-600" /> WhatsApp de la sucursal
        </div>
        <Badge variant={connected ? "default" : "secondary"} className={connected ? "bg-green-600" : ""}>
          {connected ? "Conectado" : state === "connecting" || state === "qr" ? "Conectando…" : "Desconectado"}
        </Badge>
      </div>

      {qr && !connected && (
        <div className="flex flex-col items-center gap-2">
          <img src={qr} alt="QR de WhatsApp" className="w-48 h-48" />
          <p className="text-xs text-muted-foreground text-center">
            Escaneá este QR desde WhatsApp → Dispositivos vinculados, con el teléfono de la sucursal.
          </p>
          <Button variant="ghost" size="sm" onClick={poll}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Ya lo escaneé
          </Button>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        {connected ? (
          <Button variant="outline" size="sm" onClick={logout} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin mr-1" />} Desconectar
          </Button>
        ) : (
          <Button size="sm" onClick={connect} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin mr-1" />} Conectar WhatsApp
          </Button>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `./node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add components/configuracion/sucursal-whatsapp-card.tsx
git commit -m "feat(whatsapp): card de conexion de whatsapp por sucursal"
```

---

### Task 12: Montar la card en la página de sucursales

**Files:**
- Modify: `app/(dashboard)/configuracion/sucursales/page.tsx`

**Interfaces:**
- Consumes: `SucursalWhatsAppCard` (Task 11).
- Produces: cada sucursal activa en el listado muestra la card de WhatsApp (solo lectura de conexión; sin gating en cliente — el 403 del backend ya protege, y la UI puede ocultar si se desea).

- [ ] **Step 1: Importar el componente**

En `app/(dashboard)/configuracion/sucursales/page.tsx`, agregar al bloque de imports:

```typescript
import { SucursalWhatsAppCard } from "@/components/configuracion/sucursal-whatsapp-card"
```

- [ ] **Step 2: Renderizar la card por sucursal activa**

En `SucursalList`, dentro del `.map((s) => (...))`, envolver el `div` de cada item para incluir la card debajo cuando la sucursal está activa y no es la lista `muted`. Reemplazar el `return (<div key={s.id} ...>...</div>)` de cada item por:

```tsx
        <div key={s.id} className="space-y-2">
          <div
            className={`flex items-center justify-between p-3 rounded-lg border ${muted ? "opacity-60" : ""}`}
          >
            {/* ...contenido existente del item (Store, nombre, badges, acciones)... */}
          </div>
          {!muted && s.activo && <SucursalWhatsAppCard sucursalId={s.id} />}
        </div>
```

(Mantener intacto el contenido interno del item; solo se agrega el wrapper `div.space-y-2` y la card condicional.)

- [ ] **Step 3: Typecheck**

Run: `./node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: sin errores.

- [ ] **Step 4: Verificación manual (checklist para el revisor humano)**

Como no se puede probar Evolution en local sin servidor, verificar en el entorno con `EVOLUTION_*` seteado:
1. Ir a Configuración → Sucursales. Cada sucursal activa muestra la card "WhatsApp de la sucursal".
2. Click "Conectar WhatsApp" en una sucursal → aparece QR. Escanear con el teléfono de esa sucursal → estado pasa a "Conectado".
3. Cambiar una orden de esa sucursal de estado → el cliente recibe el WhatsApp desde el número de la sucursal.
4. Desconectar la sucursal y repetir → el mensaje sale desde el central.

- [ ] **Step 5: Commit + PR #3**

```bash
git add "app/(dashboard)/configuracion/sucursales/page.tsx"
git commit -m "feat(whatsapp): mostrar conexion de whatsapp por sucursal en configuracion"
```

Fresh review y abrir PR #3.

---

## Self-Review (cobertura vs spec)

- **Modelo Central + override** → Task 1 (tabla) + Task 3 (resolver con fallback) + Task 5 (`canSendViaApi` incluye sucursal aunque central falte). ✅
- **Solo QR/Evolution por sucursal** → Tasks 2, 9, 10 (instancia `stapp-org-{org}-suc-{suc}`, cliente Evolution). ✅
- **Solo salida automática** → no se toca webhook/inbound; solo el path de `send-direct`. ✅
- **Caída → central** → Task 3 (state≠open o inactivo → central) + tests. ✅
- **Sin flag de plan nuevo** → Tasks 9/10 reusan `hasPlanFeature("whatsapp_notifications")`. ✅
- **Cotizaciones fuera de alcance** → no se wirean triggers de cotización; caen a central por `sucursalId` undefined. ✅
- **IDs TEXT/cuid** → Task 1 usa TEXT. ✅

**Placeholders:** ninguno — todo el código está completo. Los dos `rg` en Task 6/9 son para confirmar nombres de variables/helpers reales antes de editar, con instrucción explícita de ajustar si difieren (no son huecos de diseño).

**Consistencia de tipos:** `ResolvedSender` (Task 3) se consume en Task 5; `buildSucursalInstanceName` (Task 2) en Tasks 4/9/10; `upsertSucursalWhatsAppState` (Task 8) en Tasks 9/10. Firmas coinciden.

## Notas de entrega

- **3 PRs encadenados** (backend → rutas → UI). Cada slice deja software testeable: Slice 1 ya rutea (con tests) aunque la UI no exista; sin la tabla 265 aplicada, el resolver cae a central (no rompe).
- **Aplicar migración 265** en Supabase antes de mergear Slice 1 a producción.
- **Riesgo de orden de columnas**: confirmar que `entregar/route.ts` selecciona `sucursal_id` (Task 6 Step 3).
