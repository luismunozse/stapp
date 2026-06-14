# Superadmin Command Center — Design (Phase 0 + Phase 1)

**Date:** 2026-06-14
**Status:** Approved (brainstorming) — pending implementation plan
**Scope:** Redesign of the superadmin panel for fully administering talleres (organizations). This document covers **Phase 0 (safety net)** and **Phase 1 (per-org command center)**. Phases 2 and 3 are listed under Out of Scope.

---

## 1. Context

The superadmin panel (`admin.stapp.com.ar`, pages under `app/superadmin/`) already exposes extensive org administration: org list/detail (5 tabs), plans, subscriptions, payments, trial extension, limit overrides, user management, broadcast, support, audit logs. Backend coverage is strong.

The redesign goal is **not** to build capabilities from zero, but to:
1. Consolidate per-org administration into a single coherent **command center** (better UX).
2. Close high-impact gaps and fix correctness issues.

The org administration model (verified):
- `organizations` table — identity + `activo` boolean (the only suspension flag today). **Hard-delete only** (CASCADE), no `deleted_at`.
- `subscriptions` (one per org) — `status` (TRIALING/ACTIVE/CANCELED/PAST_DUE), `trial_end`, `current_period_end`, `plan_id`, `payment_provider`.
- Trial: stored as `subscriptions.status='TRIALING'` + `trial_end`. Extension via `POST /api/superadmin/trial-extension` (1–90 days, audited in `trial_extensions` + `subscription_history`, notifies org). Expiry triggers a lazy downgrade to Free (`hasValidAccess` → `downgradeToFree`).
- Limits: per-plan columns + per-org `organization_limit_overrides`. Enforced in two layers: app-layer pre-check (`enforcePlanLimit`, uses `get_effective_limits`) and DB atomic triggers (migration 167, **uses `get_plan_limit` which ignores overrides** — bug).
- Superadmin auth: env `SUPERADMIN_EMAILS` (not a DB role); middleware injects headers; API routes call `requireSuperadmin()`.
- Stack: Next.js App Router, Supabase (`supabaseAdmin`), NextAuth, Tailwind + shadcn/ui, Zod. Mutations go through `app/api/` routes (no Next Server Actions). Client uses `useSuperadminFetch` / `useSuperadminMutation`.

---

## 2. Goals / Non-Goals

**Goals**
- Make every per-org administrative action reachable from one page (layout A, single-page).
- Prevent irreversible accidents (soft-delete instead of default hard-delete).
- Make per-org limit overrides actually enforced at every layer.
- Allow changing an org's plan to any active plan (not only Profesional).

**Non-Goals (this spec)**
- Impersonation, per-org feature flags, trial shortening/removal, suspend-with-reason → Phase 2.
- Manual payment / credit note / refund, superadmin 2FA → Phase 3.
- Any change to the tenant-facing app.

---

## 3. Phase 0 — Safety Net

### 3.1 Soft-delete for organizations

**Migration** (`supabase/migrations/NNN_org_soft_delete.sql`):
- Add to `organizations`: `deleted_at TIMESTAMPTZ NULL`, `deleted_by TEXT NULL`, `archived_reason TEXT NULL`.
- Index on `deleted_at` for list filtering.

**API changes**
- `DELETE /api/superadmin/organizations/[id]` → default behavior becomes **archive**: set `deleted_at = now()`, `deleted_by = <superadmin email>`, optional `archived_reason`. Returns `{ ok: true, archived: true }`.
- Hard purge (current CASCADE delete + storage cleanup) is retained but gated behind explicit `?hard=true` AND a confirmation token equal to the org `slug` in the request body. Keep the existing guard preventing deletion of `slug='superadmin'`.
- New `POST /api/superadmin/organizations/[id]/restore` → clears `deleted_at/deleted_by/archived_reason`. Returns `{ ok: true }`.
- `GET /api/superadmin/organizations` (list) → excludes archived by default; accepts `?includeArchived=true` (and/or `?status=archived`) to show them.

**Middleware** (`middleware.ts` → `getTenantStatusBySlug`)
- Treat `deleted_at IS NOT NULL` the same as `activo = false`: tenant routes return 403 (API) / redirect to `/tenant-not-found` (UI). Respect the existing 30s cache TTL.

**Audit**: write archive/restore/hard-delete to the existing superadmin audit log.

### 3.2 Fix limit-override enforcement at DB layer

**Migration** (`supabase/migrations/NNN_fix_get_plan_limit_overrides.sql`):
- Redefine `get_plan_limit(org_id, limit_type)` so it returns `COALESCE(override_value, plan_limit)` by reading `organization_limit_overrides` (i.e. align it with `get_effective_limits`).
- The atomic triggers from migration 167 call `get_plan_limit`, so this single change makes DB-layer enforcement honor per-org overrides — matching the app-layer pre-check. No trigger rewrite needed if the function is the single source.
- Verify both `enforcePlanLimit` (app-layer) and the triggers resolve the same effective limit after the change.

---

## 4. Phase 1 — Per-Org Command Center

### 4.1 Page

`app/superadmin/organizaciones/[id]/page.tsx` rebuilt as a single-page command center (layout A). The current 5-tab component is replaced by stacked sections. Server component loads initial data; interactive pieces are client components.

### 4.2 Components (`components/superadmin/org/`)

Each component is isolated, receives data via props, and owns its own action dialogs. None reads global state directly.

| Component | Purpose | Inputs | Actions it owns |
|---|---|---|---|
| `OrgCommandHeader` | Name, slug, contact, status badges (activo, plan, trial countdown + date, health, age) | org, subscription, health | — |
| `OrgQuickActions` | Always-visible action bar | org, subscription | opens dialogs: Extend trial, Change plan, Override limits, Archive |
| `OrgResumen` | KPI grid (orders/month, clients, technicians, branches, storage, MRR, last login, health) | usage, subscription | — |
| `OrgSubscriptionTrial` | Plan/status/trial_end/period/provider + history timeline | subscription, trialHistory | Extend trial, Change plan, Cancel, Activate Premium |
| `OrgLimitsUsage` | Effective limits vs usage (bars), shows overrides | effectiveLimits, usage | Override limits dialog |
| `OrgUsers` | User list (role, status, last login) | users | per-user: change role, reset password, toggle active, verify email |
| `OrgPayments` | Payment history + reconcile MP (lazy) | lazy fetch | Reconcile MercadoPago |
| `OrgActivity` | Superadmin audit timeline for this org (lazy) | lazy fetch | — |

### 4.3 Data flow

- Extend `GET /api/superadmin/organizations/[id]` (already returns org + users + usage + subscription + payments) to also include: **trial history** (from `trial_extensions` / `subscription_history`), **effective limits** (`get_effective_limits`), **health score**.
- Heavy/secondary data (full payment history, audit timeline) loads **lazily** via dedicated sub-fetches so the initial page render is fast.
- All reads via `useSuperadminFetch`; all mutations via `useSuperadminMutation` → toast on result → refetch the affected slice.

### 4.4 Actions

Reuse existing endpoints unless noted:
- **Extend trial** → `POST /api/superadmin/trial-extension` (existing).
- **Change plan** → generalize `POST /api/superadmin/subscriptions/renew` to accept `plan_id` among **active** plans (today it hardcodes Profesional). Validate `plan_id` exists and is `activo=true`. This is the only backend change in Phase 1 beyond Phase 0.
- **Activate Premium / Cancel** → existing endpoints.
- **Override limits** → existing `POST/DELETE /api/superadmin/subscriptions/limit-overrides` (+ dialog UI).
- **Archive** → Phase 0 endpoint.

### 4.5 UX & error handling

- Each action is a shadcn `Dialog`. Destructive actions (archive, cancel) require confirmation; **archive requires typing the org `slug`**.
- API routes return `{ ok: true, ... } | { ok: false, error: string }` (consistent with the rest of the codebase); the frontend surfaces `error` via toast. Avoid relying on thrown errors (Next.js masks them in production).
- Optimistic UI is not required; refetch the affected slice after a successful mutation.

---

## 5. Testing

Vitest (matches the existing suite). Cover API/lib logic; UI is out of test scope for this phase.
- Archive sets `deleted_at`/`deleted_by`; hard purge requires `?hard=true` + slug token; `superadmin` org cannot be deleted.
- Restore clears archival fields.
- `get_plan_limit` returns the override when present (override-respecting enforcement). Cover via the app-layer/lib path that resolves effective limits.
- Generalized `renew` validates `plan_id` (rejects unknown/inactive plan; accepts a valid active plan).
- Middleware treats `deleted_at` as not-found (unit on `getTenantStatusBySlug` if testable, else document manual check).

---

## 6. File-level change map

**Phase 0**
- `supabase/migrations/NNN_org_soft_delete.sql` (new)
- `supabase/migrations/NNN_fix_get_plan_limit_overrides.sql` (new)
- `app/api/superadmin/organizations/[id]/route.ts` (DELETE → archive + hard gate)
- `app/api/superadmin/organizations/[id]/restore/route.ts` (new)
- `app/api/superadmin/organizations/route.ts` (list: archived filter)
- `middleware.ts` (`getTenantStatusBySlug`: deleted_at)

**Phase 1**
- `app/superadmin/organizaciones/[id]/page.tsx` (rebuild)
- `components/superadmin/org/*` (new components)
- `app/api/superadmin/organizations/[id]/route.ts` (GET: + trial history, effective limits, health)
- `app/api/superadmin/subscriptions/renew/route.ts` (accept `plan_id`)
- Possible new lazy endpoints for payments/audit if not already per-org filterable.

---

## 7. Risks

- **Override fix** touches a function used by atomic triggers under concurrency — verify it still rejects correctly and does not regress plan-only orgs.
- **Default archive** changes the meaning of the existing DELETE endpoint — ensure any caller (UI, bulk-delete) is updated consistently; bulk-delete should also archive by default.
- **Middleware change** runs on every tenant request — keep it cheap; reuse the existing cached status lookup.

---

## 8. Out of Scope (later phases)

- **Phase 2:** Impersonation (short-lived token, visible banner, audited, no billing access), per-org feature flags, trial shorten/remove + cumulative cap, suspend-with-reason + history.
- **Phase 3:** Manual payment / credit note / refund, superadmin 2FA.
