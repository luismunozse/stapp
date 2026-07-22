# Optional Inventory Management for VENDEDOR — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Org-level opt-in toggle (default off) that lets VENDEDOR users manage inventory; ADMIN behavior unchanged everywhere.

**Architecture:** New `requireInventarioAccess()` (ADMIN always; VENDEDOR iff `organizations.vendedores_administran_inventario`; fail-closed) swapped 1:1 into every route under `app/api/inventario/`. The toggle rides the existing `modulo_agenda` infrastructure: `/api/configuracion` PUT ↔ column, `/api/org/features` GET → navbar, `stapp:org-features-updated` event for live refresh.

**Tech Stack:** Next.js App Router, TypeScript, Supabase, vitest, NextAuth (`useSession`).

**Spec:** `docs/superpowers/specs/2026-07-21-vendedor-inventario-design.md`

## Global Constraints

- Column: `vendedores_administran_inventario BOOLEAN NOT NULL DEFAULT false` on `organizations`. Migration number `275` (274 is the last; re-verify at execution).
- Fail-closed: any error/null reading the column ⇒ VENDEDOR denied (identical to today). TECNICO never passes.
- API field name (camelCase in configuracion/features payloads): `vendedoresAdministranInventario`.
- `requireInventarioAccess()` must have the SAME return contract as `requireAdmin()` so the sweep is a drop-in.
- Sweep scope: `app/api/inventario/**` ONLY (32 files at design time — sweep by grep, not fixed list). `ordenes-compra`, `proveedores` untouched.
- ADMIN must see Inventario in the nav regardless of the flag; VENDEDOR only with flag on.
- UI copy Spanish voseo consistent with `configuracion-form.tsx`.
- Conventional commits, no AI attribution. Delivery: PR1 = Tasks 1–4 (invisible), PR2 = Tasks 5–7 (visible). Branches: `feat/vendedor-inventario` (from main), then `feat/vendedor-inventario-2` (from PR1 head).
- Deploy order: merge PR1 → apply migration 275 → merge PR2 (PR1 is safe pre-migration thanks to fail-closed).

---

### Task 0: Branch setup

- [ ] **Step 1:** `git checkout main && git pull --ff-only && git checkout -b feat/vendedor-inventario`
- [ ] **Step 2:** `git add docs/superpowers/specs/2026-07-21-vendedor-inventario-design.md docs/superpowers/plans/2026-07-21-vendedor-inventario.md && git commit -m "docs(inventario): spec y plan del permiso opcional de inventario para vendedores"`

---

### Task 1: Migration 275

**Files:** Create `supabase/migrations/275_vendedores_administran_inventario.sql`

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================================
-- 275: permiso opcional para que VENDEDORES administren inventario
-- ============================================================================
-- Toggle por organización (default apagado): muchos admins NO quieren que los
-- vendedores toquen inventario, así que el acceso es opt-in explícito.
-- Preferencia de la org (como modulo_agenda) — NO va en plans.feature_flags,
-- que es gating comercial por plan.
-- ============================================================================

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS vendedores_administran_inventario BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN organizations.vendedores_administran_inventario IS
  'Si true, los usuarios con rol VENDEDOR pueden administrar inventario (productos, stock, depósitos, ajustes, conteos). Default false: solo ADMIN.';
```

- [ ] **Step 2:** Self-review vs `265`/`274` conventions (banner, idempotent). Commit:

```bash
git add supabase/migrations/275_vendedores_administran_inventario.sql
git commit -m "feat(inventario): migración 275 — flag de org vendedores_administran_inventario"
```

---

### Task 2: Access helper + pure rule + dead-code removal

**Files:**
- Modify: `lib/auth-utils.ts` (add pure fn + async helper; DELETE unused `canManageInventory`)
- Modify: `lib/__tests__/auth-utils.test.ts` (replace `canManageInventory` describe-block with the new pure fn's)

**Interfaces:**
- Produces: `export function hasInventarioAccess(role: string | null, vendedoresHabilitados: boolean): boolean` (pure) and `export async function requireInventarioAccess()` with the exact return shape of `requireAdmin()`.
- Note: `canManageInventory` is deleted — it is used ONLY by its own tests (verified by grep) and would lie about the new rule if left.

- [ ] **Step 1: Update the test file (TDD)** — in `lib/__tests__/auth-utils.test.ts`, remove the `canManageInventory` import and describe-block; add:

```ts
import { hasInventarioAccess, canCreateOrders } from '../auth-utils'

describe('hasInventarioAccess', () => {
  it('ADMIN accede siempre, con flag apagado o prendido', () => {
    expect(hasInventarioAccess('ADMIN', false)).toBe(true)
    expect(hasInventarioAccess('ADMIN', true)).toBe(true)
  })
  it('VENDEDOR accede solo con el flag de la org prendido', () => {
    expect(hasInventarioAccess('VENDEDOR', true)).toBe(true)
    expect(hasInventarioAccess('VENDEDOR', false)).toBe(false)
  })
  it('TECNICO nunca accede, incluso con flag prendido', () => {
    expect(hasInventarioAccess('TECNICO', true)).toBe(false)
  })
  it('rol nulo/vacío/desconocido nunca accede', () => {
    expect(hasInventarioAccess(null, true)).toBe(false)
    expect(hasInventarioAccess('', true)).toBe(false)
    expect(hasInventarioAccess('admin', true)).toBe(false) // case sensitive
  })
})
```

(keep the `canCreateOrders` block untouched)

- [ ] **Step 2:** `npx vitest run lib/__tests__/auth-utils.test.ts` — Expected: FAIL (`hasInventarioAccess` not exported)

- [ ] **Step 3: Implement in `lib/auth-utils.ts`** — delete `canManageInventory`; where it was, add:

```ts
// Regla pura de acceso a administración de inventario.
// ADMIN siempre; VENDEDOR solo si la org habilitó el permiso (opt-in,
// default apagado); TECNICO y cualquier otro rol, nunca.
export function hasInventarioAccess(
  role: string | null,
  vendedoresHabilitados: boolean
): boolean {
  if (role === "ADMIN") return true
  if (role === "VENDEDOR") return vendedoresHabilitados
  return false
}

// Guard de endpoints de inventario. Mismo contrato que requireAdmin() para
// swap 1:1. Fail-closed: si la columna no existe o la lectura falla,
// el VENDEDOR queda denegado (idéntico al comportamiento histórico).
export async function requireInventarioAccess() {
  const result = await requireAuth()
  if (result.error) return result

  if (result.role === "ADMIN") return result

  let vendedoresHabilitados = false
  if (result.role === "VENDEDOR") {
    try {
      const { data } = await supabaseAdmin
        .from("organizations")
        .select("vendedores_administran_inventario")
        .eq("id", result.organizationId!)
        .single()
      vendedoresHabilitados = data?.vendedores_administran_inventario === true
    } catch {
      vendedoresHabilitados = false
    }
  }

  if (!hasInventarioAccess(result.role, vendedoresHabilitados)) {
    return {
      error: NextResponse.json({ error: "Acceso denegado" }, { status: 403 }),
      session: null,
      organizationId: null,
      userId: null,
      role: null,
    }
  }
  return result
}
```

(check `supabaseAdmin` is already imported in `lib/auth-utils.ts`; if not, add `import { supabaseAdmin } from "@/lib/supabase"`. Match the 403 shape to `requireAdmin`'s exactly as it exists in the file.)

- [ ] **Step 4:** `npx vitest run lib/__tests__/auth-utils.test.ts` — PASS. `npx tsc --noEmit` — clean.
- [ ] **Step 5:** Commit:

```bash
git add lib/auth-utils.ts lib/__tests__/auth-utils.test.ts
git commit -m "feat(inventario): requireInventarioAccess — ADMIN siempre, VENDEDOR según flag de org (fail-closed)"
```

---

### Task 3: Backend sweep + sweep-guard test

**Files:**
- Modify: every `route.ts` under `app/api/inventario/` that imports `requireAdmin` (32 at design time)
- Create: `lib/__tests__/inventario-access-sweep.test.ts`

- [ ] **Step 1: Write the sweep-guard test (TDD)** — `lib/__tests__/inventario-access-sweep.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

// Guard arquitectónico: ningún endpoint de inventario debe usar requireAdmin
// directo — el acceso va por requireInventarioAccess (ADMIN siempre,
// VENDEDOR según flag de org). Si agregás un endpoint nuevo, usá el helper.
function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return routeFiles(full)
    return name === 'route.ts' ? [full] : []
  })
}

describe('endpoints de inventario', () => {
  const files = routeFiles(join(process.cwd(), 'app', 'api', 'inventario'))

  it('existen endpoints que auditar', () => {
    expect(files.length).toBeGreaterThanOrEqual(30)
  })

  it('ninguno usa requireAdmin — todos van por requireInventarioAccess', () => {
    const ofensores = files.filter((f) => readFileSync(f, 'utf8').includes('requireAdmin'))
    expect(ofensores).toEqual([])
  })
})
```

- [ ] **Step 2:** Run it — Expected: FAIL (32 offenders listed).
- [ ] **Step 3: Sweep** — for each file under `app/api/inventario/**/route.ts`: replace the `requireAdmin` import specifier with `requireInventarioAccess` (keep other specifiers like `requireAuth` intact) and every `await requireAdmin()` call with `await requireInventarioAccess()`. Purely mechanical — no other edits.
- [ ] **Step 4:** `npx vitest run lib/__tests__/inventario-access-sweep.test.ts` — PASS. `npx tsc --noEmit` — clean. `npx vitest run lib/__tests__/ __tests__/api/` — no regressions.
- [ ] **Step 5:** Commit:

```bash
git add app/api/inventario/ lib/__tests__/inventario-access-sweep.test.ts
git commit -m "feat(inventario): endpoints de inventario usan requireInventarioAccess (barrido + guard test)"
```

---

### Task 4: PR1

- [ ] **Step 1:** `npx vitest run` full suite (known pre-existing failure: `orden-form-dispositivo-error`), `npx tsc --noEmit`, `npm run build`.
- [ ] **Step 2:** Push + PR to main. Title: `feat(inventario): infraestructura del permiso opcional de inventario para vendedores`. Body: invisible change (flag default false, sin UI), spec link, deploy note (aplicar 275 tras merge; fail-closed lo hace seguro antes), y que PR2 trae el toggle visible.

---

### Task 5: Config + features endpoints (PR2 — branch `feat/vendedor-inventario-2` from PR1 head)

**Files:**
- Modify: `app/api/configuracion/route.ts` (GET mapping + PUT handling, mirror `modulo_agenda` exactly, including the `PGRST204` fallback-retry pattern for missing column)
- Modify: `app/api/org/features/route.ts` (expose the new flag)

**Interfaces:**
- Produces: GET/PUT `/api/configuracion` field `vendedoresAdministranInventario: boolean`; GET `/api/org/features` → `{ moduloAgenda, vendedoresAdministranInventario }`.

- [ ] **Step 1:** In `app/api/configuracion/route.ts`, replicate every `modulo_agenda` / `moduloAgenda` touchpoint for the new column (read-mapping in GET response, `if (vendedoresAdministranInventario !== undefined) updateData.vendedores_administran_inventario = !!vendedoresAdministranInventario` in PUT, select cols list, PGRST204 fallback list). Grep `modulo_agenda` in the file and mirror each hit.
- [ ] **Step 2:** In `app/api/org/features/route.ts`, extend the select to `"modulo_agenda, vendedores_administran_inventario"` and the response with `vendedoresAdministranInventario: !!data?.vendedores_administran_inventario`.
- [ ] **Step 3:** `npx tsc --noEmit` clean; if `__tests__/api/` has a configuracion/features test, run it; commit:

```bash
git add app/api/configuracion/route.ts app/api/org/features/route.ts
git commit -m "feat(inventario): vendedoresAdministranInventario en configuración y org/features"
```

---

### Task 6: Toggle in Configuración form

**Files:** Modify `components/configuracion/configuracion-form.tsx`

- [ ] **Step 1:** Mirror the `moduloAgenda` pattern: state `const [vendedoresAdministranInventario, setVendedoresAdministranInventario] = useState(false)`, hydrate from GET, include in PUT body, and render a switch near the module toggles:
  - Label: `Los vendedores pueden administrar inventario`
  - Helper text: `Permite a los usuarios con rol Vendedor gestionar productos, stock, depósitos, ajustes y conteos. Apagado, solo los administradores acceden.`
  - Reuse the exact switch/row markup used by the `moduloAgenda` toggle (grep it in the file).
  - The existing `handleSave` already dispatches `stapp:org-features-updated` — no extra wiring.
- [ ] **Step 2:** `npx tsc --noEmit` clean. Commit:

```bash
git add components/configuracion/configuracion-form.tsx
git commit -m "feat(inventario): toggle de inventario para vendedores en Configuración"
```

---

### Task 7: Navbar + page gate

**Files:**
- Modify: `components/layout/navbar.tsx`
- Modify: `app/(dashboard)/inventario/page.tsx`

- [ ] **Step 1: Navbar.** In `navbar.tsx`:
  1. Extend org-features state and its fetch: `{ moduloAgenda: boolean; vendedoresAdministranInventario: boolean }`, populated from the updated `/api/org/features` response.
  2. Extend `NavItem` with `vendedorFeatureFlag?: "vendedoresAdministranInventario"` (the existing `featureFlag` hides a module for EVERYONE when off — wrong semantics here: ADMIN must always see Inventario).
  3. Change the Inventario entries (flat `navItems`, `navSections`) from `roles: ["ADMIN"]` to `roles: ["ADMIN", "VENDEDOR"], vendedorFeatureFlag: "vendedoresAdministranInventario"`.
  4. In each filter, add the condition:

```ts
const vendedorAllowed = (item: NavItem) =>
  userRole !== "VENDEDOR" || !item.vendedorFeatureFlag || !!orgFeatures[item.vendedorFeatureFlag]
```

applied alongside the existing roles/featureFlag checks (both `navItems` and `navSections` filters).
  5. `bottomNavByRole`: add Inventario to the VENDEDOR list only if that structure supports conditional entries; if it's a static dict, filter it through `vendedorAllowed` at render time the same way (inspect the render site and apply the same gate; keep ADMIN's list unchanged).

- [ ] **Step 2: Page gate.** `app/(dashboard)/inventario/page.tsx` is a `"use client"` component with no guard (protection today = sidebar + API 403s). Add a minimal client gate so a VENDEDOR without the flag doesn't land on a dead page:

```tsx
const { data: session } = useSession()
const router = useRouter()
const [accesoVendedor, setAccesoVendedor] = useState<boolean | null>(null)

useEffect(() => {
  if (session?.user?.role !== "VENDEDOR") return
  fetch("/api/org/features", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (d?.vendedoresAdministranInventario) setAccesoVendedor(true)
      else router.replace("/dashboard")
    })
    .catch(() => router.replace("/dashboard"))
}, [session, router])

if (session?.user?.role === "VENDEDOR" && accesoVendedor !== true) return null
```

(adapt imports: `useSession` from `next-auth/react`, `useRouter` from `next/navigation`; ADMIN/otros render as hoy sin fetch extra.)

- [ ] **Step 3:** `npx tsc --noEmit` clean; `npx vitest run lib/__tests__/ __tests__/` no regressions. Manual visual check pending for controller/user (VENDEDOR con flag on/off).
- [ ] **Step 4:** Commit:

```bash
git add components/layout/navbar.tsx "app/(dashboard)/inventario/page.tsx"
git commit -m "feat(inventario): Inventario visible para vendedores habilitados — navbar y gate de página"
```

---

### Task 8: PR2 + verification

- [ ] **Step 1:** Full gates: `npx vitest run`, `npx tsc --noEmit`, `npm run build`.
- [ ] **Step 2:** Push + PR to main (note dependency on PR1 + migration 275). Body: what the toggle does, default-off guarantee, screenshots/manual-check list (ADMIN ve Inventario siempre; VENDEDOR solo con flag; TECNICO nunca; el switch refresca el nav en vivo vía el evento existente).
