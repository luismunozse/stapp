# Superadmin Phase 0 — Safety Net Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make org administration safe before the command-center redesign: replace default hard-delete with soft-delete (archive/restore), and make per-org limit overrides actually enforced at the DB-trigger layer.

**Architecture:** Two DB migrations (soft-delete columns; override-aware `get_plan_limit`) plus changes to the superadmin org API routes and the Edge tenant-status lookup. Mutations keep the existing `requireSuperadmin()` + `supabaseAdmin` pattern and return `NextResponse.json`. Hard purge is retained but gated behind `?hard=true` + slug confirmation.

**Tech Stack:** Next.js App Router (route handlers), Supabase (`supabaseAdmin`, raw SQL migrations), Vitest with the existing `__tests__/api/helpers.ts` mock harness.

---

## File Structure

**New files**
- `supabase/migrations/215_org_soft_delete.sql` — `deleted_at`/`deleted_by`/`archived_reason` columns + index.
- `supabase/migrations/216_get_plan_limit_respects_overrides.sql` — override-aware `get_plan_limit`.
- `app/api/superadmin/organizations/[id]/restore/route.ts` — un-archive endpoint.
- `__tests__/api/superadmin-organizations.test.ts` — tests for archive/restore/hard-purge guard.

**Modified files**
- `app/api/superadmin/organizations/[id]/route.ts` — `DELETE` becomes archive by default; hard purge behind `?hard=true` + `confirmSlug`. `GET` (org lookup) selects `deleted_at`.
- `app/api/superadmin/organizations/route.ts` — exclude archived from list + KPIs unless `?includeArchived=true`.
- `app/api/superadmin/organizations/bulk-delete/route.ts` — archive by default (consistency).
- `lib/tenant-status-edge.ts` — treat `deleted_at IS NOT NULL` as "tenant not found".

**Note on the migration numbers:** `215`/`216` assume the next free numbers after the current highest migration. Before creating them, list `supabase/migrations/` and use the actual next integer if it differs; keep the descriptive suffixes.

---

## Task 1: Migration — org soft-delete columns

**Files:**
- Create: `supabase/migrations/215_org_soft_delete.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Soft-delete para organizations.
-- Reemplaza el hard-delete por defecto: archivar setea deleted_at; el borrado
-- permanente queda detras de un flag explicito en la API.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS deleted_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by      TEXT,        -- email del superadmin
  ADD COLUMN IF NOT EXISTS archived_reason TEXT;

-- Indice parcial: acelera el listado "no archivadas" (deleted_at IS NULL).
CREATE INDEX IF NOT EXISTS idx_organizations_not_deleted
  ON organizations (id)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN organizations.deleted_at IS
  'Soft-delete: si no es NULL, la org esta archivada y el tenant queda inaccesible.';
```

- [ ] **Step 2: Apply and verify manually**

Run (local Supabase): `supabase db push` (or apply the file via the project's migration command).
Verify:
```sql
\d organizations
-- Expect: deleted_at, deleted_by, archived_reason columns present.
SELECT indexname FROM pg_indexes WHERE tablename='organizations' AND indexname='idx_organizations_not_deleted';
-- Expect: one row.
```
Note: this repo has no DB integration-test harness, so migration verification is manual SQL — do not skip it.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/215_org_soft_delete.sql
git commit -m "feat(superadmin): columnas de soft-delete en organizations"
```

---

## Task 2: Migration — `get_plan_limit` respects per-org overrides

**Files:**
- Create: `supabase/migrations/216_get_plan_limit_respects_overrides.sql`

**Context:** `get_plan_limit(org_id, limit_type)` (migration 167) is called by the atomic enforcement triggers but reads only the plan, ignoring `organization_limit_overrides`. The app-layer pre-check uses `get_effective_limits` (migration 088) which DOES apply overrides. This task aligns the DB-trigger path. `NULL` means unlimited; an override value wins over the plan value via `COALESCE(override, plan)`.

- [ ] **Step 1: Write the migration**

```sql
-- get_plan_limit ahora respeta organization_limit_overrides (alinea el
-- enforcement de los triggers atomicos con el pre-check app-layer / get_effective_limits).
-- Semantica: NULL = ilimitado. El override por org tiene prioridad sobre el plan.

CREATE OR REPLACE FUNCTION get_plan_limit(org_id TEXT, limit_type TEXT)
RETURNS INTEGER AS $$
DECLARE
  v_plan_limit INTEGER;
  v_override   INTEGER;
  v_found      BOOLEAN := FALSE;
BEGIN
  -- Limite del plan activo
  SELECT
    CASE limit_type
      WHEN 'ordenes'    THEN p.limite_ordenes
      WHEN 'tecnicos'   THEN p.limite_tecnicos
      WHEN 'vendedores' THEN p.limite_vendedores
      WHEN 'clientes'   THEN p.limite_clientes
      WHEN 'storage'    THEN p.limite_storage_mb
    END
  INTO v_plan_limit
  FROM subscriptions s
  JOIN plans p ON s.plan_id = p.id
  WHERE s.organization_id = org_id
    AND s.status IN ('ACTIVE', 'TRIALING')
  LIMIT 1;

  GET DIAGNOSTICS v_found = ROW_COUNT;

  IF NOT v_found THEN
    -- Fallback Free para orgs sin suscripcion activa (igual que migration 167)
    RETURN CASE limit_type
      WHEN 'ordenes'    THEN 15
      WHEN 'tecnicos'   THEN 1
      WHEN 'vendedores' THEN 1
      WHEN 'clientes'   THEN 30
      WHEN 'storage'    THEN 100
    END;
  END IF;

  -- Override por org (si existe para ese tipo) tiene prioridad sobre el plan
  SELECT
    CASE limit_type
      WHEN 'ordenes'    THEN o.limite_ordenes
      WHEN 'tecnicos'   THEN o.limite_tecnicos
      WHEN 'vendedores' THEN o.limite_vendedores
      WHEN 'clientes'   THEN o.limite_clientes
      WHEN 'storage'    THEN o.limite_storage_mb
    END
  INTO v_override
  FROM organization_limit_overrides o
  WHERE o.organization_id = org_id
  LIMIT 1;

  RETURN COALESCE(v_override, v_plan_limit);
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_plan_limit(TEXT, TEXT) IS
  'Limite efectivo (plan + override por org) para un tipo. NULL = ilimitado. Fallback Free sin suscripcion activa.';
```

- [ ] **Step 2: Apply and verify manually**

Apply the migration, then verify the override wins:
```sql
-- Pre: una org con plan Profesional (limite_clientes NULL = ilimitado).
-- Setear override de clientes=5 y comprobar que get_plan_limit lo devuelve.
INSERT INTO organization_limit_overrides (organization_id, limite_clientes, motivo, aplicado_por)
VALUES ('<ORG_ID>', 5, 'test', 'admin@test')
ON CONFLICT (organization_id) DO UPDATE SET limite_clientes = EXCLUDED.limite_clientes;

SELECT get_plan_limit('<ORG_ID>', 'clientes');  -- Expect: 5
SELECT get_plan_limit('<ORG_ID>', 'ordenes');   -- Expect: NULL (sin override, plan ilimitado)

-- Limpieza
DELETE FROM organization_limit_overrides WHERE organization_id='<ORG_ID>' AND motivo='test';
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/216_get_plan_limit_respects_overrides.sql
git commit -m "fix(superadmin): get_plan_limit respeta overrides por org en triggers"
```

---

## Task 3: `DELETE` org → archive by default; hard purge gated

**Files:**
- Modify: `app/api/superadmin/organizations/[id]/route.ts` (DELETE handler ~lines 195-295; GET org lookup select ~line 84-86)
- Test: `__tests__/api/superadmin-organizations.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/api/superadmin-organizations.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  createChainMock,
  mockSupabaseFrom,
  parseResponse,
} from "./helpers"

// Superadmin routes auth via requireSuperadmin() (headers), not auth().
vi.mock("@/lib/superadmin-auth", () => ({
  requireSuperadmin: vi.fn().mockResolvedValue({ error: null, email: "admin@stapp.com.ar" }),
}))

import { DELETE } from "@/app/api/superadmin/organizations/[id]/route"

function req(url: string, body?: unknown): Request {
  return new Request(url, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

describe("DELETE /api/superadmin/organizations/[id]", () => {
  beforeEach(() => vi.clearAllMocks())

  it("archives (soft-delete) by default and sets deleted_at", async () => {
    const orgChain = createChainMock({ id: "o1", nombre: "GuruTech", slug: "guru-tech", deleted_at: null })
    const updateChain = createChainMock(null, null)
    const auditChain = createChainMock(null, null)
    // organizations.from() is used for both the lookup (.single) and the update.
    let orgCall = 0
    const orgRouter = {
      ...orgChain,
      update: vi.fn().mockReturnValue(updateChain),
    }
    mockSupabaseFrom({ organizations: orgRouter as any, audit_logs: auditChain })

    const res = await DELETE(req("http://localhost/api/superadmin/organizations/o1"), ctx("o1"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.archived).toBe(true)
    expect(orgRouter.update).toHaveBeenCalledWith(
      expect.objectContaining({ deleted_by: "admin@stapp.com.ar" })
    )
    const payload = orgRouter.update.mock.calls[0][0]
    expect(payload.deleted_at).toBeTruthy()
  })

  it("refuses to touch the superadmin org", async () => {
    const orgChain = createChainMock({ id: "s", nombre: "Admin", slug: "superadmin", deleted_at: null })
    mockSupabaseFrom({ organizations: orgChain })
    const res = await DELETE(req("http://localhost/api/superadmin/organizations/s"), ctx("s"))
    expect((await parseResponse(res)).status).toBe(403)
  })

  it("rejects hard purge without matching confirmSlug", async () => {
    const orgChain = createChainMock({ id: "o1", nombre: "GuruTech", slug: "guru-tech", deleted_at: null })
    mockSupabaseFrom({ organizations: orgChain })
    const res = await DELETE(
      req("http://localhost/api/superadmin/organizations/o1?hard=true", { confirmSlug: "wrong" }),
      ctx("o1")
    )
    expect((await parseResponse(res)).status).toBe(400)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run __tests__/api/superadmin-organizations.test.ts`
Expected: FAIL (current DELETE always hard-deletes; no `archived` field, no `confirmSlug` gate).

- [ ] **Step 3: Rewrite the DELETE handler**

In `app/api/superadmin/organizations/[id]/route.ts`, replace the entire `DELETE` function (lines 190-295) with:

```ts
/**
 * DELETE /api/superadmin/organizations/[id]
 * Por defecto ARCHIVA (soft-delete: setea deleted_at). El tenant queda inaccesible
 * pero los datos se preservan y se pueden restaurar.
 * Borrado permanente (CASCADE + limpieza de storage): solo con ?hard=true y
 * confirmSlug === slug de la org en el body.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error: authError, email } = await requireSuperadmin()
    if (authError) return authError

    const { id } = await params
    const hard = new URL(request.url).searchParams.get("hard") === "true"

    const { data: org, error: orgError } = await supabaseAdmin
      .from("organizations")
      .select("id, nombre, slug, deleted_at")
      .eq("id", id)
      .single()

    if (orgError || !org) {
      return NextResponse.json({ error: "Organización no encontrada" }, { status: 404 })
    }
    if (org.slug === "superadmin") {
      return NextResponse.json(
        { error: "No se puede eliminar la organización del panel admin" },
        { status: 403 }
      )
    }

    // ── Soft-delete (default) ──
    if (!hard) {
      if (org.deleted_at) {
        return NextResponse.json({ error: "La organización ya está archivada" }, { status: 409 })
      }
      let reason: string | null = null
      try {
        const body = await request.json()
        if (body && typeof body.reason === "string") reason = body.reason
      } catch {
        // sin body es válido
      }

      const { error: archiveError } = await supabaseAdmin
        .from("organizations")
        .update({
          deleted_at: new Date().toISOString(),
          deleted_by: email,
          archived_reason: reason,
        })
        .eq("id", id)

      if (archiveError) {
        console.error("Error archiving organization:", archiveError)
        return NextResponse.json({ error: "Error al archivar la organización" }, { status: 500 })
      }

      try {
        await supabaseAdmin.from("audit_logs").insert({
          organization_id: id,
          user_id: null,
          action: "ARCHIVE",
          entity: "organizations",
          entity_id: id,
          changes: { superadmin_email: email, reason },
        })
      } catch {
        // best effort
      }

      return NextResponse.json({
        success: true,
        archived: true,
        message: `Organización "${org.nombre}" archivada`,
      })
    }

    // ── Hard purge (requiere confirmación explícita) ──
    let confirmSlug: string | undefined
    try {
      const body = await request.json()
      confirmSlug = body?.confirmSlug
    } catch {
      // sin body → confirmSlug undefined → rechazo abajo
    }
    if (confirmSlug !== org.slug) {
      return NextResponse.json(
        { error: "Confirmación inválida: repetí el slug exacto para el borrado permanente" },
        { status: 400 }
      )
    }

    // Limpiar archivos de storage (best effort)
    const bucketsToClean = [
      STORAGE_BUCKETS.FOTOS_ORDENES,
      STORAGE_BUCKETS.FOTOS_INVENTARIO,
      STORAGE_BUCKETS.LOGOS,
      STORAGE_BUCKETS.FIRMAS,
      STORAGE_BUCKETS.AVATARS,
      STORAGE_BUCKETS.COMPROBANTES_GASTOS,
    ]
    await Promise.allSettled(
      bucketsToClean.map(async (bucket) => {
        try {
          const { data: files } = await supabaseAdmin.storage.from(bucket).list(id, { limit: 1000 })
          if (files && files.length > 0) {
            await supabaseAdmin.storage.from(bucket).remove(files.map((f) => `${id}/${f.name}`))
          }
        } catch {
          // best effort
        }
      })
    )

    const { error: deleteError } = await supabaseAdmin
      .from("organizations")
      .delete()
      .eq("id", id)

    if (deleteError) {
      console.error("Error deleting organization:", deleteError)
      return NextResponse.json({ error: "Error al eliminar la organización" }, { status: 500 })
    }

    try {
      await supabaseAdmin.from("audit_logs").insert({
        organization_id: null,
        user_id: null,
        action: "DELETE",
        entity: "organizations",
        entity_id: id,
        changes: {
          deleted_org: { id, nombre: org.nombre, slug: org.slug },
          superadmin_email: email,
        },
      })
    } catch {
      // best effort
    }

    return NextResponse.json({
      success: true,
      archived: false,
      message: `Organización "${org.nombre}" eliminada permanentemente`,
    })
  } catch (error) {
    console.error("Error in DELETE /api/superadmin/organizations/[id]:", error)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/api/superadmin-organizations.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/superadmin/organizations/[id]/route.ts __tests__/api/superadmin-organizations.test.ts
git commit -m "feat(superadmin): archivar org por defecto, hard-delete con confirmacion"
```

---

## Task 4: Restore endpoint

**Files:**
- Create: `app/api/superadmin/organizations/[id]/restore/route.ts`
- Test: `__tests__/api/superadmin-organizations.test.ts` (append)

- [ ] **Step 1: Write the failing test (append to the existing file)**

Add this import at the top of `__tests__/api/superadmin-organizations.test.ts`:
```ts
import { POST as RESTORE } from "@/app/api/superadmin/organizations/[id]/restore/route"
```
Add this describe block:
```ts
describe("POST /api/superadmin/organizations/[id]/restore", () => {
  beforeEach(() => vi.clearAllMocks())

  it("clears the archival fields", async () => {
    const updateChain = createChainMock(null, null)
    const orgRouter = {
      ...createChainMock({ id: "o1", slug: "guru-tech", deleted_at: "2026-06-01T00:00:00Z" }),
      update: vi.fn().mockReturnValue(updateChain),
    }
    mockSupabaseFrom({ organizations: orgRouter as any, audit_logs: createChainMock(null, null) })

    const r = new Request("http://localhost/api/superadmin/organizations/o1/restore", { method: "POST" })
    const res = await RESTORE(r, { params: Promise.resolve({ id: "o1" }) })
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    const payload = orgRouter.update.mock.calls[0][0]
    expect(payload).toEqual(
      expect.objectContaining({ deleted_at: null, deleted_by: null, archived_reason: null })
    )
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run __tests__/api/superadmin-organizations.test.ts -t restore`
Expected: FAIL (module does not exist).

- [ ] **Step 3: Implement the restore route**

Create `app/api/superadmin/organizations/[id]/restore/route.ts`:
```ts
import { NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"

/**
 * POST /api/superadmin/organizations/[id]/restore
 * Restaura una org archivada (limpia deleted_at/deleted_by/archived_reason).
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error: authError, email } = await requireSuperadmin()
    if (authError) return authError

    const { id } = await params

    const { data: org, error: orgError } = await supabaseAdmin
      .from("organizations")
      .select("id, nombre, slug, deleted_at")
      .eq("id", id)
      .single()

    if (orgError || !org) {
      return NextResponse.json({ error: "Organización no encontrada" }, { status: 404 })
    }
    if (!org.deleted_at) {
      return NextResponse.json({ error: "La organización no está archivada" }, { status: 409 })
    }

    const { error: updateError } = await supabaseAdmin
      .from("organizations")
      .update({ deleted_at: null, deleted_by: null, archived_reason: null })
      .eq("id", id)

    if (updateError) {
      console.error("Error restoring organization:", updateError)
      return NextResponse.json({ error: "Error al restaurar la organización" }, { status: 500 })
    }

    try {
      await supabaseAdmin.from("audit_logs").insert({
        organization_id: id,
        user_id: null,
        action: "RESTORE",
        entity: "organizations",
        entity_id: id,
        changes: { superadmin_email: email },
      })
    } catch {
      // best effort
    }

    return NextResponse.json({ success: true, message: `Organización "${org.nombre}" restaurada` })
  } catch (error) {
    console.error("Error in POST restore:", error)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run __tests__/api/superadmin-organizations.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add "app/api/superadmin/organizations/[id]/restore/route.ts" __tests__/api/superadmin-organizations.test.ts
git commit -m "feat(superadmin): endpoint restore para orgs archivadas"
```

---

## Task 5: List route excludes archived orgs

**Files:**
- Modify: `app/api/superadmin/organizations/route.ts` (main query ~lines 102-116; KPI total queries ~lines 364-389; `includeArchived` parse near line 17)
- Test: `__tests__/api/superadmin-organizations-list.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/api/superadmin-organizations-list.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { createChainMock, mockSupabaseFrom, createGetRequest, parseResponse } from "./helpers"

vi.mock("@/lib/superadmin-auth", () => ({
  requireSuperadmin: vi.fn().mockResolvedValue({ error: null, email: "admin@stapp.com.ar" }),
}))

import { GET } from "@/app/api/superadmin/organizations/route"

describe("GET /api/superadmin/organizations — archived filter", () => {
  beforeEach(() => vi.clearAllMocks())

  it("excludes archived orgs by default (filters deleted_at IS NULL)", async () => {
    const orgChain = createChainMock([], null, 0)
    // users / subscriptions / audit_logs default chains
    mockSupabaseFrom({
      organizations: orgChain,
      users: createChainMock([]),
      subscriptions: createChainMock([]),
      audit_logs: createChainMock([]),
    })

    await GET(createGetRequest("http://localhost/api/superadmin/organizations"))

    // The main list query must constrain deleted_at to NULL.
    expect(orgChain.is).toHaveBeenCalledWith("deleted_at", null)
  })

  it("includes archived when includeArchived=true", async () => {
    const orgChain = createChainMock([], null, 0)
    mockSupabaseFrom({
      organizations: orgChain,
      users: createChainMock([]),
      subscriptions: createChainMock([]),
      audit_logs: createChainMock([]),
    })

    await GET(createGetRequest("http://localhost/api/superadmin/organizations?includeArchived=true"))

    expect(orgChain.is).not.toHaveBeenCalledWith("deleted_at", null)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run __tests__/api/superadmin-organizations-list.test.ts`
Expected: FAIL (no `deleted_at` filter applied yet).

- [ ] **Step 3: Add the filter**

In `app/api/superadmin/organizations/route.ts`:

(a) After the existing `dir` parse (around line 18), add:
```ts
    const includeArchived = searchParams.get("includeArchived") === "true"
```

(b) Immediately after the main query is created with `.order(sortColumn, { ascending })` (around line 116), add:
```ts
    // Por defecto ocultar organizaciones archivadas (soft-delete)
    if (!includeArchived) {
      query = query.is("deleted_at", null)
    }
```

(c) In the KPI block, constrain the "total" and "active" counts to non-archived. Replace the `totalRes` and `trialRes` query builders (around lines 366-375) so each ends with `.is("deleted_at", null)`:
```ts
        // Total de orgs activas (no archivadas)
        supabaseAdmin
          .from("organizations")
          .select("id", { count: "exact", head: true })
          .eq("activo", true)
          .is("deleted_at", null),
        // Activas en trial (no archivadas)
        supabaseAdmin
          .from("organizations")
          .select("id", { count: "exact", head: true })
          .eq("activo", true)
          .is("deleted_at", null),
```
And the `newRes` query (new orgs this month) similarly gets `.is("deleted_at", null)` appended.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run __tests__/api/superadmin-organizations-list.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/superadmin/organizations/route.ts __tests__/api/superadmin-organizations-list.test.ts
git commit -m "feat(superadmin): listado oculta orgs archivadas (includeArchived opt-in)"
```

---

## Task 6: Edge tenant-status treats archived as not-found

**Files:**
- Modify: `lib/tenant-status-edge.ts` (select + mapping)
- Test: `lib/__tests__/tenant-status-edge.test.ts`

**Context:** The middleware calls `getTenantStatusBySlug`. Today it selects `id,activo`. Archived orgs must be treated like a non-existent tenant (return `status: null`), so the middleware redirects to `/tenant-not-found`.

- [ ] **Step 1: Write the failing test**

Create `lib/__tests__/tenant-status-edge.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { getTenantStatusBySlug } from "@/lib/tenant-status-edge"

describe("getTenantStatusBySlug — archived orgs", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co"
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key"
  })

  it("returns status null when the org is archived (deleted_at set)", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify([{ id: "o1", activo: true, deleted_at: "2026-06-01T00:00:00Z" }]), { status: 200 })
    )
    const res = await getTenantStatusBySlug("archived-org-unique-1")
    expect(res).toEqual({ kind: "ok", status: null })
  })

  it("returns the org when not archived", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify([{ id: "o2", activo: true, deleted_at: null }]), { status: 200 })
    )
    const res = await getTenantStatusBySlug("live-org-unique-2")
    expect(res).toEqual({ kind: "ok", status: { id: "o2", activo: true } })
  })
})
```
(Use unique slugs per test to avoid the module-level in-memory cache returning a stale entry.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/__tests__/tenant-status-edge.test.ts`
Expected: FAIL (current code doesn't select or honor `deleted_at`).

- [ ] **Step 3: Update the lookup**

In `lib/tenant-status-edge.ts`:

(a) Change the select URL (line 43-45) to include `deleted_at`:
```ts
  const url = `${base}/rest/v1/organizations?slug=eq.${encodeURIComponent(
    slug
  )}&select=id,activo,deleted_at&limit=1`
```

(b) Change the row typing + mapping (lines 58-60) so archived rows map to `null`:
```ts
    const rows = (await res.json()) as Array<TenantStatus & { deleted_at: string | null }>
    const row = rows[0]
    const data: TenantStatus | null =
      row && !row.deleted_at ? { id: row.id, activo: row.activo } : null
    store.set(slug, { data, expiresAt: now + TTL_MS })
    return { kind: "ok", status: data }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/__tests__/tenant-status-edge.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/tenant-status-edge.ts lib/__tests__/tenant-status-edge.test.ts
git commit -m "feat(superadmin): tenant archivado se trata como inexistente en middleware"
```

---

## Task 7: Bulk-delete archives by default

**Files:**
- Modify: `app/api/superadmin/organizations/bulk-delete/route.ts`
- Test: `__tests__/api/superadmin-bulk-delete.test.ts`

**Context:** Read the current handler first to match its request/response shape (it accepts a list of org IDs). The goal: by default it should **archive** each org (set `deleted_at`/`deleted_by`) instead of CASCADE-deleting, skipping the `superadmin` org. Keep a `hard: true` body flag for permanent purge (no per-slug confirmation in bulk — require `hard` plus a top-level `confirm: true`).

- [ ] **Step 1: Read the current handler**

Run: open `app/api/superadmin/organizations/bulk-delete/route.ts` and note the input schema (the IDs field name) and response shape. Reuse them exactly.

- [ ] **Step 2: Write the failing test**

Create `__tests__/api/superadmin-bulk-delete.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { createChainMock, mockSupabaseFrom, parseResponse } from "./helpers"

vi.mock("@/lib/superadmin-auth", () => ({
  requireSuperadmin: vi.fn().mockResolvedValue({ error: null, email: "admin@stapp.com.ar" }),
}))

import { POST } from "@/app/api/superadmin/organizations/bulk-delete/route"

function postJson(body: unknown): Request {
  return new Request("http://localhost/api/superadmin/organizations/bulk-delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST bulk-delete — archive by default", () => {
  beforeEach(() => vi.clearAllMocks())

  it("archives the given orgs (update with deleted_at), not CASCADE delete", async () => {
    const updateChain = createChainMock(null, null)
    const orgRouter = {
      ...createChainMock([{ id: "o1", slug: "a" }, { id: "o2", slug: "b" }]),
      update: vi.fn().mockReturnValue(updateChain),
      delete: vi.fn().mockReturnValue(createChainMock(null, null)),
    }
    mockSupabaseFrom({ organizations: orgRouter as any, audit_logs: createChainMock(null, null) })

    // Use the SAME field name the handler expects (confirm in Step 1).
    const res = await POST(postJson({ ids: ["o1", "o2"] }))
    const { status } = await parseResponse(res)

    expect(status).toBe(200)
    expect(orgRouter.update).toHaveBeenCalled()
    expect(orgRouter.delete).not.toHaveBeenCalled()
  })
})
```
If Step 1 reveals the IDs field is named differently (e.g. `organizationIds`), update the test body accordingly before running.

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run __tests__/api/superadmin-bulk-delete.test.ts`
Expected: FAIL (current handler calls `.delete()`).

- [ ] **Step 4: Implement archive-by-default**

Edit `app/api/superadmin/organizations/bulk-delete/route.ts`: for the non-`hard` path, replace the `.delete()` over the ID list with an update setting `deleted_at = new Date().toISOString()`, `deleted_by = email`, excluding `slug = 'superadmin'`. Keep the `hard: true` + `confirm: true` branch doing the existing CASCADE behavior. Write an `audit_logs` row with `action: "ARCHIVE"` (bulk). Preserve the handler's existing response shape (counts/message).

Concrete update call:
```ts
    const { error: archiveError } = await supabaseAdmin
      .from("organizations")
      .update({ deleted_at: new Date().toISOString(), deleted_by: email })
      .in("id", ids)
      .neq("slug", "superadmin")
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run __tests__/api/superadmin-bulk-delete.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full suite + typecheck**

Run: `npx vitest run` and `npx tsc --noEmit`
Expected: new tests pass; no new TypeScript errors in the modified files. Pre-existing unrelated failures (if any) are out of scope — note them, don't fix here.

- [ ] **Step 7: Commit**

```bash
git add app/api/superadmin/organizations/bulk-delete/route.ts __tests__/api/superadmin-bulk-delete.test.ts
git commit -m "feat(superadmin): bulk-delete archiva por defecto"
```

---

## Self-Review (author check)

- **Spec coverage:** Phase 0 of the design spec has two items — soft-delete (Tasks 1, 3, 4, 5, 6, 7) and override-enforcement fix (Task 2). Both covered.
- **Placeholders:** None — every step has concrete SQL/TS/test code. Migration numbers flagged as "verify next free integer" (operational, not a content placeholder). Task 7 intentionally defers to the existing handler's field name (Step 1 reads it) because the bulk-delete request shape wasn't captured during exploration — the test note instructs aligning the field name before running.
- **Type/name consistency:** Archival fields `deleted_at` / `deleted_by` / `archived_reason` used identically across migration, DELETE, restore, list, edge lookup, and bulk-delete. `confirmSlug` (hard purge) consistent between handler and test. `get_plan_limit(org_id, limit_type)` signature unchanged.
- **Scope:** Backend only; no UI. Command-center UI is Phase 1 (separate plan).
