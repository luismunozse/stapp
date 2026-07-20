# Panel AI Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an AI assistant (floating widget) inside the authenticated panel that answers "how do I use STApp" questions from the help manual, gated to Profesional plan with ACTIVE status, with hard cost controls.

**Architecture:** Extract the manual's hardcoded content from `app/ayuda/manual/page.tsx` into a shared pure-data module. A static system prompt rendered from that data is sent to Claude Haiku 4.5 with prompt caching. A new authenticated API route enforces plan gating, rate limits, and a per-org daily cap counted in DB. A floating widget in the dashboard layout provides the chat UI.

**Tech Stack:** Next.js App Router, TypeScript, Supabase (supabaseAdmin + SQL migration), `@anthropic-ai/sdk` (already installed), vitest, shadcn-style components in `components/ui`.

**Spec:** `docs/superpowers/specs/2026-07-20-asistente-panel-design.md`

## Global Constraints

- Model: `claude-haiku-4-5`, `max_tokens: 1024`. API key env var: `STAPP_CHATBOT_API_KEY` (already configured — same key the landing bot uses).
- System prompt must be **fully static** — no interpolated prices, dates, org names, or any per-request value (prompt caching is a byte-exact prefix match).
- Limits: message ≤ 1,000 chars; history = last 6 turns; 10 msg/min per user; 50 USER msg/day per org (DB count, org-timezone day via `todayInTimeZone`/`dayRangeUtc`).
- Plan gate: `getSubscriptionInfo().status === "ACTIVE"` AND `hasPlanFeature(orgId, "asistente_ia")`. TRIALING must NOT pass.
- UI copy: Spanish with voseo, consistent with existing panel copy (e.g. landing chatbot components).
- Conventional commits, no AI attribution lines.
- Branch: `feat/asistente-panel` created from `main` (NOT from the current fix branch). Commit the spec + this plan as the first commit on that branch.
- Delivery: **2 PRs**. PR #1 = Task 1 only (mechanical extraction refactor, zero behavior change). PR #2 = Tasks 2–7 (feature). Keeps review diffs focused.
- Migration number: `274` (273 is taken by the in-flight debt fix). If 274 exists by execution time, use the next free number and update references.

---

### Task 0: Branch setup

**Files:** none (git only)

- [ ] **Step 1: Create the feature branch from main**

```bash
git -C C:/Users/LUIS/Desktop/stapp checkout main
git -C C:/Users/LUIS/Desktop/stapp pull
git -C C:/Users/LUIS/Desktop/stapp checkout -b feat/asistente-panel
```

Note: `docs/superpowers/specs/2026-07-20-asistente-panel-design.md` and `docs/superpowers/plans/2026-07-20-asistente-panel.md` are untracked files written before branching; they carry over to the new branch automatically.

- [ ] **Step 2: Commit spec and plan**

```bash
git add docs/superpowers/specs/2026-07-20-asistente-panel-design.md docs/superpowers/plans/2026-07-20-asistente-panel.md
git commit -m "docs(asistente): spec y plan del asistente IA del panel"
```

---

### Task 1: Extract manual content to `lib/manual-content.ts` (PR #1)

**Files:**
- Create: `lib/manual-content.ts`
- Modify: `app/ayuda/manual/page.tsx` (lines 38–950: types + sections array move out; icon map stays)
- Test: `lib/__tests__/manual-content.test.ts`

**Interfaces:**
- Produces: `export type Role = "ADMIN" | "TECNICO" | "VENDEDOR"`; `export interface ContentBlock { subtitle: string; body: string; steps?: string[]; tip?: string; roles?: Role[]; seeAlso?: string[] }`; `export interface ManualSection { id: string; title: string; roles: Role[]; content: ContentBlock[] }`; `export const manualSections: ManualSection[]`. **No `icon` field** — icons are React components and stay in the page.

- [ ] **Step 1: Write the failing test**

`lib/__tests__/manual-content.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { manualSections } from '@/lib/manual-content'

describe('manualSections', () => {
  it('tiene todas las secciones del manual con ids únicos', () => {
    expect(manualSections.length).toBeGreaterThanOrEqual(20)
    const ids = manualSections.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('cada sección tiene título, roles y contenido no vacío', () => {
    for (const s of manualSections) {
      expect(s.title.length).toBeGreaterThan(0)
      expect(s.roles.length).toBeGreaterThan(0)
      expect(s.content.length).toBeGreaterThan(0)
      for (const block of s.content) {
        expect(block.subtitle.length).toBeGreaterThan(0)
        expect(block.body.length).toBeGreaterThan(0)
      }
    }
  })

  it('es data pura serializable (sin componentes React)', () => {
    expect(() => JSON.stringify(manualSections)).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/__tests__/manual-content.test.ts`
Expected: FAIL — `Cannot find module '@/lib/manual-content'`

- [ ] **Step 3: Create `lib/manual-content.ts` by moving the data**

Mechanical move from `app/ayuda/manual/page.tsx`:

1. Create `lib/manual-content.ts` with this header (no `"use client"`, no React imports):

```ts
// Contenido del manual de ayuda de STApp.
// Única fuente de verdad: lo consumen la página /ayuda/manual y el
// system prompt del asistente del panel (lib/asistente/system-prompt.ts).
// Mantener como data pura serializable — sin componentes React.

export type Role = "ADMIN" | "TECNICO" | "VENDEDOR"

export interface ContentBlock {
  subtitle: string
  body: string
  steps?: string[]
  tip?: string
  roles?: Role[]
  seeAlso?: string[]
}

export interface ManualSection {
  id: string
  title: string
  roles: Role[]
  content: ContentBlock[]
}

export const manualSections: ManualSection[] = [
  // ← move the entire `sections` array body here (page.tsx lines 67–950),
  //    deleting every `icon: <Component>,` property line
]
```

2. Move the array body verbatim from `page.tsx` lines 67–950 into `manualSections`, removing each `icon: X,` line (one per section — 24 in total).

- [ ] **Step 4: Update `app/ayuda/manual/page.tsx`**

1. Delete the local `Role`, `ManualSection`, `ContentBlock` type definitions and the `sections` array (lines ~38–950).
2. Add import and a local icon map + merged view (the page keeps rendering `section.icon` unchanged):

```tsx
import { manualSections, type Role, type ManualSection as ManualSectionData } from "@/lib/manual-content"

interface ManualSection extends ManualSectionData {
  icon: React.ElementType
}

const sectionIcons: Record<string, React.ElementType> = {
  "primeros-pasos": BookOpen,
  dashboard: LayoutDashboard,
  ordenes: ClipboardList,
  clientes: Users,
  tecnicos: Wrench,
  vendedores: Store,
  inventario: Package,
  ventas: ShoppingCart,
  pos: Monitor,
  cotizaciones: FileText,
  facturacion: Receipt,
  caja: Calculator,
  proveedores: Truck,
  garantias: Shield,
  reportes: BarChart3,
  emails: Mail,
  leads: Bot,
  soporte: Headset,
  configuracion: Settings,
  "app-movil": Smartphone,
  seguridad: Shield,
  glosario: BookMarked,
  suscripcion: CreditCard,
}

const sections: ManualSection[] = manualSections.map((s) => ({
  ...s,
  icon: sectionIcons[s.id] ?? BookOpen,
}))
```

> Execution note: the `sectionIcons` values above must be reconciled against the icons each section actually had before the move — read the original `icon:` lines while deleting them and mirror them here exactly (the list above covers the 24 ids found; fix any mismatch against the real file, including any id not listed). Remove now-unused lucide imports if any; keep the ones the map uses.

3. `const sectionsById = new Map(sections.map((s) => [s.id, s]))` (line ~952) stays as is.

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run lib/__tests__/manual-content.test.ts` — Expected: PASS (3 tests)
Run: `npx tsc --noEmit` — Expected: no new errors
Run: `npm run build` NOT required here; `npx next lint --file app/ayuda/manual/page.tsx` optional.

- [ ] **Step 6: Manual visual check**

Run: `npm run dev`, open `http://localhost:3000/ayuda/manual` (or the tenant-subdomain equivalent), verify sections render with icons exactly as before.

- [ ] **Step 7: Commit and open PR #1**

```bash
git add lib/manual-content.ts lib/__tests__/manual-content.test.ts app/ayuda/manual/page.tsx
git commit -m "refactor(ayuda): extraer contenido del manual a lib/manual-content"
```

Open PR #1 (`refactor(ayuda): extraer contenido del manual a lib/manual-content`) targeting `main`. Body: mechanical extraction, zero behavior change, prepares shared knowledge base for the panel assistant.

---

### Task 2: System prompt renderer (PR #2 starts here)

**Files:**
- Create: `lib/asistente/system-prompt.ts`
- Test: `lib/__tests__/asistente-system-prompt.test.ts`

**Interfaces:**
- Consumes: `manualSections` from `@/lib/manual-content` (Task 1).
- Produces: `export function buildAsistenteSystemPrompt(): string` — deterministic, fully static output.

- [ ] **Step 1: Write the failing test**

`lib/__tests__/asistente-system-prompt.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildAsistenteSystemPrompt } from '@/lib/asistente/system-prompt'
import { manualSections } from '@/lib/manual-content'

describe('buildAsistenteSystemPrompt', () => {
  it('es determinístico (mismo output byte a byte — requisito de prompt caching)', () => {
    expect(buildAsistenteSystemPrompt()).toBe(buildAsistenteSystemPrompt())
  })

  it('incluye todas las secciones del manual', () => {
    const prompt = buildAsistenteSystemPrompt()
    for (const s of manualSections) {
      expect(prompt).toContain(`## ${s.title}`)
    }
  })

  it('supera el mínimo cacheable de Haiku 4.5 (~4096 tokens ≈ 16k chars)', () => {
    expect(buildAsistenteSystemPrompt().length).toBeGreaterThan(20000)
  })

  it('no contiene valores dinámicos', () => {
    const prompt = buildAsistenteSystemPrompt()
    const year = new Date().getFullYear().toString()
    expect(prompt).not.toContain(year)
    expect(prompt).not.toMatch(/\$\s?\d/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/__tests__/asistente-system-prompt.test.ts`
Expected: FAIL — `Cannot find module '@/lib/asistente/system-prompt'`

- [ ] **Step 3: Implement**

`lib/asistente/system-prompt.ts`:

```ts
import { manualSections, type ContentBlock, type ManualSection } from "@/lib/manual-content"

// IMPORTANTE: este prompt debe ser 100% estático (sin fechas, precios ni
// valores por request). El caching de Anthropic es un prefix match byte a
// byte: cualquier valor dinámico invalida la caché y multiplica el costo.

const INSTRUCCIONES = `Sos el asistente de ayuda de STApp dentro del panel. Tu única función es ayudar a los usuarios (dueños de talleres, técnicos y vendedores) a aprender a usar STApp, basándote EXCLUSIVAMENTE en el manual que tenés a continuación.

Reglas:
- Respondé en español argentino informal pero profesional (vos, "querés", "tenés").
- Sé conciso: máximo 2-3 párrafos o una lista de pasos.
- Si la respuesta está en el manual, explicala con los pasos concretos y mencioná en qué sección del panel se hace.
- Si el manual indica que algo es solo para un rol (ADMIN, TECNICO, VENDEDOR), aclaralo.
- Si te preguntan algo sobre STApp que NO está en el manual, decí honestamente que no tenés ese detalle y sugerí abrir un ticket desde la sección Soporte. NUNCA inventes funcionalidades.
- Si te preguntan cualquier cosa que no sea sobre el uso de STApp (código, otros temas, datos del negocio, cuánto vendió el taller, etc.), respondé amablemente que solo podés ayudar con el uso de STApp. No tenés acceso a los datos del taller.
- No des información de precios ni condiciones comerciales; para eso indicá la sección Configuración → Billing.

# Manual de STApp`

function renderBlock(block: ContentBlock): string {
  const parts: string[] = [`### ${block.subtitle}`, block.body]
  if (block.roles?.length) parts.push(`Roles: ${block.roles.join(", ")}`)
  if (block.steps?.length) parts.push(block.steps.map((s, i) => `${i + 1}. ${s}`).join("\n"))
  if (block.tip) parts.push(`Tip: ${block.tip}`)
  return parts.join("\n")
}

function renderSection(section: ManualSection): string {
  const header = `## ${section.title}\nVisible para roles: ${section.roles.join(", ")}`
  return [header, ...section.content.map(renderBlock)].join("\n\n")
}

export function buildAsistenteSystemPrompt(): string {
  return [INSTRUCCIONES, ...manualSections.map(renderSection)].join("\n\n")
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/__tests__/asistente-system-prompt.test.ts`
Expected: PASS (4 tests). If the "no contiene valores dinámicos" test fails because some manual body legitimately contains a `$` amount or the current year, adjust the TEST to exclude that specific known-static string — never make the prompt dynamic.

- [ ] **Step 5: Commit**

```bash
git add lib/asistente/system-prompt.ts lib/__tests__/asistente-system-prompt.test.ts
git commit -m "feat(asistente): system prompt estático renderizado desde el manual"
```

---

### Task 3: Migration 274 — tables + feature flag

**Files:**
- Create: `supabase/migrations/274_asistente_panel.sql`

**Interfaces:**
- Produces: tables `asistente_conversaciones`, `asistente_mensajes` (both carry `organization_id` — denormalized on mensajes for cheap daily counting + RLS); feature flag `asistente_ia: true` on plan `profesional`.

- [ ] **Step 1: Write the migration**

`supabase/migrations/274_asistente_panel.sql`:

```sql
-- ============================================================================
-- 274: asistente IA del panel — conversaciones, mensajes y flag de plan
-- ============================================================================
-- Asistente de ayuda dentro del panel (guía de uso basada en el manual).
-- Solo para plan Profesional ACTIVO (el gate de trial se aplica en app-layer).
-- asistente_mensajes lleva organization_id denormalizado para contar el tope
-- diario por org con un count directo (sin join) y para RLS simple.
-- ============================================================================

-- (1) Conversaciones
CREATE TABLE IF NOT EXISTS asistente_conversaciones (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  usuario_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS asistente_conversaciones_org_idx
  ON asistente_conversaciones(organization_id);
CREATE INDEX IF NOT EXISTS asistente_conversaciones_usuario_idx
  ON asistente_conversaciones(usuario_id);

ALTER TABLE asistente_conversaciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS asistente_conversaciones_select ON asistente_conversaciones;
CREATE POLICY asistente_conversaciones_select ON asistente_conversaciones
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS asistente_conversaciones_all_service ON asistente_conversaciones;
CREATE POLICY asistente_conversaciones_all_service ON asistente_conversaciones
  FOR ALL USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS asistente_conversaciones_updated_at ON asistente_conversaciones;
CREATE TRIGGER asistente_conversaciones_updated_at
  BEFORE UPDATE ON asistente_conversaciones
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- (2) Mensajes (con tokens para costo real por org)
CREATE TABLE IF NOT EXISTS asistente_mensajes (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  conversacion_id TEXT NOT NULL REFERENCES asistente_conversaciones(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('USER', 'ASSISTANT')),
  contenido TEXT NOT NULL,
  modelo TEXT,
  input_tokens INTEGER,
  cache_read_input_tokens INTEGER,
  cache_creation_input_tokens INTEGER,
  output_tokens INTEGER,
  tiempo_respuesta_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS asistente_mensajes_conversacion_idx
  ON asistente_mensajes(conversacion_id);
-- Índice para el tope diario: count por org + tipo + fecha
CREATE INDEX IF NOT EXISTS asistente_mensajes_org_tipo_created_idx
  ON asistente_mensajes(organization_id, tipo, created_at);

ALTER TABLE asistente_mensajes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS asistente_mensajes_select ON asistente_mensajes;
CREATE POLICY asistente_mensajes_select ON asistente_mensajes
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS asistente_mensajes_all_service ON asistente_mensajes;
CREATE POLICY asistente_mensajes_all_service ON asistente_mensajes
  FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE asistente_conversaciones IS 'Conversaciones del asistente IA del panel (guía de uso)';
COMMENT ON TABLE asistente_mensajes IS 'Mensajes del asistente del panel, con tokens de la API para costo por org';

-- (3) Flag de plan: solo Profesional
UPDATE plans SET
  feature_flags = feature_flags || '{"asistente_ia": true}'::jsonb,
  updated_at = NOW()
WHERE slug = 'profesional';
```

- [ ] **Step 2: Sanity-check the SQL locally**

If a local Supabase is available: `npx supabase db push --dry-run` or apply against local. If not, self-review the SQL against `supabase/migrations/265_sucursal_whatsapp_config.sql` for pattern parity (generate_cuid, RLS policy names, service policy, trigger).

Note: production application of the migration is done manually by Luis (established project convention) — flag it in the PR description.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/274_asistente_panel.sql
git commit -m "feat(asistente): migración 274 — tablas de conversaciones/mensajes y flag asistente_ia"
```

---

### Task 4: Access helper + rate limiter

**Files:**
- Create: `lib/asistente/access.ts`
- Create: `lib/asistente/rate-limit.ts`
- Test: `lib/__tests__/asistente-access.test.ts`

**Interfaces:**
- Consumes: `getSubscriptionInfo`, `hasPlanFeature` from `@/lib/subscriptions`.
- Produces: `export async function canUseAsistente(organizationId: string): Promise<boolean>`; `export function checkAsistenteRateLimit(key: string, now?: number): boolean` (10 req / 60s window).

- [ ] **Step 1: Write the failing tests**

`lib/__tests__/asistente-access.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/subscriptions', () => ({
  getSubscriptionInfo: vi.fn(),
  hasPlanFeature: vi.fn(),
}))

import { getSubscriptionInfo, hasPlanFeature } from '@/lib/subscriptions'
import { canUseAsistente } from '@/lib/asistente/access'
import { checkAsistenteRateLimit } from '@/lib/asistente/rate-limit'

const baseSub = { status: 'ACTIVE', planSlug: 'profesional' } as any

describe('canUseAsistente', () => {
  beforeEach(() => vi.clearAllMocks())

  it('true: plan ACTIVE con flag asistente_ia', async () => {
    vi.mocked(getSubscriptionInfo).mockResolvedValue(baseSub)
    vi.mocked(hasPlanFeature).mockResolvedValue(true)
    expect(await canUseAsistente('org-1')).toBe(true)
  })

  it('false: TRIALING aunque tenga el flag (trial excluido)', async () => {
    vi.mocked(getSubscriptionInfo).mockResolvedValue({ ...baseSub, status: 'TRIALING' })
    vi.mocked(hasPlanFeature).mockResolvedValue(true)
    expect(await canUseAsistente('org-1')).toBe(false)
  })

  it('false: ACTIVE sin flag (plan free)', async () => {
    vi.mocked(getSubscriptionInfo).mockResolvedValue({ ...baseSub, planSlug: 'free' })
    vi.mocked(hasPlanFeature).mockResolvedValue(false)
    expect(await canUseAsistente('org-1')).toBe(false)
  })

  it('false: sin suscripción', async () => {
    vi.mocked(getSubscriptionInfo).mockResolvedValue(null)
    expect(await canUseAsistente('org-1')).toBe(false)
  })
})

describe('checkAsistenteRateLimit', () => {
  it('permite 10 y bloquea el 11º dentro de la ventana', () => {
    const now = 1_000_000
    for (let i = 0; i < 10; i++) {
      expect(checkAsistenteRateLimit('user-rl-1', now + i)).toBe(true)
    }
    expect(checkAsistenteRateLimit('user-rl-1', now + 11)).toBe(false)
  })

  it('resetea pasada la ventana de 60s', () => {
    const now = 2_000_000
    for (let i = 0; i < 10; i++) checkAsistenteRateLimit('user-rl-2', now)
    expect(checkAsistenteRateLimit('user-rl-2', now + 61_000)).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/__tests__/asistente-access.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`lib/asistente/access.ts`:

```ts
import { getSubscriptionInfo, hasPlanFeature } from "@/lib/subscriptions"

export const ASISTENTE_FEATURE_KEY = "asistente_ia"

// Gate del asistente: plan con flag asistente_ia Y suscripción ACTIVE.
// hasPlanFeature solo no alcanza: permite TRIALING vigente, y el asistente
// se vende exclusivamente con el plan Profesional pago (decisión de producto).
export async function canUseAsistente(organizationId: string): Promise<boolean> {
  const subscription = await getSubscriptionInfo(organizationId)
  if (!subscription || subscription.status !== "ACTIVE") return false
  return hasPlanFeature(organizationId, ASISTENTE_FEATURE_KEY)
}
```

`lib/asistente/rate-limit.ts`:

```ts
const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 10

const buckets = new Map<string, { count: number; resetTime: number }>()

export function checkAsistenteRateLimit(key: string, now: number = Date.now()): boolean {
  const bucket = buckets.get(key)
  if (!bucket || now > bucket.resetTime) {
    buckets.set(key, { count: 1, resetTime: now + WINDOW_MS })
    return true
  }
  if (bucket.count >= MAX_PER_WINDOW) return false
  bucket.count++
  return true
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/__tests__/asistente-access.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/asistente/access.ts lib/asistente/rate-limit.ts lib/__tests__/asistente-access.test.ts
git commit -m "feat(asistente): gate de plan Profesional ACTIVE y rate limit por usuario"
```

---

### Task 5: API route `app/api/asistente/route.ts`

**Files:**
- Create: `app/api/asistente/route.ts`

**Interfaces:**
- Consumes: `requireAuth` (`@/lib/auth-utils`), `canUseAsistente` + `checkAsistenteRateLimit` (Task 4), `buildAsistenteSystemPrompt` (Task 2), `supabaseAdmin`, `todayInTimeZone`/`dayRangeUtc`/`DEFAULT_TIMEZONE` (`@/lib/timezone`), `Anthropic` SDK, tables from Task 3.
- Produces: `POST /api/asistente` — body `{ message: string, conversacionId?: string | null }` → `{ message: string, conversacionId: string }`. Errors: 401 (sin sesión), 403 `{ error, code: "ASISTENTE_NOT_AVAILABLE" }`, 429 `{ error, code: "RATE_LIMIT" | "DAILY_LIMIT" }`, 400 (validación), 500.

- [ ] **Step 1: Implement the route**

`app/api/asistente/route.ts`:

```ts
import { NextResponse } from "next/server"
import { z } from "zod"
import Anthropic from "@anthropic-ai/sdk"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { canUseAsistente } from "@/lib/asistente/access"
import { checkAsistenteRateLimit } from "@/lib/asistente/rate-limit"
import { buildAsistenteSystemPrompt } from "@/lib/asistente/system-prompt"
import { todayInTimeZone, dayRangeUtc, DEFAULT_TIMEZONE } from "@/lib/timezone"

const ASISTENTE_MODEL = "claude-haiku-4-5"
const MAX_TOKENS = 1024
const DAILY_LIMIT_PER_ORG = 50
const HISTORY_TURNS = 6 // últimos 6 mensajes (3 idas y vueltas)

const requestSchema = z.object({
  message: z.string().min(1, "El mensaje no puede estar vacío").max(1000, "El mensaje es demasiado largo"),
  conversacionId: z.string().nullable().optional(),
})

const anthropic = new Anthropic({ apiKey: process.env.STAPP_CHATBOT_API_KEY })

export async function POST(request: Request) {
  const startTime = Date.now()
  try {
    const { error, organizationId, userId } = await requireAuth()
    if (error) return error

    if (!(await canUseAsistente(organizationId!))) {
      return NextResponse.json(
        { error: "El asistente está disponible en el plan Profesional.", code: "ASISTENTE_NOT_AVAILABLE" },
        { status: 403 }
      )
    }

    if (!checkAsistenteRateLimit(userId!)) {
      return NextResponse.json(
        { error: "Demasiados mensajes seguidos. Esperá un minuto.", code: "RATE_LIMIT" },
        { status: 429 }
      )
    }

    const body = await request.json()
    const { message, conversacionId } = requestSchema.parse(body)

    // Tope diario por org, con "día" en la tz de la org (convención del proyecto)
    const { data: orgTz } = await supabaseAdmin
      .from("organizations")
      .select("zona_horaria")
      .eq("id", organizationId!)
      .single()
    const tz = orgTz?.zona_horaria || DEFAULT_TIMEZONE
    const { desde, hasta } = dayRangeUtc(todayInTimeZone(tz), tz)

    const { count: usedToday } = await supabaseAdmin
      .from("asistente_mensajes")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId!)
      .eq("tipo", "USER")
      .gte("created_at", desde)
      .lte("created_at", hasta)

    if ((usedToday ?? 0) >= DAILY_LIMIT_PER_ORG) {
      return NextResponse.json(
        { error: "Alcanzaste el límite diario del asistente. Volvé mañana.", code: "DAILY_LIMIT" },
        { status: 429 }
      )
    }

    // Conversación: reusar si pertenece a este usuario/org, crear si no
    let convId = conversacionId ?? null
    if (convId) {
      const { data: conv } = await supabaseAdmin
        .from("asistente_conversaciones")
        .select("id")
        .eq("id", convId)
        .eq("organization_id", organizationId!)
        .eq("usuario_id", userId!)
        .single()
      if (!conv) convId = null
    }
    if (!convId) {
      const { data: conv, error: convError } = await supabaseAdmin
        .from("asistente_conversaciones")
        .insert({ organization_id: organizationId!, usuario_id: userId! })
        .select("id")
        .single()
      if (convError || !conv) throw convError ?? new Error("No se pudo crear la conversación")
      convId = conv.id
    }

    // Historial: últimos N mensajes en orden cronológico
    const { data: historial } = await supabaseAdmin
      .from("asistente_mensajes")
      .select("tipo, contenido")
      .eq("conversacion_id", convId)
      .order("created_at", { ascending: false })
      .limit(HISTORY_TURNS)
    const ordered = (historial ?? []).slice().reverse()

    await supabaseAdmin.from("asistente_mensajes").insert({
      conversacion_id: convId,
      organization_id: organizationId!,
      tipo: "USER",
      contenido: message,
    })

    // Multi-turn real (no concatenación en un string): preserva la caché
    // del system prompt entre turnos.
    const messages: Anthropic.MessageParam[] = [
      ...ordered.map((m) => ({
        role: (m.tipo === "USER" ? "user" : "assistant") as "user" | "assistant",
        content: m.contenido,
      })),
      { role: "user" as const, content: message },
    ]

    const response = await anthropic.messages.create({
      model: ASISTENTE_MODEL,
      max_tokens: MAX_TOKENS,
      system: [
        {
          type: "text",
          text: buildAsistenteSystemPrompt(),
          cache_control: { type: "ephemeral" },
        },
      ],
      messages,
    })

    const textBlock = response.content.find((b) => b.type === "text")
    const assistantMessage =
      textBlock && textBlock.type === "text" && textBlock.text
        ? textBlock.text
        : "Disculpá, tuve un problema para responder. Probá de nuevo en unos segundos."

    await supabaseAdmin.from("asistente_mensajes").insert({
      conversacion_id: convId,
      organization_id: organizationId!,
      tipo: "ASSISTANT",
      contenido: assistantMessage,
      modelo: ASISTENTE_MODEL,
      input_tokens: response.usage.input_tokens,
      cache_read_input_tokens: response.usage.cache_read_input_tokens ?? null,
      cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? null,
      output_tokens: response.usage.output_tokens,
      tiempo_respuesta_ms: Date.now() - startTime,
    })

    return NextResponse.json({ message: assistantMessage, conversacionId: convId })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("[Asistente] error:", err)
    return NextResponse.json(
      { error: "Error al procesar el mensaje. Probá de nuevo." },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors. If `cache_control` or `cache_read_input_tokens` types are missing, check the installed `@anthropic-ai/sdk` version (`npm ls @anthropic-ai/sdk`) and upgrade to latest if needed (`npm i @anthropic-ai/sdk@latest`) — caching types have been stable in the SDK for a long time, so an upgrade should only be necessary on a very old pin.

- [ ] **Step 3: Manual smoke test**

With `npm run dev` and a logged-in Profesional-ACTIVE org (requires migration 274 applied to the local/dev DB):

```bash
# desde el navegador logueado (la sesión va por cookie), en la consola:
fetch('/api/asistente', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: '¿cómo creo una orden?' }) }).then(r => r.json()).then(console.log)
```

Expected: `{ message: "...", conversacionId: "..." }`. Second call: check `asistente_mensajes.cache_read_input_tokens > 0` (cache warm). With a free/trial org: 403.

- [ ] **Step 4: Commit**

```bash
git add app/api/asistente/route.ts
git commit -m "feat(asistente): endpoint autenticado con caching, gate de plan y topes de uso"
```

---

### Task 6: Floating widget in dashboard layout

**Files:**
- Create: `components/asistente/asistente-widget.tsx` (trigger + locked state)
- Create: `components/asistente/asistente-panel.tsx` (chat panel)
- Modify: `app/(dashboard)/layout.tsx` (mount widget + compute gate server-side)

**Interfaces:**
- Consumes: `POST /api/asistente` (Task 5 contract), `canUseAsistente` (Task 4), `components/ui/button`, `components/ui/input`, `cn` from `@/lib/utils`.
- Produces: `<AsistenteWidget enabled={boolean} />` mounted globally in the dashboard.

- [ ] **Step 1: Create the trigger `components/asistente/asistente-widget.tsx`**

```tsx
"use client"

import { useState } from "react"
import Link from "next/link"
import dynamic from "next/dynamic"
import { Sparkles, Lock, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

const AsistentePanel = dynamic(
  () => import("./asistente-panel").then((mod) => mod.AsistentePanel),
  {
    ssr: false,
    loading: () => (
      <div className="fixed bottom-20 right-4 md:bottom-6 md:right-6 z-50 w-[90vw] max-w-md h-[500px] bg-card border shadow-2xl rounded-2xl flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    ),
  }
)

interface AsistenteWidgetProps {
  enabled: boolean
}

export function AsistenteWidget({ enabled }: AsistenteWidgetProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [showLockedTip, setShowLockedTip] = useState(false)

  if (!enabled) {
    return (
      <div className="fixed bottom-20 right-4 md:bottom-6 md:right-6 z-40">
        {showLockedTip && (
          <div className="absolute bottom-14 right-0 w-64 bg-card border shadow-lg rounded-xl p-3 text-sm">
            <p className="font-medium mb-1">Asistente de STApp</p>
            <p className="text-muted-foreground mb-2">
              Disponible en el plan Profesional: respondé tus dudas sobre cómo usar el sistema al instante.
            </p>
            <Link href="/configuracion/billing" className="text-primary font-medium hover:underline">
              Ver planes
            </Link>
          </div>
        )}
        <button
          onClick={() => setShowLockedTip((v) => !v)}
          aria-label="Asistente disponible en plan Profesional"
          className={cn(
            "w-12 h-12 rounded-full flex items-center justify-center",
            "bg-muted text-muted-foreground border shadow-md hover:bg-muted/80 transition-colors"
          )}
        >
          <Lock className="w-5 h-5" />
        </button>
      </div>
    )
  }

  return (
    <>
      {isOpen && <AsistentePanel onClose={() => setIsOpen(false)} />}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          aria-label="Abrir asistente de STApp"
          className={cn(
            "fixed bottom-20 right-4 md:bottom-6 md:right-6 z-40",
            "w-12 h-12 rounded-full flex items-center justify-center",
            "bg-primary text-primary-foreground shadow-lg hover:opacity-90 transition-opacity"
          )}
        >
          <Sparkles className="w-5 h-5" />
        </button>
      )}
    </>
  )
}
```

Note: `bottom-20` on mobile clears the bottom tab bar the panel uses on small screens; verify against the actual mobile nav height during the visual check and adjust if it overlaps. Check z-index against `GuidedTour`/`SyncStatusIndicator` (avoid covering them; `z-40` chosen below the chatbot's `z-50`).

- [ ] **Step 2: Create the panel `components/asistente/asistente-panel.tsx`**

```tsx
"use client"

import { useEffect, useRef, useState } from "react"
import { X, Send, Loader2, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

interface Message {
  id: string
  tipo: "USER" | "ASSISTANT"
  contenido: string
}

interface AsistentePanelProps {
  onClose: () => void
}

const WELCOME =
  "¡Hola! Soy el asistente de STApp. Preguntame lo que quieras sobre cómo usar el sistema: órdenes, inventario, cotizaciones, reportes y más."

export function AsistentePanel({ onClose }: AsistentePanelProps) {
  const [messages, setMessages] = useState<Message[]>([
    { id: "welcome", tipo: "ASSISTANT", contenido: WELCOME },
  ])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [conversacionId, setConversacionId] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const sendMessage = async () => {
    const text = input.trim()
    if (!text || isLoading) return
    setInput("")
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), tipo: "USER", contenido: text }])
    setIsLoading(true)
    try {
      const res = await fetch("/api/asistente", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, conversacionId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            tipo: "ASSISTANT",
            contenido: data.error ?? "Hubo un problema. Probá de nuevo en unos segundos.",
          },
        ])
        return
      }
      setConversacionId(data.conversacionId)
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), tipo: "ASSISTANT", contenido: data.message },
      ])
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          tipo: "ASSISTANT",
          contenido: "No pude conectarme. Revisá tu conexión y probá de nuevo.",
        },
      ])
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="fixed bottom-20 right-4 md:bottom-6 md:right-6 z-50 w-[90vw] max-w-md h-[500px] max-h-[75vh] bg-card border shadow-2xl rounded-2xl flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b bg-primary text-primary-foreground">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4" />
          <span className="font-medium text-sm">Asistente de STApp</span>
        </div>
        <button onClick={onClose} aria-label="Cerrar asistente" className="hover:opacity-80">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((m) => (
          <div key={m.id} className={cn("flex", m.tipo === "USER" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap",
                m.tipo === "USER" ? "bg-primary text-primary-foreground" : "bg-muted"
              )}
            >
              {m.contenido}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-muted rounded-xl px-3 py-2">
              <Loader2 className="w-4 h-4 animate-spin" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="border-t p-3 flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
          placeholder="¿Cómo hago para...?"
          maxLength={1000}
          disabled={isLoading}
        />
        <Button onClick={sendMessage} disabled={isLoading || !input.trim()} size="icon" aria-label="Enviar">
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Mount in `app/(dashboard)/layout.tsx`**

1. Imports:

```tsx
import { AsistenteWidget } from "@/components/asistente/asistente-widget"
import { canUseAsistente } from "@/lib/asistente/access"
```

2. In the async layout body, after `getCachedAccessInfo`:

```tsx
const asistenteEnabled = await canUseAsistente(organizationId)
```

3. In the JSX, add as a sibling next to the existing global components (`<GuidedTour />`, `<SyncStatusIndicator />`, inside `<OfflineProvider>`, after `</SidebarMain>`):

```tsx
<AsistenteWidget enabled={asistenteEnabled} />
```

- [ ] **Step 4: Typecheck + full test suite**

Run: `npx tsc --noEmit` — Expected: no new errors
Run: `npx vitest run` — Expected: all tests pass (new + pre-existing)

- [ ] **Step 5: Manual visual check**

`npm run dev`, log in:
- Profesional ACTIVE org → sparkles bubble; open, ask "¿cómo creo una orden?", get a manual-based answer; ask something off-topic ("escribime un poema") → polite refusal.
- Free/trial org → lock bubble → tip with "Ver planes" link to `/configuracion/billing`.
- Mobile viewport: bubble doesn't overlap the bottom nav.

- [ ] **Step 6: Commit**

```bash
git add components/asistente/ "app/(dashboard)/layout.tsx"
git commit -m "feat(asistente): widget flotante en el panel con estado bloqueado para planes sin acceso"
```

---

### Task 7: Final verification + PR #2

**Files:** none new

- [ ] **Step 1: Run everything**

```bash
npx vitest run
npx tsc --noEmit
npm run build
```

Expected: all green. `npm run build` matters here because `lib/manual-content.ts` is now imported from both a client page and server code.

- [ ] **Step 2: Cache verification (cost control works)**

Send 3 consecutive messages via the widget, then check in Supabase:

```sql
SELECT modelo, input_tokens, cache_read_input_tokens, cache_creation_input_tokens, output_tokens
FROM asistente_mensajes WHERE tipo = 'ASSISTANT' ORDER BY created_at DESC LIMIT 3;
```

Expected: first message has `cache_creation_input_tokens` in the thousands (cold write); following messages have `cache_read_input_tokens` in the thousands and small `input_tokens`. If `cache_read_input_tokens` stays 0, something dynamic leaked into the system prompt — fix before merging.

- [ ] **Step 3: Open PR #2**

Target `main`. Title: `feat(asistente): asistente IA del panel para plan Profesional`. Body must include: spec link, the two-table migration note (**274 must be applied manually before deploy**), the gate rule (Profesional ACTIVE, trial excluded), limits (10/min/user, 50/día/org, max_tokens 1024), and the cache verification result from Step 2.
