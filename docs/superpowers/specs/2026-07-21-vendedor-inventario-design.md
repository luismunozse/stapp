# Optional Inventory Management for VENDEDOR — Design

**Date**: 2026-07-21
**Status**: Approved by Luis (pending spec review)

## Goal

Let an organization's ADMIN optionally allow VENDEDOR users to manage inventory. Today the entire inventory module is ADMIN-only; many admins want it to stay that way, so the permission is an **opt-in org-level toggle, default off** — zero behavior change for existing orgs until an admin enables it.

## Non-goals

- Per-user (per-vendedor) granularity — the org-level helper can be extended later without rework.
- Purchase orders (`ordenes-compra`) and suppliers (`proveedores`) stay ADMIN-only.
- No change for TECNICO (never gets inventory management).
- VENDEDOR's existing read access to products via POS is untouched.

## Architecture

### 1. DB — migration `275_vendedores_administran_inventario.sql`

- `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS vendedores_administran_inventario BOOLEAN NOT NULL DEFAULT false;`
- `COMMENT ON COLUMN` explaining it is an org preference (not plan gating — deliberately NOT in `plans.feature_flags`).
- Follows the migration conventions of 265/274 (idempotent, banner comment).

### 2. Access helper — `requireInventarioAccess()` in `lib/auth-utils.ts`

- Same return contract as `requireAdmin()` (`{error, session, organizationId, userId, role}`) so call sites swap 1:1.
- Logic: `requireAuth()` → if role `ADMIN`, pass. If role `VENDEDOR`, read `organizations.vendedores_administran_inventario`; pass only when `true`. Any other case → 403 "Acceso denegado" (same shape as `requireAdmin`).
- One extra DB read per VENDEDOR request only (ADMIN path unchanged); acceptable — inventory endpoints already do multiple reads.

### 3. Backend sweep — `app/api/inventario/**`

- Mechanical replace of `requireAdmin` → `requireInventarioAccess` (import + call) in all route files under `app/api/inventario/` (32 files at design time — sweep by grep, not by a fixed list).
- No other module is touched.

### 4. Toggle endpoint + UI

- The toggle is edited only by ADMIN via the existing org-settings surface (Configuración). Exploration decides the exact page/API (existing organization settings endpoint if one exists; otherwise a minimal `PATCH` handler) — reuse before creating.
- Switch copy (neutral Spanish, panel voseo): "Los vendedores pueden administrar inventario" + helper text listing what it enables (productos, stock, depósitos, ajustes, conteos).

### 5. Navigation + page guards

- Sidebar: the Inventario entry becomes visible for VENDEDOR when the flag is on (server-derived, passed like other layout data).
- Inventory pages under `app/(dashboard)/inventario/` currently assume ADMIN; guard them with the same rule (redirect or 403 view for VENDEDOR when the flag is off — mirrors existing role-guard patterns found during exploration).

### 6. Security summary

- Enforcement is server-side per endpoint (sidebar/page visibility is UX only).
- Default off → no behavior change anywhere until an ADMIN opts in.
- Only ADMIN can change the flag; change should hit the existing audit-log mechanism if one exists for org settings (exploration confirms; if trivial, include, else follow-up).

## Delivery

Two PRs:

1. **PR1 (invisible)**: migration + helper + backend sweep + tests. With the flag defaulting to false and no UI, behavior is identical for every org.
2. **PR2 (visible)**: toggle in Configuración + sidebar entry for VENDEDOR + page guards.

Migration 275 must be applied manually to prod before PR2 is useful. PR1 is safe to deploy even before the migration is applied because the helper **fails closed**: if the column read errors or returns null/undefined (e.g. migration not yet applied), VENDEDOR is denied — identical to today's behavior. Deploy order: merge PR1 → apply 275 → merge PR2.

## Testing

- Helper: ADMIN passes with flag off; VENDEDOR passes with flag on; VENDEDOR blocked with flag off; TECNICO blocked with flag on.
- One representative inventory endpoint test updated/added proving the new helper is wired.
- Toggle endpoint: only ADMIN can change it.
- Existing inventory tests keep passing (ADMIN path unchanged).
