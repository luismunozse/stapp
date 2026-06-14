# Superadmin Phase 1 — Per-Org Command Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. UI tasks: implementers SHOULD load the project frontend design skill (frontend-design / emil-design-eng) before writing JSX and follow the existing tab components' visual patterns.

**Goal:** Rebuild the superadmin org-detail page into a single-page "command center" (layout A): a status header with badges + an always-visible quick-actions bar + stacked sections, consolidating every per-org action in one place.

**Architecture:** Pure frontend composition on top of the existing client page (`app/superadmin/organizaciones/[id]/page.tsx`) — it already fetches the aggregated `OrganizationDetailResponse` via `useSuperadminFetch`. We replace the `Tabs` with stacked section components, reuse the existing tab components as sections, add a `OrgCommandHeader`, a `OrgQuickActions` bar (dialogs that wire EXISTING endpoints), and a new `OrgLimitsSection` (with an override dialog). One small backend change: the detail GET also returns the org's `limitOverrides` row so the limits section can show effective limits. No new plan-change backend is needed — `POST /api/superadmin/subscriptions/renew` already accepts `planSlug`.

**Tech Stack:** Next.js App Router (client components), Supabase (`supabaseAdmin`), shadcn/ui (`dialog`, `select`, `badge`, `card`, `button`, `input`, `label`, `confirm-dialog`), sonner toasts, `useSuperadminFetch` / `useSuperadminMutation` hooks, Vitest for the backend test.

---

## Key facts (verified in codebase — do not re-derive)

- Page `app/superadmin/organizaciones/[id]/page.tsx` is a **client component**; uses `const { data, loading, fetchData } = useSuperadminFetch<OrgData>()` and `fetchData(\`/api/superadmin/organizations/${id}\`)`. `OrgData` mirrors `OrganizationDetailResponse`. Params via `use(params)`.
- Existing section components in `app/superadmin/organizaciones/[id]/_components/`: `org-info-tab.tsx`, `org-users-tab.tsx`, `org-usage-tab.tsx`, `org-subscription-tab.tsx`, `org-payments-tab.tsx`. Each takes the relevant slice + an `onUpdated()` callback to trigger a parent re-fetch.
- `useSuperadminMutation()` returns `{ loading, mutate }`. `mutate(url, { method, body, successMessage?, errorMessage?, onSuccess? })`. It auto-fires sonner `toast.error`/`toast.success` — do NOT also pass `successMessage` AND call `toast.success` (double fire).
- Toasts: `import { toast } from "sonner"`. `<Toaster>` already mounted globally.
- Destructive confirm: use `components/ui/confirm-dialog.tsx` (has `danger`/`warning` variants). There is NO shadcn `alert-dialog`, NO `table`, NO `separator` primitive (use raw `<table>`, `<hr className="border-t border-border" />`).
- Endpoints already available (request bodies):
  - `POST /api/superadmin/trial-extension` → `{ organizationId, dias (1..90), motivo? }`. **404 if no subscription row** — only show extend-trial when `subscription !== null`.
  - `POST /api/superadmin/subscriptions/renew` → `{ organizationId, billingPeriod?("MONTHLY"|"YEARLY"), planSlug?, months?, days?, customEndDate? }`. Pass `planSlug` to change plan. Response `{ success, message, periodEnd }`.
  - `POST /api/superadmin/subscriptions/cancel` → `{ organizationId, immediate?:boolean }`.
  - `POST /api/superadmin/subscriptions/limit-overrides` → `{ organizationId, limite_ordenes?, limite_tecnicos?, limite_clientes?, limite_vendedores?, limite_storage_mb?, motivo? }` (numbers nullable; omitted = unchanged). `DELETE ...limit-overrides?organizationId=<id>` clears all.
  - `DELETE /api/superadmin/organizations/[id]` → archives by default (Phase 0). `POST /api/superadmin/organizations/[id]/restore` → un-archive.
  - `POST /api/superadmin/organizations/[id]/toggle-status` → `{ activo: boolean }` (suspend/reactivate).
  - `GET /api/superadmin/plans` → `{ plans: PlanWithUsage[] }`; filter client-side `p.activo && !p.deleted_at` for the plan-picker; pass `plan.slug` as `planSlug`.
- `OrganizationDetailResponse` (in `types/superadmin.ts`) fields: `organization, users, usage, subscription (with .plans), payments, ordersHistory?`. We ADD `limitOverrides`.

## Out of scope (defer to a Phase 1.1 polish — note, do not silently drop)
- Trial-extension *history timeline* and *health score* in the header/sections (not in the GET; would need extra backend). Header trial badge uses `subscription.trial_end` (available). Impersonation, per-org feature flags, suspend-with-reason, trial shortening → Phase 2.

---

## File Structure

**Backend**
- Modify `app/api/superadmin/organizations/[id]/route.ts` — GET also fetches + returns `limitOverrides`.
- Modify `types/superadmin.ts` — add `OrganizationLimitOverrides` type + `limitOverrides` on `OrganizationDetailResponse`.
- Test `__tests__/api/superadmin-organization-detail.test.ts` (new) — GET returns limitOverrides.
- Test `__tests__/api/superadmin-renew-planslug.test.ts` (new) — renew honors planSlug.

**Frontend** (all under `app/superadmin/organizaciones/[id]/`)
- Create `_components/org-command-header.tsx` — name/slug/contact + status badges.
- Create `_components/org-quick-actions.tsx` — action bar + dialogs (extend trial, change plan, cancel, suspend/reactivate, archive/restore).
- Create `_components/org-limits-section.tsx` — effective limits vs usage + override dialog.
- Modify `page.tsx` — single-page layout composing header + quick-actions + sections (reuse existing tab components as sections, drop `Tabs`).
- Reuse as-is (no change): `org-info-tab.tsx`, `org-users-tab.tsx`, `org-usage-tab.tsx`, `org-payments-tab.tsx`. The `org-subscription-tab.tsx` renew dialog logic is superseded by quick-actions; keep the file but the page renders a read-only subscription summary section (see Task 6).

---

## Task 1: Backend — detail GET returns limit overrides

**Files:**
- Modify: `types/superadmin.ts`
- Modify: `app/api/superadmin/organizations/[id]/route.ts` (GET handler)
- Test: `__tests__/api/superadmin-organization-detail.test.ts`

- [ ] **Step 1: Add the type** in `types/superadmin.ts` (near `OrganizationDetailResponse`):

```ts
export interface OrganizationLimitOverrides {
  organization_id: string
  limite_ordenes: number | null
  limite_tecnicos: number | null
  limite_clientes: number | null
  limite_vendedores: number | null
  limite_storage_mb: number | null
  motivo: string | null
}
```
Then add to `OrganizationDetailResponse`:
```ts
  limitOverrides: OrganizationLimitOverrides | null
```

- [ ] **Step 2: Write the failing test** `__tests__/api/superadmin-organization-detail.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { createChainMock, mockSupabaseFrom, createGetRequest, parseResponse } from "./helpers"

vi.mock("@/lib/superadmin-auth", () => ({
  requireSuperadmin: vi.fn().mockResolvedValue({ error: null, email: "admin@stapp.com.ar" }),
}))

import { GET } from "@/app/api/superadmin/organizations/[id]/route"

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

describe("GET /api/superadmin/organizations/[id] — includes limitOverrides", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns the org's limit override row", async () => {
    mockSupabaseFrom({
      organizations: createChainMock({ id: "o1", nombre: "Guru", slug: "guru", activo: true }),
      users: createChainMock([]),
      organization_usage: createChainMock({ organization_id: "o1", clientes_count: 5 }),
      subscriptions: createChainMock({ id: "s1", organization_id: "o1", status: "TRIALING", plans: { id: "p", nombre: "Profesional" } }),
      subscription_payments: createChainMock([]),
      ordenes_servicio: createChainMock([]),
      organization_limit_overrides: createChainMock({ organization_id: "o1", limite_clientes: 500, limite_ordenes: null, limite_tecnicos: null, limite_vendedores: null, limite_storage_mb: null, motivo: "cliente VIP" }),
    })

    const res = await GET(createGetRequest("http://localhost/api/superadmin/organizations/o1"), ctx("o1"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.limitOverrides).toEqual(
      expect.objectContaining({ organization_id: "o1", limite_clientes: 500, motivo: "cliente VIP" })
    )
  })

  it("returns null limitOverrides when none exist", async () => {
    mockSupabaseFrom({
      organizations: createChainMock({ id: "o1", nombre: "Guru", slug: "guru", activo: true }),
      users: createChainMock([]),
      organization_usage: createChainMock(null),
      subscriptions: createChainMock(null),
      subscription_payments: createChainMock([]),
      ordenes_servicio: createChainMock([]),
      organization_limit_overrides: createChainMock(null),
    })

    const res = await GET(createGetRequest("http://localhost/api/superadmin/organizations/o1"), ctx("o1"))
    const { body } = await parseResponse(res)
    expect(body.limitOverrides).toBeNull()
  })
})
```

- [ ] **Step 3: Run, confirm FAIL**
`npx vitest run __tests__/api/superadmin-organization-detail.test.ts`

- [ ] **Step 4: Implement** in the GET handler of `app/api/superadmin/organizations/[id]/route.ts`. The handler currently runs a `Promise.all([...])` of `organizations`, `users`, `organization_usage`, `subscriptions`. Add a fifth query for overrides and include it in the response.

In the first `Promise.all`, add as a new entry:
```ts
        // Overrides de límites por org
        supabaseAdmin
          .from("organization_limit_overrides")
          .select("organization_id, limite_ordenes, limite_tecnicos, limite_clientes, limite_vendedores, limite_storage_mb, motivo")
          .eq("organization_id", id)
          .maybeSingle(),
```
Destructure it (e.g. add `overridesResult` to the array binding). Then in the `response` object add:
```ts
      limitOverrides: overridesResult.data ?? null,
```
Use `.maybeSingle()` (not `.single()`) so "no override row" returns `{ data: null }` without an error.

- [ ] **Step 5: Run, confirm PASS** (2 tests) + `npx tsc --noEmit` (no new errors).

- [ ] **Step 6: Commit**
```
git add types/superadmin.ts "app/api/superadmin/organizations/[id]/route.ts" __tests__/api/superadmin-organization-detail.test.ts
git commit -m "feat(superadmin): detalle de org incluye limit overrides"
```

---

## Task 2: Backend — test that renew honors planSlug

**Files:**
- Test: `__tests__/api/superadmin-renew-planslug.test.ts`
(No code change — `renew` already supports `planSlug`. This test locks the behavior the plan-picker relies on.)

- [ ] **Step 1: Read** `app/api/superadmin/subscriptions/renew/route.ts` to confirm: it resolves the plan via `plans` where `slug = planSlug || "profesional"` and `activo = true`, then writes `subscriptions.plan_id = <that plan>.id`.

- [ ] **Step 2: Write the test** `__tests__/api/superadmin-renew-planslug.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { createChainMock, mockSupabaseFrom, parseResponse } from "./helpers"

vi.mock("@/lib/superadmin-auth", () => ({
  requireSuperadmin: vi.fn().mockResolvedValue({ error: null, email: "admin@stapp.com.ar" }),
}))

import { POST } from "@/app/api/superadmin/subscriptions/renew/route"

function postJson(body: unknown): Request {
  return new Request("http://localhost/api/superadmin/subscriptions/renew", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  })
}

describe("POST /api/superadmin/subscriptions/renew — planSlug", () => {
  beforeEach(() => vi.clearAllMocks())

  it("resolves the plan by the provided planSlug and writes its id", async () => {
    const plansChain = createChainMock({ id: "plan-pro", slug: "pro", tipo: "PREMIUM", tier_order: 3, activo: true })
    const subUpsert = createChainMock({ id: "s1" })
    const subsChain = {
      ...createChainMock(null), // existing subscription lookup → none
      upsert: vi.fn().mockReturnValue(subUpsert),
      update: vi.fn().mockReturnValue(createChainMock(null)),
      insert: vi.fn().mockReturnValue(createChainMock(null)),
    }
    mockSupabaseFrom({
      plans: plansChain,
      subscriptions: subsChain as any,
      subscription_payments: createChainMock(null),
      subscription_history: createChainMock(null),
      audit_logs: createChainMock(null),
      users: createChainMock([]),
      user_notifications: createChainMock(null),
    })

    const res = await POST(postJson({ organizationId: "o1", planSlug: "pro", billingPeriod: "MONTHLY" }))
    const { status } = await parseResponse(res)

    expect(status).toBe(200)
    // The plan lookup must have filtered by the provided slug
    expect(plansChain.eq).toHaveBeenCalledWith("slug", "pro")
  })
})
```
If the renew implementation's chain shape differs (e.g. it uses `.update()` then `.insert()` rather than `.upsert()`), adapt the `subsChain` mock so the handler reaches a 200 — the key assertion is `plansChain.eq` called with `("slug", "pro")`. Read the handler first (Step 1) and shape the mock to match.

- [ ] **Step 3: Run, confirm PASS** (`npx vitest run __tests__/api/superadmin-renew-planslug.test.ts`). If it fails because the slug filter uses a different call (e.g. `.eq("slug", ...)` is conditional), adjust the assertion to match the real code path while still proving the provided slug drives plan selection.

- [ ] **Step 4: Commit**
```
git add __tests__/api/superadmin-renew-planslug.test.ts
git commit -m "test(superadmin): renew respeta planSlug para cambio de plan"
```

---

## Task 3: OrgCommandHeader component

**Files:**
- Create: `app/superadmin/organizaciones/[id]/_components/org-command-header.tsx`

**Implementer:** load the frontend design skill; match the visual language of existing `_components/*` and `components/ui/{card,badge}`.

- [ ] **Step 1: Implement the component** with this EXACT contract:

```ts
import type { OrganizationDetail, SubscriptionWithPlan } from "@/types/superadmin"

interface OrgCommandHeaderProps {
  organization: OrganizationDetail
  subscription: SubscriptionWithPlan | null
}
export function OrgCommandHeader({ organization, subscription }: OrgCommandHeaderProps): JSX.Element
```

Behavior / content (use `Badge` from `@/components/ui/badge`):
- Title row: `🔧 {organization.nombre}` + muted `{organization.slug}` (subdomain).
- Contact line (muted, omit empty): `organization.email`, `organization.telefono`, `organization.direccion`.
- Status badges:
  - Estado: if `organization.activo` → green "Activo" else gray "Suspendido". (Archived state isn't in this payload; the page handles archived separately — see Task 6 note.)
  - Plan: `subscription?.plans?.nombre ?? "Free"`.
  - Trial: if `subscription?.status === "TRIALING"` and `subscription.trial_end`, compute days left = `Math.ceil((new Date(trial_end) - now)/86400000)`; show amber badge `Trial: {n}d` (or "Trial vencido" if ≤0) plus the formatted date `dd/MM`. Otherwise no trial badge.
  - Antigüedad: `Alta {relative}` from `organization.created_at` (e.g. "hace 3 meses"); a small helper inline is fine.

Pure presentational — no data fetching, no mutations.

- [ ] **Step 2: Typecheck** `npx tsc --noEmit` (no new errors). No unit test (presentational; verified in Task 7 manual run).

- [ ] **Step 3: Commit**
```
git add "app/superadmin/organizaciones/[id]/_components/org-command-header.tsx"
git commit -m "feat(superadmin): OrgCommandHeader (badges de estado/plan/trial)"
```

---

## Task 4: OrgQuickActions component (action bar + dialogs)

**Files:**
- Create: `app/superadmin/organizaciones/[id]/_components/org-quick-actions.tsx`

**Implementer:** load the frontend design skill. Use the dialog pattern from the existing `org-subscription-tab.tsx` (useState open + one `useSuperadminMutation` + Dialog + inline success + `setTimeout` close + `onUpdated()`), and `confirm-dialog.tsx` for destructive confirmations.

- [ ] **Step 1: Implement** with this EXACT contract:

```ts
import type { OrganizationDetail, SubscriptionWithPlan } from "@/types/superadmin"

interface OrgQuickActionsProps {
  organization: OrganizationDetail
  subscription: SubscriptionWithPlan | null
  onUpdated: () => void   // re-fetch the org detail
}
export function OrgQuickActions({ organization, subscription, onUpdated }: OrgQuickActionsProps): JSX.Element
```

Render a horizontal action bar (buttons) opening dialogs. Each mutation uses `useSuperadminMutation`; on success call `onUpdated()`. Actions:

1. **Extender trial** — show ONLY if `subscription !== null`. Dialog with a number input `dias` (1..90) + optional `motivo`. `mutate("/api/superadmin/trial-extension", { method:"POST", body:{ organizationId: organization.id, dias, motivo: motivo || undefined }, successMessage:"Trial extendido", onSuccess: onUpdated })`.
2. **Cambiar plan** — Dialog: fetch active plans on open via a local `useSuperadminFetch<{plans: PlanWithUsage[]}>()` → `fetchData("/api/superadmin/plans")`, filter `p.activo && !p.deleted_at`; a `Select` of plan names + a `Select` for `billingPeriod` (MONTHLY/YEARLY). Confirm → `mutate("/api/superadmin/subscriptions/renew", { method:"POST", body:{ organizationId: organization.id, planSlug: selected.slug, billingPeriod }, successMessage:"Plan actualizado", onSuccess: onUpdated })`.
3. **Cancelar suscripción** — show only if `subscription && subscription.status !== "CANCELED"`. Use `confirm-dialog` (danger). A checkbox/switch "inmediato". → `mutate("/api/superadmin/subscriptions/cancel", { method:"POST", body:{ organizationId: organization.id, immediate }, successMessage:"Suscripción cancelada", onSuccess: onUpdated })`.
4. **Suspender / Reactivar** — toggles `activo`. Button label depends on `organization.activo`. Suspender uses `confirm-dialog` (warning). → `mutate("/api/superadmin/organizations/${organization.id}/toggle-status", { method:"POST", body:{ activo: !organization.activo }, successMessage: organization.activo ? "Organización suspendida" : "Organización reactivada", onSuccess: onUpdated })`.
5. **Archivar** — `confirm-dialog` (danger) that REQUIRES typing the org slug to enable the confirm button (mirror the API's `confirmSlug` intent for safety). → `mutate("/api/superadmin/organizations/${organization.id}", { method:"DELETE", successMessage:"Organización archivada", onSuccess: () => { onUpdated() } })`. (Default DELETE archives; no body needed. Optionally include `{ reason }`.)

Acceptance: each action calls the exact endpoint+body above; success re-fetches; destructive ones require confirmation; extend-trial hidden when no subscription; cancel hidden when already canceled.

- [ ] **Step 2: Typecheck** `npx tsc --noEmit`. No unit test (verified in Task 7).

- [ ] **Step 3: Commit**
```
git add "app/superadmin/organizaciones/[id]/_components/org-quick-actions.tsx"
git commit -m "feat(superadmin): OrgQuickActions (trial, plan, cancelar, suspender, archivar)"
```

---

## Task 5: OrgLimitsSection + override dialog

**Files:**
- Create: `app/superadmin/organizaciones/[id]/_components/org-limits-section.tsx`

**Implementer:** load the frontend design skill. Reuse usage-bar visuals consistent with `org-usage-tab.tsx`.

- [ ] **Step 1: Implement** with this EXACT contract:

```ts
import type { OrganizationDetail, SubscriptionWithPlan, OrganizationUsage, OrganizationLimitOverrides } from "@/types/superadmin"

interface OrgLimitsSectionProps {
  organization: OrganizationDetail
  subscription: SubscriptionWithPlan | null
  usage: OrganizationUsage | null
  limitOverrides: OrganizationLimitOverrides | null
  onUpdated: () => void
}
export function OrgLimitsSection({ organization, subscription, usage, limitOverrides, onUpdated }: OrgLimitsSectionProps): JSX.Element
```

Behavior:
- For each resource (`ordenes`, `tecnicos`, `vendedores`, `clientes`, `storage_mb`): compute **effective limit** = `limitOverrides?.[\`limite_${key}\`] ?? subscription?.plans?.[\`limite_${key}\`] ?? null` (null = unlimited "∞"). Show `usage / effective` with a progress bar (skip the bar when unlimited). Mark resources that have an override with a small "override" tag.
- "Editar límites" button → Dialog with a numeric input per resource (prefilled from the override row if present, else empty placeholder showing the plan limit), plus `motivo`. Empty input = leave unchanged (omit from body). Save → `mutate("/api/superadmin/subscriptions/limit-overrides", { method:"POST", body:{ organizationId: organization.id, ...changedFields, motivo: motivo||undefined }, successMessage:"Límites actualizados", onSuccess: onUpdated })`.
- "Restaurar al plan" button (only when `limitOverrides !== null`) → `confirm-dialog` → `mutate("/api/superadmin/subscriptions/limit-overrides?organizationId=" + organization.id, { method:"DELETE", successMessage:"Límites restaurados", onSuccess: onUpdated })`.

Acceptance: effective limits reflect override-over-plan; editing posts only changed fields; restore deletes overrides.

- [ ] **Step 2: Typecheck** `npx tsc --noEmit`. No unit test (verified Task 7).

- [ ] **Step 3: Commit**
```
git add "app/superadmin/organizaciones/[id]/_components/org-limits-section.tsx"
git commit -m "feat(superadmin): OrgLimitsSection con override dialog"
```

---

## Task 6: Rebuild page.tsx as single-page command center

**Files:**
- Modify: `app/superadmin/organizaciones/[id]/page.tsx`

**Implementer:** load the frontend design skill. Read the current `page.tsx` fully first to preserve its data-fetch, loading/empty states, and the `onUpdated = () => fetchData(...)` wiring.

- [ ] **Step 1: Replace the `Tabs` block with stacked sections.** Keep the existing `useSuperadminFetch<OrgData>()` + `fetchData(\`/api/superadmin/organizations/${id}\`)` and a single `refresh = () => fetchData(\`/api/superadmin/organizations/${id}\`)`. `OrgData` now includes `limitOverrides` (Task 1). Compose, in order:
  1. `<OrgCommandHeader organization={data.organization} subscription={data.subscription} />`
  2. `<OrgQuickActions organization={data.organization} subscription={data.subscription} onUpdated={refresh} />`
  3. **Resumen + Uso**: render the existing `<OrgUsageTab usage={data.usage} ordersHistory={data.ordersHistory} ... />` (pass the props it already expects — read its signature).
  4. **Suscripción** (read-only summary): a small card showing `subscription.status`, plan name, `trial_end`/`current_period_end`, provider. Actions live in QuickActions; do NOT render the old renew dialog here. (You may render the existing `<OrgSubscriptionTab>` if you strip its now-duplicated action button, or write a compact read-only summary inline — prefer the compact summary to avoid duplicate "renew" UX.)
  5. `<OrgLimitsSection organization usage subscription limitOverrides={data.limitOverrides} onUpdated={refresh} />`
  6. **Usuarios**: existing `<OrgUsersTab users={data.users} ... onUpdated={refresh} />` (read its signature).
  7. **Pagos**: existing `<OrgPaymentsTab payments={data.payments} />`.
  8. **Identidad** (edit org fields): existing `<OrgInfoTab organization={data.organization} onUpdated={refresh} />`.
  - Each section wrapped in a `Card` with a clear heading. Remove `useSearchParams`/`?tab=` logic and the `Tabs` import.
- [ ] **Step 2: Archived handling.** If `data.organization` represents an archived org, the detail GET still returns it. Add a top banner (use `components/ui/status-banner.tsx` if suitable) when archived. Detect archived via a field if present; if the GET payload doesn't expose `deleted_at`, skip the banner (note as a Phase 1.1 follow-up — do not invent a field). Keep the page functional either way.
- [ ] **Step 3: Typecheck + lint-build sanity** `npx tsc --noEmit` (no new errors) and `npx next build` is NOT required; instead verify the dev server renders in Task 7.
- [ ] **Step 4: Run the full test suite** `npx vitest run` — confirm no regressions (backend tasks' tests pass; UI has no unit tests).
- [ ] **Step 5: Commit**
```
git add "app/superadmin/organizaciones/[id]/page.tsx"
git commit -m "feat(superadmin): centro de comando single-page (reemplaza tabs)"
```

---

## Task 7: Verification — run the app and smoke-test the command center

**Files:** none (manual verification).

- [ ] **Step 1:** Start the dev server (`npm run dev`) and open a superadmin org detail page (`admin.<host>/superadmin/organizaciones/<id>` per the project's local setup; consult README/CLAUDE for the exact local superadmin host). Use the project `run`/`verify` skill if available.
- [ ] **Step 2:** Confirm visually: header badges render (estado/plan/trial), quick-actions bar present, all sections stacked and populated, no console errors.
- [ ] **Step 3:** Exercise (against a disposable test org): extend trial, change plan, edit limits + restore, suspend/reactivate. Confirm each shows a toast and the page refreshes with updated data.
- [ ] **Step 4:** Report results. If anything fails, capture the error and fix via a follow-up task.
- [ ] **Step 5: Commit** any fixes found.

---

## Self-Review (author check)

- **Spec coverage:** command-center layout A (Tasks 3,4,5,6) ✓; per-org actions consolidated — extend trial, change plan (renew+planSlug), cancel, suspend, archive/restore, limit overrides (Task 4,5) ✓; limits show effective (override) values (Task 1+5) ✓; reuse existing sections (Task 6) ✓. Deferred-and-noted: trial history timeline, health score, archived banner if `deleted_at` not in payload.
- **Placeholders:** backend tasks (1,2) have full code + tests. UI tasks (3,4,5,6) give exact prop contracts + exact endpoint bodies + acceptance criteria; visual JSX intentionally implemented by following existing `_components/*` patterns + the frontend-design skill rather than pre-pasted, because pre-writing polished JSX in a plan produces worse UI than implementing against the validated layout. This is a deliberate, stated adaptation — not a vague "implement later".
- **Type consistency:** `OrganizationLimitOverrides` + `limitOverrides` used identically across Task 1 (def), Task 5 (consumer), Task 6 (passing). Endpoint bodies match the verified schemas. `onUpdated`/`refresh` re-fetch wiring consistent.
- **Scope:** frontend rebuild + one small GET addition; no new mutation backend (renew already supports planSlug). Phase 2/3 features excluded.
