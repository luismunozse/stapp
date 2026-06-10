# RLS Hardening Phase 1 — Apply Runbook

> **Scope**: Changes B + C + D in a single atomic SQL block.
> **App impact**: Zero. All API routes use `supabaseAdmin` (service_role), which bypasses RLS unconditionally.
> **Do NOT** apply this while Phase 2 (PR2/PR3) is in-flight in the same DB. Phase 1 is safe to apply independently.

---

## Pre-checks

Before pasting any SQL:

1. **Confirm migration tip**: Run the following in Studio SQL editor. The latest number should be `199` or `200` (migration `200_series_en_venta_e_idempotencia` may or may not be applied depending on deploy state); our new migration is `201`.
   ```sql
   SELECT MAX(version) FROM supabase_migrations.schema_migrations;
   -- OR check the supabase/migrations/ directory for the highest numbered file.
   ```

2. **Confirm `public.get_current_organization_id()` exists**:
   ```sql
   SELECT proname, prosecdef
   FROM pg_catalog.pg_proc p
   JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND proname = 'get_current_organization_id';
   -- EXPECTED: 1 row, prosecdef = true
   ```

3. **Confirm none of the four Change-D tables already have RLS enabled** (if they do, someone applied this earlier):
   ```sql
   SELECT relname, relrowsecurity
   FROM pg_class
   WHERE relname IN ('admin_emails','proveedor_contactos','proveedor_adjuntos','proveedor_catalogo_items');
   -- EXPECTED: all 4 rows have relrowsecurity = false
   ```

4. **Take a count baseline** for the D-tables (to verify no data loss after apply):
   ```sql
   SELECT
     (SELECT count(*) FROM admin_emails)            AS admin_emails,
     (SELECT count(*) FROM proveedor_contactos)     AS proveedor_contactos,
     (SELECT count(*) FROM proveedor_adjuntos)      AS proveedor_adjuntos,
     (SELECT count(*) FROM proveedor_catalogo_items) AS proveedor_catalogo_items;
   ```
   Save this number.

---

## Step 1 — Apply the Migration

1. Open Supabase Studio → **SQL Editor** → New query.
2. Paste the entire contents of `supabase/migrations/201_rls_hardening_phase1.sql`.
3. Click **Run**.
4. Confirm the output shows `COMMIT` (not an error). If any error appears, the transaction rolled back automatically — no partial state was applied.

---

## Step 2 — Run the Probe Harness

1. Open a new SQL Editor tab in Studio.
2. Paste the entire contents of `supabase/migrations/verify/phase1_probes.sql`.
3. Run each section in order (Sections 0 → 5).
4. Compare each result against the `-- EXPECTED:` annotation in the file.

### Key pass/fail checks

| Section | Test | Expected |
|---------|------|----------|
| 0.3 | No `app.organization_id` remaining in policies | 0 rows |
| 1.1 | All 12 `*_all_service` policies have `roles = {service_role}` | 12 rows |
| 1.2 | Authenticated INSERT on `depositos` raises error | Error or 0 rows |
| 2.1–2.8 | Authenticated sees only own-org rows | 0 org-B rows visible |
| 2.10 | `get_current_organization_id()` returns the JWT org | `'ORG_A'` |
| 3.1 | RLS enabled on 4 D-tables | 4 rows with `relrowsecurity = true` |
| 3.8 | anon role sees 0 rows from D-tables | 0 each |
| 4.1–4.2 | anon still reads order tables (open window, expected) | > 0 rows |

If **any Section 0–3 check fails**: run the rollback (Step 5) and investigate before re-applying.

Section 4 checks are informational — a non-zero count there is the expected pre-Phase-4 state.

---

## Step 3 — Smoke-Test Live API Routes

These checks confirm the running app is unaffected. All use service_role under the hood.

1. **POS / Ventas**: Create a test venta in the app or call `GET /api/ventas` in a browser with a logged-in session. Confirm it returns data without errors.
2. **Inventario**: Open the inventory list page. Confirm items load and stock figures are correct.
3. **Cotizaciones**: Open an existing cotizacion. Confirm template selection works.
4. **Proveedores**: Navigate to any proveedor detail. Confirm contactos and adjuntos load correctly (this exercises the D-tables via service_role).
5. **Admin emails**: Trigger a test email send (if feasible in staging). Confirm it persists in the admin email log.

No HTTP 500 or empty-list anomalies should appear. If they do, check server logs for `RLS` errors — this would indicate a route using `authenticated` role unexpectedly (unlikely given the current architecture).

---

## Step 4 — Regression Tests

Run the automated test suites against the environment where Phase 1 was just applied:

```bash
# Vitest unit tests
npm run test:run

# Playwright e2e tests
npm run test:e2e
```

Both should be fully green. Phase 1 introduces no code changes, so any failure is either a pre-existing issue or an environment mismatch.

---

## Step 5 — Rollback Procedure

**When to trigger**: any Section 0–3 probe fails, any API route returns unexpected empty data, or `npm run test:e2e` regression appears after applying Phase 1.

**Do not** roll back based on Section 4 probes — those document the expected open anon window.

### Full rollback (all three changes, D → C → B)

1. Open Studio SQL Editor → New query.
2. Paste the entire `supabase/migrations/rollback/201_rollback.sql`.
3. Run. Three separate `BEGIN/COMMIT` blocks execute in order.
4. Confirm each block outputs `COMMIT` without errors.
5. Re-run the pre-check queries from the Pre-checks section to confirm state is back to pre-Phase-1.

### Partial rollback (single change only)

The rollback file is split into three independently runnable `BEGIN/COMMIT` blocks labeled `ROLLBACK D`, `ROLLBACK C`, and `ROLLBACK B`. You can paste and run only the block for the change you need to revert.

Rollback order recommendation for full revert: **D first, then C, then B**.

---

## Checklist (sign off before marking Phase 1 complete)

- [ ] Migration 201 applied without error (output: `COMMIT`)
- [ ] Section 0 probes pass (no stale GUC, function present)
- [ ] Section 1 probes pass (B: service_role scoped, authenticated blocked)
- [ ] Section 2 probes pass (C: JWT-scoped isolation, no cross-org leak)
- [ ] Section 3 probes pass (D: RLS enabled, anon denied on PII tables)
- [ ] Section 4 confirms open anon window is still present (expected at this stage)
- [ ] API smoke tests: no HTTP 500, no empty-list anomalies
- [ ] `npm run test:run` green
- [ ] `npm run test:e2e` green

---

## What Phase 1 Does NOT Do

- Does **not** close the anon read window on `ordenes_servicio`, `cotizaciones`, `orden_eventos`, `repuestos_orden`. That is Change A / Phase 4 and is gated by the Realtime spike.
- Does **not** modify any TypeScript/JavaScript application code.
- Does **not** affect service_role access in any way.
