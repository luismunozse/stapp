# Commissions Slice 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One SQL definition of every commission row, frozen payouts with an atomic pay RPC and an audited unpay, and every current commission screen and API reading that definition — with no number change on any unpaid document.

**Architecture:** Two views hold the single definition: `v_comisiones_filas` (every row, including order rows that have not accrued yet, for the order card's projection) and `v_comisiones_devengadas` (`= filas WHERE devengada`, what every list, total and payment reads). Live rows reproduce today's formulas (119 + `app/api/comisiones/route.ts:56-57`, and 333) byte for byte; a row with a non-annulled payout item is replaced by the item (closed-row rule). Payouts live in three new tables, are written only by two plpgsql RPCs, and the legacy `comision_pagada*` columns are re-derived from the items by those RPCs.

**Tech Stack:** Next.js 16 App Router route handlers, Supabase Postgres (service-role client `supabaseAdmin`), plpgsql, zod, SWR, vitest (+ Testing Library), SQL text tests (`__tests__/helpers/sql-text.ts`) and hand-run verify probes.

**Spec:** `docs/superpowers/specs/2026-10-29-comisiones-unificadas-design.md` (Slice 1 in "Slices"; "Model", "Payouts", "Integration map", "Calls I made").

## Global Constraints

- Slice 1 changes no number on an unpaid document. ORIGINAL rows reproduce `v_comisiones_ordenes` (119) plus the route filters (REPARADO/ENTREGADO, ENTREGADO_SIN_REPARACION when `organizations.comision_aplica_sin_reparacion`, `estado_cobro = 'COBRADO'`) and `v_comisiones_ventas` (333), bugs included: every `devoluciones_venta` row subtracts (annulled and rejected too), orders ignore labor, services, discounts and credit notes, practice orders count.
- Oracle: for every document whose legacy flag is false, Σ rows of the definition == today's screen amount. Paid documents == their backfilled payout; the only differences are the rows the backfill check lists.
- Reports (`estado-resultados`, `tendencia-financiera`, `rentabilidad`, `rentabilidad-tecnicos`) are out of scope (slice 4). Plan gating of commission screens is unchanged. Branch filter and org-timezone periods are slice 6: periods keep today's untimezoned `gte/lte`.
- Supabase only through `supabaseAdmin`; every query filters `organization_id` (including the `users` name lookups).
- New views: `WITH (security_invoker = true)`, `REVOKE ALL ... FROM PUBLIC, anon, authenticated`, `GRANT SELECT ... TO service_role` (347). `CREATE OR REPLACE VIEW` resets options: always restate `WITH (security_invoker = true)`.
- New tables: `id TEXT PRIMARY KEY DEFAULT generate_cuid()`, `organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE`, user FKs plain `REFERENCES users(id)` (NO ACTION, so the org purge cascade passes and `eliminarPersonal` falls back to "baja" on 23503); `ENABLE ROW LEVEL SECURITY`, a `FOR ALL TO service_role USING (true) WITH CHECK (true)` policy, `REVOKE ALL ... FROM PUBLIC, anon, authenticated`, no grant to `authenticated` (365 shape minus the authenticated read).
- RPCs: plpgsql, SECURITY INVOKER, errors raised as `'COMISION_ERROR:<CODE>[:<detail>]'`, `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` + `GRANT EXECUTE ... TO service_role` (354 hardening).
- Migration files start with `SET LOCAL lock_timeout = '3s';`, never contain `BEGIN;`/`COMMIT;` (db-run 40-line window), name their rollback and verify files in the header. Numbers 376–379 are provisional: renumber at merge; tests find files by suffix or marker (`readBySuffix`, `readByMarker`), never by number.
- Implementers never run `node scripts/db-run.mjs`. Every DB dry-run/apply step below is **handed to the orchestrator**.
- Strict TDD: failing test first in every task. Run one file at a time: `./node_modules/.bin/vitest run <path>`; typecheck `./node_modules/.bin/tsc --noEmit`. Never `npx next`, `npx tsc`, `npm run lint`, nor the whole suite. SQL text tests carry `// @vitest-environment node`.
- `rg` always with explicit paths or `-` (repo root holds `.env*`).
- English for code, identifiers, comments, commits. DB objects use the spec's Spanish names. JSON fields added to an existing Spanish payload stay Spanish camelCase. UI copy in Spanish, voseo, matching the screens ("Actualizá", "Elegí").
- Never round money inline in commission files: use `round2` from `@/lib/precios` (the sweep in Task 16 flags `* 100` next to `comision`).
- Conventional commits, no AI attribution, no `Co-Authored-By`. Public repo: no customer names; describe defects neutrally.
- PR budget 400 changed lines; chain below.

## Review Focus

1. An admin double-clicks "Marcar como pagadas", or two admins pay the same rows at once → exactly one payout; the other request gets 409 and writes nothing. (Task 1 unique index text test, Task 5 probe "same row twice", Task 10 `23505 → 409` test.)
2. Under "Todos", the admin selects rows of two people and pays → the bar disables the button with a reason, and the server refuses `OTRO_BENEFICIARIO`. (Task 13 component test, Task 5 probe.)
3. An admin unpays an old payout after a later payout already settled its return/annulment adjustments → refused with "Anulá ese pago primero"; amounts never subtract twice. (Task 6 probe.)
4. A period with more than 1000 commission rows → list and totals include every row. (Task 7 test.)
5. A technician is reassigned, or the order's amount is edited, after the order's commission was paid → the paid row keeps the old technician and amount; the new technician gets no row for that order. (Task 2 anti-join text test, Task 5 probes.)

---

## PR chain

DB PRs carry SQL files and SQL text tests only: merging them changes nothing at runtime, so they stack to main. App PRs change request bodies between screens and routes, so they ship together through a feature-branch chain (tracker merges to main once, after the rollout steps 1–6 at the end).

| PR | Tasks | Content | Est. changed lines |
|---|---|---|---|
| 1 | 1 | 376: `ventas.fecha_anulacion` + trigger; payout/adjustment tables; rollback | ~300 |
| 2 | 2, 3 | 377: the two views; rollback; read-only oracle/drift audit | ~370 |
| 3 | 4 | Idempotent payout backfill from legacy flags + checks | ~200 |
| 4 | 5 | 378: flag sync + `pagar_comisiones`; rollback; probes | ~395 |
| 5 | 6 | 379: `anular_pago_comisiones` (+ audit_logs); rollback; probes | ~270 |
| 6 | 7 | `lib/commissions/types.ts`, `rows.ts` (paged reader, summaries) | ~280 |
| 7 | 8 | GET `/api/comisiones` (technician tab, Mis comisiones) | ~260 |
| 8 | 9 | GET `/api/comisiones/vendedores`, `/api/vendedores/[id]`, `/api/vendedores/[id]/comisiones` | ~300 |
| 9 | 10, 11 | `lib/commissions/payouts.ts` + pay/unpay/liquidar wrappers | ~400 |
| 10 | 12, 13 | `AnularPagoDialog` + technician screens | ~400 |
| 11 | 14 | Seller screens | ~280 |
| 12 | 15, 16 | Order card endpoint + card; sweeps | ~400 |

## File structure

- `supabase/migrations/376_comisiones_fundacion.sql` — schema only (column, trigger, three tables). `rollback/376_rollback.sql`.
- `supabase/migrations/377_comisiones_definicion.sql` — the single definition (two views). `rollback/377_rollback.sql`. `backfill/377_auditoria_comisiones.sql` — read-only oracle + drift.
- `supabase/migrations/backfill/377_backfill_comisiones_pagos.sql` — re-runnable payout backfill.
- `supabase/migrations/378_comisiones_pagar_rpc.sql`, `rollback/378_rollback.sql`, `verify/378_probes.sql`.
- `supabase/migrations/379_comisiones_anular_pago_rpc.sql`, `rollback/379_rollback.sql`, `verify/379_probes.sql`.
- `lib/commissions/types.ts` — client-safe types and kind labels. `lib/commissions/rows.ts` — server reader over the views. `lib/commissions/payouts.ts` — body schemas, RPC error mapping, pay/annul handlers.
- `app/api/comisiones/orden/[id]/route.ts` — rows of one order for the card.
- `components/comisiones/anular-pago-dialog.tsx` — shared unpay dialog with mandatory reason.
- Tests: `__tests__/comisiones-*-migration.test.ts`, `__tests__/comisiones-backfill-pagos.test.ts`, `__tests__/lib/commissions-*.test.ts`, `__tests__/api/comisiones-*.test.ts`, `__tests__/components/*`, `lib/__tests__/comisiones-calculo-sweep.test.ts`.

---

### Task 1: Payout tables and sale annulment date (PR 1)

**Files:**
- Create: `supabase/migrations/376_comisiones_fundacion.sql`, `supabase/migrations/rollback/376_rollback.sql`
- Test: `__tests__/comisiones-fundacion-migration.test.ts`

**Interfaces:**
- Produces:
  - `ventas.fecha_anulacion TIMESTAMPTZ`, trigger `ventas_fecha_anulacion` → `set_fecha_anulacion_venta()`.
  - `comisiones_pagos(id, organization_id, beneficiario_id, fecha_pago TIMESTAMPTZ NOT NULL DEFAULT now(), pagado_por TEXT NULL, notas, total NUMERIC(12,2) NOT NULL, anulado BOOLEAN NOT NULL DEFAULT false, anulado_por, anulado_at, motivo_anulacion, origen TEXT NOT NULL DEFAULT 'APP' CHECK IN ('APP','BACKFILL'), created_at)`; `CHECK (NOT anulado OR (anulado_at IS NOT NULL AND anulado_por IS NOT NULL AND length(btrim(motivo_anulacion)) > 0))`.
  - `comisiones_pagos_items(id, pago_id → comisiones_pagos ON DELETE CASCADE, organization_id, documento_tipo CHECK IN ('VENTA','ORDEN') NULL, documento_id NULL, rol CHECK IN ('VENDEDOR','TECNICO','RECEPCION'), tipo CHECK IN ('ORIGINAL','AJUSTE_DEVOLUCION','AJUSTE_ANULACION','AJUSTE_MANUAL'), ajuste_ref TEXT NULL, base NUMERIC(12,2) NULL, porcentaje NUMERIC(5,2) NULL, monto NUMERIC(12,2) NOT NULL, fecha_devengo TIMESTAMPTZ NULL, anulado BOOLEAN NOT NULL DEFAULT false)`; `CHECK ((documento_tipo IS NULL) = (documento_id IS NULL))`.
  - Index `comisiones_pagos_items_documento_idx (organization_id, documento_tipo, documento_id, rol)`; index on `(pago_id)`; partial unique `comisiones_pagos_items_fila_vigente_uq ON (organization_id, COALESCE(documento_tipo,'-'), COALESCE(documento_id,'-'), rol, tipo, COALESCE(ajuste_ref,'-')) WHERE NOT anulado`.
  - `comisiones_ajustes(id, organization_id, beneficiario_id, documento_tipo NULL, documento_id NULL, rol, monto NUMERIC(12,2) NOT NULL CHECK (monto <> 0), motivo TEXT NOT NULL CHECK (length(btrim(motivo)) > 0), origen CHECK IN ('MANUAL','CAMBIO_TASA'), created_by NOT NULL, created_at)`; same documento CHECK; index `(organization_id, beneficiario_id)`.
  - `comisiones_pagos_items.anulado` mirrors its payout's `anulado`; only `anular_pago_comisiones` (Task 6) writes it. `fecha_devengo` freezes the row's accrual date at payment.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
const mig = () => readBySuffix("_comisiones_fundacion.sql")
const rb = () => readByMarker("rollback", "Rollback of comisiones_fundacion")

describe("376: hygiene", () => {
  it("starts with SET LOCAL lock_timeout and opens no transaction", () => {
    expect(collapse(mig()).startsWith("SET LOCAL lock_timeout = '3s';")).toBe(true)
    expect(stripComments(mig())).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im)
  })
})
describe("376: ventas.fecha_anulacion", () => {
  it("adds the column and a trigger on INSERT OR UPDATE OF estado", () => {
    expect(collapse(mig())).toContain("ADD COLUMN IF NOT EXISTS fecha_anulacion TIMESTAMPTZ")
    expect(collapse(mig())).toMatch(/BEFORE INSERT OR UPDATE OF estado ON ventas FOR EACH ROW EXECUTE FUNCTION set_fecha_anulacion_venta\(\)/)
  })
  it("backfills annulled sales from updated_at with ventas_updated_at disabled around it", () => {
    const s = collapse(mig())
    const off = s.indexOf("ALTER TABLE ventas DISABLE TRIGGER ventas_updated_at")
    const upd = s.indexOf("UPDATE ventas SET fecha_anulacion = updated_at WHERE estado = 'ANULADA' AND fecha_anulacion IS NULL")
    const on = s.indexOf("ALTER TABLE ventas ENABLE TRIGGER ventas_updated_at")
    expect(off).toBeGreaterThan(-1); expect(upd).toBeGreaterThan(off); expect(on).toBeGreaterThan(upd)
  })
})
describe("376: tables", () => {
  it.each(["comisiones_pagos", "comisiones_pagos_items", "comisiones_ajustes"])("%s: RLS on, service_role only", (t) => {
    const s = collapse(mig())
    expect(s).toContain(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`)
    expect(s).toContain(`REVOKE ALL ON public.${t} FROM PUBLIC, anon, authenticated`)
    expect(s).not.toMatch(new RegExp(`GRANT [A-Z, ]+ ON public\\.${t} TO authenticated`))
  })
  it("a row can carry only one non-annulled payout item", () => {
    expect(collapse(mig())).toContain("CREATE UNIQUE INDEX IF NOT EXISTS comisiones_pagos_items_fila_vigente_uq ON comisiones_pagos_items (organization_id, COALESCE(documento_tipo, '-'), COALESCE(documento_id, '-'), rol, tipo, COALESCE(ajuste_ref, '-')) WHERE NOT anulado")
  })
  it("pins the role, kind and origin vocabularies", () => {
    const s = collapse(mig())
    expect(s).toContain("CHECK (rol IN ('VENDEDOR', 'TECNICO', 'RECEPCION'))")
    expect(s).toContain("CHECK (tipo IN ('ORIGINAL', 'AJUSTE_DEVOLUCION', 'AJUSTE_ANULACION', 'AJUSTE_MANUAL'))")
    expect(s).toContain("CHECK (origen IN ('APP', 'BACKFILL'))")
    expect(s).toContain("CHECK (origen IN ('MANUAL', 'CAMBIO_TASA'))")
  })
})
describe("376: rollback", () => {
  it("warns about data loss, exports first, and drops in dependency order", () => {
    const head = rb().slice(0, rb().indexOf("DROP"))
    expect(head).toMatch(/pierde|loses/i); expect(head).toMatch(/377_rollback/)
    const s = collapse(rb())
    expect(s.indexOf("DROP TABLE IF EXISTS comisiones_pagos_items")).toBeLessThan(s.indexOf("DROP TABLE IF EXISTS comisiones_pagos;"))
    expect(s).toContain("DROP COLUMN IF EXISTS fecha_anulacion")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run __tests__/comisiones-fundacion-migration.test.ts`
Expected: FAIL with `No file in supabase/migrations/ matches suffix "_comisiones_fundacion.sql"`

- [ ] **Step 3: Write `376_comisiones_fundacion.sql` and `rollback/376_rollback.sql`**

Trigger body (the only logic in this file):

```sql
CREATE OR REPLACE FUNCTION set_fecha_anulacion_venta() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.estado = 'ANULADA' THEN NEW.fecha_anulacion := COALESCE(NEW.fecha_anulacion, now()); END IF;
    RETURN NEW;
  END IF;
  IF NEW.estado = 'ANULADA' AND OLD.estado IS DISTINCT FROM 'ANULADA' THEN
    NEW.fecha_anulacion := COALESCE(NEW.fecha_anulacion, now());
  ELSIF NEW.estado IS DISTINCT FROM 'ANULADA' THEN
    NEW.fecha_anulacion := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

Header: why (spec link), "no reader until 377", rollback/verify paths. The backfill `UPDATE` sits between `DISABLE`/`ENABLE TRIGGER ventas_updated_at` so annulled sales keep their `updated_at` (`restore_stock_on_cancel` and `ventas_proteger_anulacion` only act on an `estado` change, so they no-op). Rollback header (Spanish or English, says "loses"/"pierde" every payout and adjustment, tells to run 377_rollback first, and carries a `SELECT * FROM comisiones_pagos JOIN comisiones_pagos_items ...` to export before dropping); legacy flags stay correct because the RPCs keep them in sync.

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run __tests__/comisiones-fundacion-migration.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/376_comisiones_fundacion.sql supabase/migrations/rollback/376_rollback.sql __tests__/comisiones-fundacion-migration.test.ts
git commit -m "feat(db): add commission payout tables and sale annulment date"
```

- [ ] **Step 6: Hand to the orchestrator** — dry-run `node scripts/db-run.mjs supabase/migrations/376_comisiones_fundacion.sql`. Expected: ROLLBACK with no error; `UPDATE` row count = annulled sales without `fecha_anulacion`.

---

### Task 2: The single definition (PR 2)

**Files:**
- Create: `supabase/migrations/377_comisiones_definicion.sql`, `supabase/migrations/rollback/377_rollback.sql`
- Test: `__tests__/comisiones-definicion-migration.test.ts`

**Interfaces:**
- Consumes: Task 1 tables and `ventas.fecha_anulacion`.
- Produces: views `v_comisiones_filas` and `v_comisiones_devengadas` with exactly these columns:
  `clave TEXT, organization_id, sucursal_id, documento_tipo, documento_id, beneficiario_id, rol, tipo, ajuste_ref, base NUMERIC(12,2), porcentaje NUMERIC(5,2), monto NUMERIC(12,2), fecha_devengo TIMESTAMPTZ, devengada BOOLEAN, pago_id, fecha_pago TIMESTAMPTZ, pagado BOOLEAN, pendiente NUMERIC(12,2), documento_codigo, documento_numero INTEGER, documento_detalle, documento_estado TEXT, documento_total, documento_costo_repuestos`.
  `clave = <documento_tipo|->:<documento_id|->:<rol>:<tipo>:<ajuste_ref|->` (unique per row; ids are cuids, never contain `:`).

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
const mig = () => collapse(readBySuffix("_comisiones_definicion.sql"))
const m119 = () => collapse(readBySuffix("_comisiones_tecnicos.sql"))
const m333 = () => collapse(readBySuffix("_comision_neta_de_devoluciones.sql"))

describe("377: today's formulas, verbatim", () => {
  it("order base and amount are 119's expressions", () => {
    expect(mig()).toContain("ROUND(GREATEST(COALESCE(o.costo_final, 0) - rep.costo, 0) * COALESCE(o.porcentaje_comision, 0) / 100, 2)")
    expect(mig()).toContain("WHERE o.tecnico_id IS NOT NULL")
  })
  it("an order accrues exactly under the route filters of app/api/comisiones/route.ts:56-57", () => {
    expect(mig()).toContain("(o.estado_cobro = 'COBRADO' AND (o.estado IN ('REPARADO', 'ENTREGADO') OR (o.estado = 'ENTREGADO_SIN_REPARACION' AND org.comision_aplica_sin_reparacion))) AS devengada")
  })
  it("sale base is 333's unpaid branch, shared verbatim with 333", () => {
    const frag = "GREATEST(COALESCE(v.iva_neto, v.total) * (1 - dev.devuelto / v.total), 0)"
    expect(m333()).toContain(frag); expect(mig()).toContain(frag)
    expect(mig()).toContain("WHEN COALESCE(v.total, 0) <= 0 OR dev.devuelto = 0 THEN COALESCE(v.iva_neto, v.total)")
  })
  it("keeps today's bug: unpaid sale returns are summed without estado/anulada filters", () => {
    expect(mig()).toContain("SELECT COALESCE(SUM(d.monto_devolucion), 0) AS devuelto FROM devoluciones_venta d WHERE d.venta_id = v.id )")
  })
  it("119's repuestos sum is the parts cost", () => {
    expect(m119()).toContain("SUM(r.cantidad * r.precio_unitario)")
    expect(mig()).toContain("COALESCE(SUM(r.cantidad * r.precio_unitario), 0) AS costo")
  })
})
describe("377: adjustments and the closed-row rule", () => {
  it("a post-payment return counts only if effective and after the payout", () => {
    expect(mig()).toContain("d.estado = 'COMPLETADA' AND NOT d.anulada AND d.created_at > po.fecha_pago")
  })
  it("an annulment reverses the paid ORIGINAL plus paid return adjustments", () => {
    expect(mig()).toContain("-(po.monto + COALESCE(dp.monto, 0))")
    expect(mig()).toContain("COALESCE(v.fecha_anulacion, v.updated_at)")
  })
  it("a paid row suppresses its live twin by key, never by beneficiary", () => {
    const anti = mig().slice(mig().indexOf("WHERE NOT EXISTS ( SELECT 1 FROM pagadas x"))
    const cuerpo = anti.slice(0, anti.indexOf(")"))
    expect(cuerpo).toContain("x.documento_id IS NOT DISTINCT FROM l.documento_id")
    expect(cuerpo).toContain("x.ajuste_ref IS NOT DISTINCT FROM l.ajuste_ref")
    expect(cuerpo).not.toContain("beneficiario_id")
  })
  it("items of annulled payouts never close a row", () => {
    expect(mig()).toContain("FROM comisiones_pagos_items i JOIN comisiones_pagos p ON p.id = i.pago_id WHERE NOT i.anulado")
  })
})
describe("377: security and hygiene", () => {
  it.each(["v_comisiones_filas", "v_comisiones_devengadas"])("%s is invoker-secured and service_role only", (v) => {
    expect(mig()).toContain(`CREATE OR REPLACE VIEW ${v} WITH (security_invoker = true) AS`)
    expect(mig()).toContain(`REVOKE ALL ON public.${v} FROM PUBLIC, anon, authenticated`)
    expect(mig()).toContain(`GRANT SELECT ON public.${v} TO service_role`)
  })
  it("devengadas is filas filtered, nothing else", () => {
    expect(mig()).toContain("v_comisiones_devengadas WITH (security_invoker = true) AS SELECT * FROM v_comisiones_filas WHERE devengada;")
  })
  it("aborts before creating anything when 376 is missing", () => {
    expect(mig().indexOf("Abort: aplicar 376 antes de 377")).toBeLessThan(mig().indexOf("CREATE OR REPLACE VIEW"))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run __tests__/comisiones-definicion-migration.test.ts`
Expected: FAIL with `No file ... matches suffix "_comisiones_definicion.sql"`

- [ ] **Step 3: Write `377_comisiones_definicion.sql`** — header, `SET LOCAL lock_timeout = '3s';`, a `DO` block raising `'Abort: aplicar 376 antes de 377'` when `to_regclass('public.comisiones_pagos_items') IS NULL` or `ventas.fecha_anulacion` is missing, then exactly:

```sql
CREATE OR REPLACE VIEW v_comisiones_filas WITH (security_invoker = true) AS
WITH pagadas AS NOT MATERIALIZED (
  SELECT i.organization_id, i.documento_tipo, i.documento_id, i.rol, i.tipo, i.ajuste_ref,
         i.base, i.porcentaje, i.monto, i.fecha_devengo,
         p.id AS pago_id, p.beneficiario_id, p.fecha_pago
    FROM comisiones_pagos_items i
    JOIN comisiones_pagos p ON p.id = i.pago_id
   WHERE NOT i.anulado
),
vivas AS (
  -- ORIGINAL / ORDEN / TECNICO: 119 + the filters of app/api/comisiones/route.ts:56-57
  SELECT o.organization_id, 'ORDEN'::text AS documento_tipo, o.id AS documento_id,
         o.tecnico_id AS beneficiario_id, 'TECNICO'::text AS rol, 'ORIGINAL'::text AS tipo,
         NULL::text AS ajuste_ref,
         GREATEST(COALESCE(o.costo_final, 0) - rep.costo, 0) AS base,
         COALESCE(o.porcentaje_comision, 0) AS porcentaje,
         ROUND(GREATEST(COALESCE(o.costo_final, 0) - rep.costo, 0) * COALESCE(o.porcentaje_comision, 0) / 100, 2) AS monto,
         o.fecha_completado AS fecha_devengo,
         (o.estado_cobro = 'COBRADO'
           AND (o.estado IN ('REPARADO', 'ENTREGADO')
                OR (o.estado = 'ENTREGADO_SIN_REPARACION' AND org.comision_aplica_sin_reparacion))) AS devengada
    FROM ordenes_servicio o
    JOIN organizations org ON org.id = o.organization_id
    CROSS JOIN LATERAL (
      SELECT COALESCE(SUM(r.cantidad * r.precio_unitario), 0) AS costo
        FROM repuestos_orden r WHERE r.orden_id = o.id
    ) rep
   WHERE o.tecnico_id IS NOT NULL
  UNION ALL
  -- ORIGINAL / VENTA / VENDEDOR: 333, unpaid branch (a paid sale is closed by its item)
  SELECT v.organization_id, 'VENTA', v.id, v.vendedor_id, 'VENDEDOR', 'ORIGINAL', NULL,
         b.base, COALESCE(v.porcentaje_comision, 0),
         ROUND(b.base * COALESCE(v.porcentaje_comision, 0) / 100, 2),
         v.created_at, true
    FROM ventas v
    CROSS JOIN LATERAL (
      SELECT COALESCE(SUM(d.monto_devolucion), 0) AS devuelto
        FROM devoluciones_venta d WHERE d.venta_id = v.id
    ) dev
    CROSS JOIN LATERAL (
      SELECT CASE
               WHEN COALESCE(v.total, 0) <= 0 OR dev.devuelto = 0 THEN COALESCE(v.iva_neto, v.total)
               ELSE GREATEST(COALESCE(v.iva_neto, v.total) * (1 - dev.devuelto / v.total), 0)
             END AS base
    ) b
   WHERE v.estado = 'COMPLETADA' AND v.vendedor_id IS NOT NULL
  UNION ALL
  -- AJUSTE_DEVOLUCION: an effective return created after the sale's ORIGINAL row was paid
  SELECT v.organization_id, 'VENTA', v.id, po.beneficiario_id, 'VENDEDOR', 'AJUSTE_DEVOLUCION', d.id,
         ROUND(COALESCE(v.iva_neto, v.total) * d.monto_devolucion / v.total, 2),
         po.porcentaje,
         -ROUND(COALESCE(v.iva_neto, v.total) * d.monto_devolucion / v.total * po.porcentaje / 100, 2),
         d.created_at, true
    FROM pagadas po
    JOIN ventas v ON v.id = po.documento_id AND v.estado = 'COMPLETADA' AND v.total > 0
    JOIN devoluciones_venta d ON d.venta_id = v.id
     AND d.estado = 'COMPLETADA' AND NOT d.anulada AND d.created_at > po.fecha_pago
   WHERE po.documento_tipo = 'VENTA' AND po.rol = 'VENDEDOR' AND po.tipo = 'ORIGINAL'
  UNION ALL
  -- AJUSTE_ANULACION: an annulled sale whose ORIGINAL row was paid gives back what is still paid on it
  SELECT v.organization_id, 'VENTA', v.id, po.beneficiario_id, 'VENDEDOR', 'AJUSTE_ANULACION', NULL,
         po.base, po.porcentaje,
         -(po.monto + COALESCE(dp.monto, 0)),
         COALESCE(v.fecha_anulacion, v.updated_at), true
    FROM pagadas po
    JOIN ventas v ON v.id = po.documento_id AND v.estado = 'ANULADA'
    LEFT JOIN LATERAL (
      SELECT SUM(x.monto) AS monto FROM pagadas x
       WHERE x.documento_tipo = 'VENTA' AND x.documento_id = v.id
         AND x.rol = 'VENDEDOR' AND x.tipo = 'AJUSTE_DEVOLUCION'
    ) dp ON true
   WHERE po.documento_tipo = 'VENTA' AND po.rol = 'VENDEDOR' AND po.tipo = 'ORIGINAL'
  UNION ALL
  -- AJUSTE_MANUAL: stored adjustments (no writer in slice 1)
  SELECT a.organization_id, a.documento_tipo, a.documento_id, a.beneficiario_id, a.rol,
         'AJUSTE_MANUAL', a.id, NULL, NULL, a.monto, a.created_at, true
    FROM comisiones_ajustes a
),
filas AS (
  SELECT l.*, NULL::text AS pago_id, NULL::timestamptz AS fecha_pago, false AS pagado
    FROM vivas l
   WHERE NOT EXISTS (
     SELECT 1 FROM pagadas x
      WHERE x.documento_tipo IS NOT DISTINCT FROM l.documento_tipo
        AND x.documento_id IS NOT DISTINCT FROM l.documento_id
        AND x.rol = l.rol AND x.tipo = l.tipo
        AND x.ajuste_ref IS NOT DISTINCT FROM l.ajuste_ref)
  UNION ALL
  SELECT x.organization_id, x.documento_tipo, x.documento_id, x.beneficiario_id, x.rol, x.tipo,
         x.ajuste_ref, x.base, x.porcentaje, x.monto, x.fecha_devengo, true,
         x.pago_id, x.fecha_pago, true
    FROM pagadas x
)
SELECT
  COALESCE(f.documento_tipo, '-') || ':' || COALESCE(f.documento_id, '-') || ':' || f.rol || ':'
    || f.tipo || ':' || COALESCE(f.ajuste_ref, '-') AS clave,
  f.organization_id,
  COALESCE(o.sucursal_id, v.sucursal_id) AS sucursal_id,
  f.documento_tipo, f.documento_id, f.beneficiario_id, f.rol, f.tipo, f.ajuste_ref,
  f.base::numeric(12,2) AS base,
  f.porcentaje::numeric(5,2) AS porcentaje,
  f.monto::numeric(12,2) AS monto,
  f.fecha_devengo, f.devengada, f.pago_id, f.fecha_pago, f.pagado,
  (CASE WHEN f.pagado THEN 0 ELSE f.monto END)::numeric(12,2) AS pendiente,
  o.codigo_orden AS documento_codigo,
  COALESCE(o.numero_orden, v.numero_venta) AS documento_numero,
  COALESCE(o.dispositivo, v.cliente_nombre) AS documento_detalle,
  COALESCE(o.estado::text, v.estado::text) AS documento_estado,
  COALESCE(o.costo_final, v.total) AS documento_total,
  rep.costo::numeric(12,2) AS documento_costo_repuestos
FROM filas f
LEFT JOIN ordenes_servicio o ON f.documento_tipo = 'ORDEN' AND o.id = f.documento_id
LEFT JOIN ventas v ON f.documento_tipo = 'VENTA' AND v.id = f.documento_id
LEFT JOIN LATERAL (
  SELECT COALESCE(SUM(r.cantidad * r.precio_unitario), 0) AS costo
    FROM repuestos_orden r WHERE r.orden_id = o.id
) rep ON f.documento_tipo = 'ORDEN';

CREATE OR REPLACE VIEW v_comisiones_devengadas WITH (security_invoker = true) AS
SELECT * FROM v_comisiones_filas WHERE devengada;
```

Then the REVOKE/GRANT pairs and `COMMENT ON VIEW` for both (devengadas: "what is owed; every list, total and payment reads this"). `rollback/377_rollback.sql` (marker "Rollback of comisiones_definicion"): drop `v_comisiones_devengadas` then `v_comisiones_filas`; header: 378/379 RPCs stop working until 377 is reapplied.

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run __tests__/comisiones-definicion-migration.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/377_comisiones_definicion.sql supabase/migrations/rollback/377_rollback.sql __tests__/comisiones-definicion-migration.test.ts
git commit -m "feat(db): add the single commission definition views"
```

---

### Task 3: Oracle and drift audit (PR 2)

**Files:**
- Create: `supabase/migrations/backfill/377_auditoria_comisiones.sql`
- Test: `__tests__/comisiones-definicion-migration.test.ts` (append a describe)

**Interfaces:**
- Consumes: Task 2 views, legacy `v_comisiones_ordenes`, `v_comisiones_ventas`.
- Produces: a read-only file (marker `Audit of comisiones_definicion`), run with db-run (prints every SELECT). Sections, in order:
  - `[1]` ORDEN unpaid documents whose amount differs — **expect 0 rows**.
  - `[2]` VENTA unpaid documents whose amount differs — **expect 0 rows**.
  - `[3]` drift: flag true without a non-annulled item in the legacy role, and item without flag — expect 0 rows after Task 4.
  - `[4]` row count by `rol, tipo, devengada, pagado`.

- [ ] **Step 1: Write the failing test**

```ts
const audit = () => readByMarker("backfill", "Audit of comisiones_definicion")
describe("377 audit", () => {
  it("is read-only", () => {
    expect(stripComments(audit())).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/i)
  })
  it("compares unpaid documents with today's screen filters, both directions", () => {
    const s = collapse(audit())
    expect(s).toContain("FROM v_comisiones_ordenes c JOIN organizations org ON org.id = c.organization_id WHERE NOT c.comision_pagada AND c.estado_cobro = 'COBRADO'")
    expect(s).toContain("FROM v_comisiones_ventas c WHERE NOT c.comision_pagada")
    expect(s.match(/FULL JOIN/g)).toHaveLength(2)
    expect(s).toContain("WHERE COALESCE(h.monto, 0) <> COALESCE(n.monto, 0)")
  })
  it("lists flag/item drift in both directions", () => {
    expect(audit()).toMatch(/\[3\]/); expect(collapse(audit())).toMatch(/comision_pagada AND NOT EXISTS/); expect(collapse(audit())).toMatch(/NOT \w+\.comision_pagada AND EXISTS/)
  })
})
```

`readByMarker` takes `"rollback" | "verify"`: widen its `dir` parameter type to `"rollback" | "verify" | "backfill"` in `__tests__/helpers/sql-text.ts` (one-line change, part of this step).

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run __tests__/comisiones-definicion-migration.test.ts`
Expected: FAIL with `No file in supabase/migrations/backfill matches marker "Audit of comisiones_definicion"`

- [ ] **Step 3: Write the audit.** Section `[1]` is exactly:

```sql
WITH hoy AS (
  SELECT c.orden_id AS documento_id, c.monto_comision AS monto
    FROM v_comisiones_ordenes c
    JOIN organizations org ON org.id = c.organization_id
   WHERE NOT c.comision_pagada AND c.estado_cobro = 'COBRADO'
     AND (c.estado IN ('REPARADO', 'ENTREGADO')
          OR (c.estado = 'ENTREGADO_SIN_REPARACION' AND org.comision_aplica_sin_reparacion))
), nuevo AS (
  SELECT d.documento_id, SUM(d.monto) AS monto
    FROM v_comisiones_devengadas d
    JOIN ordenes_servicio o ON o.id = d.documento_id AND NOT o.comision_pagada
   WHERE d.documento_tipo = 'ORDEN' AND d.rol = 'TECNICO'
   GROUP BY d.documento_id
)
SELECT '[1] ORDEN' AS seccion, COALESCE(h.documento_id, n.documento_id) AS documento_id, h.monto AS hoy, n.monto AS nuevo
  FROM hoy h FULL JOIN nuevo n ON n.documento_id = h.documento_id
 WHERE COALESCE(h.monto, 0) <> COALESCE(n.monto, 0);
```

`[2]` mirrors it with `v_comisiones_ventas c WHERE NOT c.comision_pagada AND c.vendedor_id IS NOT NULL`, `c.venta_id`, `ventas` and `rol = 'VENDEDOR'`; a `[2b]` SELECT counts unpaid sales with a commission but no seller (today they show in the seller tab list without a name and are skipped by its summary; the definition emits no row for them). `[3]` per legacy role (VENDEDOR↔ventas, TECNICO↔ordenes_servicio). Header: "run any time; [1] and [2] must be empty — a row there means slice 1 changed a number".

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run __tests__/comisiones-definicion-migration.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/backfill/377_auditoria_comisiones.sql __tests__/comisiones-definicion-migration.test.ts __tests__/helpers/sql-text.ts
git commit -m "test(db): add the commission definition oracle audit"
```

- [ ] **Step 6: Hand to the orchestrator** — 377 needs 376 applied (its precondition aborts otherwise), so: apply 376, dry-run 377, apply 377, then run `node scripts/db-run.mjs supabase/migrations/backfill/377_auditoria_comisiones.sql`. Expected: `[1]` and `[2]` print 0 rows; `[3]` lists every legacy-paid document (no items yet).

---

### Task 4: Payout backfill from legacy flags (PR 3)

**Files:**
- Create: `supabase/migrations/backfill/377_backfill_comisiones_pagos.sql`
- Test: `__tests__/comisiones-backfill-pagos.test.ts`

**Interfaces:**
- Consumes: Task 1 tables, Task 2 views, legacy views.
- Produces: `origen = 'BACKFILL'` payouts (`pagado_por` NULL) with one ORIGINAL item per legacy-paid document. Re-runnable: a document that already has a non-annulled ORIGINAL item in its legacy role is skipped. No `BEGIN`: db-run dry-runs by default, `--apply` commits.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
const bf = () => readByMarker("backfill", "Backfill of comisiones_pagos from legacy flags")
describe("payout backfill", () => {
  it("opens no transaction (db-run decides dry-run vs apply)", () => {
    expect(stripComments(bf())).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im)
  })
  it("takes amounts from today's views, and annulled paid sales from 333's paid branch", () => {
    const s = collapse(bf())
    expect(s).toContain("FROM v_comisiones_ordenes c WHERE c.comision_pagada")
    expect(s).toContain("FROM v_comisiones_ventas c JOIN ventas v ON v.id = c.venta_id WHERE c.comision_pagada AND c.vendedor_id IS NOT NULL")
    expect(s).toContain("ROUND(COALESCE(v.iva_neto, v.total) * COALESCE(v.porcentaje_comision, 0) / 100, 2)")
    expect(s).toContain("WHERE v.comision_pagada AND v.estado = 'ANULADA' AND v.vendedor_id IS NOT NULL")
  })
  it("is idempotent: skips documents that already have a live ORIGINAL item", () => {
    expect(collapse(bf())).toMatch(/DELETE FROM _bf b WHERE EXISTS \( SELECT 1 FROM comisiones_pagos_items i WHERE NOT i\.anulado AND i\.documento_tipo = b\.documento_tipo AND i\.documento_id = b\.documento_id AND i\.rol = b\.rol AND i\.tipo = 'ORIGINAL' \)/)
  })
  it("groups by beneficiary, org-timezone day and notes; NULL date = migration date", () => {
    const s = collapse(bf())
    expect(s).toContain("COALESCE(c.fecha_pago_comision, now())")
    expect(s).toContain("AT TIME ZONE org.zona_horaria)::date")
    expect(s).toContain("MAX(b.pagado_at) AS fecha_pago")
    expect(s).toContain("p.notas IS NOT DISTINCT FROM b.notas")
  })
  it("ends with the checks the spec asks for", () => {
    for (const s of ["[2] por beneficiario", "[3] filas post-pago", "[4] pagadas fuera de los filtros de hoy", "[5] pagadas sin beneficiario"]) expect(bf()).toContain(s)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run __tests__/comisiones-backfill-pagos.test.ts`
Expected: FAIL with `No file in supabase/migrations/backfill matches marker ...`

- [ ] **Step 3: Write the backfill.** After `SET LOCAL lock_timeout = '3s';` and a `DO` block aborting when 377 is missing or when an org with legacy-paid documents has a `zona_horaria` absent from `pg_timezone_names`:

```sql
CREATE TEMP TABLE _bf ON COMMIT DROP AS
SELECT c.organization_id, c.tecnico_id AS beneficiario_id, 'ORDEN'::text AS documento_tipo,
       c.orden_id AS documento_id, 'TECNICO'::text AS rol, c.ganancia AS base,
       c.porcentaje_comision AS porcentaje, COALESCE(c.monto_comision, 0) AS monto,
       c.fecha_completado AS fecha_devengo, COALESCE(c.fecha_pago_comision, now()) AS pagado_at,
       NULLIF(btrim(c.comision_pago_notas), '') AS notas
  FROM v_comisiones_ordenes c
 WHERE c.comision_pagada
UNION ALL
SELECT c.organization_id, c.vendedor_id, 'VENTA', c.venta_id, 'VENDEDOR',
       COALESCE(v.iva_neto, v.total), c.porcentaje_comision, COALESCE(c.monto_comision, 0),
       c.created_at, COALESCE(c.fecha_pago_comision, now()), NULLIF(btrim(c.comision_pago_notas), '')
  FROM v_comisiones_ventas c JOIN ventas v ON v.id = c.venta_id
 WHERE c.comision_pagada AND c.vendedor_id IS NOT NULL
UNION ALL
-- Paid sales annulled later: 333 hides them; same expression as its paid branch.
SELECT v.organization_id, v.vendedor_id, 'VENTA', v.id, 'VENDEDOR',
       COALESCE(v.iva_neto, v.total, 0), COALESCE(v.porcentaje_comision, 0),
       COALESCE(ROUND(COALESCE(v.iva_neto, v.total) * COALESCE(v.porcentaje_comision, 0) / 100, 2), 0),
       v.created_at, COALESCE(v.fecha_pago_comision, now()), NULLIF(btrim(v.comision_pago_notas), '')
  FROM ventas v
 WHERE v.comision_pagada AND v.estado = 'ANULADA' AND v.vendedor_id IS NOT NULL;

DELETE FROM _bf b WHERE EXISTS (
  SELECT 1 FROM comisiones_pagos_items i
   WHERE NOT i.anulado AND i.documento_tipo = b.documento_tipo AND i.documento_id = b.documento_id
     AND i.rol = b.rol AND i.tipo = 'ORIGINAL' );

ALTER TABLE _bf ADD COLUMN dia DATE;
UPDATE _bf b SET dia = (b.pagado_at AT TIME ZONE org.zona_horaria)::date
  FROM organizations org WHERE org.id = b.organization_id;

CREATE TEMP TABLE _bf_pagos ON COMMIT DROP AS
SELECT generate_cuid() AS pago_id, g.*
  FROM (SELECT b.organization_id, b.beneficiario_id, b.dia, b.notas,
               MAX(b.pagado_at) AS fecha_pago, SUM(b.monto) AS total
          FROM _bf b GROUP BY b.organization_id, b.beneficiario_id, b.dia, b.notas) g;

INSERT INTO comisiones_pagos (id, organization_id, beneficiario_id, fecha_pago, pagado_por, notas, total, origen)
SELECT pago_id, organization_id, beneficiario_id, fecha_pago, NULL, notas, total, 'BACKFILL' FROM _bf_pagos;

INSERT INTO comisiones_pagos_items (pago_id, organization_id, documento_tipo, documento_id, rol, tipo,
                                    ajuste_ref, base, porcentaje, monto, fecha_devengo)
SELECT p.pago_id, b.organization_id, b.documento_tipo, b.documento_id, b.rol, 'ORIGINAL',
       NULL, b.base, b.porcentaje, b.monto, b.fecha_devengo
  FROM _bf b
  JOIN _bf_pagos p ON p.organization_id = b.organization_id AND p.beneficiario_id = b.beneficiario_id
                  AND p.dia = b.dia AND p.notas IS NOT DISTINCT FROM b.notas;
```

Note: in the test the day expression is asserted as `AT TIME ZONE org.zona_horaria)::date` — matches the `UPDATE` above. Closing SELECTs (each labelled in a `seccion` column): `[1]` payouts and items inserted by this run; `[2] por beneficiario` — per (org, beneficiario, rol) Σ items of non-annulled ORIGINAL items vs today's paid screen total (TECNICO: Σ `v_comisiones_ordenes.monto_comision` paid **and** inside the route filters; VENDEDOR: Σ `v_comisiones_ventas.monto_comision` paid) with `diferencia`; `[3] filas post-pago` — `v_comisiones_devengadas` rows with `tipo IN ('AJUSTE_DEVOLUCION','AJUSTE_ANULACION')`; `[4] pagadas fuera de los filtros de hoy` — BACKFILL TECNICO items whose order fails the route filters, and VENDEDOR items of annulled sales (these explain every non-zero `diferencia` in `[2]`); `[5] pagadas sin beneficiario` — legacy-paid orders with `tecnico_id` NULL and sales with `vendedor_id` NULL (not migrated). Header explains the MAX(`fecha_pago_comision`) choice and the re-run after the app deploy.

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run __tests__/comisiones-backfill-pagos.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/backfill/377_backfill_comisiones_pagos.sql __tests__/comisiones-backfill-pagos.test.ts
git commit -m "feat(db): backfill legacy paid commissions into frozen payouts"
```

- [ ] **Step 6: Hand to the orchestrator** — dry-run the backfill; expected: `[2]` differences fully explained by `[4]`; `[3]` lists the post-payment return and annulment rows for the user to read; `[5]` reviewed. Apply only after the user reads `[3]` and `[4]`.

---

### Task 5: Flag sync and atomic pay RPC (PR 4)

**Files:**
- Create: `supabase/migrations/378_comisiones_pagar_rpc.sql`, `supabase/migrations/rollback/378_rollback.sql`, `supabase/migrations/verify/378_probes.sql`
- Test: `__tests__/comisiones-pagar-rpc-migration.test.ts`

**Interfaces:**
- Consumes: Task 1 tables, Task 2 `v_comisiones_devengadas`.
- Produces:
  - `comisiones_sincronizar_flags(p_organization_id TEXT, p_documento_tipo TEXT, p_documento_ids TEXT[]) RETURNS void` — legacy role is VENDEDOR for `'VENTA'` (table `ventas`), TECNICO for `'ORDEN'` (table `ordenes_servicio`). Per document: `comision_pagada` = a non-annulled item exists in the legacy role (any kind); `fecha_pago_comision`/`comision_pago_notas` = the payout of the non-annulled ORIGINAL item in that role, else the latest non-annulled item's payout, else NULL. Updates only rows whose values change; always `AND organization_id = p_organization_id`.
  - `pagar_comisiones(p_organization_id TEXT, p_usuario_id TEXT, p_beneficiario_id TEXT, p_filas JSONB, p_notas TEXT DEFAULT NULL) RETURNS JSONB` → `{"pagoId": text, "total": numeric, "filas": int}`. `p_filas = [{"clave": text, "monto": number}]`.
  - Error codes (message prefix `COMISION_ERROR:`): `NO_AUTORIZADO`, `BENEFICIARIO_NO_ENCONTRADO`, `SIN_FILAS`, `FILA_DUPLICADA`, `FILA_NO_DISPONIBLE:<clave>`, `FILA_YA_PAGADA:<clave>`, `OTRO_BENEFICIARIO:<clave>`, `MONTO_DISTINTO:<clave>`. A concurrent duplicate surfaces as SQLSTATE `23505` from the partial unique index.
  - Advisory lock key, shared with Task 6: `pg_advisory_xact_lock(hashtext('comisiones:' || p_organization_id))`.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
const mig = () => collapse(readBySuffix("_comisiones_pagar_rpc.sql"))
const probes = () => readByMarker("verify", "Verification of comisiones_pagar_rpc")
const cuerpo = () => mig().slice(mig().indexOf("CREATE OR REPLACE FUNCTION pagar_comisiones("))
describe("378: pagar_comisiones", () => {
  it("checks ADMIN of the org before anything else", () => {
    expect(cuerpo()).toMatch(/rol = 'ADMIN'.*COMISION_ERROR:NO_AUTORIZADO/)
    expect(cuerpo().indexOf("COMISION_ERROR:NO_AUTORIZADO")).toBeLessThan(cuerpo().indexOf("pg_advisory_xact_lock"))
  })
  it("serializes per org and compares every row against the definition, not a total", () => {
    expect(cuerpo()).toContain("pg_advisory_xact_lock(hashtext('comisiones:' || p_organization_id))")
    expect(cuerpo()).toContain("FROM v_comisiones_devengadas")
    for (const c of ["FILA_NO_DISPONIBLE", "FILA_YA_PAGADA", "OTRO_BENEFICIARIO", "MONTO_DISTINTO"]) expect(cuerpo()).toContain(`COMISION_ERROR:${c}`)
    expect(cuerpo().indexOf("MONTO_DISTINTO")).toBeLessThan(cuerpo().indexOf("INSERT INTO comisiones_pagos"))
  })
  it("syncs both legacy flags after inserting the items", () => {
    expect(cuerpo()).toContain("comisiones_sincronizar_flags(p_organization_id, 'VENTA'")
    expect(cuerpo()).toContain("comisiones_sincronizar_flags(p_organization_id, 'ORDEN'")
  })
  it.each(["pagar_comisiones(TEXT, TEXT, TEXT, JSONB, TEXT)", "comisiones_sincronizar_flags(TEXT, TEXT, TEXT[])"])("%s is service_role only", (f) => {
    expect(mig()).toContain(`REVOKE EXECUTE ON FUNCTION ${f} FROM PUBLIC, anon, authenticated`)
    expect(mig()).toContain(`GRANT EXECUTE ON FUNCTION ${f} TO service_role`)
    expect(mig()).not.toMatch(/SECURITY DEFINER/)
  })
})
describe("378: probes", () => {
  it("roll back, never commit, and cover the review-focus cases", () => {
    const s = stripComments(probes())
    expect(s).toMatch(/^\s*BEGIN\s*;/m); expect(s.trimEnd().endsWith("ROLLBACK;")).toBe(true); expect(s).not.toMatch(/\bCOMMIT\b/i)
    for (const c of ["NO_AUTORIZADO", "MONTO_DISTINTO", "OTRO_BENEFICIARIO", "FILA_YA_PAGADA", "FILA_NO_DISPONIBLE"]) expect(probes()).toContain(c)
    expect(probes()).toMatch(/reasign/i); expect(probes()).toMatch(/costo_final/)
    expect(probes()).toContain("has_function_privilege")
    expect(s).toMatch(/COUNT\(DISTINCT orden\)/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run __tests__/comisiones-pagar-rpc-migration.test.ts`
Expected: FAIL with `No file ... matches suffix "_comisiones_pagar_rpc.sql"`

- [ ] **Step 3: Write 378, its rollback and probes.** `pagar_comisiones`, in this order: (1) `users` row `id = p_usuario_id AND organization_id = p_organization_id AND rol = 'ADMIN' AND deleted_at IS NULL` else `NO_AUTORIZADO`; (2) beneficiary row in the org (any `deleted_at`) else `BENEFICIARIO_NO_ENCONTRADO`; (3) `p_filas` a non-empty array (`SIN_FILAS`), distinct `clave` (`FILA_DUPLICADA`); (4) advisory lock; (5) one set-based read of `v_comisiones_devengadas` filtered by `organization_id` and by `documento_id = ANY(split_part(clave, ':', 2))` / `ajuste_ref = ANY(split_part(clave, ':', 5))` (keeps the filters pushable into every branch), matched on `clave`; raise the first problem in request order: missing → `FILA_NO_DISPONIBLE`, `pagado` → `FILA_YA_PAGADA`, `beneficiario_id IS DISTINCT FROM p_beneficiario_id` → `OTRO_BENEFICIARIO`, `monto <> ROUND((fila->>'monto')::numeric, 2)` → `MONTO_DISTINTO`; (6) insert the payout (`fecha_pago = now()`, `pagado_por = p_usuario_id`, `notas = NULLIF(btrim(p_notas), '')`, `total = Σ monto`, any sign allowed) and one item per row copying `documento_tipo, documento_id, rol, tipo, ajuste_ref, base, porcentaje, monto, fecha_devengo` from the definition; (7) sync flags for the VENTA ids with VENDEDOR items and the ORDEN ids with TECNICO items of this payout; (8) return. Probes (marker `Verification of comisiones_pagar_rpc`, README pattern, each probe skips itself and says so when the base has no fitting row): non-admin; empty; duplicate; wrong amount (and no payout written); other beneficiary; a non-accrued order key → `FILA_NO_DISPONIBLE`; success (item = row, row now `pagado`, flag true, `fecha_pago_comision` = payout `fecha_pago`); same row again → `FILA_YA_PAGADA`; reassign `tecnico_id` of the paid order → row keeps the old beneficiary and amount, no row for the new one; change `costo_final` → paid amount unchanged; privileges (`has_function_privilege` anon false, service_role true; `prosecdef` false). Rollback (marker `Rollback of comisiones_pagar_rpc`): drop both functions; header: legacy flags stay as last synced.

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run __tests__/comisiones-pagar-rpc-migration.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/378_comisiones_pagar_rpc.sql supabase/migrations/rollback/378_rollback.sql supabase/migrations/verify/378_probes.sql __tests__/comisiones-pagar-rpc-migration.test.ts
git commit -m "feat(db): add atomic commission pay RPC with per-row checks"
```

- [ ] **Step 6: Hand to the orchestrator** — dry-run 378; after apply, run `verify/378_probes.sql` in the SQL editor. Expected: every `obtenido` equals `esperado` or starts with `OK:`.

---

### Task 6: Audited payout annulment RPC (PR 5)

**Files:**
- Create: `supabase/migrations/379_comisiones_anular_pago_rpc.sql`, `supabase/migrations/rollback/379_rollback.sql`, `supabase/migrations/verify/379_probes.sql`
- Test: `__tests__/comisiones-anular-pago-migration.test.ts`

**Interfaces:**
- Consumes: Task 5 `comisiones_sincronizar_flags`, the advisory lock key.
- Produces: `anular_pago_comisiones(p_organization_id TEXT, p_usuario_id TEXT, p_pago_id TEXT, p_motivo TEXT) RETURNS JSONB` → `{"pagoId": text, "filas": int}`. Codes: `NO_AUTORIZADO`, `MOTIVO_REQUERIDO`, `PAGO_NO_ENCONTRADO`, `PAGO_YA_ANULADO`, `AJUSTES_PAGADOS:<pago_id>`. Writes one `audit_logs` row: `action 'UPDATE'`, `entity 'comisiones_pagos'`, `entity_id p_pago_id`, `changes {"before":{"anulado":false},"after":{"anulado":true,"motivo_anulacion":…,"beneficiario_id":…,"total":…}}`, `description 'Anuló un pago de comisiones: ' || motivo`.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
const mig = () => collapse(readBySuffix("_comisiones_anular_pago_rpc.sql"))
const probes = () => readByMarker("verify", "Verification of comisiones_anular_pago_rpc")
describe("379: anular_pago_comisiones", () => {
  it("requires ADMIN and a non-blank reason", () => {
    expect(mig()).toContain("COMISION_ERROR:NO_AUTORIZADO")
    expect(mig()).toMatch(/btrim\(COALESCE\(p_motivo, ''\)\) = ''.*COMISION_ERROR:MOTIVO_REQUERIDO/)
  })
  it("refuses while a later payout holds adjustments of its ORIGINAL rows", () => {
    expect(mig()).toMatch(/tipo IN \('AJUSTE_DEVOLUCION', 'AJUSTE_ANULACION'\).*COMISION_ERROR:AJUSTES_PAGADOS/)
    expect(mig().indexOf("AJUSTES_PAGADOS")).toBeLessThan(mig().indexOf("SET anulado = true"))
  })
  it("soft-annuls payout and items, resyncs flags, audits in the same transaction", () => {
    const s = mig()
    expect(s).toMatch(/UPDATE comisiones_pagos SET anulado = true, anulado_por = p_usuario_id, anulado_at = now\(\), motivo_anulacion = btrim\(p_motivo\)/)
    expect(s).toMatch(/UPDATE comisiones_pagos_items SET anulado = true WHERE pago_id = p_pago_id/)
    expect(s).toContain("comisiones_sincronizar_flags(")
    expect(s).toMatch(/INSERT INTO audit_logs \(organization_id, user_id, action, entity, entity_id, changes, description\)/)
    expect(s).not.toMatch(/DELETE FROM comisiones_pagos/)
  })
})
describe("379: probes", () => {
  it("cover annul, re-annul, reason, the adjustment guard via a sale annulled after payment", () => {
    for (const c of ["MOTIVO_REQUERIDO", "PAGO_YA_ANULADO", "AJUSTES_PAGADOS", "AJUSTE_ANULACION", "fecha_anulacion", "audit_logs"]) expect(probes()).toContain(c)
    expect(stripComments(probes()).trimEnd().endsWith("ROLLBACK;")).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run __tests__/comisiones-anular-pago-migration.test.ts`
Expected: FAIL with `No file ... matches suffix "_comisiones_anular_pago_rpc.sql"`

- [ ] **Step 3: Write 379, rollback and probes.** Order: admin check → reason → advisory lock → payout `FOR UPDATE` by id and org (`PAGO_NO_ENCONTRADO`, `PAGO_YA_ANULADO`) → guard: a non-annulled item in another payout with `tipo IN ('AJUSTE_DEVOLUCION', 'AJUSTE_ANULACION')` on the same `(documento_tipo, documento_id, rol)` as an ORIGINAL item of this payout → `AJUSTES_PAGADOS:<that pago_id>` → the two UPDATEs → sync flags for affected VENTA and ORDEN ids → audit row → return. Probes: blank reason; success (row pending again, flag false, `audit_logs` row present); annul again; then on a sale with no invoice: pay its ORIGINAL (P1), `UPDATE ventas SET estado = 'ANULADA'` (checks `fecha_anulacion` set by trigger and an `AJUSTE_ANULACION` row of `-P1.monto`), pay that row (P2), annul P1 → `AJUSTES_PAGADOS`, annul P2 then P1 → both OK.

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run __tests__/comisiones-anular-pago-migration.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/379_comisiones_anular_pago_rpc.sql supabase/migrations/rollback/379_rollback.sql supabase/migrations/verify/379_probes.sql __tests__/comisiones-anular-pago-migration.test.ts
git commit -m "feat(db): add audited soft annulment of commission payouts"
```

- [ ] **Step 6: Hand to the orchestrator** — dry-run 379; after apply, run `verify/379_probes.sql`.

---

### Task 7: Commission rows reader (PR 6)

**Files:**
- Create: `lib/commissions/types.ts`, `lib/commissions/rows.ts`
- Test: `__tests__/lib/commissions-rows.test.ts`

**Interfaces:**
- Consumes: views from Task 2; `traerTodas` from `@/lib/supabase-paginar`; `round2` from `@/lib/precios`.
- Produces (`types.ts`, client-safe):

```ts
export type CommissionDocType = "VENTA" | "ORDEN"
export type CommissionRole = "VENDEDOR" | "TECNICO" | "RECEPCION"
export type CommissionKind = "ORIGINAL" | "AJUSTE_DEVOLUCION" | "AJUSTE_ANULACION" | "AJUSTE_MANUAL"
export interface CommissionRow {
  clave: string; sucursalId: string | null; documentoTipo: CommissionDocType | null; documentoId: string | null
  beneficiarioId: string; rol: CommissionRole; tipo: CommissionKind; ajusteRef: string | null
  base: number | null; porcentaje: number | null; monto: number; fechaDevengo: string | null; devengada: boolean
  pagoId: string | null; fechaPago: string | null; pagado: boolean; pendiente: number
  documentoCodigo: string | null; documentoNumero: number | null; documentoDetalle: string | null
  documentoEstado: string | null; documentoTotal: number | null; documentoCostoRepuestos: number | null
}
export interface PayRowInput { clave: string; monto: number }
export const COMMISSION_KIND_LABEL: Record<CommissionKind, string | null> =
  { ORIGINAL: null, AJUSTE_DEVOLUCION: "Devolución", AJUSTE_ANULACION: "Venta anulada", AJUSTE_MANUAL: "Ajuste" }
```

- Produces (`rows.ts`, server-only):
  - `readCommissionRows(q: { organizationId: string; roles: CommissionRole[]; beneficiarioId?: string | null; desde?: string | null; hasta?: string | null; estado?: "pendiente" | "pagada" | "all" }): Promise<CommissionRow[]>` — `v_comisiones_devengadas`, `.eq("organization_id")`, `.in("rol", roles)`, `.or("monto.neq.0,pagado.eq.true")` (spec "Rows not shown"), optional `beneficiario_id`, `fecha_devengo` `gte`/`lte`, `pagado` for pendiente/pagada; order `fecha_devengo` desc (nulls last) then `clave`; all pages via `traerTodas`; throws `Error` on a query error.
  - `readDocumentCommissionRows(organizationId: string, documentoTipo: CommissionDocType, documentoId: string): Promise<CommissionRow[]>` — `v_comisiones_filas`, no zero filter (the card shows 0% rows and projections).
  - `summarizeByBeneficiary(rows: CommissionRow[]): CommissionSummary[]` with `CommissionSummary = { beneficiarioId: string; originales: number; base: number; documentoTotal: number; monto: number; pendiente: number }` — `originales`, `base`, `documentoTotal` count/sum ORIGINAL rows only; `monto`, `pendiente` sum every row; each total through `round2`.

- [ ] **Step 1: Write the failing test**

```ts
import { montarSupabaseEnMemoria } from "../helpers/supabase-memoria"
const fila = (o: Partial<Record<string, unknown>>) => ({ clave: "ORDEN:o1:TECNICO:ORIGINAL:-", organization_id: "org-1", sucursal_id: null, documento_tipo: "ORDEN", documento_id: "o1", beneficiario_id: "t1", rol: "TECNICO", tipo: "ORIGINAL", ajuste_ref: null, base: "1000.00", porcentaje: "10.00", monto: "100.00", fecha_devengo: "2026-10-01T10:00:00Z", devengada: true, pago_id: null, fecha_pago: null, pagado: false, pendiente: "100.00", documento_codigo: "CEL-1", documento_numero: 1, documento_detalle: "iPhone", documento_estado: "ENTREGADO", documento_total: "1200.00", documento_costo_repuestos: "200.00", ...o })

it("reads only the caller's org and roles, and hides unpaid zero rows", async () => {
  montarSupabaseEnMemoria({ v_comisiones_devengadas: [fila({}), fila({ clave: "x2", organization_id: "org-2" }), fila({ clave: "x3", monto: "0.00", pendiente: "0.00" }), fila({ clave: "x4", monto: "0.00", pendiente: "0.00", pagado: true, pago_id: "p1" }), fila({ clave: "x5", rol: "VENDEDOR" })] })
  const rows = await readCommissionRows({ organizationId: "org-1", roles: ["TECNICO"] })
  expect(rows.map((r) => r.clave).sort()).toEqual(["ORDEN:o1:TECNICO:ORIGINAL:-", "x4"])
  expect(rows[0]).toMatchObject({ monto: 100, base: 1000, porcentaje: 10, pagado: false })
})
it("reads past the 1000-row PostgREST cap", async () => {
  const pagina = (n: number) => Array.from({ length: n }, (_, i) => fila({ clave: `k${n}-${i}` }))
  const range = vi.fn((a: number) => Promise.resolve({ data: a === 0 ? pagina(1000) : pagina(3), error: null }))
  const chain: any = new Proxy({}, { get: (_t, p) => (p === "range" ? range : () => chain) })
  vi.mocked(supabaseAdmin.from).mockReturnValue(chain)
  const rows = await readCommissionRows({ organizationId: "org-1", roles: ["TECNICO"] })
  expect(rows).toHaveLength(1003)
  expect(range).toHaveBeenNthCalledWith(2, 1000, 1999)
  expect(summarizeByBeneficiary(rows)[0].monto).toBe(100300)
})
it("throws instead of returning an empty list on a query error", async () => {
  montarSupabaseEnMemoria({ v_comisiones_devengadas: [fila({})] }, { errorDeLectura: { v_comisiones_devengadas: { message: "boom" } } })
  await expect(readCommissionRows({ organizationId: "org-1", roles: ["TECNICO"] })).rejects.toThrow()
})
it("summaries count ORIGINAL rows but net every row", () => {
  const rows = [toRow(fila({})), toRow(fila({ clave: "a", tipo: "AJUSTE_DEVOLUCION", monto: "-30.10", pendiente: "-30.10", base: "301.00" }))]
  expect(summarizeByBeneficiary(rows)).toEqual([{ beneficiarioId: "t1", originales: 1, base: 1000, documentoTotal: 1200, monto: 69.9, pendiente: 69.9 }])
})
it("document rows come from v_comisiones_filas and keep zero and non-accrued rows", async () => {
  montarSupabaseEnMemoria({ v_comisiones_filas: [fila({ monto: "0.00", pendiente: "0.00", devengada: false }), fila({ clave: "o2", documento_id: "o2" })] })
  expect(await readDocumentCommissionRows("org-1", "ORDEN", "o1")).toHaveLength(1)
})
```

(`toRow` is the exported snake→camel mapper `toCommissionRow(raw): CommissionRow` from `rows.ts`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run __tests__/lib/commissions-rows.test.ts`
Expected: FAIL with `Failed to resolve import "@/lib/commissions/rows"`

- [ ] **Step 3: Implement `types.ts` and `rows.ts`** with the signatures above; `toCommissionRow` turns numeric strings into `Number` (NULL stays `null` for `base`, `porcentaje`, `documento*`).

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run __tests__/lib/commissions-rows.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/commissions/types.ts lib/commissions/rows.ts __tests__/lib/commissions-rows.test.ts
git commit -m "feat(comisiones): add paged reader over the commission definition"
```

---

### Task 8: Technician tab and "Mis comisiones" read the definition (PR 7)

**Files:**
- Modify: `app/api/comisiones/route.ts` (whole GET)
- Modify: `__tests__/api/comision-sin-reparacion.test.ts` (Suite 1 only, lines 86-158)
- Test: `__tests__/api/comisiones-lectura.test.ts`

**Interfaces:**
- Consumes: `readCommissionRows`, `summarizeByBeneficiary`.
- Produces: GET response `{ items: TecnicoCommissionItem[], resumen: [...] }`, existing fields kept and new ones added:
  `{ clave, ordenId: documentoId, tecnicoId: beneficiarioId, tecnicoNombre, rol, tipo, pagoId, pendiente, codigoOrden: documentoCodigo, numeroOrden: documentoNumero, dispositivo: documentoDetalle, estado: documentoEstado, fechaCompletado: fechaDevengo, costoFinal: documentoTotal ?? 0, costoRepuestos: documentoCostoRepuestos ?? 0, ganancia: base ?? 0, porcentajeComision: porcentaje ?? 0, montoComision: monto, comisionPagada: pagado, fechaPagoComision: fechaPago }`;
  `resumen`: `{ tecnicoId, tecnicoNombre, totalOrdenes: originales, totalGanancia: base, totalComision: monto, totalPendiente: pendiente }`.
  Roles `["TECNICO"]`; non-ADMIN keeps today's guard (403 for another `tecnicoId`, else forced to self). No `organizations` read any more: the definition applies flag 257.

- [ ] **Step 1: Write the failing test**

```ts
it("TECNICO gets only own rows; another id is 403", async () => { /* mockAuthSuccess({ role: "TECNICO", userId: "t1" }); ?tecnicoId=t2 → 403; no param → rows of t1 only (in-memory v_comisiones_devengadas with t1 and t2 rows) */ })
it("maps a paid row from its payout and sums resumen from every row", async () => {
  // ADMIN; rows: t1 ORIGINAL unpaid 100, t1 ORIGINAL paid 50 (pago_id "p1", fecha_pago set)
  expect(body.items.find((i: any) => i.pagoId === "p1")).toMatchObject({ comisionPagada: true, montoComision: 50, pendiente: 0 })
  expect(body.resumen[0]).toMatchObject({ tecnicoId: "t1", tecnicoNombre: "Ana", totalOrdenes: 2, totalComision: 150, totalPendiente: 100 })
})
it("forwards period and soloPendientes to the definition", async () => {
  // rows with fecha_devengo inside and outside 2026-10-01..2026-10-07T23:59:59, one paid → only the unpaid one inside the range comes back
})
it("looks up names inside the org only", async () => { expect(mem.consultas("users")).toContainEqual(expect.objectContaining({ /* eq organization_id org-1 */ })) })
it("500 when the definition read fails", async () => { /* errorDeLectura on v_comisiones_devengadas → 500 */ })
```

In `comision-sin-reparacion.test.ts`, replace Suite 1 with one test: `"/api/comisiones applies no estado filter of its own: the definition owns flag 257"` — asserts the route never reads `organizations` nor `v_comisiones_ordenes`, and reads `v_comisiones_devengadas`. Suites 2 and 3 stay untouched (reports are slice 4).

- [ ] **Step 2: Run tests to verify they fail**

Run: `./node_modules/.bin/vitest run __tests__/api/comisiones-lectura.test.ts`
Run: `./node_modules/.bin/vitest run __tests__/api/comision-sin-reparacion.test.ts`
Expected: FAIL (route still reads `v_comisiones_ordenes`)

- [ ] **Step 3: Rewrite the GET** over `readCommissionRows({ organizationId, roles: ["TECNICO"], beneficiarioId: tecnicoId, desde, hasta, estado: soloPendientes ? "pendiente" : "all" })`; names via `users` `.in("id", ids).eq("organization_id", organizationId)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: both commands of Step 2. Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/comisiones/route.ts __tests__/api/comisiones-lectura.test.ts __tests__/api/comision-sin-reparacion.test.ts
git commit -m "refactor(comisiones): technician commissions read the single definition"
```

---

### Task 9: Seller reads use the definition (PR 8)

**Files:**
- Modify: `app/api/comisiones/vendedores/route.ts` (GET), `app/api/vendedores/[id]/route.ts:48-94`, `app/api/vendedores/[id]/comisiones/route.ts` (GET)
- Test: `__tests__/api/comisiones-vendedores-lectura.test.ts`

**Interfaces:**
- Consumes: Task 7 reader.
- Produces:
  - `/api/comisiones/vendedores` item: `{ clave, ventaId: documentoId, vendedorId, vendedorNombre, tipo, pagoId, pendiente, numeroVenta: documentoNumero, clienteNombre: documentoDetalle, fecha: fechaDevengo, total: documentoTotal ?? 0, porcentajeComision, montoComision, comisionPagada, fechaPagoComision }`; `resumen`: `{ vendedorId, vendedorNombre, totalVentas: originales, totalFacturado: documentoTotal, totalComision: monto, totalPendiente: pendiente }`.
  - `/api/vendedores/[id]` keeps `comisionDevengada` (Σ monto), `comisionPagada` (Σ monto of paid rows), `comisionPendiente` (Σ pendiente), all rows of that seller, role VENDEDOR.
  - `/api/vendedores/[id]/comisiones` item: `{ clave, ventaId, tipo, pagoId, numeroVenta, clienteNombre, fecha, total, porcentajeComision, montoComision, pagada, fechaPago }` (`notas` dropped: no consumer); `totales { devengada, pagada, pendiente }`; `estado` param maps to the reader's `estado`.

- [ ] **Step 1: Write the failing test**

```ts
it("seller tab: a post-payment return row appears negative and nets the pending total", async () => {
  // rows: VENTA v1 ORIGINAL paid 100 (p1); VENTA v1 AJUSTE_DEVOLUCION unpaid -30 (ajuste_ref d1)
  expect(body.items.map((i: any) => [i.tipo, i.montoComision, i.comisionPagada])).toEqual([["AJUSTE_DEVOLUCION", -30, false], ["ORIGINAL", 100, true]])
  expect(body.resumen[0]).toMatchObject({ totalVentas: 1, totalComision: 70, totalPendiente: -30 })
})
it("vendedor detail: devengada - pagada === pendiente over every row", async () => { /* expect(body.comisionDevengada - body.comisionPagada).toBe(body.comisionPendiente) */ })
it("liquidation list: estado=pendiente returns only unpaid rows of that seller in that org", async () => { /* rows of v2, other org, paid → excluded */ })
it("none of the three routes reads v_comisiones_ventas", async () => { expect(mem.lecturas).not.toContain("v_comisiones_ventas") })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run __tests__/api/comisiones-vendedores-lectura.test.ts`
Expected: FAIL

- [ ] **Step 3: Rewrite the three reads** with the reader (roles `["VENDEDOR"]`, `beneficiarioId` = filter or URL id). Name lookups filter `organization_id`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `./node_modules/.bin/vitest run __tests__/api/comisiones-vendedores-lectura.test.ts`
Run: `./node_modules/.bin/vitest run __tests__/api/comisiones-suscripciones-acceso.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/comisiones/vendedores/route.ts app/api/vendedores/[id]/route.ts app/api/vendedores/[id]/comisiones/route.ts __tests__/api/comisiones-vendedores-lectura.test.ts
git commit -m "refactor(comisiones): seller commissions read the single definition"
```

---

### Task 10: Payout handlers and RPC error mapping (PR 9)

**Files:**
- Create: `lib/commissions/payouts.ts`
- Test: `__tests__/lib/commissions-payouts.test.ts`

**Interfaces:**
- Consumes: RPCs from Tasks 5–6.
- Produces:

```ts
export const payBodySchema: z.ZodType<{ beneficiarioId: string; filas: PayRowInput[]; notas?: string }>
// beneficiarioId min(1); filas min(1) of { clave: string.min(1), monto: number.finite() }; notas trim max(500) optional
export const liquidarBodySchema // payBodySchema without beneficiarioId
export const annulBodySchema   // { pagoId: string.min(1), motivo: string.trim().min(1, "Indicá el motivo de la anulación.").max(500) }
export function commissionRpcError(error: { code?: string; message?: string } | null): { status: number; error: string } | null
export async function payCommissions(a: { organizationId: string; userId: string; beneficiarioId: string; filas: PayRowInput[]; notas?: string }): Promise<NextResponse>
// 200 { pagoId, total, filas }
export async function annulCommissionPayout(a: { organizationId: string; userId: string; pagoId: string; motivo: string }): Promise<NextResponse>
// 200 { pagoId, filas }
```

  Mapping (exact copy):

| Code | Status | `error` |
|---|---|---|
| `NO_AUTORIZADO` | 403 | Solo un administrador puede pagar o anular comisiones. |
| `BENEFICIARIO_NO_ENCONTRADO`, `PAGO_NO_ENCONTRADO` | 404 | La persona no existe en este taller. / Pago no encontrado. |
| `SIN_FILAS` | 400 | Elegí al menos una comisión. |
| `FILA_DUPLICADA` | 400 | Hay comisiones repetidas en el pedido. |
| `MOTIVO_REQUERIDO` | 400 | Indicá el motivo de la anulación. |
| `FILA_NO_DISPONIBLE`, `FILA_YA_PAGADA`, `OTRO_BENEFICIARIO`, `MONTO_DISTINTO`, SQLSTATE `23505` | 409 | Las comisiones cambiaron desde que abriste la pantalla. Actualizá y revisá los montos antes de pagar. |
| `PAGO_YA_ANULADO` | 409 | Ese pago ya estaba anulado. |
| `AJUSTES_PAGADOS` | 409 | Un pago posterior ya liquidó ajustes de estas comisiones (devoluciones o anulaciones). Anulá ese pago primero. |
| anything else | `null` → handler answers 500 `Error al pagar comisiones` / `Error al anular el pago` |

- [ ] **Step 1: Write the failing test**

```ts
it.each([
  ["COMISION_ERROR:MONTO_DISTINTO:VENTA:v1:VENDEDOR:ORIGINAL:-", 409],
  ["COMISION_ERROR:OTRO_BENEFICIARIO:x", 409],
  ["COMISION_ERROR:AJUSTES_PAGADOS:p2", 409],
  ["COMISION_ERROR:NO_AUTORIZADO", 403],
  ["COMISION_ERROR:SIN_FILAS", 400],
])("maps %s to %i", (message, status) => expect(commissionRpcError({ code: "P0001", message })?.status).toBe(status))
it("a concurrent duplicate (23505) is a 409, not a 500", () => expect(commissionRpcError({ code: "23505", message: "duplicate key" })?.status).toBe(409))
it("unknown errors are not mapped", () => expect(commissionRpcError({ code: "XX000", message: "boom" })).toBeNull())
it("payCommissions sends the rows and amounts as given and returns the payout", async () => {
  vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { pagoId: "p1", total: 70, filas: 2 }, error: null } as any)
  const res = await payCommissions({ organizationId: "org-1", userId: "a1", beneficiarioId: "t1", filas: [{ clave: "k1", monto: 100 }, { clave: "k2", monto: -30 }], notas: " semana " })
  expect(supabaseAdmin.rpc).toHaveBeenCalledWith("pagar_comisiones", { p_organization_id: "org-1", p_usuario_id: "a1", p_beneficiario_id: "t1", p_filas: [{ clave: "k1", monto: 100 }, { clave: "k2", monto: -30 }], p_notas: "semana" })
  expect((await parseResponse(res)).body).toEqual({ pagoId: "p1", total: 70, filas: 2 })
})
it("annulBodySchema rejects a blank reason", () => expect(annulBodySchema.safeParse({ pagoId: "p1", motivo: "  " }).success).toBe(false))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run __tests__/lib/commissions-payouts.test.ts`
Expected: FAIL with `Failed to resolve import "@/lib/commissions/payouts"`

- [ ] **Step 3: Implement `payouts.ts`.** Code = text after `COMISION_ERROR:` up to the next `:`.

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run __tests__/lib/commissions-payouts.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/commissions/payouts.ts __tests__/lib/commissions-payouts.test.ts
git commit -m "feat(comisiones): add payout handlers over the pay and annul RPCs"
```

---

### Task 11: Pay, unpay and liquidar become thin wrappers (PR 9)

**Files:**
- Modify: `app/api/comisiones/pagar/route.ts`, `app/api/comisiones/vendedores/pagar/route.ts`, `app/api/vendedores/[id]/comisiones/liquidar/route.ts`
- Modify: `__tests__/api/comisiones-integridad.test.ts` (replace C1, C2a, C2b; keep C3, C4)

**Interfaces:**
- Consumes: Task 10.
- Produces (URLs kept): `POST /api/comisiones/pagar` and `POST /api/comisiones/vendedores/pagar` take `payBodySchema`; both `DELETE`s take `annulBodySchema` (`{ pagoId, motivo }`); `POST /api/vendedores/[id]/comisiones/liquidar` takes `liquidarBodySchema`, keeps its 404 for a non-VENDEDOR id, pays `beneficiarioId = id`, answers `{ pagoId, total, liquidadas: filas, solicitadas: body.filas.length }`. All `requireAdmin`; zod errors → 400 with the first message. No route writes `comision_pagada` any more.

- [ ] **Step 1: Write the failing tests** (new C1/C2 in `comisiones-integridad.test.ts`)

```ts
it("C1.1 — pay goes through pagar_comisiones and never updates a table", async () => {
  mockAdminAuth(); const mem = montarSupabaseEnMemoria({}, { resultadoRpc: () => ({ pagoId: "p1", total: 10, filas: 1 }) })
  const res = await pagarTecnicoPost(createPostRequest({ beneficiarioId: "t1", filas: [{ clave: "k", monto: 10 }] }))
  expect(res.status).toBe(200)
  expect(mem.escrituras.map((e) => [e.tabla, e.operacion])).toEqual([["pagar_comisiones", "rpc"]])
})
it("C1.2 — the legacy body { ordenIds } is a 400 and calls nothing", async () => { /* status 400, escrituras [] */ })
it("C1.3 — a stale amount is a 409 with the reload message", async () => { /* rpc error COMISION_ERROR:MONTO_DISTINTO:k → 409, body.error matches /Actualizá/ */ })
it("C2a.1 — unpay annuls the payout with its reason", async () => { /* DELETE { pagoId: "p1", motivo: "error de carga" } → rpc anular_pago_comisiones with p_pago_id p1, p_motivo */ })
it("C2a.2 — unpay without a reason is a 400", async () => { /* { pagoId: "p1" } → 400 */ })
it("C2b.1 — the seller unpay route is the same wrapper", async () => { /* vendedores/pagar DELETE → anular_pago_comisiones */ })
it("C5 — liquidar pays the URL's seller, 404 when the id is not a VENDEDOR", async () => { /* users chain empty → 404; found → rpc p_beneficiario_id === "v1" */ })
it("C6 — non-admins cannot pay nor unpay", async () => { /* mockAuthSuccess({ role: "TECNICO" }) → 403 on POST and DELETE, escrituras [] */ })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run __tests__/api/comisiones-integridad.test.ts`
Expected: FAIL (routes still update `ordenes_servicio`/`ventas`)

- [ ] **Step 3: Rewrite the three route files** as `requireAdmin` → parse → `payCommissions` / `annulCommissionPayout`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `./node_modules/.bin/vitest run __tests__/api/comisiones-integridad.test.ts`
Expected: PASS (C3, C4 unchanged and green)

- [ ] **Step 5: Commit**

```bash
git add app/api/comisiones/pagar/route.ts app/api/comisiones/vendedores/pagar/route.ts "app/api/vendedores/[id]/comisiones/liquidar/route.ts" __tests__/api/comisiones-integridad.test.ts
git commit -m "refactor(comisiones): pay and unpay routes wrap the payout RPCs"
```

---

### Task 12: Unpay dialog with mandatory reason (PR 10)

**Files:**
- Create: `components/comisiones/anular-pago-dialog.tsx`
- Test: `__tests__/components/anular-pago-dialog.test.tsx`

**Interfaces:**
- Produces: `AnularPagoDialog({ open, onOpenChange, pagoId, fechaPago, endpoint, onAnulado }: { open: boolean; onOpenChange: (o: boolean) => void; pagoId: string | null; fechaPago: string | null; endpoint: "/api/comisiones/pagar" | "/api/comisiones/vendedores/pagar"; onAnulado: () => void })`. Sends `DELETE endpoint` with `{ pagoId, motivo }`. Copy: title `Anular pago`; text `Se anula el pago completo del {fecha}, no solo esta fila: todas sus comisiones vuelven a quedar pendientes. Queda registrado quién lo anuló y por qué.` (`del {fecha}` omitted when `fechaPago` is null); label `Motivo`; placeholder `Ej.: se cargó un monto equivocado`; buttons `Cancelar`, `Anular pago` (disabled while the trimmed reason is empty or sending); success `toast.success("Pago anulado")`; error → `toast.error(body.error ?? "No se pudo anular el pago")`, dialog stays open.

- [ ] **Step 1: Write the failing test**

```ts
it("keeps 'Anular pago' disabled until a reason is typed, then sends pagoId and reason", async () => {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ pagoId: "p1", filas: 2 }) }) as any
  const onAnulado = vi.fn()
  render(<AnularPagoDialog open onOpenChange={vi.fn()} pagoId="p1" fechaPago="2026-10-20T12:00:00Z" endpoint="/api/comisiones/pagar" onAnulado={onAnulado} />)
  const boton = screen.getByRole("button", { name: "Anular pago" })
  expect(boton).toBeDisabled()
  await userEvent.type(screen.getByLabelText("Motivo"), "monto equivocado")
  await userEvent.click(boton)
  expect(global.fetch).toHaveBeenCalledWith("/api/comisiones/pagar", expect.objectContaining({ method: "DELETE", body: JSON.stringify({ pagoId: "p1", motivo: "monto equivocado" }) }))
  await waitFor(() => expect(onAnulado).toHaveBeenCalled())
})
it("shows the server's 409 message and stays open", async () => { /* ok:false, json { error: "Un pago posterior ya liquidó ajustes..." } → toast.error called with that text; onAnulado not called */ })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run __tests__/components/anular-pago-dialog.test.tsx`
Expected: FAIL with `Failed to resolve import`

- [ ] **Step 3: Implement** with `Dialog`, `Textarea`, `Label` (same primitives as `liquidar-comisiones-dialog.tsx`); reset the reason when `open` turns false.

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run __tests__/components/anular-pago-dialog.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add components/comisiones/anular-pago-dialog.tsx __tests__/components/anular-pago-dialog.test.tsx
git commit -m "feat(comisiones): add unpay dialog that requires a reason"
```

---

### Task 13: Technician screens pay rows and annul payouts (PR 10)

**Files:**
- Modify: `components/comisiones/comisiones-view.tsx`, `components/tecnicos/tecnico-comisiones.tsx`
- Test: `__tests__/components/comisiones-view-pago.test.tsx`

**Interfaces:**
- Consumes: Task 8 response, Task 11 bodies, Task 12 dialog, `COMMISSION_KIND_LABEL`.
- Produces (both components): selection is a `Set<string>` of `clave`; React keys are `clave`; pay sends `{ beneficiarioId, filas: selected.map(r => ({ clave: r.clave, monto: r.montoComision })) }`; a non-OK pay response → `toast.error(body.error)` and `mutate()`; the "Pagada" control opens `AnularPagoDialog` with the row's `pagoId`/`fechaPagoComision` (`endpoint="/api/comisiones/pagar"`); a row with `documentoId` null renders `—` instead of the order link; a non-ORIGINAL row shows its `COMMISSION_KIND_LABEL` badge. In `comisiones-view.tsx`, when the selection spans more than one `tecnicoId`, the bar shows `Elegí comisiones de una sola persona para pagarlas juntas.` and the button is disabled. In `tecnico-comisiones.tsx` the payment history groups paid rows by `pagoId` (label = day of `fechaPagoComision`), and the CSV keeps its columns.

- [ ] **Step 1: Write the failing test**

```ts
vi.mock("swr", () => ({ default: (key: string | null) => ({ data: key?.startsWith("/api/comisiones?") ? data.value : [], isLoading: false, mutate }) }))
vi.mock("@/contexts/modal-context", () => ({ useModal: () => ({ confirm: vi.fn().mockResolvedValue(true) }) }))
it("blocks paying a selection that spans two technicians", async () => {
  data.value = { items: [item({ clave: "a", tecnicoId: "t1" }), item({ clave: "b", tecnicoId: "t2" })], resumen: [] }
  render(<ComisionesView />)
  for (const c of screen.getAllByRole("checkbox").slice(1)) await userEvent.click(c)
  expect(screen.getByText("Elegí comisiones de una sola persona para pagarlas juntas.")).toBeInTheDocument()
  expect(screen.getByRole("button", { name: /Marcar como pagadas/ })).toBeDisabled()
})
it("pays one technician's rows with their displayed amounts", async () => {
  data.value = { items: [item({ clave: "a", tecnicoId: "t1", montoComision: 100 }), item({ clave: "b", tecnicoId: "t1", montoComision: 50 })], resumen: [] }
  // select both, click → fetch POST /api/comisiones/pagar body { beneficiarioId: "t1", filas: [{ clave: "a", monto: 100 }, { clave: "b", monto: 50 }] }
})
it("on 409 shows the server message and reloads", async () => { /* fetch ok:false json {error:"Las comisiones cambiaron..."} → toast.error(that), mutate called */ })
it("clicking a paid row opens the annul dialog for its payout", async () => { /* item comisionPagada true pagoId p9 → click "Pagada" → dialog title "Anular pago" visible */ })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run __tests__/components/comisiones-view-pago.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement** the changes in both components (desktop table and mobile cards).

- [ ] **Step 4: Run test to verify it passes, then typecheck**

Run: `./node_modules/.bin/vitest run __tests__/components/comisiones-view-pago.test.tsx`
Run: `./node_modules/.bin/tsc --noEmit`
Expected: PASS; no type errors in the touched files

- [ ] **Step 5: Commit**

```bash
git add components/comisiones/comisiones-view.tsx components/tecnicos/tecnico-comisiones.tsx __tests__/components/comisiones-view-pago.test.tsx
git commit -m "feat(comisiones): technician screens pay rows and annul payouts"
```

---

### Task 14: Seller screens pay rows and annul payouts (PR 11)

**Files:**
- Modify: `components/comisiones/comisiones-vendedores-view.tsx`, `components/vendedores/liquidar-comisiones-dialog.tsx`
- Test: `__tests__/components/comisiones-vendedores-pago.test.tsx`

**Interfaces:**
- Consumes: Task 9 responses, Task 11 bodies, Task 12 dialog (`endpoint="/api/comisiones/vendedores/pagar"`).
- Produces: same selection/pay/409/annul behaviour as Task 13 (mixed-seller guard in the tab). Adjustment rows show their badge and a negative amount; the confirm text says `comisión(es)` instead of `venta(s)`. The liquidar dialog preselects every pending row (negatives included), keys by `clave`, posts `{ filas, notas }`, and on a non-OK answer shows `body.error` and calls `mutate()`.

- [ ] **Step 1: Write the failing test**

```ts
it("tab: an adjustment row shows 'Devolución' and a negative amount, and nets the selected total", async () => { /* items ORIGINAL 100 + AJUSTE_DEVOLUCION -30 same seller → badge "Devolución"; select all → bar total formatted 70 */ })
it("tab: blocks a two-seller selection", async () => { /* hint text + disabled button */ })
it("liquidar dialog posts every preselected row with its amount", async () => {
  // swr data { comisiones: [{ clave: "a", montoComision: 100, ... }, { clave: "b", montoComision: -30, ... }], totales }
  // click "Liquidar" → fetch POST /api/vendedores/v1/comisiones/liquidar body { filas: [{clave:"a",monto:100},{clave:"b",monto:-30}] }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run __tests__/components/comisiones-vendedores-pago.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement** the changes.

- [ ] **Step 4: Run test to verify it passes, then typecheck**

Run: `./node_modules/.bin/vitest run __tests__/components/comisiones-vendedores-pago.test.tsx`
Run: `./node_modules/.bin/tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add components/comisiones/comisiones-vendedores-view.tsx components/vendedores/liquidar-comisiones-dialog.tsx __tests__/components/comisiones-vendedores-pago.test.tsx
git commit -m "feat(comisiones): seller screens pay rows and annul payouts"
```

---

### Task 15: Order card reads the definition (PR 12)

**Files:**
- Create: `app/api/comisiones/orden/[id]/route.ts`
- Modify: `components/ordenes/orden-comision-card.tsx`, `components/ordenes/orden-detail.tsx:1282-1293,1338-1349`, `__tests__/components/orden-comision-card.test.tsx`
- Test: `__tests__/api/comisiones-orden.test.ts`

**Interfaces:**
- Consumes: `readDocumentCommissionRows`, `CommissionRow`.
- Produces:
  - `GET /api/comisiones/orden/[id]` — `requireAdmin`; `{ filas: Array<CommissionRow & { beneficiarioNombre: string }> }` for `("ORDEN", id)` in the caller's org (another org's order → `{ filas: [] }`).
  - `OrdenComisionCard({ ordenId, tecnicoId, porcentajeComision, horasTrabajadas, version, onUpdateField, readOnly }: { ordenId: string; tecnicoId: string | null | undefined; porcentajeComision: number | null | undefined; horasTrabajadas?: number; version: string; onUpdateField: (field: string, value: any) => void; readOnly?: boolean })` — props `costoFinal`, `repuestos`, `costoRepuestosExtra`, `comisionPagada`, `fechaPagoComision` are removed; it computes nothing.
  - `commissionCardVersion(o: { costoFinal?: number | null; porcentajeComision?: number | null; tecnicoId?: string | null; estado?: string | null; estadoCobro?: string | null; repuestos?: Array<{ cantidad: number; precioUnitario: number | string }> }): string` — `JSON.stringify` of those inputs; a cache key only. SWR key: `` `/api/comisiones/orden/${ordenId}?v=${encodeURIComponent(version)}` `` (null when no `tecnicoId`).
  - Rendering per row: unpaid → `Costo final` (documentoTotal), `Repuestos` (− documentoCostoRepuestos), `Ganancia` (base), editable `% Comisión` (unless `readOnly`), `Comisión` (monto); `devengada === false` → badge `Proyectada` and line `Se devenga cuando la orden queda reparada o entregada y cobrada.`; paid → badge `Pagada`, `Ganancia` (base), read-only `%`, `Comisión` (monto), `Pagada el {fechaPago}`, and `Pagada a {beneficiarioNombre}` when `beneficiarioId !== tecnicoId`. Loading `Cargando…`; error `No se pudo cargar la comisión.` "Horas trabajadas" block unchanged.

- [ ] **Step 1: Write the failing tests**

```ts
// __tests__/api/comisiones-orden.test.ts
it("non-admins get 403", async () => { /* TECNICO → 403 */ })
it("returns the order's rows in the caller's org, zero and projected rows included", async () => { /* in-memory v_comisiones_filas: o1 org-1 (devengada false, monto 0), o1 org-2, o2 org-1 → only first; beneficiarioNombre from users of org-1 */ })

// __tests__/components/orden-comision-card.test.tsx (replace the props of the two existing tests; add)
it("shows the definition's amount, not a client computation", () => { /* swr data { filas: [row({ monto: 123.45, base: 999, porcentaje: 7 })] } → text /123[.,]45/ present */ })
it("labels a non-accrued row as projected", () => { /* devengada false → "Proyectada" and the hint line */ })
it("a paid row locks the rate and names who was paid when the technician changed", () => { /* pagado true, beneficiarioId "t-old", beneficiarioNombre "Beto", tecnicoId "t-new" → no spinbutton for %, text "Pagada a Beto" */ })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./node_modules/.bin/vitest run __tests__/api/comisiones-orden.test.ts`
Run: `./node_modules/.bin/vitest run __tests__/components/orden-comision-card.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement** the route, the card, and the two `orden-detail.tsx` call sites (`version={commissionCardVersion({ ...orden, repuestos: (orden as any).repuestos })}`; drop the removed props).

- [ ] **Step 4: Run tests and typecheck**

Run: both commands of Step 2, plus `./node_modules/.bin/vitest run __tests__/components/orden-detail-practica.test.tsx` and `./node_modules/.bin/tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add "app/api/comisiones/orden/[id]/route.ts" components/ordenes/orden-comision-card.tsx components/ordenes/orden-detail.tsx __tests__/api/comisiones-orden.test.ts __tests__/components/orden-comision-card.test.tsx
git commit -m "refactor(ordenes): commission card reads the single definition"
```

---

### Task 16: Sweeps — nothing else computes commission (PR 12)

**Files:**
- Create: `lib/__tests__/comisiones-calculo-sweep.test.ts`
- Modify: `lib/__tests__/comisiones-suscripciones-access-sweep.test.ts` (add a describe)

**Interfaces:**
- Produces: `findCommissionOffenders(files: Array<{ path: string; source: string }>): Array<{ path: string; rule: "vista-legada" | "calcula" | "escribe-flag" }>` (local to the test file). Scans `app`, `components`, `lib`, `hooks`, `contexts` (`.ts`/`.tsx`, skipping `__tests__` and `*.test.*`), comments stripped. Rules:
  - `vista-legada`: source mentions `v_comisiones_ordenes` or `v_comisiones_ventas`.
  - `calcula`: source mentions `porcentaje_comision` or `porcentajeComision`, and one line has both `/[*/]\s*100\b/` and `/pct|porcentaje|comision/i`.
  - `escribe-flag`: `/comision_pagada\s*:\s*(true|false)/`.
  - Allowed list (`calcula` only), each with the comment `// slice 4: reports switch to the definition`: `app/api/reportes/estado-resultados/route.ts`, `app/api/reportes/tendencia-financiera/route.ts`, `app/api/reportes/rentabilidad/route.ts`, `app/api/reportes/rentabilidad-tecnicos/route.ts`.

- [ ] **Step 1: Write the failing test**

```ts
it("the detector catches each rule and ignores percentage formatting", () => {
  expect(findCommissionOffenders([
    { path: "a.ts", source: 'supabaseAdmin.from("v_comisiones_ventas")' },
    { path: "b.ts", source: "const pct = Number(o.porcentaje_comision)\nconst c = Math.round(g * pct) / 100" },
    { path: "c.ts", source: ".update({ comision_pagada: true })" },
    { path: "d.ts", source: "porcentajeComision\nreturn `${(n * 100).toFixed(0)}%`" },
    { path: "e.ts", source: "// v_comisiones_ventas in a comment\nporcentaje_comision" },
  ]).map((o) => o.rule)).toEqual(["vista-legada", "calcula", "escribe-flag"])
})
it("no source file outside the allowed list computes commission, reads a legacy view or writes the flag", () => {
  expect(findCommissionOffenders(sources()).filter((o) => !(o.rule === "calcula" && ALLOWED.has(o.path)))).toEqual([])
})
it("every allowed file still computes (a fixed report leaves the list)", () => {
  const calc = new Set(findCommissionOffenders(sources()).filter((o) => o.rule === "calcula").map((o) => o.path))
  expect([...ALLOWED].filter((p) => !calc.has(p))).toEqual([])
})
// comisiones-suscripciones-access-sweep.test.ts
describe("endpoints de comisiones", () => {
  const handlers = handlersDe(join(API, "comisiones"))
  it("existen endpoints que auditar", () => expect(handlers.length).toBeGreaterThanOrEqual(6))
  it("todos piden requireAdmin salvo GET /api/comisiones (cada técnico ve las suyas)", () => {
    expect(handlers.filter((h) => !(h.id === "route.ts" && h.metodo === "GET")).filter((h) => !/\brequireAdmin\b/.test(h.body)).map((h) => `${h.id} :: ${h.metodo}`)).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./node_modules/.bin/vitest run lib/__tests__/comisiones-calculo-sweep.test.ts`
Expected: FAIL with `findCommissionOffenders is not defined` (then, once defined, green only if Tasks 8–15 removed every offender; any leftover is listed)

- [ ] **Step 3: Implement the detector in the test file**; fix any offender it lists outside the allowed list.

- [ ] **Step 4: Run tests to verify they pass**

Run: `./node_modules/.bin/vitest run lib/__tests__/comisiones-calculo-sweep.test.ts`
Run: `./node_modules/.bin/vitest run lib/__tests__/comisiones-suscripciones-access-sweep.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/__tests__/comisiones-calculo-sweep.test.ts lib/__tests__/comisiones-suscripciones-access-sweep.test.ts
git commit -m "test(comisiones): sweep that only the definition computes commission"
```

---

## Rollout (handed to the orchestrator; implementers never run these)

1. Merge PRs 1–5 (SQL only, no runtime effect).
2. Apply 376, then 377 (`node scripts/db-run.mjs <file>` dry-run, then `--apply`).
3. Run `backfill/377_auditoria_comisiones.sql`: `[1]` and `[2]` must be empty. If not, stop: slice 1 would change a number.
4. Dry-run `backfill/377_backfill_comisiones_pagos.sql`; the user reads `[2]`–`[5]`; then `--apply`. Re-run the audit: `[3]` empty.
5. Apply 378 and 379; run both probe files.
6. Merge the app tracker (PRs 6–12) to main. Old routes kept flipping flags until this deploy.
7. Immediately re-run the backfill (`--apply`; idempotent: picks up documents paid by the old routes in the window) and the audit; a `[3]` row of the "item without flag" kind is an unpay done by an old route in the window. Do NOT annul a BACKFILL payout to fix it: a BACKFILL payout groups several documents (beneficiary + org-timezone day + notes), so annulling it un-pays documents that were legitimately paid. Remediate by case:
   - No APP payout and no annulment exists yet (nothing was paid or annulled through the new RPCs): `DELETE FROM comisiones_pagos WHERE origen = 'BACKFILL'` (its items go with it: `comisiones_pagos_items.pago_id` is `ON DELETE CASCADE` in 376), re-run the backfill, re-run the audit.
   - Otherwise: annul only a payout with a single item. For a multi-item payout, annul it and re-pay its other rows from the new UI; they come back at live amounts, not the frozen ones.
8. Legacy views `v_comisiones_ordenes`/`v_comisiones_ventas` stay (no app reader; the sweep forbids new ones) until the later cleanup.

## Self-review notes

- Spec coverage: definition (T2), adjustment rows (T2: devolución/anulación/manual; order credit-note adjustments are slice 2, see hand-off), tables (T1), RPCs (T5, T6), backfill + dry-run lists (T4, T3), `fecha_anulacion` (T1), every screen/API (T8, T9, T11, T13–T15), pagination (T7), sweep (T16), reports out (T16 allowed list).
- Every test name above pins one decision; signatures in Interfaces are the ones later tasks consume (`readCommissionRows`, `summarizeByBeneficiary`, `payBodySchema`, `annulBodySchema`, `commissionRpcError`, `COMMISSION_KIND_LABEL`, `commissionCardVersion`).
