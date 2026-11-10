# Commissions Slice 2 — Reception and Technician on Repairs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repairs pay two roles, the person who received the device (`RECEPCION`) and the technician (`TECNICO`), on the real order amount (discounts and credit notes subtracted), under per-organization rules with defaults, shown on a reception tab, the technician page and the order card.

**Architecture:** One new migration adds `comisiones_config`, a nullable reception rate on `users` and a reception rate snapshot on `ordenes_servicio`, set by one BEFORE INSERT trigger that covers every order creation path. A second migration restates the single definition (`v_comisiones_filas` / `v_comisiones_devengadas`): the order branch computes both roles in one pass per order, reads the org rules, and adds `AJUSTE_DEVOLUCION` rows for credit notes created after a role was paid; it ends with a read-only impact report, so its dry-run is the production impact the PR must state. The pay and annul RPCs (378/379) are role-agnostic and stay untouched. The app adds a config route and tab, rate fields on the seller and technician forms, a `Recepción` tab, both order roles on the technician page, and both roles on the order card.

**Tech Stack:** Next.js 16 App Router route handlers, Supabase Postgres (service-role client `supabaseAdmin`), plpgsql, zod, SWR, vitest (+ Testing Library), SQL text tests (`__tests__/helpers/sql-text.ts`) and hand-run verify probes.

**Spec:** `docs/superpowers/specs/2026-10-29-comisiones-unificadas-design.md` (slice 2 in "Slices"; "Vocabulary", "After payment the row is closed", "Payouts" legacy-flag role rule, "Rates", "Org rules" with "Definitions behind the rules" and "Participants", "Integration map", "Calls I made"). Slice 1 plan: `docs/superpowers/plans/2026-10-29-comisiones-slice1-fundacion.md`.

## Global Constraints

- **Numbers.**
  - Unpaid `VENTA` rows do not change: the sale branches of 377 are copied verbatim.
  - Paid rows never change amount or beneficiary when the definition changes (closed-row rule). A probe pins it: every live payout item equals its row after 381.
  - Binding decision: defaults keep today's numbers except the intended technician-base fix (discount and credit notes). The spec's own definitions also move some unpaid `ORDEN`/`TECNICO` rows: repaired-but-not-delivered orders, practice orders, warranty re-entries, and the accrual date. The 381 impact report lists each cause apart, with counts and money. The controller stops for the user's OK before `--apply` (see "Calls I made in this plan").
  - New `RECEPCION` rows of amount 0 with no payout are not emitted. With the default reception rate 0, no reception row appears until a shop sets a rate. Existing `VENDEDOR`/`TECNICO` zero rows keep the slice 1 parity ruling: listed, not payable.
- **Out of scope.**
  - Reports (`estado-resultados`, `tendencia-financiera`, `rentabilidad`, `rentabilidad-tecnicos`) stay on their own formulas until slice 4. Reception rows are missing from them until then.
  - Rate changes "from date X" and manual adjustments are slice 3.
  - The branch filter and org-timezone periods are slice 6.
  - Fiado and express repairs never reach `COBRADO` (slice 7).
  - Plan gating of the commission screens is unchanged.
  - Seller tab, seller detail and liquidar stay `VENDEDOR` only.
- **Data access.**
  - Supabase only through `supabaseAdmin`.
  - Every query filters `organization_id`, including the `users` name lookups.
- **Views.**
  - Use `WITH (security_invoker = true)`, `REVOKE ALL ... FROM PUBLIC, anon, authenticated` and `GRANT SELECT ... TO service_role` (347).
  - `CREATE OR REPLACE VIEW` resets options, so always restate `security_invoker`.
  - New view columns go only at the end.
- **New tables.**
  - RLS on, a `FOR ALL TO service_role USING (true) WITH CHECK (true)` policy, `REVOKE ALL ... FROM PUBLIC, anon, authenticated`, no grant to `authenticated` (as 376).
  - `comisiones_config` is one row per org, so its key is `organization_id TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE`. The twin is `notas_credito_counter` (186:92). This deviates from the `id` cuid rule on purpose.
  - No user FK in it: who changed it lives in `audit_logs`.
- **Trigger function.**
  - `set_porcentaje_comision_recepcion()` is `SECURITY DEFINER SET search_path = public, pg_temp`, with `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated`.
  - Why: an order insert must never fail because the writer's role cannot read `comisiones_config` (service_role only).
  - The plpgsql-RPC rule (SECURITY INVOKER) is unchanged; 378/379 are not touched.
- **Migration files.**
  - Start with `SET LOCAL lock_timeout = '3s';`, contain no `BEGIN;`/`COMMIT;`, and name their rollback and verify files in the header.
  - 380 and 381 are provisional numbers: renumber at merge (several open PRs carry SQL).
  - Tests find files by suffix (`_comisiones_recepcion.sql`, `_comisiones_reparaciones.sql`) or marker (`Rollback of comisiones_recepcion`, `Rollback of comisiones_reparaciones`, `Verification of comisiones_recepcion`, `Verification of comisiones_reparaciones`), never by number.
  - Never write the string `Rollback of comisiones_definicion` in a new file: it is 377's marker.
- **Probes.**
  - Each probe file has its own temp result table (`_r380`, `_r381`), opens `BEGIN` and ends in `ROLLBACK`, and runs in dry-run only.
  - Fixtures set their own rates and config inside the probe; they never rely on live user rates.
  - Every RPC call runs under `SET LOCAL ROLE service_role` with `RESET ROLE` on both the success and the exception paths.
  - `now()` is frozen inside one transaction: any event that must come after a payout (credit note, cobro) sets `created_at = clock_timestamp()` explicitly.
- **Database runs.** Implementers never run `scripts/db-run.mjs`. Every dry-run or apply step goes to the controller, who runs it with the user's OK: dry-run first, then `--apply`.
- **Strict TDD.**
  - Failing test first.
  - `./node_modules/.bin/vitest run <path>`, one file at a time.
  - `./node_modules/.bin/tsc --noEmit` once per task that touches TS.
  - Never the full suite, `npm run lint`, `npx`, or `next build`. SQL text tests carry `// @vitest-environment node`.
- **Search.** `rg` always gets explicit paths or `-`. Never read `.env*`.
- **Language.**
  - English for code, identifiers, comments and commits. DB objects use the spec's Spanish names. JSON fields added to an existing Spanish payload stay Spanish camelCase.
  - New UI copy is neutral Spanish, with no voseo and no regional forms. Existing strings are untouched unless a task says so.
- **Money.** Never round money inline in commission files: use `round2` from `@/lib/precios`.
- **Commits and the public repo.**
  - Conventional commits, no `Co-Authored-By`, no AI attribution.
  - The repo is public: never name the requesting customer, shop or organization. The PR states aggregate counts and amounts only.
- **Access.**
  - The config route and screen are ADMIN only.
  - Every new or changed route keeps or gets its guard and is covered by an access sweep.

## Review Focus

1. Discount plus credit notes above `costo_final` → the order amount floors at 0. The `TECNICO` row is listed at 0 and cannot be paid; no `RECEPCION` row; nothing negative. (Task 3, probe R3.)
2. A credit note after payment that exceeds the remaining labour, or several credit notes → the total clawed back never exceeds the paid base × the paid rate. (Task 3, probe R11.)
3. A receiver who was removed (baja) still has pending reception rows → they are listed with their name under "Todos" and can be paid. The person picker lists only active people. (Task 8 API test.)
4. Orders received before the shop set a rate (NULL snapshot) → never a reception row, even after a default is set. The config screen says so. (Task 3, probe R4; Task 6 copy test.)
5. The same person is technician and receiver on one order → two rows, both payable in one payout from the technician page. (Task 9 test.)

---

## Facts verified on origin/main 4f3981ff

- **Order credit notes.**
  - `notas_credito.anulada` exists since 186, and `DELETE /api/notas-credito/[id]` sets it.
  - Open PRs #511–#515 (migrations 367–369) add annulment of *sale* credit notes (`devoluciones_venta`). They do not touch `notas_credito`.
  - If they land, the 368 SQL sweep requires every reader of NC tables to drop annulled rows. 381's order branch already filters `NOT nc.anulada`. The verbatim 377 sale branches still sum every `devoluciones_venta` row (slice 1 parity), and that sweep will flag them: fixing them is slice 5's job, not this slice's.
  - 368 also recreates the legacy `v_comisiones_ventas`, which has no app reader.
- **`descuento_cobro`:** `DECIMAL(10,2) NOT NULL DEFAULT 0` (067). It accumulates in `registrar_cobros_orden_atomica` (269).
- **`recibido_por`.**
  - `TEXT REFERENCES users(id)`, nullable (260).
  - Written only at creation:
    - POST `/api/ordenes`, through `resolveOperador`;
    - `crear_recepcion_multiple` (288);
    - `crear_reparaciones_express` (349, the operator);
    - the práctica route (the user).
  - Never updated.
  - NULL on reingreso, warranty-claim orders, quote conversions, demo seeds and legacy orders.
- **`es_practica`:** `BOOLEAN NOT NULL DEFAULT false` (348).
- **Warranty re-entry.**
  - `es_reingreso BOOLEAN NOT NULL DEFAULT false` (068), set by POST `/api/ordenes/[id]/reingreso`.
  - Warranty-claim orders (PATCH `/api/garantias/[id]/reclamos`) do not set it. They are linked only by `reclamos_garantia.orden_reparacion_id` (001, no index).
- **Flag 257:** `organizations.comision_aplica_sin_reparacion BOOLEAN NOT NULL DEFAULT false`. Edited in Configuración › Empresa (`configuracion-form.tsx` ~711–722) through the PUT `/api/configuracion` cascades.
- **377 already closes paid rows by key.**
  - `filas` drops a live row whose `(org, documento_tipo, documento_id, rol, tipo, ajuste_ref)` has a non-annulled item, and emits the item instead: its amount, base, rate, and the payout's beneficiary.
  - This is role-agnostic: `RECEPCION` rows and the new order adjustment rows inherit it.
- **378 needs no change.**
  - `pagar_comisiones` copies `rol` from the definition, so it accepts `RECEPCION`.
  - Flag sync sends only `TECNICO` items for `ORDEN` and `VENDEDOR` items for `VENTA`. The legacy-paid guard also checks only those roles.
  - So reception payouts never touch `ordenes_servicio.comision_pagada`.
- **379 needs no change.** The `AJUSTES_PAGADOS` guard matches on `(documento_tipo, documento_id, rol)`, so it already covers order credit-note adjustments.
- **Order creation paths.** All are row INSERTs, so one BEFORE INSERT trigger covers every one, including future ones:
  1. POST `/api/ordenes`;
  2. `crear_recepcion_multiple` (288);
  3. `crear_reparaciones_express` (349);
  4. POST `/api/ordenes/[id]/reingreso`;
  5. POST `/api/onboarding/practica`, plus the 348 internal autocheck;
  6. POST `/api/cotizaciones/[id]/convertir-orden`;
  7. PATCH `/api/garantias/[id]/reclamos`;
  8. `lib/onboarding/sample-data.ts`;
  9. POST `/api/onboarding/seed-demo-data`.

  The spec named five; 6–9 are extra.
- **Rate writers.**
  - POST `/api/vendedores`, PUT `/api/vendedores/[id]`, POST `/api/tecnicos`, PUT `/api/tecnicos/[id]`.
  - Forms: `components/vendedores/vendedor-form.tsx` and `components/tecnicos/tecnico-form.tsx`, fed by the list GETs and the `[id]` GETs.
  - GET `/api/tecnicos` is `requireAuth` (it feeds pickers).
  - PATCH `/api/usuarios/[id]/rol` writes only `porcentaje_comision`, and stays as it is.
- **Config screens.**
  - `/configuracion` tabs come from `components/configuracion/config-tabs.ts`.
  - "Avisos" is the twin: own save button, `forceMount`, its own component.
  - The cascade gotcha: a new `organizations` column in `/api/configuracion` degrades three SELECT cascades and silently drops settings. That is why `comisiones_config` is its own table with its own route.
- **Solved twins reused.**
  - `ComisionesView` (technician tab) → the reception tab.
  - `/api/operadores` (source of the order form's "Recibido por" select) → the people picker.
  - The Avisos tab → the config tab.
  - 377's post-payment sale-return branch → order credit-note adjustments.

## Integration map for this slice

| Consumer | Change | Task |
|---|---|---|
| `v_comisiones_filas`, `v_comisiones_devengadas` | order branch: both roles, rules, real amount; order NC adjustments; 3 new columns | 2 |
| `pagar_comisiones` (378), `anular_pago_comisiones` (379) | none; probes pin `RECEPCION` pay/annul and the untouched legacy flag | 3 |
| `lib/commissions/types.ts`, `rows.ts` | new row fields, role and kind labels, accrual hints | 4 |
| `comisiones_config` + `/api/comisiones/config` | new table, ADMIN route, audit | 1, 5 |
| `/configuracion` tabs, flag 257 checkbox | new "Comisiones" tab; the checkbox moves into it | 6 |
| Seller and technician rate writers and forms | nullable reception rate | 7 |
| Order creation paths | trigger (all paths); quote conversion records the receiver | 1, 7 |
| GET `/api/comisiones` | `rol` param (`TECNICO` default, `RECEPCION`, `todos`) | 8 |
| `/comisiones` page, `ComisionesView` | `Recepción` tab | 8 |
| `TecnicoComisiones` (`tecnicos/[id]`, "Mis comisiones") | both order roles, role badge, CSV "Rol" column | 9 |
| GET `/api/comisiones/orden/[id]`, `OrdenComisionCard`, `orden-detail.tsx` | both roles, base breakdown, accrual hint (ESR nuance), refresh after a credit note | 10 |
| Seller tab, `/api/vendedores/[id]`, liquidar | none (`VENDEDOR` only) | — |
| Reports (4 files) | none until slice 4; calc sweep allowed list unchanged | — |
| `backfill/377_auditoria_comisiones.sql` `[1]` | after 381 it lists the intended order changes; 381's report supersedes it | rollout |
| Access sweeps | config route counted; technician rate writes pinned to ADMIN | 5, 7 |

## File structure

- `supabase/migrations/380_comisiones_recepcion.sql` contains the schema plus the trigger. Alongside it: `rollback/380_rollback.sql` and `verify/380_probes.sql`.
- `supabase/migrations/381_comisiones_reparaciones.sql` contains the views plus the impact report. Alongside it: `rollback/381_rollback.sql` (377's views, verbatim) and `verify/381_probes.sql`.
- `lib/commissions/config.ts` holds the client-safe rule types, defaults, zod schema and option copy.
- `app/api/comisiones/config/route.ts` is the GET/PUT route, ADMIN only.
- `components/configuracion/comisiones-config.tsx` is the rules screen.
- Tests:
  - `__tests__/comisiones-recepcion-migration.test.ts`
  - `__tests__/comisiones-reparaciones-migration.test.ts`
  - `__tests__/lib/commissions-config.test.ts`
  - `__tests__/api/comisiones-config.test.ts`
  - `__tests__/components/comisiones-config.test.tsx`
  - `__tests__/api/tasas-recepcion.test.ts`
  - `__tests__/components/tasa-recepcion-forms.test.tsx`
  - `__tests__/components/comisiones-recepcion-tab.test.tsx`
  - plus appends to existing commission tests and both sweeps.

---

### Task 1: Reception rates, org rules table and snapshot trigger (PR A)

**Files:**
- Create: `supabase/migrations/380_comisiones_recepcion.sql`, `supabase/migrations/rollback/380_rollback.sql`, `supabase/migrations/verify/380_probes.sql`
- Test: `__tests__/comisiones-recepcion-migration.test.ts`

**Interfaces:**
- Produces:
  - Table `comisiones_config` with these columns:
    - `organization_id TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE`
    - `orden_devengo TEXT NOT NULL DEFAULT 'ENTREGA_Y_COBRO' CHECK (orden_devengo IN ('ENTREGA_Y_COBRO', 'ENTREGA', 'COBRO'))`
    - `tecnico_base TEXT NOT NULL DEFAULT 'MANO_DE_OBRA' CHECK (tecnico_base IN ('MANO_DE_OBRA', 'MONTO_ORDEN'))`
    - `recepcion_base TEXT NOT NULL DEFAULT 'MONTO_ORDEN' CHECK (recepcion_base IN ('MONTO_ORDEN', 'MANO_DE_OBRA'))`
    - `recepcion_porcentaje_default NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (recepcion_porcentaje_default BETWEEN 0 AND 100)`
    - `reingreso_comisiona BOOLEAN NOT NULL DEFAULT false`
    - `created_at`, `updated_at` (`TIMESTAMPTZ NOT NULL DEFAULT now()`)
  - `users.porcentaje_comision_recepcion NUMERIC(5,2)`: nullable (NULL = use the org default), `CHECK (... BETWEEN 0 AND 100)`.
  - `ordenes_servicio.porcentaje_comision_recepcion NUMERIC(5,2)`: nullable, where NULL means legacy (an order received before 380). Constraint `ordenes_servicio_porcentaje_recepcion_check CHECK (porcentaje_comision_recepcion BETWEEN 0 AND 100) NOT VALID`, then `VALIDATE CONSTRAINT`.
  - Function `set_porcentaje_comision_recepcion() RETURNS TRIGGER` and trigger `trigger_ordenes_porcentaje_recepcion BEFORE INSERT ON ordenes_servicio FOR EACH ROW`.
  - Index `reclamos_garantia_orden_reparacion_idx ON reclamos_garantia (orden_reparacion_id) WHERE orden_reparacion_id IS NOT NULL` (read by 381).

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest"
import { readBySuffix, readByMarker, collapse, stripComments } from "./helpers/sql-text"

const mig = () => readBySuffix("_comisiones_recepcion.sql")
const rb = () => readByMarker("rollback", "Rollback of comisiones_recepcion")
const probes = () => readByMarker("verify", "Verification of comisiones_recepcion")
const fn = () => { const s = collapse(mig()); return s.slice(s.indexOf("CREATE OR REPLACE FUNCTION set_porcentaje_comision_recepcion()")) }

describe("380: hygiene", () => {
  it("starts with SET LOCAL lock_timeout, opens no transaction, writes no rows", () => {
    expect(collapse(mig()).startsWith("SET LOCAL lock_timeout = '3s';")).toBe(true)
    expect(stripComments(mig())).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im)
    expect(stripComments(mig())).not.toMatch(/\b(INSERT INTO|DELETE FROM)\b|\bUPDATE\s+\w+\s+SET\b/)
  })
})
describe("380: comisiones_config", () => {
  it("one row per org with the spec's options and defaults", () => {
    const s = collapse(mig())
    for (const frag of [
      "organization_id TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE",
      "orden_devengo TEXT NOT NULL DEFAULT 'ENTREGA_Y_COBRO' CHECK (orden_devengo IN ('ENTREGA_Y_COBRO', 'ENTREGA', 'COBRO'))",
      "tecnico_base TEXT NOT NULL DEFAULT 'MANO_DE_OBRA' CHECK (tecnico_base IN ('MANO_DE_OBRA', 'MONTO_ORDEN'))",
      "recepcion_base TEXT NOT NULL DEFAULT 'MONTO_ORDEN' CHECK (recepcion_base IN ('MONTO_ORDEN', 'MANO_DE_OBRA'))",
      "recepcion_porcentaje_default NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (recepcion_porcentaje_default BETWEEN 0 AND 100)",
      "reingreso_comisiona BOOLEAN NOT NULL DEFAULT false",
    ]) expect(s).toContain(frag)
  })
  it("RLS on, service_role only", () => {
    const s = collapse(mig())
    expect(s).toContain("ALTER TABLE comisiones_config ENABLE ROW LEVEL SECURITY")
    expect(s).toContain("REVOKE ALL ON public.comisiones_config FROM PUBLIC, anon, authenticated")
    expect(s).not.toMatch(/GRANT [A-Z, ]+ ON public\.comisiones_config TO authenticated/)
  })
})
describe("380: rates", () => {
  it("a nullable reception rate per person and a snapshot per order, both 0..100", () => {
    const s = collapse(mig())
    expect(s).toContain("ALTER TABLE users ADD COLUMN IF NOT EXISTS porcentaje_comision_recepcion NUMERIC(5,2)")
    expect(s).toContain("ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS porcentaje_comision_recepcion NUMERIC(5,2)")
    expect(s).toContain("CHECK (porcentaje_comision_recepcion BETWEEN 0 AND 100) NOT VALID")
    expect(s).toContain("VALIDATE CONSTRAINT ordenes_servicio_porcentaje_recepcion_check")
  })
})
describe("380: snapshot trigger", () => {
  it("fires BEFORE INSERT only: recibido_por is never edited", () => {
    expect(collapse(mig())).toContain("CREATE TRIGGER trigger_ordenes_porcentaje_recepcion BEFORE INSERT ON ordenes_servicio FOR EACH ROW EXECUTE FUNCTION set_porcentaje_comision_recepcion()")
  })
  it("explicit value kept; no receiver or receiver outside the org = 0; own rate, else org default, else 0", () => {
    const s = fn()
    expect(s).toContain("IF NEW.porcentaje_comision_recepcion IS NOT NULL THEN RETURN NEW;")
    expect(s).toMatch(/IF NEW\.recibido_por IS NULL THEN NEW\.porcentaje_comision_recepcion := 0;/)
    expect(s).toContain("u.id = NEW.recibido_por AND u.organization_id = NEW.organization_id")
    expect(s).toMatch(/COALESCE\(v_propio, \(SELECT c\.recepcion_porcentaje_default FROM comisiones_config c WHERE c\.organization_id = NEW\.organization_id\), 0\)/)
  })
  it("definer with pinned search_path, not callable directly", () => {
    expect(fn()).toMatch(/SECURITY DEFINER SET search_path = public, pg_temp/)
    expect(collapse(mig())).toContain("REVOKE EXECUTE ON FUNCTION set_porcentaje_comision_recepcion() FROM PUBLIC, anon, authenticated")
  })
})
describe("380: rollback and probes", () => {
  it("rollback warns, runs after 381's, and drops trigger before columns and table", () => {
    const head = rb().slice(0, rb().indexOf("DROP"))
    expect(head).toMatch(/pierde|loses/i); expect(head).toMatch(/381_rollback/)
    const s = collapse(rb())
    expect(s.indexOf("DROP TRIGGER IF EXISTS trigger_ordenes_porcentaje_recepcion")).toBeLessThan(s.indexOf("DROP COLUMN IF EXISTS porcentaje_comision_recepcion"))
    expect(s).toContain("DROP TABLE IF EXISTS comisiones_config")
  })
  it("probes roll back, use their own result table, and cover each branch", () => {
    const s = stripComments(probes())
    expect(s).toMatch(/^\s*BEGIN\s*;/m); expect(s.trimEnd().endsWith("ROLLBACK;")).toBe(true)
    expect(s).toContain("CREATE TEMP TABLE _r380")
    for (const k of ["propio", "por defecto", "sin config", "sin receptor", "otra org", "explicito", "has_table_privilege", "prosecdef"]) expect(probes()).toContain(k)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run __tests__/comisiones-recepcion-migration.test.ts`
Expected: FAIL with `No file in supabase/migrations/ matches suffix "_comisiones_recepcion.sql"`

- [ ] **Step 3: Write 380, its rollback and probes.**
  - Header: why (spec link), "nothing reads these until 381", and the rollback and verify paths.
  - The trigger function is the only logic:

```sql
CREATE OR REPLACE FUNCTION set_porcentaje_comision_recepcion() RETURNS TRIGGER AS $$
DECLARE v_propio NUMERIC(5,2);
BEGIN
  IF NEW.porcentaje_comision_recepcion IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.recibido_por IS NULL THEN NEW.porcentaje_comision_recepcion := 0; RETURN NEW; END IF;
  SELECT u.porcentaje_comision_recepcion INTO v_propio
    FROM users u WHERE u.id = NEW.recibido_por AND u.organization_id = NEW.organization_id;
  IF NOT FOUND THEN NEW.porcentaje_comision_recepcion := 0; RETURN NEW; END IF;
  NEW.porcentaje_comision_recepcion := COALESCE(v_propio, (SELECT c.recepcion_porcentaje_default FROM comisiones_config c WHERE c.organization_id = NEW.organization_id), 0);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;
```

  - **Rollback** (marker `Rollback of comisiones_recepcion`):
    - Header: run `381_rollback` first. It loses every order's reception snapshot and the shop rules, so export `comisiones_config` first.
    - Drop the trigger, the function, the index and `comisiones_config`, then both columns.
  - **Probes** (marker `Verification of comisiones_recepcion`):
    - Fixture: any org with a sucursal and a cliente. Two users of that org get `porcentaje_comision_recepcion` set inside the probe (7, and NULL). The probe upserts `comisiones_config` with default 3.
    - Each insert is a plain `INSERT INTO ordenes_servicio`. The trigger fires for every insert path, so one insert shape proves it.
    - Labelled probes:
      - `propio` (7);
      - `por defecto` (NULL rate → 3);
      - `sin config` (config row deleted → 0);
      - `sin receptor` (0);
      - `otra org` (receiver id from another org → 0);
      - `explicito` (insert with 9 → 9);
      - CHECK rejects 101 on `comisiones_config` and on `users`;
      - `has_table_privilege('authenticated', 'comisiones_config', 'SELECT')` false, service_role true;
      - `pg_proc.prosecdef` true and `proconfig` contains `search_path`.

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run __tests__/comisiones-recepcion-migration.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/380_comisiones_recepcion.sql supabase/migrations/rollback/380_rollback.sql supabase/migrations/verify/380_probes.sql __tests__/comisiones-recepcion-migration.test.ts
git commit -m "feat(db): add reception commission rates, shop rules and order snapshot trigger"
```

- [ ] **Step 6: Hand to the controller.** Dry-run 380; it is expected to end in ROLLBACK with no error. After `--apply`, dry-run `verify/380_probes.sql`: every `obtenido` must equal `esperado` or start with `OK:`.

---

### Task 2: The order branch of the definition, both roles, plus the impact report (PR A)

**Files:**
- Create: `supabase/migrations/381_comisiones_reparaciones.sql`, `supabase/migrations/rollback/381_rollback.sql`
- Test: `__tests__/comisiones-reparaciones-migration.test.ts`

**Interfaces:**
- Consumes: Task 1's columns and table; 377's views; the `pagadas` key rule.
- Produces:
  - `v_comisiones_filas` and `v_comisiones_devengadas` keep every 377 column in place and append three columns: `base_tipo TEXT`, `documento_monto NUMERIC(12,2)` and `motivo_sin_devengo TEXT`. The values are:
    - `base_tipo` is `'MANO_DE_OBRA' | 'MONTO_ORDEN'` on live `ORDEN` `ORIGINAL` rows, else NULL.
    - `documento_monto` is the order amount on live `ORDEN` `ORIGINAL` rows, else NULL.
    - `motivo_sin_devengo` is NULL when the row is accrued. Otherwise one of `'ESPERA_ENTREGA_Y_COBRO' | 'ESPERA_ENTREGA' | 'ESPERA_COBRO' | 'SIN_REPARACION' | 'NO_COMISIONA'`.
  - New row keys:
    - `ORDEN:<id>:RECEPCION:ORIGINAL:-`
    - `ORDEN:<id>:<TECNICO|RECEPCION>:AJUSTE_DEVOLUCION:<notas_credito.id>`

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest"
import { readBySuffix, readByMarker, collapse, stripComments } from "./helpers/sql-text"

const mig = () => collapse(readBySuffix("_comisiones_reparaciones.sql"))
const m377 = () => collapse(readBySuffix("_comisiones_definicion.sql"))
const rb = () => readByMarker("rollback", "Rollback of comisiones_reparaciones")
const vista = (s: string) => s.slice(s.indexOf("CREATE OR REPLACE VIEW v_comisiones_filas"), s.indexOf("SELECT * FROM v_comisiones_filas WHERE devengada;") + 49)

describe("381: hygiene", () => {
  it("lock_timeout first, no transaction, no DML, aborts before anything when 380 is missing", () => {
    expect(mig().startsWith("SET LOCAL lock_timeout = '3s';")).toBe(true)
    expect(stripComments(readBySuffix("_comisiones_reparaciones.sql"))).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;|\b(INSERT INTO|DELETE FROM)\b|\bUPDATE\s+\w+\s+SET\b/im)
    expect(mig().indexOf("Abort: aplicar 380 antes de 381")).toBeLessThan(mig().indexOf("CREATE TEMP TABLE _antes_381"))
  })
})
describe("381: sales are untouched", () => {
  it.each([
    "SELECT COALESCE(SUM(d.monto_devolucion), 0) AS devuelto FROM devoluciones_venta d WHERE d.venta_id = v.id )",
    "GREATEST(COALESCE(v.iva_neto, v.total) * (1 - dev.devuelto / v.total), 0)",
    "d.estado = 'COMPLETADA' AND NOT d.anulada AND d.created_at > po.fecha_pago",
    "-(po.monto + COALESCE(dp.monto, 0))",
  ])("keeps 377's fragment %s", (frag) => { expect(m377()).toContain(frag); expect(mig()).toContain(frag) })
})
describe("381: the order amount and the two roles", () => {
  it("order amount = costo_final − descuento_cobro − non-annulled credit notes, floored at 0", () => {
    expect(mig()).toContain("GREATEST(COALESCE(o.costo_final, 0) - COALESCE(o.descuento_cobro, 0) - ncs.monto, 0) AS monto_orden")
    expect(mig()).toContain("WHERE nc.orden_id = o.id AND nc.organization_id = o.organization_id AND NOT nc.anulada")
  })
  it("one row per role from the order's own snapshots; RECEPCION only when its amount is above 0", () => {
    expect(mig()).toContain("('TECNICO'::text, o.tecnico_id, COALESCE(o.porcentaje_comision, 0)::numeric, COALESCE(cfg.tecnico_base, 'MANO_DE_OBRA'))")
    expect(mig()).toContain("('RECEPCION'::text, o.recibido_por, COALESCE(o.porcentaje_comision_recepcion, 0)::numeric, COALESCE(cfg.recepcion_base, 'MONTO_ORDEN'))")
    expect(mig()).toContain("WHERE rr.beneficiario_id IS NOT NULL AND (rr.rol = 'TECNICO' OR ROUND(bb.base * rr.porcentaje / 100, 2) > 0)")
  })
  it("labour base is the order amount minus 119's parts cost", () => {
    expect(mig()).toContain("ELSE GREATEST(m.monto_orden - rep.costo, 0) END AS base")
    expect(mig()).toContain("COALESCE(SUM(r.cantidad * r.precio_unitario), 0) AS costo")
  })
})
describe("381: rules", () => {
  it("defaults when the config row is missing match 380's column defaults", () => {
    for (const d of ["COALESCE(cfg.orden_devengo, 'ENTREGA_Y_COBRO')", "COALESCE(cfg.reingreso_comisiona, false)"]) expect(mig()).toContain(d)
  })
  it("never-commission cases, flag 257 for both roles, then the accrual rule", () => {
    const s = mig()
    expect(s).toContain("WHEN o.es_practica OR o.estado IN ('CANCELADO', 'ENTREGADO_SIN_COBRO') OR (e.reingreso AND NOT COALESCE(cfg.reingreso_comisiona, false)) THEN 'NO_COMISIONA'")
    expect(s).toContain("WHEN o.estado = 'ENTREGADO_SIN_REPARACION' AND NOT org.comision_aplica_sin_reparacion THEN 'SIN_REPARACION'")
    expect(s).toContain("o.estado_cobro IS NOT DISTINCT FROM 'COBRADO' AS cobrada")
    expect(s).toContain("(o.es_reingreso OR EXISTS (SELECT 1 FROM reclamos_garantia rg WHERE rg.orden_reparacion_id = o.id)) AS reingreso")
    expect(s).toContain("(mo.motivo IS NULL) AS devengada")
  })
  it("fecha_devengo follows the rule; cobros and invoice payments ignore annulled ones", () => {
    const s = mig()
    expect(s).toContain("COALESCE(CASE e.regla WHEN 'ENTREGA' THEN o.fecha_entrega WHEN 'COBRO' THEN uc.ultimo_cobro ELSE GREATEST(o.fecha_entrega, uc.ultimo_cobro) END, o.fecha_completado) AS fecha_devengo")
    expect(s).toContain("AND NOT c.anulado")
    expect(s).toContain("f.estado_pago::text <> 'ANULADA'")
  })
})
describe("381: order credit notes after payment", () => {
  it("one negative row per credit note created after the role's ORIGINAL was paid, capped at the paid base", () => {
    const s = mig()
    expect(s).toContain("NOT nc.anulada AND nc.created_at > po.fecha_pago")
    expect(s).toContain("SUM(nc.monto) OVER (ORDER BY nc.created_at, nc.id) AS acumulado")
    expect(s).toContain("LEAST(COALESCE(po.base, 0), x.acumulado) - LEAST(COALESCE(po.base, 0), x.acumulado - x.monto) AS reduccion")
    expect(s).toContain("WHERE po.documento_tipo = 'ORDEN' AND po.tipo = 'ORIGINAL' AND po.rol IN ('TECNICO', 'RECEPCION')")
  })
  it("the closed-row anti-join is still by key, never by beneficiary", () => {
    const anti = mig().slice(mig().indexOf("WHERE NOT EXISTS ( SELECT 1 FROM pagadas x"))
    const cuerpo = anti.slice(0, anti.indexOf(")"))
    expect(cuerpo).not.toContain("beneficiario_id")
  })
})
describe("381: views, security, impact report", () => {
  it("both views invoker-secured, service_role only; devengadas restated; new columns last", () => {
    const s = mig()
    for (const v of ["v_comisiones_filas", "v_comisiones_devengadas"]) {
      expect(s).toContain(`CREATE OR REPLACE VIEW ${v} WITH (security_invoker = true) AS`)
      expect(s).toContain(`REVOKE ALL ON public.${v} FROM PUBLIC, anon, authenticated`)
      expect(s).toContain(`GRANT SELECT ON public.${v} TO service_role`)
    }
    expect(s).toMatch(/rep\.costo::numeric\(12,2\) AS documento_costo_repuestos, f\.base_tipo, f\.documento_monto::numeric\(12,2\) AS documento_monto, f\.motivo_sin_devengo FROM filas f/)
  })
  it("snapshots before replacing and prints every section the PR must state", () => {
    const s = mig()
    expect(s.indexOf("CREATE TEMP TABLE _antes_381 ON COMMIT DROP AS")).toBeLessThan(s.indexOf("CREATE OR REPLACE VIEW v_comisiones_filas"))
    for (const sec of ["[1] TECNICO sin pagar: cambia el monto", "[1b] cambia sin descuento ni nota de credito", "[2] TECNICO sin pagar: deja de devengar", "[3] TECNICO sin pagar: empieza a devengar", "[4] TECNICO sin pagar: cambia la fecha de devengo", "[5] filas pagadas que cambian", "[6] ajustes nuevos por nota de credito posterior al pago", "[7] filas RECEPCION", "[8] pendiente TECNICO devengado"]) expect(s).toContain(sec)
  })
  it("rollback restores 377's views exactly and says what stays visible", () => {
    expect(collapse(rb())).toContain("DROP VIEW IF EXISTS v_comisiones_devengadas; DROP VIEW IF EXISTS v_comisiones_filas;")
    expect(vista(collapse(rb()))).toBe(vista(m377()))
    expect(rb()).not.toContain("Rollback of comisiones_definicion")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run __tests__/comisiones-reparaciones-migration.test.ts`
Expected: FAIL with `No file in supabase/migrations/ matches suffix "_comisiones_reparaciones.sql"`

- [ ] **Step 3: Write `381_comisiones_reparaciones.sql`.** Order of the file:
  1. Header.
  2. `SET LOCAL lock_timeout = '3s';`
  3. A `DO` block raising `'Abort: aplicar 380 antes de 381'` when `to_regclass('public.comisiones_config')` is NULL or `ordenes_servicio.porcentaje_comision_recepcion` is missing.
  4. `_antes_381`.
  5. The two views.
  6. REVOKE/GRANT pairs and `COMMENT ON VIEW`.
  7. `_despues_381`.
  8. Report sections `[1]`–`[8]`.

  **The view.** It is 377's text with exactly these changes:
  - every `vivas` branch gains three trailing columns: `NULL, NULL, NULL` on the sale and manual branches;
  - `filas`'s paid branch adds `NULL, NULL, NULL` after `true` (devengada);
  - the final SELECT appends `f.base_tipo, f.documento_monto::numeric(12,2) AS documento_monto, f.motivo_sin_devengo`;
  - 377's `ORIGINAL / ORDEN / TECNICO` branch is replaced by the branch below;
  - the order credit-note branch below is added after the sale `AJUSTE_ANULACION` branch.

```sql
  -- ORIGINAL / ORDEN / TECNICO + RECEPCION: one pass per order, one row per role
  SELECT o.organization_id, 'ORDEN'::text AS documento_tipo, o.id AS documento_id,
         rr.beneficiario_id, rr.rol, 'ORIGINAL'::text AS tipo, NULL::text AS ajuste_ref,
         bb.base, rr.porcentaje, ROUND(bb.base * rr.porcentaje / 100, 2) AS monto,
         COALESCE(CASE e.regla WHEN 'ENTREGA' THEN o.fecha_entrega
                               WHEN 'COBRO'   THEN uc.ultimo_cobro
                               ELSE GREATEST(o.fecha_entrega, uc.ultimo_cobro) END,
                  o.fecha_completado) AS fecha_devengo,
         (mo.motivo IS NULL) AS devengada,
         rr.base_tipo, m.monto_orden AS documento_monto, mo.motivo AS motivo_sin_devengo
    FROM ordenes_servicio o
    JOIN organizations org ON org.id = o.organization_id
    LEFT JOIN comisiones_config cfg ON cfg.organization_id = o.organization_id
    CROSS JOIN LATERAL (
      SELECT COALESCE(SUM(r.cantidad * r.precio_unitario), 0) AS costo
        FROM repuestos_orden r WHERE r.orden_id = o.id
    ) rep
    CROSS JOIN LATERAL (
      SELECT COALESCE(SUM(nc.monto), 0) AS monto FROM notas_credito nc
       WHERE nc.orden_id = o.id AND nc.organization_id = o.organization_id AND NOT nc.anulada
    ) ncs
    CROSS JOIN LATERAL (
      SELECT GREATEST(COALESCE(o.costo_final, 0) - COALESCE(o.descuento_cobro, 0) - ncs.monto, 0) AS monto_orden
    ) m
    CROSS JOIN LATERAL (
      -- Builder's call (spec): an order collected only through invoice payments (345) is dated
      -- by its last pagos_parciales.fecha; the later of both sources wins.
      SELECT GREATEST(
        (SELECT MAX(c.created_at) FROM cobros_orden c
          WHERE c.orden_id = o.id AND c.organization_id = o.organization_id AND NOT c.anulado),
        (SELECT MAX(pp.fecha) FROM pagos_parciales pp JOIN facturas f ON f.id = pp.factura_id
          WHERE f.orden_id = o.id AND f.estado_pago::text <> 'ANULADA')
      ) AS ultimo_cobro
    ) uc
    CROSS JOIN LATERAL (
      SELECT COALESCE(cfg.orden_devengo, 'ENTREGA_Y_COBRO') AS regla,
             o.estado IN ('ENTREGADO', 'ENTREGADO_SIN_REPARACION') AS entregada,
             o.estado_cobro IS NOT DISTINCT FROM 'COBRADO' AS cobrada,
             (o.es_reingreso OR EXISTS (SELECT 1 FROM reclamos_garantia rg WHERE rg.orden_reparacion_id = o.id)) AS reingreso
    ) e
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN o.es_practica OR o.estado IN ('CANCELADO', 'ENTREGADO_SIN_COBRO')
          OR (e.reingreso AND NOT COALESCE(cfg.reingreso_comisiona, false)) THEN 'NO_COMISIONA'
        WHEN o.estado = 'ENTREGADO_SIN_REPARACION' AND NOT org.comision_aplica_sin_reparacion THEN 'SIN_REPARACION'
        WHEN e.regla = 'ENTREGA_Y_COBRO' AND NOT (e.entregada AND e.cobrada) THEN 'ESPERA_ENTREGA_Y_COBRO'
        WHEN e.regla = 'ENTREGA' AND NOT e.entregada THEN 'ESPERA_ENTREGA'
        WHEN e.regla = 'COBRO' AND NOT e.cobrada THEN 'ESPERA_COBRO'
      END AS motivo
    ) mo
    CROSS JOIN LATERAL (VALUES
      ('TECNICO'::text, o.tecnico_id, COALESCE(o.porcentaje_comision, 0)::numeric, COALESCE(cfg.tecnico_base, 'MANO_DE_OBRA')),
      ('RECEPCION'::text, o.recibido_por, COALESCE(o.porcentaje_comision_recepcion, 0)::numeric, COALESCE(cfg.recepcion_base, 'MONTO_ORDEN'))
    ) AS rr(rol, beneficiario_id, porcentaje, base_tipo)
    CROSS JOIN LATERAL (
      SELECT CASE rr.base_tipo WHEN 'MONTO_ORDEN' THEN m.monto_orden
             ELSE GREATEST(m.monto_orden - rep.costo, 0) END AS base
    ) bb
   WHERE rr.beneficiario_id IS NOT NULL AND (rr.rol = 'TECNICO' OR ROUND(bb.base * rr.porcentaje / 100, 2) > 0)
  UNION ALL
  -- AJUSTE_DEVOLUCION / ORDEN: a credit note created after the role's ORIGINAL row was paid.
  -- The running sum per paid row caps the total at the paid base.
  SELECT po.organization_id, 'ORDEN', po.documento_id, po.beneficiario_id, po.rol, 'AJUSTE_DEVOLUCION', n.id,
         n.reduccion, COALESCE(po.porcentaje, 0),
         -ROUND(n.reduccion * COALESCE(po.porcentaje, 0) / 100, 2),
         n.created_at, true, NULL, NULL, NULL
    FROM pagadas po
    CROSS JOIN LATERAL (
      SELECT x.id, x.created_at,
             LEAST(COALESCE(po.base, 0), x.acumulado) - LEAST(COALESCE(po.base, 0), x.acumulado - x.monto) AS reduccion
        FROM (SELECT nc.id, nc.created_at, nc.monto,
                     SUM(nc.monto) OVER (ORDER BY nc.created_at, nc.id) AS acumulado
                FROM notas_credito nc
               WHERE nc.orden_id = po.documento_id AND nc.organization_id = po.organization_id
                 AND NOT nc.anulada AND nc.created_at > po.fecha_pago) x
    ) n
   WHERE po.documento_tipo = 'ORDEN' AND po.tipo = 'ORIGINAL' AND po.rol IN ('TECNICO', 'RECEPCION')
     AND ROUND(n.reduccion * COALESCE(po.porcentaje, 0) / 100, 2) <> 0
```

  **The impact report.**
  - Both snapshots are `CREATE TEMP TABLE ... ON COMMIT DROP AS SELECT clave, organization_id, documento_id, beneficiario_id, rol, tipo, monto, pendiente, devengada, pagado, fecha_devengo FROM v_comisiones_filas WHERE documento_tipo = 'ORDEN'`. `_despues_381` also takes `motivo_sin_devengo`.
  - Each section is one SELECT with a `seccion` label column and aggregate columns only: no org names. `talleres` = `COUNT(DISTINCT organization_id)`.
  - Unless a section says otherwise, rows are `rol = 'TECNICO' AND tipo = 'ORIGINAL' AND NOT pagado` and are joined on `clave`.
  - Section `[1]` is exactly:

```sql
SELECT '[1] TECNICO sin pagar: cambia el monto' AS seccion,
       COUNT(*) AS filas, COUNT(DISTINCT a.organization_id) AS talleres,
       SUM(d.monto - a.monto) AS diferencia,
       COUNT(*) FILTER (WHERE a.devengada AND d.devengada) AS devengadas,
       COALESCE(SUM(d.monto - a.monto) FILTER (WHERE a.devengada AND d.devengada), 0) AS diferencia_devengadas
  FROM _antes_381 a JOIN _despues_381 d USING (clave)
 WHERE a.rol = 'TECNICO' AND a.tipo = 'ORIGINAL' AND NOT a.pagado AND a.monto <> d.monto;
```

  Sections `[1b]`–`[8]`:

  | Section | Rows | What it shows |
  |---|---|---|
  | `[1b] cambia sin descuento ni nota de credito` | `[1]`'s rows whose order has `descuento_cobro = 0` and no non-annulled credit note | Must be 0. |
  | `[2] TECNICO sin pagar: deja de devengar` | `a.devengada AND NOT d.devengada` | `GROUP BY causa`: `practica` when `es_practica`; `reingreso` when `d.motivo_sin_devengo = 'NO_COMISIONA'` and the order is a re-entry; `reparado sin entregar` when `estado = 'REPARADO'`; else `otra`. Count, talleres, `SUM(a.monto)`. |
  | `[3] TECNICO sin pagar: empieza a devengar` | the opposite of `[2]` | Count; expected 0. |
  | `[4] TECNICO sin pagar: cambia la fecha de devengo` | devengada in both and `fecha_devengo` differs | Count, plus a count of those whose `date_trunc('month', ...)` differs. |
  | `[5] filas pagadas que cambian` | `a.pagado` | Any whose `d` row is missing, not `pagado`, or differs in `monto` or `beneficiario_id`. Must be 0. |
  | `[6] ajustes nuevos por nota de credito posterior al pago` | `d.tipo = 'AJUSTE_DEVOLUCION'` | `GROUP BY rol`: count, talleres, `SUM(monto)`. |
  | `[7] filas RECEPCION` | `d.rol = 'RECEPCION'` | Count; expected 0 right after apply. |
  | `[8] pendiente TECNICO devengado` | — | `SUM(pendiente)` over devengada `TECNICO` rows, before and after, as two columns. |

  **Rollback** (`rollback/381_rollback.sql`, marker `Rollback of comisiones_reparaciones`):
  - Body: `SET LOCAL lock_timeout`, `DROP VIEW IF EXISTS v_comisiones_devengadas; DROP VIEW IF EXISTS v_comisiones_filas;`, then 377's two `CREATE OR REPLACE VIEW` statements, REVOKE/GRANT pairs and comments, copied verbatim.
  - Header:
    - plpgsql RPCs keep working, because they resolve the views at call time;
    - live `RECEPCION` rows and order credit-note adjustments disappear;
    - their paid items stay visible, because 377's `pagadas` branch is role-agnostic;
    - run `380_rollback` after this file.

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run __tests__/comisiones-reparaciones-migration.test.ts`
Run: `./node_modules/.bin/vitest run __tests__/comisiones-definicion-migration.test.ts`
Expected: PASS (377's own test untouched and green)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/381_comisiones_reparaciones.sql supabase/migrations/rollback/381_rollback.sql __tests__/comisiones-reparaciones-migration.test.ts
git commit -m "feat(db): repair commissions for reception and technician on the real order amount"
```

---

### Task 3: Probes for the order definition (PR A)

**Files:**
- Create: `supabase/migrations/verify/381_probes.sql`
- Test: `__tests__/comisiones-reparaciones-migration.test.ts` (append a describe)

**Interfaces:**
- Consumes: Tasks 1–2, `pagar_comisiones`, `anular_pago_comisiones`.
- Produces: a probe file (marker `Verification of comisiones_reparaciones`, result table `_r381`).
  - Real-data invariant first, before any fixture write:
    - `R0`: every non-annulled payout item has a `v_comisiones_filas` row with the same `clave`, `monto`, `pagado = true`, and the payout's `beneficiario_id`. Expect `0` mismatches.
  - The fixture is one order in a real org. It has:
    - two users of that org: technician T and receiver R;
    - `costo_final 1000`, `descuento_cobro 100`, one part `1 × 200`, one credit note `50`;
    - `porcentaje_comision 10` and `porcentaje_comision_recepcion 5`, set explicitly;
    - an upserted `comisiones_config` row (defaults).
  - So the order amount is 850, labour is 650, `TECNICO` is 65.00 and `RECEPCION` is 42.50.
  - The order is made `COBRADO` with a cobros row of 900, the way `verify/360_probes.sql` does it. The probe asserts `estado_cobro = 'COBRADO'` as a precondition.

| Probe | Setup | Expected |
|---|---|---|
| R1 | `ENTREGADO` + `COBRADO` | `TECNICO` base 650, monto 65.00, `base_tipo MANO_DE_OBRA`, `documento_monto 850`; `RECEPCION` base 850, monto 42.50; both `devengada` |
| R2 | `tecnico_base = MONTO_ORDEN`, `recepcion_base = MANO_DE_OBRA` | `TECNICO` 85.00, `RECEPCION` 32.50 |
| R3 | a second credit note of 2000 | `documento_monto 0`; `TECNICO` row at 0 present; no `RECEPCION` row |
| R4 | `porcentaje_comision_recepcion` NULL (legacy) or 0 | no `RECEPCION` row; `TECNICO` row present |
| R5 | `REPARADO` + `COBRADO`, each `orden_devengo` | `ENTREGA_Y_COBRO`: not devengada, `ESPERA_ENTREGA_Y_COBRO`; `COBRO`: devengada; `ENTREGA`: `ESPERA_ENTREGA`. Then `ENTREGADO` + `PARCIAL`: `ENTREGA` devengada; `ENTREGA_Y_COBRO` not |
| R6 | dates (`clock_timestamp()` offsets) | `ENTREGA_Y_COBRO`: `fecha_devengo` = later of `fecha_entrega` and the last non-annulled cobro; `ENTREGA`: `fecha_entrega`; `COBRO`: last cobro; with only an invoice payment: its `pagos_parciales.fecha` |
| R7 | `ENTREGADO_SIN_REPARACION`, flag 257 off, then on | off: both roles `SIN_REPARACION`; on: both devengada |
| R8 | `es_practica`; `CANCELADO`; `ENTREGADO_SIN_COBRO`; `estado_cobro` NULL with `ENTREGADO` | first three `NO_COMISIONA`; the last not devengada |
| R9 | `es_reingreso`; a `reclamos_garantia` row pointing at the order | both `NO_COMISIONA`; with `reingreso_comisiona = true` devengada |
| R10 | pay the `RECEPCION` row (service_role) | payout ok, item `rol RECEPCION`; `ordenes_servicio.comision_pagada` still false; then pay `TECNICO` → true |
| R11 | after both payouts: credit notes of 600 and then 100 with `created_at = clock_timestamp()` | `TECNICO` adjustments −60.00 and −5.00 (cap at labour 650); `RECEPCION` −30.00 and −5.00; annul the 100 one → its rows disappear |
| R12 | after payout: change `costo_final`, `descuento_cobro`, both rates, `tecnico_id`, every config rule | both paid rows keep `monto`, `beneficiario_id`, `pagado` |
| R13 | annul the `RECEPCION` payout (`anular_pago_comisiones`, service_role) | row live again at the current amount; `comision_pagada` unchanged |
| R14 | privileges | both views `reloptions` contain `security_invoker=true`; `has_table_privilege('authenticated', 'v_comisiones_filas', 'SELECT')` false |

- [ ] **Step 1: Write the failing test** (append to `__tests__/comisiones-reparaciones-migration.test.ts`)

```ts
const probes = () => readByMarker("verify", "Verification of comisiones_reparaciones")
describe("381: probes", () => {
  it("roll back, own result table, service_role around every RPC, real-data invariant first", () => {
    const s = stripComments(probes())
    expect(s).toMatch(/^\s*BEGIN\s*;/m); expect(s.trimEnd().endsWith("ROLLBACK;")).toBe(true)
    expect(s).toContain("CREATE TEMP TABLE _r381")
    expect(s.match(/SET LOCAL ROLE service_role/g)!.length).toBe(s.match(/RESET ROLE/g)!.length / 2)
    expect(probes().indexOf("R0")).toBeLessThan(probes().indexOf("INSERT INTO ordenes_servicio"))
  })
  it("covers every row of the probe table", () => {
    for (let i = 0; i <= 14; i++) expect(probes()).toContain(`R${i}`)
    for (const k of ["clock_timestamp()", "comision_pagada", "reclamos_garantia", "pagos_parciales", "AJUSTE_DEVOLUCION"]) expect(probes()).toContain(k)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run __tests__/comisiones-reparaciones-migration.test.ts`
Expected: FAIL with `No file in supabase/migrations/verify matches marker "Verification of comisiones_reparaciones"`

- [ ] **Step 3: Write `verify/381_probes.sql`.**
  - Follow `verify/378_probes.sql`'s shape: a header listing what each probe proves, `_r381 (orden INT, probe TEXT, esperado TEXT, obtenido TEXT)`, a `pg_temp` helper for expected RPC errors, and one final SELECT.
  - Every RPC call sits inside `BEGIN ... EXCEPTION`, with `SET LOCAL ROLE service_role` before it and `RESET ROLE` after it and in the handler. That is why the test counts `RESET ROLE` twice per `SET LOCAL ROLE`.
  - A probe that finds no org with two users, a sucursal and a cliente skips itself with `SALTEADO:`.
  - Each scenario runs inside its own `SAVEPOINT` and rolls back to it, so R3's large credit note or R7's flag flip never leaks into a later probe. R10–R13 share one savepoint because they build on each other.

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run __tests__/comisiones-reparaciones-migration.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/verify/381_probes.sql __tests__/comisiones-reparaciones-migration.test.ts
git commit -m "test(db): probe the repair commission definition and its closed rows"
```

- [ ] **Step 6: Hand to the controller.** This needs 380 applied.
  - Dry-run 381 and read the report:
    - `[1b]`, `[3]`, `[5]` and `[7]` must be 0;
    - `[1]`, `[2]`, `[4]` and `[6]` are the numbers the PR states;
    - `[2]` rows of a cause other than `reparado sin entregar`, `practica` or `reingreso` stop the rollout.
  - With the user's OK, `--apply` 381, then dry-run `verify/381_probes.sql`.

---

### Task 4: Row fields and labels (PR B)

**Files:**
- Modify: `lib/commissions/types.ts`, `lib/commissions/rows.ts`
- Test: `__tests__/lib/commissions-rows.test.ts` (append), `__tests__/lib/commissions-labels.test.ts`

**Interfaces:**
- Consumes: the three new view columns (Task 2).
- Produces:

```ts
export type CommissionBaseKind = "MANO_DE_OBRA" | "MONTO_ORDEN"
export type OrderAccrualBlock = "ESPERA_ENTREGA_Y_COBRO" | "ESPERA_ENTREGA" | "ESPERA_COBRO" | "SIN_REPARACION" | "NO_COMISIONA"
// CommissionRow gains: baseTipo: CommissionBaseKind | null; documentoMonto: number | null; motivoSinDevengo: OrderAccrualBlock | null
export const COMMISSION_ROLE_LABEL: Record<CommissionRole, string> // { VENDEDOR: "Venta", TECNICO: "Técnico", RECEPCION: "Recepción" }
export function commissionKindLabel(tipo: CommissionKind, documentoTipo: CommissionDocType | null): string | null
// ORDEN + AJUSTE_DEVOLUCION → "Nota de crédito"; otherwise COMMISSION_KIND_LABEL[tipo]
export const ORDER_ACCRUAL_HINT: Record<OrderAccrualBlock, string>
```

Hint copy (exact):

| Code | Copy |
|---|---|
| `ESPERA_ENTREGA_Y_COBRO` | Se genera cuando la orden se entrega y queda cobrada por completo. |
| `ESPERA_ENTREGA` | Se genera cuando la orden se entrega. |
| `ESPERA_COBRO` | Se genera cuando la orden queda cobrada por completo. |
| `SIN_REPARACION` | No genera comisión: la orden se entregó sin reparar y el taller no paga comisión en ese caso. |
| `NO_COMISIONA` | Esta orden no genera comisión (práctica, cancelada, entregada sin cobro o reingreso por garantía). |

- [ ] **Step 1: Write the failing tests**

```ts
// commissions-rows.test.ts (append)
it("maps the order-only columns and keeps NULL as null", () => {
  expect(toCommissionRow(fila({ base_tipo: "MANO_DE_OBRA", documento_monto: "850.00", motivo_sin_devengo: "SIN_REPARACION" }))).toMatchObject({ baseTipo: "MANO_DE_OBRA", documentoMonto: 850, motivoSinDevengo: "SIN_REPARACION" })
  expect(toCommissionRow(fila({}))).toMatchObject({ baseTipo: null, documentoMonto: null, motivoSinDevengo: null })
})
// commissions-labels.test.ts
it("an order credit-note adjustment is a 'Nota de crédito'; a sale one keeps 'Devolución'", () => {
  expect(commissionKindLabel("AJUSTE_DEVOLUCION", "ORDEN")).toBe("Nota de crédito")
  expect(commissionKindLabel("AJUSTE_DEVOLUCION", "VENTA")).toBe("Devolución")
  expect(commissionKindLabel("ORIGINAL", "ORDEN")).toBeNull()
})
it("every accrual block has a hint and every role a label", () => {
  expect(Object.keys(ORDER_ACCRUAL_HINT).sort()).toEqual(["ESPERA_COBRO", "ESPERA_ENTREGA", "ESPERA_ENTREGA_Y_COBRO", "NO_COMISIONA", "SIN_REPARACION"])
  expect(COMMISSION_ROLE_LABEL.RECEPCION).toBe("Recepción")
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./node_modules/.bin/vitest run __tests__/lib/commissions-rows.test.ts`
Run: `./node_modules/.bin/vitest run __tests__/lib/commissions-labels.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement** in `types.ts`; `toCommissionRow` maps `base_tipo`, `documento_monto` (through `num`) and `motivo_sin_devengo`.

- [ ] **Step 4: Run tests and typecheck**

Run: both commands of Step 2, then `./node_modules/.bin/tsc --noEmit`
Expected: PASS; no type errors

- [ ] **Step 5: Commit**

```bash
git add lib/commissions/types.ts lib/commissions/rows.ts __tests__/lib/commissions-rows.test.ts __tests__/lib/commissions-labels.test.ts
git commit -m "feat(comisiones): expose order base, amount and accrual reason on commission rows"
```

---

### Task 5: Shop rules API (PR B)

**Files:**
- Create: `lib/commissions/config.ts`, `app/api/comisiones/config/route.ts`
- Modify: `lib/audit.ts` (add `"comisiones_config"` to `AuditEntity`), `lib/__tests__/comisiones-suscripciones-access-sweep.test.ts` (count `>= 10`)
- Test: `__tests__/lib/commissions-config.test.ts`, `__tests__/api/comisiones-config.test.ts`

**Interfaces:**
- Consumes: `comisiones_config` and `organizations.comision_aplica_sin_reparacion`.
- Produces (`config.ts`, client-safe):

```ts
export type OrderAccrualRule = "ENTREGA_Y_COBRO" | "ENTREGA" | "COBRO"
export interface CommissionConfig {
  ordenDevengo: OrderAccrualRule; tecnicoBase: CommissionBaseKind; recepcionBase: CommissionBaseKind
  recepcionPorcentajeDefault: number; reingresoComisiona: boolean; sinReparacionComisiona: boolean
}
export const COMMISSION_CONFIG_DEFAULTS: Omit<CommissionConfig, "sinReparacionComisiona">
// { ordenDevengo: "ENTREGA_Y_COBRO", tecnicoBase: "MANO_DE_OBRA", recepcionBase: "MONTO_ORDEN", recepcionPorcentajeDefault: 0, reingresoComisiona: false }
export const commissionConfigSchema: z.ZodType<CommissionConfig>
// enums as above; recepcionPorcentajeDefault number().min(0, msg).max(100, msg) → round2; msg "El porcentaje de recepción debe estar entre 0 y 100"
export const ORDER_ACCRUAL_OPTIONS: ReadonlyArray<{ value: OrderAccrualRule; label: string; implica: string }>
export const BASE_OPTIONS: ReadonlyArray<{ value: CommissionBaseKind; label: string; implica: string }>
```

  Option copy (exact):

  | Value | `label` | `implica` |
  |---|---|---|
  | `ENTREGA_Y_COBRO` | Al entregar la orden y tenerla cobrada por completo | Una orden entregada con saldo pendiente no genera comisión hasta que se cobra todo. |
  | `ENTREGA` | Al entregar la orden | Se genera al entregar, aunque quede saldo por cobrar. |
  | `COBRO` | Al tener la orden cobrada por completo | Se genera al cobrar todo, aunque el equipo siga en el taller. |
  | `MANO_DE_OBRA` | Mano de obra | Monto de la orden menos el costo de los repuestos. |
  | `MONTO_ORDEN` | Monto de la orden | Todo lo que se cobra por la orden, repuestos incluidos. |

- `GET /api/comisiones/config`:
  - `requireAdmin`;
  - returns `200 CommissionConfig`, using the defaults when the org has no row;
  - `sinReparacionComisiona` comes from `organizations` (with `.eq("id", organizationId)`);
  - `Cache-Control: no-store`.
- `PUT /api/comisiones/config`:
  - `requireAdmin`; the body is `commissionConfigSchema`, and a zod error gives 400 with the first message;
  - upserts `comisiones_config` on `organization_id` (`updated_at: now`);
  - updates `organizations.comision_aplica_sin_reparacion` only when it changed (`.eq("id", organizationId)`);
  - writes `createAuditLogger(...).update("comisiones_config", organizationId, before, after)` when anything changed;
  - returns `200` with the saved `CommissionConfig`;
  - a DB error gives 500 `No se pudieron guardar las reglas de comisiones`.

- [ ] **Step 1: Write the failing tests**

```ts
// __tests__/lib/commissions-config.test.ts — @vitest-environment node
it("TS defaults equal 380's column defaults and 381's fallbacks", () => {
  const m380 = collapse(readBySuffix("_comisiones_recepcion.sql")), m381 = collapse(readBySuffix("_comisiones_reparaciones.sql"))
  expect(m380).toContain(`orden_devengo TEXT NOT NULL DEFAULT '${COMMISSION_CONFIG_DEFAULTS.ordenDevengo}'`)
  expect(m380).toContain(`tecnico_base TEXT NOT NULL DEFAULT '${COMMISSION_CONFIG_DEFAULTS.tecnicoBase}'`)
  expect(m380).toContain(`recepcion_base TEXT NOT NULL DEFAULT '${COMMISSION_CONFIG_DEFAULTS.recepcionBase}'`)
  expect(m380).toContain(`recepcion_porcentaje_default NUMERIC(5,2) NOT NULL DEFAULT ${COMMISSION_CONFIG_DEFAULTS.recepcionPorcentajeDefault}`)
  expect(m381).toContain(`COALESCE(cfg.tecnico_base, '${COMMISSION_CONFIG_DEFAULTS.tecnicoBase}')`)
  expect(m381).toContain(`COALESCE(cfg.recepcion_base, '${COMMISSION_CONFIG_DEFAULTS.recepcionBase}')`)
})
it("schema rejects 101 and unknown options, rounds the rate", () => {
  expect(commissionConfigSchema.safeParse({ ...ok, recepcionPorcentajeDefault: 101 }).success).toBe(false)
  expect(commissionConfigSchema.safeParse({ ...ok, ordenDevengo: "REPARADO" }).success).toBe(false)
  expect(commissionConfigSchema.parse({ ...ok, recepcionPorcentajeDefault: 2.555 }).recepcionPorcentajeDefault).toBe(2.56)
})

// __tests__/api/comisiones-config.test.ts — @vitest-environment node
it("non-admins get 403 on GET and PUT and nothing is written", async () => { /* mockAuthSuccess({ role: "VENDEDOR" }) → 403, 403; mem.escrituras [] */ })
it("GET without a row returns the defaults and the org's flag 257", async () => {
  // organizations [{ id: "org-1", comision_aplica_sin_reparacion: true }], comisiones_config []
  expect(body).toEqual({ ...COMMISSION_CONFIG_DEFAULTS, sinReparacionComisiona: true })
})
it("GET never reads another org's row", async () => { /* rows for org-1 and org-2 → org-2 values never returned */ })
it("PUT upserts the caller's row, updates flag 257 in its org only, and audits before/after", async () => {
  // expect upsert on comisiones_config with organization_id "org-1" and snake_case values
  // expect organizations update { comision_aplica_sin_reparacion: false } filtered id = org-1
  // expect audit_logs insert entity "comisiones_config", entity_id "org-1", changes.before.ordenDevengo "ENTREGA_Y_COBRO", changes.after.ordenDevengo "COBRO"
})
it("PUT with 101 is a 400 with the schema's message", async () => { /* body.error === "El porcentaje de recepción debe estar entre 0 y 100" */ })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./node_modules/.bin/vitest run __tests__/lib/commissions-config.test.ts`
Run: `./node_modules/.bin/vitest run __tests__/api/comisiones-config.test.ts`
Expected: FAIL with `Failed to resolve import "@/lib/commissions/config"`

- [ ] **Step 3: Implement** `config.ts` and the route (snake↔camel mapping local to the route); add the audit entity; bump the access sweep count.

- [ ] **Step 4: Run tests and typecheck**

Run: both commands of Step 2, `./node_modules/.bin/vitest run lib/__tests__/comisiones-suscripciones-access-sweep.test.ts`, `./node_modules/.bin/tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/commissions/config.ts app/api/comisiones/config/route.ts lib/audit.ts lib/__tests__/comisiones-suscripciones-access-sweep.test.ts __tests__/lib/commissions-config.test.ts __tests__/api/comisiones-config.test.ts
git commit -m "feat(comisiones): add admin route for the shop's repair commission rules"
```

---

### Task 6: Rules screen in Configuración (PR B)

**Files:**
- Create: `components/configuracion/comisiones-config.tsx`
- Modify: `components/configuracion/config-tabs.ts`, `components/configuracion/configuracion-form.tsx` (mount the tab; remove the flag-257 checkbox, its state and its field in the PUT body), `__tests__/components/configuracion-tabs.test.tsx` (six → seven triggers)
- Test: `__tests__/components/comisiones-config.test.tsx`

**Interfaces:**
- Consumes: Task 5 (route, `ORDER_ACCRUAL_OPTIONS`, `BASE_OPTIONS`, `commissionConfigSchema`).
- Produces:
  - `ComisionesConfig({ allowEdit }: { allowEdit: boolean })`.
  - `CONFIG_TABS` gains `{ value: "comisiones", label: "Comisiones" }` between `comprobantes` and `avisos`. It is not in `FORM_TABS`: the screen has its own save button, like Avisos.
  - It is mounted as `<TabsContent value="comisiones" forceMount className={PANEL_CLASS}>`.
  - The main form stops sending `comisionAplicaSinReparacion`. `/api/configuracion` is untouched, so there is no cascade change.
- Copy (exact, neutral Spanish):

  | Part | Copy |
  |---|---|
  | Title | Comisiones de reparaciones |
  | Intro | Estas reglas definen cuándo y sobre qué monto ganan comisión el técnico y la persona que recibió el equipo. Un cambio recalcula las comisiones pendientes; las ya pagadas no cambian. |
  | Group "Cuándo se genera la comisión" | one radio per `ORDER_ACCRUAL_OPTIONS`, showing `label` and `implica` |
  | Group "Base del técnico" | `BASE_OPTIONS` |
  | Group "Base de recepción" | `BASE_OPTIONS` |
  | Note under the bases | Monto de la orden: costo final menos descuentos y notas de crédito. No incluye el recargo por pago con tarjeta. |
  | Note under the accrual rule | Las reparaciones fiadas y las exprés todavía no quedan cobradas por completo: con una regla que pide cobro, no generan comisión. |
  | Field label | Porcentaje de recepción por defecto |
  | Field help | Se aplica a quien recibe un equipo y no tiene un porcentaje de recepción propio. Con 0, la recepción no genera comisión. Cada orden guarda el porcentaje vigente al recibirla: un cambio no modifica órdenes ya recibidas. |
  | Checkbox | Los reingresos por garantía generan comisión |
  | Checkbox help | Incluye las órdenes creadas desde un reclamo de garantía. Un reingreso no tiene comisión de recepción. |
  | Checkbox | Las órdenes entregadas sin reparar generan comisión |
  | Checkbox help | Vale para el técnico y para la persona que recibió el equipo. |
  | Button | Guardar reglas |
  | Success toast | Reglas de comisiones guardadas |
  | Error toast | the server's `error`, or else "No se pudieron guardar las reglas" |
  | Load error | No se pudieron cargar las reglas de comisiones. |
  | Empresa tab, where the checkbox was | Las reglas de comisiones, incluido el pago en órdenes entregadas sin reparar, se configuran en la pestaña Comisiones. |

- [ ] **Step 1: Write the failing tests**

```ts
it("shows each option with what it implies and the current values", async () => {
  // fetch GET → { ...COMMISSION_CONFIG_DEFAULTS, sinReparacionComisiona: false }
  expect(await screen.findByText("Una orden entregada con saldo pendiente no genera comisión hasta que se cobra todo.")).toBeInTheDocument()
  expect(screen.getByRole("radio", { name: /Al entregar la orden y tenerla cobrada por completo/ })).toBeChecked()
  expect(screen.getByText(/un cambio no modifica órdenes ya recibidas/)).toBeInTheDocument()
})
it("saves the whole rule set with PUT and confirms", async () => {
  // click radio "Al entregar la orden", type 5 in "Porcentaje de recepción por defecto", click "Guardar reglas"
  expect(fetch).toHaveBeenLastCalledWith("/api/comisiones/config", expect.objectContaining({ method: "PUT", body: JSON.stringify({ ...COMMISSION_CONFIG_DEFAULTS, ordenDevengo: "ENTREGA", recepcionPorcentajeDefault: 5, sinReparacionComisiona: false }) }))
})
it("shows the server error and keeps the edits", async () => { /* PUT 400 { error: "El porcentaje de recepción debe estar entre 0 y 100" } → toast.error with it */ })
it("allowEdit=false disables every control", async () => { /* all radios, the number input, both checkboxes, the button disabled */ })
// configuracion-tabs.test.tsx: "renders the seven tab triggers and defaults to Secciones"; and Empresa no longer has the 257 checkbox but shows the pointer line
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./node_modules/.bin/vitest run __tests__/components/comisiones-config.test.tsx`
Run: `./node_modules/.bin/vitest run __tests__/components/configuracion-tabs.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement.** Fetch with SWR key `/api/comisiones/config`. Parse the response with `commissionConfigSchema.safeParse`; a failed parse shows the load error. Keep local state, PUT on save, then `mutate()`.

- [ ] **Step 4: Run tests and typecheck**

Run: both commands of Step 2, plus `./node_modules/.bin/vitest run __tests__/components/configuracion-form-pos-variantes.test.tsx` and `./node_modules/.bin/tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add components/configuracion/comisiones-config.tsx components/configuracion/config-tabs.ts components/configuracion/configuracion-form.tsx __tests__/components/comisiones-config.test.tsx __tests__/components/configuracion-tabs.test.tsx
git commit -m "feat(configuracion): repair commission rules tab with what each choice implies"
```

---

### Task 7: Reception rate per person, and the quote conversion records the receiver (PR B)

**Files:**
- Modify:
  - `app/api/vendedores/route.ts` (GET, POST), `app/api/vendedores/[id]/route.ts` (GET, PUT)
  - `app/api/tecnicos/route.ts` (GET, POST), `app/api/tecnicos/[id]/route.ts` (GET, PUT)
  - `components/vendedores/vendedor-form.tsx`, `components/tecnicos/tecnico-form.tsx`
  - the item types in `components/vendedores/vendedores-list.tsx` and `components/tecnicos/tecnicos-list.tsx`
  - `app/api/cotizaciones/[id]/convertir-orden/route.ts`
  - `lib/__tests__/comisiones-calculo-sweep.test.ts` (append), `lib/__tests__/comisiones-suscripciones-access-sweep.test.ts` (append)
- Test: `__tests__/api/tasas-recepcion.test.ts`, `__tests__/components/tasa-recepcion-forms.test.tsx`

**Interfaces:**
- Produces:
  - **Requests:** `porcentajeComisionRecepcion?: number | null` on POST/PUT for vendedores and tecnicos.
    - `null` clears the rate (the org default applies).
    - Absent means unchanged on PUT and NULL on POST.
    - Outside 0..100 gives 400 `El porcentaje de recepción debe estar entre 0 y 100`.
    - Written to `users.porcentaje_comision_recepcion` with the existing `organization_id` filters.
  - **Responses:** `porcentajeComisionRecepcion: number | null` on GET vendedores (list and `[id]`) and GET `tecnicos/[id]`.
    - On GET `/api/tecnicos` (list, `requireAuth`) it is included only when `role === "ADMIN"`.
  - **Forms:** `vendedor?.porcentajeComisionRecepcion?: number | null`, and the same on `tecnico`.
    - Field label "Comisión por recepción (%)", placeholder "Por defecto del taller".
    - Help: "Vacío: se usa el porcentaje por defecto del taller. Cada orden guarda el porcentaje vigente al recibir el equipo."
    - The body sends `null` when the input is blank, else `Number(value)`.
  - **Quote conversion:** the insert sets `recibido_por: await resolveOperador(organizationId!, null, userId!)`, the same default as POST `/api/ordenes`.
  - **Sweeps:**
    - Calc sweep, new describe "reception attribution":
      - only the four rate-writer route files contain the object key `porcentaje_comision_recepcion:`;
      - only `app/api/ordenes/route.ts`, `app/api/onboarding/practica/route.ts` and `app/api/cotizaciones/[id]/convertir-orden/route.ts` contain the object key `recibido_por:`;
      - each list has a "the listed files still match" check, like `ALLOWED`.
    - Access sweep, new describe: POST `/api/tecnicos` and `PUT /api/tecnicos/[id]` call `requireAdmin`.

- [ ] **Step 1: Write the failing tests**

```ts
// __tests__/api/tasas-recepcion.test.ts — @vitest-environment node
it.each([
  ["PUT /api/vendedores/[id]", putVendedor], ["PUT /api/tecnicos/[id]", putTecnico],
])("%s writes null, a number, or nothing", async (_n, put) => {
  expect(await updateOf(put({ porcentajeComisionRecepcion: null }))).toMatchObject({ porcentaje_comision_recepcion: null })
  expect(await updateOf(put({ porcentajeComisionRecepcion: 5 }))).toMatchObject({ porcentaje_comision_recepcion: 5 })
  expect(await updateOf(put({ nombre: "X" }))).not.toHaveProperty("porcentaje_comision_recepcion")
})
it("101 is a 400 with the reception message on all four writers", async () => { /* POST vendedores, PUT vendedores, POST tecnicos, PUT tecnicos */ })
it("GET /api/tecnicos returns the reception rate to ADMIN only", async () => { /* ADMIN → field present; TECNICO → property absent */ })
it("a converted quote records who converted it as the receiver", async () => { /* insert payload recibido_por === "u-admin" */ })

// __tests__/components/tasa-recepcion-forms.test.tsx
it("blank reception rate posts null, a value posts the number", async () => { /* VendedorForm: submit with blank → body.porcentajeComisionRecepcion === null; type 4.5 → 4.5; same for TecnicoForm */ })
it("explains the default and the snapshot", () => { expect(screen.getByText(/Cada orden guarda el porcentaje vigente al recibir el equipo/)).toBeInTheDocument() })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./node_modules/.bin/vitest run __tests__/api/tasas-recepcion.test.ts`
Run: `./node_modules/.bin/vitest run __tests__/components/tasa-recepcion-forms.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement.** Keep each route's validation style: zod in vendedores, manual checks in tecnicos. Prefill the forms from the prop.

- [ ] **Step 4: Run tests and typecheck**

Run: both commands of Step 2, `./node_modules/.bin/vitest run lib/__tests__/comisiones-calculo-sweep.test.ts`, `./node_modules/.bin/vitest run lib/__tests__/comisiones-suscripciones-access-sweep.test.ts`, `./node_modules/.bin/tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/vendedores app/api/tecnicos/route.ts "app/api/tecnicos/[id]/route.ts" components/vendedores components/tecnicos/tecnico-form.tsx components/tecnicos/tecnicos-list.tsx "app/api/cotizaciones/[id]/convertir-orden/route.ts" lib/__tests__/comisiones-calculo-sweep.test.ts lib/__tests__/comisiones-suscripciones-access-sweep.test.ts __tests__/api/tasas-recepcion.test.ts __tests__/components/tasa-recepcion-forms.test.tsx
git commit -m "feat(comisiones): reception rate per person and receiver on converted quotes"
```

---

### Task 8: Reception tab (PR C)

**Files:**
- Modify: `app/api/comisiones/route.ts`, `components/comisiones/comisiones-view.tsx`, `app/(dashboard)/comisiones/page.tsx`, `__tests__/api/comisiones-lectura.test.ts` (append), `__tests__/components/comisiones-view-pago.test.tsx` (the order adjustment label is now "Nota de crédito")
- Test: `__tests__/components/comisiones-recepcion-tab.test.tsx`

**Interfaces:**
- Consumes: Task 4 labels; `readCommissionRows`; `/api/operadores` (`Array<{ id, nombre, rol }>`).
- Produces:
  - **GET `/api/comisiones?rol=`**:
    - `TECNICO` (the default when absent) reads roles `["TECNICO"]`;
    - `RECEPCION` reads `["RECEPCION"]`;
    - `todos` reads `["TECNICO", "RECEPCION"]`;
    - any other value gives 400 `Rol inválido`.
    - The non-admin guard is unchanged: only the caller's own rows, whatever the role. The item and summary shapes are unchanged, so `tecnicoId`/`tecnicoNombre` name the beneficiary of any role.
  - **`ComisionesView`**: `ComisionesView({ tecnicoIdFijo, rol = "TECNICO" }: { tecnicoIdFijo?: string; rol?: "TECNICO" | "RECEPCION" })`.
    - It always sends `rol`.
    - For `RECEPCION`:
      - the people come from `/api/operadores` and the filter label is "Persona";
      - the empty state reads "Sin comisiones de recepción" / "Aparecen cuando una orden recibida con porcentaje de recepción cumple la regla del taller. El porcentaje se configura en Configuración › Comisiones.".
    - For both roles, the "Ganancia" header and summary label become "Base".
    - Badges use `commissionKindLabel(i.tipo, "ORDEN")`.
    - Paying is unchanged: `/api/comisiones/pagar`, `{ beneficiarioId, filas }`.
  - **Page:** tabs Técnicos | Recepción | Vendedores. The `Recepción` tab mounts `<ComisionesView rol="RECEPCION" />`. Description: "Liquidación de comisiones de técnicos, recepción y vendedores."

- [ ] **Step 1: Write the failing tests**

```ts
// comisiones-lectura.test.ts (append)
it.each([["", ["TECNICO"]], ["?rol=RECEPCION", ["RECEPCION"]], ["?rol=todos", ["TECNICO", "RECEPCION"]]])("rol%s reads %j", async (q, roles) => {
  mockAuthSuccess({ role: "ADMIN" }); const mem = montarSupabaseEnMemoria({ v_comisiones_devengadas: [fila({}), fila({ clave: "r", rol: "RECEPCION", beneficiario_id: "v1" })], users: usuarios })
  const body = (await parseResponse(await pedir(q))).body
  expect(new Set(body.items.map((i: any) => i.rol))).toEqual(new Set(roles))
})
it("an unknown rol is a 400", async () => { /* ?rol=VENDEDOR → 400 { error: "Rol inválido" } */ })
it("a non-admin with rol=todos gets only own rows of both roles", async () => { /* TECNICO t1; rows t1 TECNICO, t1 RECEPCION, t2 RECEPCION → 2 items, both t1 */ })
it("a removed receiver keeps their name and pending rows", async () => { /* users v9 { activo: false, deleted_at: "2026-10-01" } in org-1; rol=RECEPCION → item tecnicoNombre "Vera", pendiente 42.5 */ })

// comisiones-recepcion-tab.test.tsx
it("reads reception rows, lists people from /api/operadores and pays one person", async () => {
  // swr: "/api/operadores" → [{ id: "v1", nombre: "Vera", rol: "VENDEDOR" }]; "/api/comisiones?rol=RECEPCION&..." → items of v1
  expect(swrKeys.some((k) => k?.startsWith("/api/comisiones?") && k.includes("rol=RECEPCION"))).toBe(true)
  expect(screen.getByText("Persona")).toBeInTheDocument()
  // select both rows, pay → POST /api/comisiones/pagar { beneficiarioId: "v1", filas: [...] }
})
it("shows where to set the rate when there is nothing to list", () => { expect(screen.getByText(/Configuración › Comisiones/)).toBeInTheDocument() })
it("the technician tab still asks rol=TECNICO", () => { /* <ComisionesView /> key contains rol=TECNICO */ })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./node_modules/.bin/vitest run __tests__/api/comisiones-lectura.test.ts`
Run: `./node_modules/.bin/vitest run __tests__/components/comisiones-recepcion-tab.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement** the route param, the view prop (desktop table and mobile cards) and the page tab.

- [ ] **Step 4: Run tests and typecheck**

Run: both commands of Step 2, `./node_modules/.bin/vitest run __tests__/components/comisiones-view-pago.test.tsx`, `./node_modules/.bin/vitest run lib/__tests__/comisiones-suscripciones-access-sweep.test.ts`, `./node_modules/.bin/tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/comisiones/route.ts components/comisiones/comisiones-view.tsx "app/(dashboard)/comisiones/page.tsx" __tests__/api/comisiones-lectura.test.ts __tests__/components/comisiones-view-pago.test.tsx __tests__/components/comisiones-recepcion-tab.test.tsx
git commit -m "feat(comisiones): reception commissions tab"
```

---

### Task 9: Technician page shows both order roles (PR C)

**Files:**
- Modify: `components/tecnicos/tecnico-comisiones.tsx`
- Test: `__tests__/components/tecnico-comisiones-pago.test.tsx` (append)

**Interfaces:**
- Consumes: Task 8 `rol=todos`, Task 4 labels.
- Produces:
  - The request adds `rol=todos`.
  - A `RECEPCION` row shows a "Recepción" badge, and adjustments use `commissionKindLabel(tipo, "ORDEN")`.
  - The CSV headers become `["Orden", "Rol", "Dispositivo", "Fecha completado", "Costo final", "Repuestos", "Base", "% Comisión", "Comisión", "Estado pago", "Fecha pago"]`. "Rol" is `COMMISSION_ROLE_LABEL[i.rol]`.
  - Averages (`ticketPromedio`, `comisionPromedio`) use `TECNICO` `ORIGINAL` rows only. Totals (comisión, pendiente, pagado) sum every row.
  - Paying keeps `beneficiarioId: tecnicoId` for rows of both roles.

- [ ] **Step 1: Write the failing test**

```ts
it("asks both order roles and badges the reception rows", () => { /* swr key includes rol=todos; item rol RECEPCION → badge "Recepción" */ })
it("pays technician and reception rows of the same order in one payout", async () => {
  // items: ORDEN:o1:TECNICO:ORIGINAL:- 65, ORDEN:o1:RECEPCION:ORIGINAL:- 42.5, both tecnicoId t1
  expect(JSON.parse(fetchBody())).toEqual({ beneficiarioId: "t1", filas: [{ clave: "ORDEN:o1:TECNICO:ORIGINAL:-", monto: 65 }, { clave: "ORDEN:o1:RECEPCION:ORIGINAL:-", monto: 42.5 }] })
})
it("the CSV has a Rol column", () => { /* capture Blob text → first line contains "\"Orden\",\"Rol\"" and a row with "\"Recepción\"" */ })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run __tests__/components/tecnico-comisiones-pago.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement** the changes.

- [ ] **Step 4: Run test and typecheck**

Run: `./node_modules/.bin/vitest run __tests__/components/tecnico-comisiones-pago.test.tsx`, then `./node_modules/.bin/tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add components/tecnicos/tecnico-comisiones.tsx __tests__/components/tecnico-comisiones-pago.test.tsx
git commit -m "feat(tecnicos): technician page lists reception commissions with a role column"
```

---

### Task 10: Order card shows both roles (PR C)

**Files:**
- Modify: `components/ordenes/orden-comision-card.tsx`, `lib/commissions/card-version.ts`, `components/ordenes/orden-detail.tsx` (two call sites near 1283 and 1335; NC dialog `onSuccess` near 1399), `__tests__/components/orden-comision-card.test.tsx`, `__tests__/api/comisiones-orden.test.ts` (append)

**Interfaces:**
- Consumes: Task 4 fields and labels; GET `/api/comisiones/orden/[id]` (unchanged code: the new columns flow through `CommissionRow`).
- Produces:
  - **Card props:** `OrdenComisionCard` adds `recibidoPorId: string | null | undefined`.
  - **Key and visibility:**
    - The SWR key is `` `${orderCommissionKeyPrefix(ordenId)}v=${encodeURIComponent(version)}` `` when `tecnicoId || recibidoPorId`, else `null`.
    - The card returns `null` when there is neither, or when it has loaded with no rows and no `tecnicoId`.
    - The "Horas trabajadas" block shows only when there is a `tecnicoId`.
  - **Layout:**
    - Title "Comisiones".
    - Each row is headed `` `${COMMISSION_ROLE_LABEL[rol]} · ${beneficiarioNombre}` ``.
    - The editable `%` appears only for an unpaid `TECNICO` `ORIGINAL` row when not `readOnly`. The `RECEPCION` `%` is read-only, because rate changes are slice 3.
  - **Unpaid `ORIGINAL` breakdown:**
    - "Costo final" (`documentoTotal`);
    - "Descuentos y notas de crédito" `−(documentoTotal − documentoMonto)`, shown only when it is not 0;
    - "Repuestos" `−documentoCostoRepuestos`, shown only when `baseTipo === "MANO_DE_OBRA"`;
    - then the base, labelled "Mano de obra" or "Monto de la orden" by `baseTipo`.
  - **Paid rows:**
    - "Base", `%`, "Comisión", "Pagada el {fecha}";
    - "Pagada a {nombre}" when `beneficiarioId` differs from the current `tecnicoId` (`TECNICO`) or `recibidoPorId` (`RECEPCION`).
  - **Not accrued:** the badge "Proyectada" plus `ORDER_ACCRUAL_HINT[motivoSinDevengo]`. This replaces the old fixed sentence and covers the ENTREGADO_SIN_REPARACION nuance.
  - **`card-version.ts`:**
    - `orderCommissionKeyPrefix(ordenId: string): string` returns `` `/api/comisiones/orden/${ordenId}?` ``.
    - `commissionCardVersion` also takes `descuentoCobro?: number | null` and `fechaEntrega?: string | null`.
  - **`orden-detail.tsx`:**
    - Both call sites pass `recibidoPorId={(orden as any).recibidoPor?.id}`.
    - The NC dialog `onSuccess` also runs `void mutate((k) => typeof k === "string" && k.startsWith(orderCommissionKeyPrefix(orden.id)))`.

- [ ] **Step 1: Write the failing tests**

```ts
it("shows the technician and the receiver as two blocks with their names", () => {
  swr.data = { filas: [row(), row({ clave: "ORDEN:o:RECEPCION:ORIGINAL:-", rol: "RECEPCION", beneficiarioId: "r1", beneficiarioNombre: "Rita", baseTipo: "MONTO_ORDEN", base: 850, porcentaje: 5, monto: 42.5 })] }
  render(<OrdenComisionCard {...props} recibidoPorId="r1" />)
  expect(screen.getByText("Técnico · Ana")).toBeInTheDocument(); expect(screen.getByText("Recepción · Rita")).toBeInTheDocument()
  expect(screen.getAllByRole("spinbutton", { name: "% Comisión" })).toHaveLength(1)
})
it("explains discounts and credit notes, and repuestos only for a labour base", () => {
  swr.data = { filas: [row({ rol: "TECNICO", documentoTotal: 1000, documentoMonto: 850, documentoCostoRepuestos: 200, baseTipo: "MANO_DE_OBRA", base: 650 })] }
  // "Descuentos y notas de crédito" with 150, "Repuestos", "Mano de obra" with 650
})
it.each(Object.entries(ORDER_ACCRUAL_HINT))("a row blocked by %s shows its hint", (code, hint) => {
  swr.data = { filas: [row({ devengada: false, motivoSinDevengo: code })] }
  render(<OrdenComisionCard {...props} />); expect(screen.getByText(hint)).toBeInTheDocument()
})
it("loads for an order with a receiver and no technician, without the hours block", () => { /* tecnicoId null, recibidoPorId "r1" → key not null; no "Horas trabajadas" */ })
it("renders nothing with neither person", () => { /* both null → empty DOM, every key null */ })
it("the card key starts with the shared prefix and the version changes with the discount", () => {
  expect(swr.keys[0]!.startsWith(orderCommissionKeyPrefix("o"))).toBe(true)
  expect(commissionCardVersion({ descuentoCobro: 0 })).not.toBe(commissionCardVersion({ descuentoCobro: 100 }))
})
// comisiones-orden.test.ts (append)
it("returns the reception row with its beneficiary name", async () => { /* v_comisiones_filas row rol RECEPCION beneficiario r1; users r1 "Rita" in org-1 */ })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./node_modules/.bin/vitest run __tests__/components/orden-comision-card.test.tsx`
Run: `./node_modules/.bin/vitest run __tests__/api/comisiones-orden.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement** the card, `card-version.ts` and the three `orden-detail.tsx` edits.

- [ ] **Step 4: Run tests and typecheck**

Run: both commands of Step 2, plus `./node_modules/.bin/vitest run __tests__/components/orden-detail-practica.test.tsx`, `./node_modules/.bin/vitest run lib/__tests__/comisiones-calculo-sweep.test.ts` and `./node_modules/.bin/tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add components/ordenes/orden-comision-card.tsx lib/commissions/card-version.ts components/ordenes/orden-detail.tsx __tests__/components/orden-comision-card.test.tsx __tests__/api/comisiones-orden.test.ts
git commit -m "feat(ordenes): order card shows technician and reception commissions"
```

---

## Calls I made in this plan (for the user to check)

1. **Reception rows get their own tab** (Técnicos | Recepción | Vendedores). This is a deviation from the integration map line "seller tab: reception rows appear per person".
   - Why: the reception rows are order rows with the same shape as the technician tab, so `ComisionesView` is the solved twin.
   - Receivers are any role (counter staff, technicians, admins). In the seller tab, a technician's reception rows would sit under "Vendedores", and the seller picker lists sellers only.
   - The seller tab, the seller detail and liquidar stay `VENDEDOR` only, so their totals do not change meaning.
   - Cost: a shop with no technicians pays sales and reception in two payouts instead of one.
2. **Spec defaults move more than the base.** These spec definitions move unpaid technician rows:
   - "Delivered" excludes REPARADO;
   - practice orders never commission;
   - warranty re-entries default to "no";
   - the accrual date becomes the later of delivery and the last cobro.

   The brief's binding decision says defaults keep today's numbers except the base fix. The plan implements the spec and makes 381's dry-run report each cause separately (`[2]`, `[4]`). The rollout stops at that dry-run for the user's OK.
3. **Warranty re-entry** = `es_reingreso`, or an order linked from `reclamos_garantia.orden_reparacion_id` (warranty-claim orders do not set the flag).
4. **Dating an order collected only through invoices:** the last `pagos_parciales.fecha` of a non-annulled invoice. The later of that and the last cobro wins.
5. **Order credit notes after payment:** one negative row per credit note per paid role, with a running cap at the paid base, so the total clawback never exceeds what was paid. If the credit note is annulled before that adjustment is paid, the adjustment disappears. Once the adjustment is paid it stays closed, and reversing it is a slice 3 manual adjustment.
6. **Quote conversion records the person who converts as the receiver**, the same default as POST `/api/ordenes`. Without it, converted orders could never pay reception commission.
7. **Admins who receive a device follow the spec:** their own rate, else the org default.
8. **The flag 257 checkbox moves** from Configuración › Empresa into the new Comisiones tab, so every repair rule sits on one screen. `/api/configuracion` is untouched, so no cascade risk.
9. **The snapshot trigger is `SECURITY DEFINER`** (see Global Constraints).

---

## Self-review

- **Spec coverage.**
  - Every org rule has a column, a default, a view branch, a probe and a screen control: accrual rule, both bases, default reception rate, re-entries, flag 257 for both roles.
  - Rates: nullable per person, snapshot per order through a trigger on every creation path.
  - Payouts: role-agnostic 378 and the legacy flag kept `TECNICO`-only, probed in R10.
  - Closed rows: R0 and R12.
  - Order credit notes, before and after payment: R1 and R11.
  - Integration map: tab, technician page, "Mis comisiones" (same component), order card.
  - Parked items: the CSV "Rol" column (Task 9) and the ESR hint nuance (Tasks 4 and 10).
  - The production count of changed technician rows: 381 report sections `[1]`, `[2]` and `[4]`.
- **Placeholders.** None. Each `/* ... */` in a test is an arrange-and-assert spelled out in words, with the exact expected values.
- **Type consistency.**
  - `CommissionBaseKind` and `OrderAccrualBlock` (Task 4) are the types Tasks 5, 6 and 10 use.
  - `COMMISSION_CONFIG_DEFAULTS` is pinned to the SQL defaults by a test.
  - The view columns `base_tipo`, `documento_monto` and `motivo_sin_devengo` map to `baseTipo`, `documentoMonto` and `motivoSinDevengo`.
  - `rol` query values (`TECNICO`, `RECEPCION`, `todos`) are the same in Tasks 8 and 9.
- **Numbers checked by hand.**
  - The fixture: 1000 − 100 − 50 = 850; 850 − 200 = 650; 10% of 650 = 65.00; 5% of 850 = 42.50.
  - R11 caps: 600 then 100 against 650 gives 600 + 50, so −60.00 and −5.00. Against 850 it gives 600 + 100, so −30.00 and −5.00.
  - `[1b]` and `[3]` are 0 by construction: without a discount or credit note the labour base equals 119's, and the new accrual condition is narrower than 377's.

---

## Review Workload Forecast

| Task | Content | Est. changed lines |
|---|---|---|
| 1 | 380 + rollback + probes + test | ~380 |
| 2 | 381 (views, impact report) + rollback (377 copy, ~135 verbatim) + test | ~600 |
| 3 | 381 probes + test | ~340 |
| 4 | row fields, labels | ~90 |
| 5 | config lib + route + audit entity + tests | ~330 |
| 6 | config tab + checkbox move + tests | ~340 |
| 7 | rate fields (4 routes, 2 forms, lists), quote receiver, sweeps, tests | ~330 |
| 8 | `rol` param, reception tab, page, tests | ~260 |
| 9 | technician page, CSV, tests | ~110 |
| 10 | order card, version key, order detail, tests | ~280 |
| **Total** | | **~3,060** |

**PR split** (same shape as slice 1: the DB PR first, then the app PRs shipped in one deploy after the rollout):

| PR | Tasks | Est. lines | Notes |
|---|---|---|---|
| A — DB | 1–3 | ~1,320 | `size:exception`. ~135 lines are a verbatim 377 copy (rollback), and ~70 are verbatim 377 sale branches. SQL and text tests only: no runtime effect until applied. Merge to main. |
| B — rules and rates | 4–7 | ~1,090 | `size:exception`. Feature branch `feat/comisiones-recepcion`, PR 1 of the chain. |
| C — screens and card | 8–10 | ~650 | `size:exception`. Targets B's branch. |

**Rollout order** (the controller runs every step with the user's OK; dry-run first, then `--apply`):

1. Merge PR A to main. It is SQL only and has no runtime effect.
2. 380: dry-run, then `--apply`. Then dry-run `verify/380_probes.sql`.
3. 381: dry-run and read the impact report.
   - `[1b]`, `[3]`, `[5]` and `[7]` must be 0.
   - Record `[1]`, `[2]`, `[4]` and `[6]` in PR A's description (aggregates only).
   - The user approves the listed changes, then `--apply`.
   - Then dry-run `verify/381_probes.sql`.
   - From here, the technician tab of the deployed slice 1 app shows the new technician numbers. That is intended, and there are still no reception rows.
4. Merge the app chain (B, then C) to main in one deploy.
5. After deploy, a shop sets its rules and default reception rate in Configuración › Comisiones, and per-person rates in the seller and technician forms. Only orders received after that carry a reception rate.
6. From now on, `backfill/377_auditoria_comisiones.sql` section `[1]` lists the intended order changes. 381's report supersedes it for orders, while `[2]` (sales) must still be empty.
