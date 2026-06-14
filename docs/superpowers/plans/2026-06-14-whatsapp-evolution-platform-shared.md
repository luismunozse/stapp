# WhatsApp Evolution — Servidor Compartido de Plataforma · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el tenant conecte WhatsApp con un solo botón (QR) contra el servidor Evolution compartido de plataforma, sin cargar URL/instancia/API key.

**Architecture:** `baseUrl` + `apiKey` de Evolution pasan a ser config de plataforma (env vars), leídas por un helper único. Cada org conserva solo un `instanceName` autogenerado (`stapp-org-{orgId}`) y vincula su propio número por QR. Al quedar `open`, el backend activa las notificaciones WhatsApp de la org. El plan Profesional sigue gateando.

**Tech Stack:** Next.js 16 App Router, TypeScript, Vitest + helpers en `__tests__/api/helpers.ts`, Tailwind.

**Strict TDD:** ENABLED. Test runner: `npm run test:run`. Test rojo → mínimo → verde → commit.

**Spec:** `docs/superpowers/specs/2026-06-14-whatsapp-evolution-platform-shared-design.md`

---

## File Structure

- `lib/whatsapp/platform-config.ts` — CREATE. Helper `getPlatformEvolutionConfig()` (lee env) + `buildInstanceName(orgId)`.
- `lib/whatsapp/providers/index.ts` — MODIFY. `getEvolutionCreds` toma baseUrl/apiKey del env, instance de la DB.
- `app/api/whatsapp/evolution/connect/route.ts` — CREATE. Conecta usando env + instance autogenerado.
- `app/api/whatsapp/evolution/qr/route.ts` — MODIFY. Lee env; al estado `open` activa notificaciones.
- `app/api/whatsapp/evolution/logout/route.ts` — MODIFY. Lee env; desconecta y apaga notificaciones.
- `app/api/whatsapp/config/route.ts` — MODIFY. Quita la rama Evolution del PUT (la reemplaza `connect`).
- `components/configuracion/whatsapp-setup.tsx` — MODIFY. UI de un solo flujo "Conectar WhatsApp".
- `.env.example` — MODIFY. Documentar `EVOLUTION_BASE_URL` y `EVOLUTION_API_KEY`.
- Tests: `__tests__/lib/whatsapp-platform-config.test.ts`, `__tests__/api/whatsapp-evolution-connect.test.ts`, `__tests__/api/whatsapp-evolution-qr.test.ts`, `__tests__/api/whatsapp-evolution-logout.test.ts`.

Convenciones de test (de `__tests__/api/*`): `auth()` está globalmente mockeado en `vitest.setup.ts`; `mockAuthSuccess({ organizationId })` controla la org; `mockSupabaseFrom({ tabla: createChainMock(data) })` mockea Supabase; `vi.mock("@/lib/subscriptions")` para `hasPlanFeature`; `vi.mock("@/lib/whatsapp/providers/evolution")` para el cliente. Env con `vi.stubEnv(...)`.

---

## Task 1: Helper de config de plataforma

**Files:**
- Create: `lib/whatsapp/platform-config.ts`
- Test: `__tests__/lib/whatsapp-platform-config.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Create `__tests__/lib/whatsapp-platform-config.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from "vitest"
import { getPlatformEvolutionConfig, buildInstanceName } from "@/lib/whatsapp/platform-config"

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("getPlatformEvolutionConfig", () => {
  it("returns baseUrl + apiKey from env (trimming trailing slash)", () => {
    vi.stubEnv("EVOLUTION_BASE_URL", "https://evo.stapp.com.ar/")
    vi.stubEnv("EVOLUTION_API_KEY", "secret-key")
    expect(getPlatformEvolutionConfig()).toEqual({
      baseUrl: "https://evo.stapp.com.ar",
      apiKey: "secret-key",
    })
  })

  it("returns null when baseUrl is missing", () => {
    vi.stubEnv("EVOLUTION_BASE_URL", "")
    vi.stubEnv("EVOLUTION_API_KEY", "secret-key")
    expect(getPlatformEvolutionConfig()).toBeNull()
  })

  it("returns null when apiKey is missing", () => {
    vi.stubEnv("EVOLUTION_BASE_URL", "https://evo.stapp.com.ar")
    vi.stubEnv("EVOLUTION_API_KEY", "")
    expect(getPlatformEvolutionConfig()).toBeNull()
  })
})

describe("buildInstanceName", () => {
  it("derives a stable per-org instance name", () => {
    expect(buildInstanceName("org-123")).toBe("stapp-org-org-123")
  })
})
```

- [ ] **Step 2: Correr para ver fallar**

Run: `npm run test:run -- __tests__/lib/whatsapp-platform-config.test.ts`
Expected: FAIL — módulo `@/lib/whatsapp/platform-config` no existe.

- [ ] **Step 3: Implementar**

Create `lib/whatsapp/platform-config.ts`:

```ts
/**
 * Configuración de plataforma del servidor Evolution compartido.
 * baseUrl + apiKey son infra de plataforma (env), NO por organización.
 * Cada org conserva solo su instanceName (ver buildInstanceName).
 */

export interface PlatformEvolutionConfig {
  baseUrl: string
  apiKey: string
}

export function getPlatformEvolutionConfig(): PlatformEvolutionConfig | null {
  const baseUrl = process.env.EVOLUTION_BASE_URL?.trim().replace(/\/+$/, "")
  const apiKey = process.env.EVOLUTION_API_KEY?.trim()
  if (!baseUrl || !apiKey) return null
  return { baseUrl, apiKey }
}

/**
 * Nombre de instancia estable y único por organización.
 * No editable por el tenant.
 */
export function buildInstanceName(organizationId: string): string {
  return `stapp-org-${organizationId}`
}
```

- [ ] **Step 4: Correr para ver pasar**

Run: `npm run test:run -- __tests__/lib/whatsapp-platform-config.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/whatsapp/platform-config.ts __tests__/lib/whatsapp-platform-config.test.ts
git commit -m "feat(whatsapp): helper de config de plataforma para Evolution compartido"
```

---

## Task 2: `getEvolutionCreds` usa env de plataforma

**Files:**
- Modify: `lib/whatsapp/providers/index.ts:43-56`
- Test: extender `__tests__/lib/whatsapp-platform-config.test.ts` (o nuevo `__tests__/lib/whatsapp-get-evolution-creds.test.ts`)

- [ ] **Step 1: Escribir el test que falla**

Create `__tests__/lib/whatsapp-get-evolution-creds.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from "vitest"
import { getEvolutionCreds } from "@/lib/whatsapp/providers"

afterEach(() => vi.unstubAllEnvs())

const baseConfig = {
  provider: "evolution" as const,
  is_configured: true,
  phone_number_id: null,
  access_token_encrypted: null,
  evolution_base_url: null,        // ya no se usa
  evolution_instance_name: "stapp-org-org-1",
  evolution_api_key_encrypted: null, // ya no se usa
}

describe("getEvolutionCreds (platform env)", () => {
  it("uses platform env for baseUrl/apiKey and DB instanceName", () => {
    vi.stubEnv("EVOLUTION_BASE_URL", "https://evo.stapp.com.ar")
    vi.stubEnv("EVOLUTION_API_KEY", "platform-key")
    expect(getEvolutionCreds(baseConfig)).toEqual({
      baseUrl: "https://evo.stapp.com.ar",
      instanceName: "stapp-org-org-1",
      apiKey: "platform-key",
    })
  })

  it("returns null when platform env is missing", () => {
    vi.stubEnv("EVOLUTION_BASE_URL", "")
    vi.stubEnv("EVOLUTION_API_KEY", "")
    expect(getEvolutionCreds(baseConfig)).toBeNull()
  })

  it("returns null when instanceName is missing", () => {
    vi.stubEnv("EVOLUTION_BASE_URL", "https://evo.stapp.com.ar")
    vi.stubEnv("EVOLUTION_API_KEY", "platform-key")
    expect(getEvolutionCreds({ ...baseConfig, evolution_instance_name: null })).toBeNull()
  })
})
```

- [ ] **Step 2: Correr para ver fallar**

Run: `npm run test:run -- __tests__/lib/whatsapp-get-evolution-creds.test.ts`
Expected: FAIL — `getEvolutionCreds` aún lee de la DB y devuelve null (faltan columnas) o creds incorrectas.

- [ ] **Step 3: Implementar**

In `lib/whatsapp/providers/index.ts`, agregar el import arriba (junto a los otros imports):

```ts
import { getPlatformEvolutionConfig } from "@/lib/whatsapp/platform-config"
```

Reemplazar la función `getEvolutionCreds` (líneas 43-56) por:

```ts
export function getEvolutionCreds(config: ConfigRow): EvolutionCredentials | null {
  const platform = getPlatformEvolutionConfig()
  if (!platform || !config.evolution_instance_name) {
    return null
  }
  return {
    baseUrl: platform.baseUrl,
    instanceName: config.evolution_instance_name,
    apiKey: platform.apiKey,
  }
}
```

- [ ] **Step 4: Correr para ver pasar**

Run: `npm run test:run -- __tests__/lib/whatsapp-get-evolution-creds.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/whatsapp/providers/index.ts __tests__/lib/whatsapp-get-evolution-creds.test.ts
git commit -m "feat(whatsapp): getEvolutionCreds resuelve baseUrl/apiKey desde env de plataforma"
```

---

## Task 3: Ruta `POST /api/whatsapp/evolution/connect`

**Files:**
- Create: `app/api/whatsapp/evolution/connect/route.ts`
- Test: `__tests__/api/whatsapp-evolution-connect.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Create `__tests__/api/whatsapp-evolution-connect.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, parseResponse } from "./helpers"

vi.mock("@/lib/subscriptions", () => ({ hasPlanFeature: vi.fn() }))
vi.mock("@/lib/whatsapp/providers/evolution", () => ({
  createInstance: vi.fn(),
  connectInstance: vi.fn(),
}))

import { hasPlanFeature } from "@/lib/subscriptions"
import { createInstance, connectInstance } from "@/lib/whatsapp/providers/evolution"
import { POST } from "@/app/api/whatsapp/evolution/connect/route"

describe("POST /api/whatsapp/evolution/connect", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("EVOLUTION_BASE_URL", "https://evo.stapp.com.ar")
    vi.stubEnv("EVOLUTION_API_KEY", "platform-key")
    mockSupabaseFrom({ whatsapp_config: createChainMock(null) })
    vi.mocked(hasPlanFeature).mockResolvedValue(true)
    vi.mocked(createInstance).mockResolvedValue({ success: true, alreadyExists: false } as any)
    vi.mocked(connectInstance).mockResolvedValue({ state: "connecting", qrBase64: "data:image/png;base64,AAA", pairingCode: "1234" } as any)
  })
  afterEach(() => vi.unstubAllEnvs())

  it("returns 403 without the plan feature", async () => {
    mockAuthSuccess({ organizationId: "org-1" })
    vi.mocked(hasPlanFeature).mockResolvedValue(false)
    const res = await POST()
    expect(res.status).toBe(403)
  })

  it("returns 503 when platform env is missing", async () => {
    mockAuthSuccess({ organizationId: "org-1" })
    vi.stubEnv("EVOLUTION_BASE_URL", "")
    const res = await POST()
    expect(res.status).toBe(503)
  })

  it("creates the instance with stapp-org-{id} and returns the QR", async () => {
    mockAuthSuccess({ organizationId: "org-1" })
    const res = await POST()
    const { status, body } = await parseResponse(res)
    expect(status).toBe(200)
    expect(body.qrBase64).toContain("base64")
    expect(body.state).toBe("connecting")
    const credsArg = vi.mocked(createInstance).mock.calls[0][0]
    expect(credsArg).toEqual({
      baseUrl: "https://evo.stapp.com.ar",
      instanceName: "stapp-org-org-1",
      apiKey: "platform-key",
    })
  })
})
```

- [ ] **Step 2: Correr para ver fallar**

Run: `npm run test:run -- __tests__/api/whatsapp-evolution-connect.test.ts`
Expected: FAIL — la ruta no existe.

- [ ] **Step 3: Implementar**

Create `app/api/whatsapp/evolution/connect/route.ts`:

```ts
import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { hasPlanFeature } from "@/lib/subscriptions"
import { getPlatformEvolutionConfig, buildInstanceName } from "@/lib/whatsapp/platform-config"
import { createInstance, connectInstance } from "@/lib/whatsapp/providers/evolution"

/**
 * Conecta WhatsApp de la org contra el servidor Evolution COMPARTIDO de plataforma.
 * Sin entrada del tenant: baseUrl/apiKey vienen del env, instanceName es autogenerado.
 * Crea la instancia (idempotente), pide el QR y persiste el estado.
 */
export async function POST() {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const hasFeature = await hasPlanFeature(organizationId!, "whatsapp_notifications")
    if (!hasFeature) {
      return NextResponse.json(
        { error: "Requiere plan Profesional", code: "FEATURE_REQUIRED", feature: "whatsapp_notifications" },
        { status: 403 }
      )
    }

    const platform = getPlatformEvolutionConfig()
    if (!platform) {
      return NextResponse.json(
        { error: "WhatsApp no disponible (configuración de plataforma incompleta)", code: "PLATFORM_UNCONFIGURED" },
        { status: 503 }
      )
    }

    const instanceName = buildInstanceName(organizationId!)
    const creds = { baseUrl: platform.baseUrl, instanceName, apiKey: platform.apiKey }

    const created = await createInstance(creds)
    if (!created.success) {
      return NextResponse.json({ error: `No se pudo crear instancia: ${created.error}` }, { status: 502 })
    }

    const result = await connectInstance(creds)

    await supabaseAdmin
      .from("whatsapp_config")
      .upsert(
        {
          organization_id: organizationId!,
          provider: "evolution",
          evolution_instance_name: instanceName,
          evolution_connection_state: result.state,
          evolution_last_qr_at: result.qrBase64 ? new Date().toISOString() : undefined,
          is_configured: true,
          is_verified: result.state === "open",
        },
        { onConflict: "organization_id" }
      )

    return NextResponse.json({
      state: result.state,
      qrBase64: result.qrBase64 || null,
      pairingCode: result.pairingCode || null,
      error: result.error || null,
    })
  } catch (err) {
    console.error("Error connect Evolution:", err)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
```

- [ ] **Step 4: Correr para ver pasar**

Run: `npm run test:run -- __tests__/api/whatsapp-evolution-connect.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/whatsapp/evolution/connect/route.ts __tests__/api/whatsapp-evolution-connect.test.ts
git commit -m "feat(whatsapp): ruta connect usa Evolution compartido + instance autogenerado"
```

---

## Task 4: `qr` route lee env + activa notificaciones al quedar `open`

**Files:**
- Modify: `app/api/whatsapp/evolution/qr/route.ts`
- Test: `__tests__/api/whatsapp-evolution-qr.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Create `__tests__/api/whatsapp-evolution-qr.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, parseResponse } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

vi.mock("@/lib/whatsapp/providers/evolution", () => ({ getConnectionState: vi.fn() }))
import { getConnectionState } from "@/lib/whatsapp/providers/evolution"
import { GET } from "@/app/api/whatsapp/evolution/qr/route"

describe("GET /api/whatsapp/evolution/qr (poll)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("EVOLUTION_BASE_URL", "https://evo.stapp.com.ar")
    vi.stubEnv("EVOLUTION_API_KEY", "platform-key")
    mockSupabaseFrom({
      whatsapp_config: createChainMock({ provider: "evolution", evolution_instance_name: "stapp-org-org-1" }),
      organizations: createChainMock(null),
    })
  })
  afterEach(() => vi.unstubAllEnvs())

  it("enables notificaciones_whatsapp when state becomes open", async () => {
    mockAuthSuccess({ organizationId: "org-1" })
    vi.mocked(getConnectionState).mockResolvedValue({ state: "open" } as any)
    const res = await GET()
    const { status, body } = await parseResponse(res)
    expect(status).toBe(200)
    expect(body.state).toBe("open")
    // se actualizó organizations con el flag en true
    const orgUpdate = vi.mocked(supabaseAdmin.from).mock.calls.some(
      (c) => c[0] === "organizations"
    )
    expect(orgUpdate).toBe(true)
  })

  it("does NOT enable notifications when state is not open", async () => {
    mockAuthSuccess({ organizationId: "org-1" })
    vi.mocked(getConnectionState).mockResolvedValue({ state: "connecting" } as any)
    const res = await GET()
    expect(res.status).toBe(200)
    const orgUpdate = vi.mocked(supabaseAdmin.from).mock.calls.some(
      (c) => c[0] === "organizations"
    )
    expect(orgUpdate).toBe(false)
  })
})
```

- [ ] **Step 2: Correr para ver fallar**

Run: `npm run test:run -- __tests__/api/whatsapp-evolution-qr.test.ts`
Expected: FAIL — la ruta aún lee creds de la DB y no toca `organizations`.

- [ ] **Step 3: Implementar**

Reemplazar el contenido completo de `app/api/whatsapp/evolution/qr/route.ts` por:

```ts
import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { hasPlanFeature } from "@/lib/subscriptions"
import { getPlatformEvolutionConfig, buildInstanceName } from "@/lib/whatsapp/platform-config"
import { connectInstance, getConnectionState } from "@/lib/whatsapp/providers/evolution"

async function resolveCreds(organizationId: string) {
  const platform = getPlatformEvolutionConfig()
  if (!platform) return null
  return { baseUrl: platform.baseUrl, instanceName: buildInstanceName(organizationId), apiKey: platform.apiKey }
}

async function persistState(organizationId: string, state: string, qr?: boolean) {
  await supabaseAdmin
    .from("whatsapp_config")
    .update({
      evolution_connection_state: state,
      ...(qr ? { evolution_last_qr_at: new Date().toISOString() } : {}),
      is_verified: state === "open",
    })
    .eq("organization_id", organizationId)

  // Conectar = activar: al quedar open, asegurar notificaciones WhatsApp en true.
  if (state === "open") {
    await supabaseAdmin
      .from("organizations")
      .update({ notificaciones_whatsapp: true })
      .eq("id", organizationId)
  }
}

/** POST: pide QR / pairing code. */
export async function POST() {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const hasFeature = await hasPlanFeature(organizationId!, "whatsapp_notifications")
    if (!hasFeature) {
      return NextResponse.json(
        { error: "Requiere plan Profesional", code: "FEATURE_REQUIRED", feature: "whatsapp_notifications" },
        { status: 403 }
      )
    }

    const creds = await resolveCreds(organizationId!)
    if (!creds) {
      return NextResponse.json({ error: "WhatsApp no disponible (plataforma)", code: "PLATFORM_UNCONFIGURED" }, { status: 503 })
    }

    const result = await connectInstance(creds)
    await persistState(organizationId!, result.state, !!result.qrBase64)

    return NextResponse.json({
      state: result.state,
      qrBase64: result.qrBase64 || null,
      pairingCode: result.pairingCode || null,
      error: result.error || null,
    })
  } catch (err) {
    console.error("Error fetching Evolution QR:", err)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}

/** GET: poll de estado. Activa notificaciones al quedar open. */
export async function GET() {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const creds = await resolveCreds(organizationId!)
    if (!creds) {
      return NextResponse.json({ error: "WhatsApp no disponible (plataforma)", code: "PLATFORM_UNCONFIGURED" }, { status: 503 })
    }

    const state = await getConnectionState(creds)
    await persistState(organizationId!, state.state)

    return NextResponse.json({ state: state.state, error: state.error || null })
  } catch (err) {
    console.error("Error polling Evolution state:", err)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
```

- [ ] **Step 4: Correr para ver pasar**

Run: `npm run test:run -- __tests__/api/whatsapp-evolution-qr.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/whatsapp/evolution/qr/route.ts __tests__/api/whatsapp-evolution-qr.test.ts
git commit -m "feat(whatsapp): qr route usa env de plataforma y activa notificaciones al conectar"
```

---

## Task 5: `logout` route lee env + apaga notificaciones

**Files:**
- Modify: `app/api/whatsapp/evolution/logout/route.ts`
- Test: `__tests__/api/whatsapp-evolution-logout.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Create `__tests__/api/whatsapp-evolution-logout.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

vi.mock("@/lib/whatsapp/providers/evolution", () => ({ logoutInstance: vi.fn() }))
import { logoutInstance } from "@/lib/whatsapp/providers/evolution"
import { POST } from "@/app/api/whatsapp/evolution/logout/route"

describe("POST /api/whatsapp/evolution/logout", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("EVOLUTION_BASE_URL", "https://evo.stapp.com.ar")
    vi.stubEnv("EVOLUTION_API_KEY", "platform-key")
    mockSupabaseFrom({
      whatsapp_config: createChainMock(null),
      organizations: createChainMock(null),
    })
    vi.mocked(logoutInstance).mockResolvedValue({ success: true } as any)
  })
  afterEach(() => vi.unstubAllEnvs())

  it("disconnects and turns notificaciones_whatsapp off", async () => {
    mockAuthSuccess({ organizationId: "org-1" })
    const res = await POST()
    expect(res.status).toBe(200)
    const orgUpdate = vi.mocked(supabaseAdmin.from).mock.calls.some((c) => c[0] === "organizations")
    expect(orgUpdate).toBe(true)
    const credsArg = vi.mocked(logoutInstance).mock.calls[0][0]
    expect(credsArg.instanceName).toBe("stapp-org-org-1")
    expect(credsArg.baseUrl).toBe("https://evo.stapp.com.ar")
  })
})
```

- [ ] **Step 2: Correr para ver fallar**

Run: `npm run test:run -- __tests__/api/whatsapp-evolution-logout.test.ts`
Expected: FAIL — la ruta lee creds de la DB y no toca `organizations`.

- [ ] **Step 3: Implementar**

Reemplazar el contenido completo de `app/api/whatsapp/evolution/logout/route.ts` por:

```ts
import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { getPlatformEvolutionConfig, buildInstanceName } from "@/lib/whatsapp/platform-config"
import { logoutInstance } from "@/lib/whatsapp/providers/evolution"

export async function POST() {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const platform = getPlatformEvolutionConfig()
    if (!platform) {
      return NextResponse.json({ error: "WhatsApp no disponible (plataforma)", code: "PLATFORM_UNCONFIGURED" }, { status: 503 })
    }

    const result = await logoutInstance({
      baseUrl: platform.baseUrl,
      instanceName: buildInstanceName(organizationId!),
      apiKey: platform.apiKey,
    })

    await supabaseAdmin
      .from("whatsapp_config")
      .update({ evolution_connection_state: "close", is_verified: false })
      .eq("organization_id", organizationId!)

    // Desconectar = desactivar (simétrico con conectar = activar).
    await supabaseAdmin
      .from("organizations")
      .update({ notificaciones_whatsapp: false })
      .eq("id", organizationId!)

    return NextResponse.json({ success: result.success, error: result.error || null })
  } catch (err) {
    console.error("Error logout Evolution:", err)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
```

- [ ] **Step 4: Correr para ver pasar**

Run: `npm run test:run -- __tests__/api/whatsapp-evolution-logout.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add app/api/whatsapp/evolution/logout/route.ts __tests__/api/whatsapp-evolution-logout.test.ts
git commit -m "feat(whatsapp): logout route usa env de plataforma y apaga notificaciones"
```

---

## Task 6: Quitar la rama Evolution del `PUT /api/whatsapp/config`

**Files:**
- Modify: `app/api/whatsapp/config/route.ts:113-173`

La rama Evolution del PUT (que pedía baseUrl/instanceName/apiKey) queda obsoleta: la reemplaza `connect`. Se mantiene la rama Meta intacta.

- [ ] **Step 1: Reemplazar la rama Evolution por un 410**

En `app/api/whatsapp/config/route.ts`, ubicar el bloque que arranca con `// Evolution` (línea ~113) y va hasta el cierre del manejo de Evolution (antes del `} catch`). Reemplazar TODO ese bloque Evolution por:

```ts
    // Evolution: el alta se hace ahora vía POST /api/whatsapp/evolution/connect
    // (servidor compartido de plataforma, sin credenciales por org).
    if (provider === "evolution") {
      return NextResponse.json(
        { error: "Usá Conectar WhatsApp (Evolution compartido). Esta ruta quedó obsoleta para Evolution.", code: "USE_CONNECT" },
        { status: 410 }
      )
    }
```

> `provider` ya se determina arriba en la función (línea ~73). Si la rama Meta usa un `if (provider === "meta")`, dejá ese bloque tal cual y poné este `if (provider === "evolution")` en su lugar; eliminá las referencias a `createInstance`/`getConnectionState`/`encrypt` que quedaran sin uso SOLO si no las usa la rama Meta (Meta usa `encrypt` para el token — NO borres ese import).

- [ ] **Step 2: Typecheck + tests de regresión de la ruta**

Run: `npx tsc --noEmit`
Expected: sin errores (si quedó un import sin uso de `createInstance`/`getConnectionState`, quitarlo).

Run: `npm run test:run -- __tests__/api/whatsapp`
Expected: PASS — las rutas nuevas verdes; ninguna rompe.

- [ ] **Step 3: Commit**

```bash
git add app/api/whatsapp/config/route.ts
git commit -m "refactor(whatsapp): PUT config deja de aceptar Evolution (reemplazado por connect)"
```

---

## Task 7: UI — un solo flujo "Conectar WhatsApp"

**Files:**
- Modify: `components/configuracion/whatsapp-setup.tsx`

Sin unit test (interacción/visual). Verificar por `npm run build` + smoke manual.

- [ ] **Step 1: Reescribir el componente al flujo único**

Reemplazar el contenido de `components/configuracion/whatsapp-setup.tsx` por un componente que:

1. Al montar, hace `GET /api/whatsapp/config` para saber si ya está conectado (`isVerified` / `connectionState === "open"`).
2. Estado **desconectado**: muestra botón **"Conectar WhatsApp"** → `POST /api/whatsapp/evolution/connect` → guarda `qrBase64` + `pairingCode` en estado y los muestra → arranca polling `GET /api/whatsapp/evolution/qr` cada 3s hasta `state === "open"` (o timeout 90s) → al quedar open, muestra "Conectado ✅".
3. Estado **conectado**: muestra "WhatsApp conectado ✅ — los mensajes salen del número vinculado" + botón **"Desconectar"** → `POST /api/whatsapp/evolution/logout` → vuelve a estado desconectado.
4. NO muestra provider, URL ni API key. Copy en español neutro.

Código del componente:

```tsx
"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Loader2, MessageCircle, CheckCircle2, RefreshCw } from "lucide-react"

type Status = "loading" | "disconnected" | "pairing" | "connected"

export function WhatsAppSetup() {
  const [status, setStatus] = useState<Status>("loading")
  const [qr, setQr] = useState<string | null>(null)
  const [pairingCode, setPairingCode] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/whatsapp/config")
      const data = await res.json().catch(() => ({}))
      if (data?.isVerified || data?.connectionState === "open") {
        setStatus("connected")
      } else {
        setStatus("disconnected")
      }
    } catch {
      setStatus("disconnected")
    }
  }, [])

  useEffect(() => {
    refreshStatus()
    return () => stopPolling()
  }, [refreshStatus, stopPolling])

  const startPolling = useCallback(() => {
    stopPolling()
    const started = Date.now()
    pollRef.current = setInterval(async () => {
      if (Date.now() - started > 90_000) {
        stopPolling()
        setError("Tiempo agotado. Probá de nuevo.")
        setStatus("disconnected")
        return
      }
      try {
        const res = await fetch("/api/whatsapp/evolution/qr")
        const data = await res.json().catch(() => ({}))
        if (data?.state === "open") {
          stopPolling()
          setQr(null)
          setPairingCode(null)
          setStatus("connected")
        }
      } catch {
        /* sigue intentando */
      }
    }, 3000)
  }, [stopPolling])

  const handleConnect = async () => {
    setError(null)
    setStatus("pairing")
    try {
      const res = await fetch("/api/whatsapp/evolution/connect", { method: "POST" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error || "No se pudo iniciar la conexión")
        setStatus("disconnected")
        return
      }
      setQr(data.qrBase64 || null)
      setPairingCode(data.pairingCode || null)
      if (data.state === "open") {
        setStatus("connected")
        return
      }
      startPolling()
    } catch {
      setError("Error de red al conectar")
      setStatus("disconnected")
    }
  }

  const handleDisconnect = async () => {
    setError(null)
    try {
      await fetch("/api/whatsapp/evolution/logout", { method: "POST" })
    } finally {
      setQr(null)
      setPairingCode(null)
      setStatus("disconnected")
    }
  }

  return (
    <div className="rounded-lg border bg-card p-6 max-w-lg">
      <div className="flex items-center gap-2 mb-1">
        <MessageCircle className="h-5 w-5 text-green-600" />
        <h2 className="text-base font-semibold">WhatsApp</h2>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        Conectá el WhatsApp de tu taller para que los cambios de estado de las órdenes
        se notifiquen automáticamente a tus clientes. Usá un número dedicado.
      </p>

      {status === "loading" && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Verificando estado…
        </div>
      )}

      {status === "connected" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-green-600">
            <CheckCircle2 className="h-4 w-4" /> WhatsApp conectado — los mensajes salen del número vinculado.
          </div>
          <Button variant="outline" size="sm" onClick={handleDisconnect}>
            Desconectar
          </Button>
        </div>
      )}

      {status === "disconnected" && (
        <Button onClick={handleConnect}>
          <MessageCircle className="h-4 w-4 mr-2" /> Conectar WhatsApp
        </Button>
      )}

      {status === "pairing" && (
        <div className="space-y-3">
          <p className="text-sm">
            Abrí WhatsApp en el teléfono del taller → <strong>Dispositivos vinculados → Vincular un dispositivo</strong> y escaneá:
          </p>
          {qr ? (
            <img src={qr} alt="QR de WhatsApp" className="h-56 w-56 border rounded" />
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Generando QR…
            </div>
          )}
          {pairingCode && (
            <p className="text-sm">
              O ingresá este código en el teléfono: <strong className="tracking-widest">{pairingCode}</strong>
            </p>
          )}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <RefreshCw className="h-3 w-3 animate-spin" /> Esperando vinculación…
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-500 mt-3">{error}</p>}
    </div>
  )
}
```

> Si el componente se exportaba con otro nombre o como `default`, mantené la firma de export que ya consumía la página (`app/(dashboard)/configuracion/whatsapp/page.tsx` u similar). Verificá el import existente antes de cambiar el nombre del export.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: compila sin errores de tipo en `whatsapp-setup.tsx`.

- [ ] **Step 3: Commit**

```bash
git add components/configuracion/whatsapp-setup.tsx
git commit -m "feat(whatsapp): UI de un solo flujo Conectar WhatsApp (sin provider ni credenciales)"
```

---

## Task 8: Documentar env vars

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Agregar las variables**

Append a `.env.example`:

```bash
# WhatsApp — Servidor Evolution compartido de plataforma (self-hosted)
# baseUrl + apiKey son globales; cada org genera su instancia stapp-org-{id}.
EVOLUTION_BASE_URL=https://evo.stapp.com.ar
EVOLUTION_API_KEY=
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs(env): documenta EVOLUTION_BASE_URL y EVOLUTION_API_KEY de plataforma"
```

- [ ] **Step 3: (Manual, fuera del repo) Setear en Vercel**

En Vercel → Project → Settings → Environment Variables, agregar para Production:
- `EVOLUTION_BASE_URL = https://evo.stapp.com.ar`
- `EVOLUTION_API_KEY = 544d6cbbbaccd0e0217ea35e348123e161d981fdd928e48dad58059c4cea2439`

Redeploy para que tome las variables.

---

## Task 9: Verificación final

- [ ] **Step 1: Suite completa**

Run: `npm run test:run`
Expected: todo verde, sin regresiones (atención a tests que tocaran las rutas whatsapp viejas).

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: limpio.

- [ ] **Step 3: Smoke en producción (post-deploy + env en Vercel)**

1. Config → WhatsApp → "Conectar WhatsApp" → escanear QR con el número del taller.
2. Verificar estado "Conectado ✅".
3. Confirmar en DB: `organizations.notificaciones_whatsapp = true` para la org.
4. Cambiar estado de una orden de prueba → llega el WhatsApp.
5. "Desconectar" → `notificaciones_whatsapp = false`, instancia en `close`.

- [ ] **Step 4: PR**

Rama lista para review en contexto fresco (regla PR) antes del merge. Incluir nota: requiere setear las 2 env vars en Vercel ANTES del deploy para que el flujo funcione.

---

## Self-Review Notes

- **Cobertura del spec:** config plataforma → T1; getEvolutionCreds env → T2; connect zero-config → T3; auto-enable on open → T4; auto-disable on logout → T5; quitar Evolution del PUT → T6; UI un-solo-flujo → T7; env docs → T8. Meta intacto (no se toca el send path ni la rama Meta del PUT). Fuera de alcance (orden-creada, recordatorio WA, opt-out) explícitamente excluidos.
- **Consistencia de tipos:** `buildInstanceName(orgId) → "stapp-org-{orgId}"` usado igual en T1/T2/T3/T4/T5. `getPlatformEvolutionConfig(): {baseUrl, apiKey} | null` consumido en T2/T3/T4/T5. Columna real `organizations.notificaciones_whatsapp` (DEFAULT TRUE) en T4/T5.
- **Sin placeholders:** todo el código está completo en cada step.
- **Riesgo conocido:** orgs que ya usaban Evolution con server propio re-parean contra el compartido (marginal). Meta orgs no se afectan.
