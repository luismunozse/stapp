# Export Quick Wins — Design

Date: 2026-06-10
Scope: Close two audit gaps — **#13 data portability** and **#8 native XLSX export**.
Status: Approved (design decisions confirmed); pending spec review before plan.

## Context

Audit (2026-06-09) compared STApp vs a competitor and surfaced two export gaps:

- **#8** — Export only outputs CSV. No native `.xlsx`. (`ExcelJS` is already a dependency; the import side uses it in `lib/csv-parser.ts`.)
- **#13** — "If I stop paying, can I export everything?" Today **no**:
  1. `hasPlanFeature(orgId, "data_export")` gates every export endpoint to Profesional (intentional upgrade driver, migration 187).
  2. When a sub goes `CANCELED` / `PAST_DUE`, `app/(dashboard)/layout.tsx:69` redirects the org to `/suscripcion-requerida`, so the export UI is **unreachable**.

Net: the churned customer (`CANCELED`/`PAST_DUE`) — exactly the "stopped paying" case — cannot reach the button and the API returns 403.

## Product decision (#13)

Separate two concerns:

- **Data portability** — a right. Raw export of the org's own data must always work, on any plan/status, including a blocked account.
- **Export as a feature** — Premium polish. Analytics/report exports (`/api/export/reportes`) stay gated to Profesional.

Chosen policy: **portability always, reports Premium.** This honors the promise without removing the upgrade driver.

## Changes

### A. #8 — XLSX output

**`lib/csv-export.ts`**
- Add `arrayToXLSX(data, columns): Promise<Buffer>` using `ExcelJS`. Reuse the existing `CSVColumn<T>` defs (same `key` dot-path resolution and `transform`). Bold header row, autofit-ish column widths.
- Generalize the browser download helper: keep `downloadCSV`, add `downloadBlob(blob, filename)` (handles binary xlsx; native Capacitor path writes the binary to Documents).

**`app/api/export/[entity]/route.ts`**
- Refactor the five `exportX()` functions to return `{ data, columns }` instead of a CSV string. Format selection happens once at the end based on a `format` query param (`csv` default | `xlsx`).
- `xlsx` → `arrayToXLSX`, content-type `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `.xlsx` filename.

**Export UI** (`components/export/export-button.tsx` + `components/reportes-avanzados/export-button.tsx`)
- Add a CSV / Excel format choice; pass `format` to the request; download the returned blob.

### B. #13 — Portability always reachable

**Gating**
- Remove the `hasPlanFeature("data_export")` check from `/api/export/[entity]` (keep `requireAuth` — own-data only, org-scoped via `organization_id`).
- Keep the gate in `/api/export/reportes` (analytics stays Premium).

**Reachability when blocked**
- `/api/export/[entity]` is an API route (not under the dashboard layout) and `requireAuth` succeeds for blocked orgs (they still hold a session) — so the API is reachable once the gate is removed.
- **VERIFIED (2026-06-10):** `middleware.ts` does NOT cut `/api/export` for a churned org. The subscription block lives in the dashboard layout, not middleware. Middleware only enforces rate-limit, tenant-active, tenant-ownership, auth presence, and role (role checks target page paths, not `/api/export`). A `CANCELED`/`PAST_DUE` org keeps `organizations.activo = true`, so it passes the tenant-active check and the request reaches the route with `x-organization-id` injected. (Hard org deactivation by superadmin — `activo = false` — does 403 at middleware line 380, but that is an admin action distinct from churn; acceptable.)
- Add an "Exportá tus datos" section to `components/subscription/subscription-required-view.tsx` with buttons that hit the five export endpoints, so a churned/blocked org can pull its data from the block screen.

## Out of scope (YAGNI)

- Single "export everything as ZIP" dump — five per-entity downloads suffice.
- Scheduled/automated exports.
- Report export format beyond current CSV/text.

## Testing (Strict TDD)

- `arrayToXLSX`: produces a valid workbook; header row matches columns; one data row maps `key`/`transform` correctly; empty data → headers only.
- `/api/export/[entity]`: `format=xlsx` returns xlsx content-type + buffer; `format=csv`/absent returns CSV (unchanged).
- Gating: export route returns 200 for a Free/blocked org (no `data_export`); `/api/export/reportes` still 403 without `data_export`.

## Risks

- **Middleware** may block `/api/export` for blocked orgs — verify before relying on API reachability from the block screen.
- **XLSX memory** — 10,000-row cap already in the queries; ExcelJS in-memory workbook for 10k rows × ~15 cols is fine.
- Removing the export gate slightly weakens the Profesional pitch; mitigated by keeping report/analytics export Premium.
