# Commissions Slice 3 — Rate Changes "From Date X" and Manual Adjustments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin changes a person's commission rate for one concept (sales, technician, reception) "from today" or "from date X", sees the impact split into unpaid and already-paid documents before confirming, and the change is applied atomically and audited; paid rows stay closed and only get an optional `CAMBIO_TASA` adjustment. The same slice adds the admin screen for manual adjustments.

**Architecture:** One plpgsql RPC, `cambiar_tasa_comision`, is both the preview and the confirm. It takes the payout lock, locks the documents, reads the single definition, rewrites the unpaid snapshots and reads the definition again, all inside one subtransaction. A preview, or a confirm whose preview fingerprint no longer matches, rolls that subtransaction back. So the preview is what confirm does, by construction. Paid documents get their difference from the frozen payout item. `ventas_updated_at` learns to skip snapshot-only updates. A second migration makes the legacy-flag sync ignore manual adjustments and adds `eliminar_ajuste_comision`. The app adds one rate route, an adjustments API, audit rows on every person-rate writer, a change dialog opened from the seller and technician forms, an "Ajustes" tab, and the adjustment reason on every commission list.

**Tech Stack:** Next.js 16 App Router route handlers, Supabase Postgres (`supabaseAdmin`), plpgsql, zod, SWR, vitest (+ Testing Library), SQL text tests (`__tests__/helpers/sql-text.ts`), hand-run verify probes.

**Spec:** `docs/superpowers/specs/2026-10-29-comisiones-unificadas-design.md` (Slices item 3; "Rates", especially "Changing a rate (the tool)"; "Payouts" (`comisiones_ajustes`); "After payment the row is closed"; Integration map row "Rate writers"). Slice 2 plan (interfaces consumed): `docs/superpowers/plans/2026-10-30-comisiones-slice2-recepcion.md`. Slice 1 plan: `docs/superpowers/plans/2026-10-29-comisiones-slice1-fundacion.md`.

## Global Constraints

Slice 2's Global Constraints apply verbatim: Data access, Views, Migration files, Probes, Database runs, Strict TDD, Search, Language, Money, Commits and the public repo, Access. This slice changes or adds:

- **Numbers.** Applying this slice changes no amount. Only a confirmed rate change rewrites snapshots or writes adjustments. A paid item never changes (a probe compares every item before and after).
- **Migrations.**
  - 382 and 383 are provisional: renumber at merge.
  - Suffixes: `_comisiones_cambio_tasa.sql` and `_comisiones_ajustes_manuales.sql`.
  - Markers: `Rollback of comisiones_cambio_tasa`, `Verification of comisiones_cambio_tasa`, `Rollback of comisiones_ajustes_manuales`, `Verification of comisiones_ajustes_manuales`.
  - Never write another migration's marker in a new file. Example: 383's rollback copies 378's function but not the line `Rollback of comisiones_pagar_rpc`.
- **RPCs.**
  - plpgsql, `SECURITY INVOKER`, errors raised as `'COMISION_ERROR:<CODE>[:<detail>]'`.
  - `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` plus `GRANT EXECUTE ... TO service_role` (378).
  - Slice 2's `SECURITY DEFINER` reasoning does not apply: every caller is service_role.
- **No DDL at request time.** No `ALTER TABLE ... DISABLE TRIGGER` and no other DDL inside a function.
  - It needs table ownership.
  - It takes a SHARE ROW EXCLUSIVE lock on the whole table, for every shop, until commit.
- **Lock order.** Any function that changes what a payout sees takes the lock first: `pg_advisory_xact_lock(hashtext('comisiones:' || p_organization_id))`. Then it locks the documents `FOR UPDATE ... ORDER BY id`, the same order as 378.
- **Probes.**
  - Result tables: `_r382` and `_r383`.
  - Fixtures live in synthetic organizations `org-probe-382` and `org-probe-383`, built the way `verify/372_probes.sql` builds `org-probe-372`. No real shop's rows are used.
  - Each fixture sets every rate and config value it relies on.
- **Copy.** New UI copy is neutral Spanish: no voseo, and "aquí", not "acá". Slice 1's voseo strings stay as they are.
- **Access.** Every new route lives under `app/api/comisiones` and calls `requireAdmin`. The Ajustes tab lives on `/comisiones`, which is in `RUTAS_ADMIN`.

## Review Focus

1. **A rate typed with a comma** ("0,05", "5,5") must read as the same number as with a dot. The example and the warning follow it, and an unparseable value never turns into 0. (Task 7 test.)
2. **A commission paid between preview and confirm** (another admin or another tab): confirm writes nothing and answers 409 with the refreshed preview, where that document has moved to "ya pagadas". (Task 2 probe T5, Task 4 route test, Task 7 dialog test.)
3. **Confirm pressed twice, or the same change applied again later:** the second run writes nothing (`SIN_CAMBIOS`), never a second set of adjustments. (Task 2 probe T6, Task 7 "one POST on double click".)
4. **The date boundary uses the shop's time zone.** A sale at 23:30 on the evening before X (already X in UTC) is excluded. A sale at 00:10 on X is included. (Task 2 probe T3.)
5. **A manual adjustment typed as 0, "-0" or 0.004, or submitted twice:**
   - an amount that rounds to 0 is refused;
   - amounts are rounded to cents;
   - a double click creates one row.

   (Task 5 API test, Task 9 component test.)

---

## Facts verified on this worktree (origin/main 4f3981ff + slice 2 plan)

- **377 emits manual adjustments, both origins.**
  - Every `comisiones_ajustes` row becomes an `AJUSTE_MANUAL` row (377:111-114), whatever its `origen`.
  - `ajuste_ref` is the adjustment id, `devengada` is true, `fecha_devengo` is `created_at`, and `base`/`porcentaje` are NULL.
  - 381 keeps this branch (slice 2 appends `NULL, NULL, NULL`).
- **378 pays them.**
  - It finds the row with `documento_id = ANY(v_docs) OR ajuste_ref = ANY(v_ajustes)` (378:201).
  - It skips the document lock for `-` (378:175-181).
- **The gap is in 378's flag sync.**
  - `comisiones_sincronizar_flags` sets `comision_pagada` when any live item of the legacy role exists, of any kind (378:74, 98).
  - A paid manual adjustment linked to a sale whose own commission is unpaid would therefore set the sale's flag. That flag blocks editing the sale (`lib/ventas/bloqueos.ts:62`, 372:127).
  - Fixed in Task 3.
- **379 needs no change.**
  - Its guard ignores `AJUSTE_MANUAL`.
  - Annulling a payout whose `ORIGINAL` item later got a `CAMBIO_TASA` adjustment leaves a live row at the old snapshot plus the adjustment, which equals the new-rate amount. That is consistent.
- **Correction to the brief.**
  - Post-payment adjustment rows are derived from the paid item, not from the snapshot: sale returns use `po.porcentaje` (377:88), annulments use `po.monto` (377:100), order credit notes use `po.porcentaje` (slice 2's 381).
  - The real reason not to rewrite a paid document's snapshot is the double count it would cause: if that payout were later annulled, the live row would come back at the new rate on top of the `CAMBIO_TASA` adjustment.
- **UPDATE triggers.**
  - On `ventas`:
    - `ventas_updated_at` fires on any update and moves `updated_at`;
    - `trigger_restore_stock_on_cancel` acts only on COMPLETADA→ANULADA (334);
    - `ventas_proteger_anulacion` and `ventas_fecha_anulacion` fire only `UPDATE OF estado`.
  - On `ordenes_servicio`:
    - it has no `updated_at` (353:57);
    - `ordenes_search_update` recomputes the same vector;
    - `trg_orden_cambio_estado_tiempo`, `ordenes_recalcular_cobro` and `trigger_ordenes_es_practica_guard` fire only on their own columns.
  - `ordenes_servicio` is in the realtime publication (073), but no client subscribes anymore (`hooks/use-realtime-orders.ts` polls).
  - 376's `DISABLE TRIGGER` pattern cannot be used at request time (see Global Constraints).
- **Columns.**
  - `users.porcentaje_comision` is `DECIMAL(5,2) NOT NULL DEFAULT 0`, shared by sales and technician (119, 122).
  - `ventas.porcentaje_comision` and `ordenes_servicio.porcentaje_comision` are `DECIMAL(5,2)` and nullable.
  - Slice 2 adds `users.porcentaje_comision_recepcion` and `ordenes_servicio.porcentaje_comision_recepcion`, both nullable. Its insert trigger fills NULL, so a legacy NULL only exists on orders received before 380.
- **Time zone:** `organizations.zona_horaria TEXT NOT NULL DEFAULT 'America/Argentina/Buenos_Aires'` (032).
- **Rate writers.** These files write a rate column as an object key or an assignment:
  - person rate: `app/api/vendedores/route.ts`, `vendedores/[id]`, `tecnicos/route.ts`, `tecnicos/[id]`, `usuarios/[id]/rol`;
  - order snapshot: `app/api/ordenes/route.ts`, `ordenes/[id]`, `ordenes/[id]/tomar`, `tecnicos/[id]/reasignar`.
  - `usuarios/[id]/rol` already writes `audit_logs`, including `porcentaje_comision_before`/`_after`.
  - The four vendedores/tecnicos routes do not.
  - The order writers copy the assigned technician's rate. PUT `ordenes/[id]` also takes the card's per-order `%`, and its own diff audit already logs it.
- **Rows without a document** render "—" in the lists, but the technician CSV writes `#null` (`components/tecnicos/tecnico-comisiones.tsx:240`). Slice 3 creates the first such rows, so Task 10 fixes it.

## Integration map for this slice

| Consumer | Change | Task |
|---|---|---|
| `ventas_updated_at` trigger | skips an update that only rewrites `porcentaje_comision` | 1 |
| `cambiar_tasa_comision` (new) | preview and confirm, audited | 1, 2 |
| `comisiones_sincronizar_flags` (378) | ignores `AJUSTE_MANUAL` items | 3 |
| `eliminar_ajuste_comision` (new) | deletes an unpaid manual adjustment, audited | 3 |
| Definition views, `pagar_comisiones`, `anular_pago_comisiones` | unchanged; probes pin both adjustment origins as payable | 2, 3 |
| POST `/api/comisiones/tasas` | new | 4 |
| `/api/comisiones/ajustes`, `/api/comisiones/ajustes/[id]` | new | 5 |
| Person-rate writers (4 routes); `usuarios/[id]/rol` | `audit_logs` (the rol route is pinned as is) | 6 |
| `vendedor-form`, `tecnico-form` | edit mode: rate shown with "Cambiar" (opens the dialog); create mode: example and warning | 8 |
| `roles-permisos`, `comisiones-config` (slice 2) | example and warning under the rate input | 8 |
| `/comisiones` page | "Ajustes" tab | 9 |
| `rows.ts`, the 3 list APIs, 4 list components, order card | adjustment origin and reason; CSV `#null` fix | 10 |
| Order card `RECEPCION` % | stays read-only (see "Calls I made") | — |
| Reports | slice 4 | — |
| Sweeps | access count; rate writers leave an audit trail | 4, 6 |

## File structure

- **382:** `supabase/migrations/382_comisiones_cambio_tasa.sql` holds the trigger guard and `cambiar_tasa_comision`. Alongside it: `rollback/382_rollback.sql` and `verify/382_probes.sql`.
- **383:** `supabase/migrations/383_comisiones_ajustes_manuales.sql` holds the flag-sync fix and `eliminar_ajuste_comision`. Alongside it: `rollback/383_rollback.sql` and `verify/383_probes.sql`.
- **lib:**
  - `lib/commissions/rate-change.ts` (client-safe): body schema, result schema and types, concept labels.
  - `lib/commissions/rate-hint.ts` (client-safe): rate parsing, the example amount, the suspicious-value rule.
  - `lib/commissions/rate-audit.ts`: the audit helper for person-rate writers.
  - `lib/commissions/adjustments.ts` (client-safe): adjustment schemas, item type, origin labels.
- **Routes:** `app/api/comisiones/tasas/route.ts`, `app/api/comisiones/ajustes/route.ts`, `app/api/comisiones/ajustes/[id]/route.ts`.
- **Components:** `components/comisiones/tasa-ayuda.tsx`, `cambiar-tasa-dialog.tsx`, `ajustes-view.tsx`, `nuevo-ajuste-dialog.tsx`, `eliminar-ajuste-dialog.tsx`.

---

### Task 1: The rate-change RPC and a quiet snapshot rewrite (PR A)

**Files:**
- Create: `supabase/migrations/382_comisiones_cambio_tasa.sql`, `supabase/migrations/rollback/382_rollback.sql`
- Test: `__tests__/comisiones-cambio-tasa-migration.test.ts`

**Interfaces:**
- Consumes:
  - 376: `comisiones_pagos`, `comisiones_pagos_items`, `comisiones_ajustes`;
  - the `v_comisiones_filas` columns (`documento_tipo`, `documento_id`, `rol`, `tipo`, `ajuste_ref`, `base`, `monto`, `beneficiario_id`, `pagado`);
  - slice 2's 380 (`comisiones_config.recepcion_porcentaje_default`, both reception columns);
  - `organizations.zona_horaria`.
- Produces:
  - **The trigger:** `ventas_updated_at` recreated with a `WHEN` clause; same name, same function.
  - **The function:**

    ```
    cambiar_tasa_comision(p_organization_id TEXT, p_usuario_id TEXT, p_beneficiario_id TEXT,
      p_rol TEXT, p_porcentaje NUMERIC, p_desde DATE, p_incluir_pagadas BOOLEAN,
      p_confirmar BOOLEAN, p_huella TEXT DEFAULT NULL) RETURNS JSONB
    ```

  - **Errors:** `NO_AUTORIZADO`, `ROL_INVALIDO`, `PORCENTAJE_INVALIDO`, `BENEFICIARIO_NO_ENCONTRADO`, `FECHA_FUTURA`, `HUELLA_REQUERIDA`.
  - **Result** (camelCase JSON):

    ```
    { aplicado: bool, motivo: null | 'VISTA_PREVIA_DESACTUALIZADA' | 'SIN_CAMBIOS', huella: text | null,
      porcentajeAnterior: num | null, porcentajeNuevo: num | null, porcentajeDocumentos: num, desde: 'YYYY-MM-DD' | null,
      pendientes: { documentos: int, diferencia: num, compensaciones: int },
      pagadas: { documentos: int, diferencia: num,
                 detalle: [{ documentoId, documentoNumero, documentoCodigo, fecha, pagado, diferencia }] (≤ 50, by fecha) },
      ajustes: int, documentosReescritos: int }
    ```

    - `huella` is NULL when `p_desde` is NULL.
    - `ajustes` and `documentosReescritos` are 0 unless `aplicado`.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest"
import { readBySuffix, readByMarker, collapse, stripComments } from "./helpers/sql-text"

const raw = () => readBySuffix("_comisiones_cambio_tasa.sql")
const mig = () => collapse(raw())
const fn = () => mig().slice(mig().indexOf("CREATE OR REPLACE FUNCTION cambiar_tasa_comision("))
const rb = () => readByMarker("rollback", "Rollback of comisiones_cambio_tasa")
const PLAIN = "CREATE TRIGGER ventas_updated_at BEFORE UPDATE ON ventas FOR EACH ROW EXECUTE FUNCTION update_updated_at()"

describe("382: hygiene", () => {
  it("lock_timeout first, no transaction, aborts before anything when slice 2 is missing, no runtime DDL", () => {
    expect(mig().startsWith("SET LOCAL lock_timeout = '3s';")).toBe(true)
    expect(stripComments(raw())).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im)
    expect(mig().indexOf("Abort: aplicar 380 y 381 antes de 382")).toBeLessThan(mig().indexOf("CREATE TRIGGER"))
    expect(mig()).not.toMatch(/DISABLE TRIGGER/)
  })
})
describe("382: a snapshot-only update leaves ventas.updated_at alone", () => {
  it("recreates ventas_updated_at with a WHEN that ignores porcentaje_comision", () => {
    expect(mig()).toContain("DROP TRIGGER IF EXISTS ventas_updated_at ON ventas;")
    expect(mig()).toContain("CREATE TRIGGER ventas_updated_at BEFORE UPDATE ON ventas FOR EACH ROW WHEN ((to_jsonb(OLD) - 'porcentaje_comision' - 'updated_at') IS DISTINCT FROM (to_jsonb(NEW) - 'porcentaje_comision' - 'updated_at')) EXECUTE FUNCTION update_updated_at()")
  })
})
describe("382: cambiar_tasa_comision", () => {
  it("invoker, service_role only", () => {
    expect(fn().slice(0, fn().indexOf("REVOKE"))).not.toMatch(/SECURITY DEFINER/)
    expect(mig()).toContain("REVOKE EXECUTE ON FUNCTION cambiar_tasa_comision(TEXT, TEXT, TEXT, TEXT, NUMERIC, DATE, BOOLEAN, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated")
    expect(mig()).toContain("GRANT EXECUTE ON FUNCTION cambiar_tasa_comision(TEXT, TEXT, TEXT, TEXT, NUMERIC, DATE, BOOLEAN, BOOLEAN, TEXT) TO service_role")
  })
  it("admin check, then the payout lock, then documents in id order, then the first write", () => {
    const s = fn(), lock = s.indexOf("PERFORM pg_advisory_xact_lock(hashtext('comisiones:' || p_organization_id))")
    expect(s.indexOf("COMISION_ERROR:NO_AUTORIZADO")).toBeLessThan(lock)
    expect(lock).toBeLessThan(s.indexOf("ORDER BY id FOR UPDATE"))
    expect(s.indexOf("ORDER BY id FOR UPDATE")).toBeLessThan(s.indexOf("UPDATE ventas SET porcentaje_comision = v_valor"))
  })
  it("document date is the sale's created_at or the order's fecha_ingreso, from the start of X in the shop's zone", () => {
    const s = fn()
    expect(s).toContain("v_desde_ts := p_desde::timestamp AT TIME ZONE v_tz")
    expect(s).toContain("v.created_at >= v_desde_ts"); expect(s).toContain("o.fecha_ingreso >= v_desde_ts")
    expect(s).toContain("p_desde > (now() AT TIME ZONE v_tz)::date")
  })
  it("a document whose ORIGINAL row in the role has a live payout item is never rewritten", () => {
    expect(fn()).toContain("AND i.rol = p_rol AND i.tipo = 'ORIGINAL' AND NOT i.anulado")
    for (const u of ["UPDATE ventas SET porcentaje_comision = v_valor", "UPDATE ordenes_servicio SET porcentaje_comision = v_valor", "UPDATE ordenes_servicio SET porcentaje_comision_recepcion = v_valor"]) {
      const at = fn().indexOf(u); expect(at).toBeGreaterThan(-1)
      expect(fn().slice(at, at + 200)).toContain("AND id = ANY(v_pend)")
    }
  })
  it("reception 'use the shop default' writes the default's current value into the documents", () => {
    expect(fn()).toContain("COALESCE(v_pct, (SELECT c.recepcion_porcentaje_default FROM comisiones_config c WHERE c.organization_id = p_organization_id), 0)")
  })
  it("rewrite and re-read happen in one subtransaction that a preview or a stale confirm rolls back", () => {
    const s = fn()
    expect(s).toContain("v_aplicar := p_confirmar AND (p_desde IS NULL OR p_huella = v_huella);")
    expect(s).toContain("RAISE EXCEPTION 'COMISION_VISTA_PREVIA'")
    expect(s).toContain("EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'COMISION_VISTA_PREVIA' THEN RAISE; END IF;")
    const fin = s.indexOf("EXCEPTION WHEN raise_exception")
    expect(s.indexOf("UPDATE ventas SET porcentaje_comision = v_valor")).toBeLessThan(fin)
    expect(s.indexOf("INSERT INTO comisiones_ajustes")).toBeGreaterThan(fin)
    expect(s.indexOf("INSERT INTO audit_logs")).toBeGreaterThan(fin)
  })
  it("unpaid amounts come from the definition; the only formula is the closed row's difference", () => {
    const s = fn()
    expect(s).toContain("FROM v_comisiones_filas f")
    expect(s.match(/\* v_valor \/ 100/g)).toHaveLength(1)
    expect(s).toContain("ROUND(x.base_neta * v_valor / 100, 2) - x.actual AS diferencia")
  })
  it("the paid difference nets post-payment rows and earlier rate changes; an annulled sale targets 0", () => {
    const s = fn()
    expect(s).toContain("CASE WHEN y.anulada THEN 0 ELSE GREATEST(y.base_pagada - y.devuelto, 0) END AS base_neta")
    expect(s).toContain("fl.tipo IN ('ORIGINAL', 'AJUSTE_DEVOLUCION', 'AJUSTE_ANULACION') OR fl.origen = 'CAMBIO_TASA'")
    expect(s).toContain("p.beneficiario_id = p_beneficiario_id AND i.base IS NOT NULL")
  })
  it("adjustments are CAMBIO_TASA; paid ones only when asked; netting ones always", () => {
    const s = fn()
    expect(s).toMatch(/INSERT INTO comisiones_ajustes \([^)]*origen[^)]*\)/)
    expect(s).toContain("'CAMBIO_TASA'")
    expect(s).toContain("WHERE p_incluir_pagadas AND x.diferencia <> 0")
  })
})
describe("382: rollback", () => {
  it("restores the plain trigger, drops the function, and says data stays", () => {
    expect(collapse(rb())).toContain(PLAIN)
    expect(collapse(rb())).toContain("DROP FUNCTION IF EXISTS cambiar_tasa_comision(TEXT, TEXT, TEXT, TEXT, NUMERIC, DATE, BOOLEAN, BOOLEAN, TEXT)")
    expect(rb().slice(0, rb().indexOf("DROP"))).toMatch(/audit_logs/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run __tests__/comisiones-cambio-tasa-migration.test.ts`
Expected: FAIL with `No file in supabase/migrations/ matches suffix "_comisiones_cambio_tasa.sql"`

- [ ] **Step 3: Write 382 and its rollback.**
  - **File order:**
    1. Header: why (spec link); "no caller until the route lands"; the trigger reasoning from "Facts verified"; rollback and verify paths.
    2. `SET LOCAL lock_timeout = '3s';`
    3. A `DO` block raising `Abort: aplicar 380 y 381 antes de 382` when `to_regclass('public.comisiones_config')` is NULL or `v_comisiones_filas` has no `motivo_sin_devengo` column (`information_schema.columns`).
    4. `DROP TRIGGER IF EXISTS ventas_updated_at ON ventas;` followed by the `CREATE TRIGGER` pinned above.
    5. The function, then its REVOKE and GRANT.
  - **Trigger fallback.** If the dry-run rejects the whole-row `to_jsonb(OLD)` in `WHEN`, use `WHEN (current_setting('stapp.reescritura_tasa', true) IS DISTINCT FROM 'on')` instead. In that case the RPC does `PERFORM set_config('stapp.reescritura_tasa', 'on', true)` before the rewrite and `'off'` after it. Update the pinned string to match.
  - **Function body, in this order:**
    1. **Admin.** The caller must be an active ADMIN of the org (same query as 378), else `NO_AUTORIZADO`.
    2. **Validation.**
       - `p_rol` must be one of `VENDEDOR`, `TECNICO`, `RECEPCION`, else `ROL_INVALIDO`.
       - `p_porcentaje` may be NULL only when `p_rol = 'RECEPCION'`, and must be within 0..100, else `PORCENTAJE_INVALIDO`.
       - `v_pct := ROUND(p_porcentaje, 2)`.
    3. **Dates.**
       - `v_tz` is `organizations.zona_horaria`.
       - `p_desde > (now() AT TIME ZONE v_tz)::date` raises `FECHA_FUTURA`.
       - `p_confirmar AND p_desde IS NOT NULL AND p_huella IS NULL` raises `HUELLA_REQUERIDA`.
       - `v_desde_ts := p_desde::timestamp AT TIME ZONE v_tz`.
    4. **Lock.** The advisory lock.
    5. **The person.** Read the beneficiary's row with `id` and `organization_id` `FOR UPDATE`, else `BENEFICIARIO_NO_ENCONTRADO`. A removed person is allowed.
       - `v_antes_persona` is `porcentaje_comision_recepcion` for `RECEPCION`, else `porcentaje_comision`.
       - `v_col` is that column's name.
    6. **Values.** `v_valor` is the `COALESCE` pinned above for `RECEPCION`, else `v_pct`. `v_doc_tipo := CASE p_rol WHEN 'VENDEDOR' THEN 'VENTA' ELSE 'ORDEN' END`.
    7. **Documents** (only when `p_desde` is not NULL).
       - Unpaid candidates (`v_pend`), plus their old snapshots (`v_snaps`, a `jsonb_object_agg(id, snap)`):

```sql
SELECT COALESCE(array_agg(d.id ORDER BY d.id), '{}'), COALESCE(jsonb_object_agg(d.id, d.snap), '{}')
  INTO v_pend, v_snaps
  FROM (
    SELECT v.id, v.porcentaje_comision AS snap FROM ventas v
     WHERE p_rol = 'VENDEDOR' AND v.organization_id = p_organization_id
       AND v.vendedor_id = p_beneficiario_id AND v.created_at >= v_desde_ts
    UNION ALL
    SELECT o.id, CASE WHEN p_rol = 'TECNICO' THEN o.porcentaje_comision ELSE o.porcentaje_comision_recepcion END
      FROM ordenes_servicio o
     WHERE p_rol IN ('TECNICO', 'RECEPCION') AND o.organization_id = p_organization_id
       AND ((p_rol = 'TECNICO' AND o.tecnico_id = p_beneficiario_id) OR (p_rol = 'RECEPCION' AND o.recibido_por = p_beneficiario_id))
       AND o.fecha_ingreso >= v_desde_ts
  ) d
 WHERE NOT EXISTS (SELECT 1 FROM comisiones_pagos_items i
                    WHERE i.organization_id = p_organization_id AND i.documento_tipo = v_doc_tipo AND i.documento_id = d.id
                      AND i.rol = p_rol AND i.tipo = 'ORIGINAL' AND NOT i.anulado)
   AND (d.snap IS DISTINCT FROM v_valor
        OR EXISTS (SELECT 1 FROM comisiones_ajustes a
                    WHERE a.organization_id = p_organization_id AND a.documento_tipo = v_doc_tipo AND a.documento_id = d.id
                      AND a.rol = p_rol AND a.beneficiario_id = p_beneficiario_id AND a.origen = 'CAMBIO_TASA'));
```

       - **Paid documents** (`v_pag` ids, plus a jsonb array `v_pagadas` with every field of `pagadas.detalle`). This is the only formula in the file:

```sql
WITH pd AS (
  SELECT i.documento_id, i.base AS base_pagada, i.porcentaje AS porcentaje_pagado,
         COALESCE(v.created_at, o.fecha_ingreso) AS fecha, COALESCE(v.numero_venta, o.numero_orden) AS numero, o.codigo_orden AS codigo
    FROM comisiones_pagos_items i
    JOIN comisiones_pagos p ON p.id = i.pago_id AND p.organization_id = i.organization_id
    LEFT JOIN ventas v ON v_doc_tipo = 'VENTA' AND v.id = i.documento_id AND v.organization_id = i.organization_id
    LEFT JOIN ordenes_servicio o ON v_doc_tipo = 'ORDEN' AND o.id = i.documento_id AND o.organization_id = i.organization_id
   WHERE i.organization_id = p_organization_id AND i.documento_tipo = v_doc_tipo
     AND i.rol = p_rol AND i.tipo = 'ORIGINAL' AND NOT i.anulado
     AND p.beneficiario_id = p_beneficiario_id AND i.base IS NOT NULL
     AND COALESCE(v.created_at, o.fecha_ingreso) >= v_desde_ts
), fl AS (
  SELECT f.documento_id, f.tipo, f.base, f.monto, f.beneficiario_id, a.origen
    FROM v_comisiones_filas f
    LEFT JOIN comisiones_ajustes a ON f.tipo = 'AJUSTE_MANUAL' AND a.id = f.ajuste_ref AND a.organization_id = f.organization_id
   WHERE f.organization_id = p_organization_id AND f.documento_tipo = v_doc_tipo AND f.rol = p_rol
     AND f.documento_id IN (SELECT documento_id FROM pd)
), y AS (
  SELECT pd.documento_id, pd.base_pagada, pd.porcentaje_pagado, pd.fecha, pd.numero, pd.codigo,
         COALESCE(bool_or(fl.tipo = 'AJUSTE_ANULACION'), false) AS anulada,
         COALESCE(SUM(fl.base) FILTER (WHERE fl.tipo = 'AJUSTE_DEVOLUCION'), 0) AS devuelto,
         COALESCE(SUM(fl.monto) FILTER (WHERE fl.beneficiario_id = p_beneficiario_id
           AND (fl.tipo IN ('ORIGINAL', 'AJUSTE_DEVOLUCION', 'AJUSTE_ANULACION') OR fl.origen = 'CAMBIO_TASA')), 0) AS actual
    FROM pd LEFT JOIN fl USING (documento_id)
   GROUP BY pd.documento_id, pd.base_pagada, pd.porcentaje_pagado, pd.fecha, pd.numero, pd.codigo
), x AS (
  SELECT y.*, CASE WHEN y.anulada THEN 0 ELSE GREATEST(y.base_pagada - y.devuelto, 0) END AS base_neta FROM y
)
SELECT x.*, ROUND(x.base_neta * v_valor / 100, 2) - x.actual AS diferencia FROM x
```

         Keep only the rows where `diferencia <> 0`.
       - **Lock the documents.** `PERFORM 1 FROM ventas` (or `ordenes_servicio`) `WHERE organization_id = p_organization_id AND id = ANY(v_pend || v_pag) ORDER BY id FOR UPDATE;`
       - **Before.** `v_antes`: `jsonb_object_agg(f.documento_id, f.monto)` over `v_comisiones_filas f` where the org matches, `documento_tipo = v_doc_tipo`, `documento_id = ANY(v_pend)`, `rol = p_rol`, `tipo = 'ORIGINAL'` and `NOT f.pagado`.
       - **Netting.** `v_ct`: `SUM(a.monto)` per document over the `CAMBIO_TASA` adjustments of `v_pend` for this person and role, `HAVING SUM(a.monto) <> 0`.
       - **The subtransaction:**
         1. `BEGIN`.
         2. The one `UPDATE` for the role, with `AND id = ANY(v_pend) AND <col> IS DISTINCT FROM v_valor`.
         3. `GET DIAGNOSTICS v_reescritos = ROW_COUNT`.
         4. `v_despues`: the same read as `v_antes`.
         5. Build the result:
            - `pendientes.diferencia = Σ(despues − antes) − Σ v_ct`, with a missing row counting as 0;
            - `pendientes.compensaciones` is the number of `v_ct` entries;
            - `pagadas` comes from `v_pagadas`.
         6. `v_huella := md5(concat_ws('|', p_rol, v_valor, p_desde, v_antes_persona, <pending lines>, <paid lines>))`.
            - Pending lines: `string_agg(id || ':' || antes || '>' || despues || ':' || ct, ',' ORDER BY id)`, with NULLs as 0.
            - Paid lines: `string_agg(documento_id || ':' || diferencia, ',' ORDER BY documento_id)`.
            - The fingerprint ignores `p_incluir_pagadas`, so ticking the box does not make a preview stale.
         7. `v_aplicar := ...` (pinned above).
         8. `IF NOT v_aplicar THEN RAISE EXCEPTION 'COMISION_VISTA_PREVIA'; END IF;`
         9. The pinned handler.
    8. **When `p_desde` is NULL.** There are no documents, and `v_aplicar := p_confirmar`.
    9. **Nothing to change.** If `v_aplicar`, the person's column already equals `v_pct`, `v_reescritos = 0`, `v_ct` is empty and either `p_incluir_pagadas` is false or `v_pagadas` is empty: return `aplicado: false, motivo: 'SIN_CAMBIOS'`.
    10. **Stale.** If `p_confirmar AND NOT v_aplicar`: return the fresh result with `aplicado: false, motivo: 'VISTA_PREVIA_DESACTUALIZADA'`.
    11. **Apply.** If `v_aplicar`, run these steps outside the subtransaction:
        1. **Adjustments.** `INSERT INTO comisiones_ajustes (organization_id, beneficiario_id, documento_tipo, documento_id, rol, monto, motivo, origen, created_by)`:
           - one row `-v_ct` per netting document, always;
           - one row `diferencia` per paid document, `WHERE p_incluir_pagadas AND x.diferencia <> 0`;
           - `origen` is `'CAMBIO_TASA'`, `created_by` is `p_usuario_id`, `created_at` is the default `now()` ("dated at the change").
           - Each `motivo` formats its rates with `replace(trim_scale(n)::text, '.', ',')`:
             - paid: `'Cambio de porcentaje de 0,5 % a 5 % desde el 01/09/2026. La comisión ya estaba pagada: se ajusta la diferencia.'`;
             - netting: `'Cambio de porcentaje a 5 % desde el 01/09/2026: compensa un ajuste anterior por cambio de porcentaje.'`
        2. **The person.** `UPDATE users SET <col> = v_pct WHERE id = p_beneficiario_id AND organization_id = p_organization_id AND <col> IS DISTINCT FROM v_pct`.
        3. **One audit row** in `audit_logs`:
           - `action 'UPDATE'`, `entity 'users'`, `entity_id` the person;
           - `changes = {before: {<col>: v_antes_persona}, after: {<col>: v_pct}, cambioTasa: {rol, desde, incluirPagadas, documentos: [{id, porcentajeAnterior}], ajustes: [ids], diferenciaPendiente, diferenciaPagadas}}`;
           - `description`, for example: `'Cambió el porcentaje de comisión (ventas) de Ana de 0,5 % a 5 % desde el 01/09/2026'`, or `'... desde hoy'`.
        4. Return `aplicado: true`, with `ajustes` and `documentosReescritos` filled in.
  - **Rollback** (marker `Rollback of comisiones_cambio_tasa`):
    - Body: `DROP TRIGGER IF EXISTS ventas_updated_at ON ventas;`, then the `PLAIN` create from the test, then the `DROP FUNCTION`.
    - Header:
      - rewritten snapshots and `CAMBIO_TASA` adjustments stay;
      - each change's `audit_logs.changes.cambioTasa.documentos` holds the old snapshots, for a manual restore;
      - adjustments are removed through the Ajustes screen while unpaid.

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run __tests__/comisiones-cambio-tasa-migration.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/382_comisiones_cambio_tasa.sql supabase/migrations/rollback/382_rollback.sql __tests__/comisiones-cambio-tasa-migration.test.ts
git commit -m "feat(db): change a commission rate from a date with an exact preview"
```

---

### Task 2: Probes for the rate change, including the acceptance scenario (PR A)

**Files:**
- Create: `supabase/migrations/verify/382_probes.sql`
- Test: `__tests__/comisiones-cambio-tasa-migration.test.ts` (append)

**Interfaces:**
- Consumes: Task 1; `pagar_comisiones`; `anular_pago_comisiones`.
- Produces: a probe file (marker `Verification of comisiones_cambio_tasa`, table `_r382`).

**The fixture**, in `org-probe-382`:
- **Organization:** `zona_horaria 'America/Argentina/Buenos_Aires'`, and a `comisiones_config` row with `orden_devengo 'ENTREGA'` and `recepcion_porcentaje_default 2`.
- **Users:**
  - admin `u382-admin`;
  - sellers A and B, `porcentaje_comision 5`;
  - technician T, `porcentaje_comision 10`;
  - receiver R, with `porcentaje_comision_recepcion` NULL.
- **The date:** X = `2026-09-01`.
- **Sales** (`COMPLETADA`, `iva_neto` NULL, so the base is the total), each with an explicit `porcentaje_comision` and `created_at`:

  | Sale | Seller | Total | Rate | `created_at` (shop zone) | State |
  |---|---|---|---|---|---|
  | S0 | A | 10000 | 0.5 | 08-31 23:30 | unpaid |
  | S1 | A | 10000 | 0.05 | 09-01 00:10 | paid 5.00 |
  | S2 | A | 10000 | 0.5 | 09-02 10:00 | paid 50.00 |
  | S3 | B | 12000 | 0.5 | 09-02 11:00 | paid 60.00 |
  | S4 | A | 10000 | 0.5 | 09-03 10:00 | unpaid |

- **Orders** (`fecha_ingreso` 09-02 09:00, `costo_final` 1000, no parts, `ENTREGADO`):
  - O1: technician T, snapshot 0, unpaid;
  - O2: technician T, snapshot 5, paid 50.00;
  - O3: received by R, its reception snapshot set to NULL after the insert (the legacy shape).
- **Payments** go through `pagar_comisiones` as service_role.

| Probe | Setup | Expected |
|---|---|---|
| T0 | real data, before the fixture | live `ORIGINAL` items with NULL `base` = 0. UPDATE triggers (`tgtype & 16`, `NOT tgisinternal`) on `ventas` = {`ventas_updated_at`, `trigger_restore_stock_on_cancel`, `ventas_proteger_anulacion`, `ventas_fecha_anulacion`}; on `ordenes_servicio` = {`ordenes_search_update`, `trg_orden_cambio_estado_tiempo`, `ordenes_recalcular_cobro`, `trigger_ordenes_es_practica_guard`}. Any other name fails the probe: an UPDATE trigger the quiet rewrite did not review |
| T1 | **acceptance**: A, `VENDEDOR`, 5, X, `incluir_pagadas` true; preview, then confirm with its `huella`; then B the same | A's preview: `pendientes` {1, 450.00, 0}, `pagadas` {2, 945.00}, `detalle` S1 495.00 and S2 450.00. Confirm: `aplicado`, `ajustes` 2, `documentosReescritos` 1. The definition now has two `AJUSTE_MANUAL` rows for A (S1 495.00, S2 450.00), `devengada`, `NOT pagado`, `pendiente` = `monto`, `origen` `CAMBIO_TASA`. B gets one row: S3 540.00. Every payout item of S1–S3 is identical before and after (count, `monto`, `base`, `anulado`). The S1–S3 snapshots are unchanged |
| T2 | the preview in T1 | leaves no trace: S4's snapshot, the count of `comisiones_ajustes` and the count of `audit_logs` for the org are unchanged. Its `pendientes`/`pagadas`/`huella` equal the confirm's |
| T3 | after T1 | S0 is still 0.5 (23:30 on the eve of X is outside); S1 got its row (00:10 on X is inside) |
| T4 | after T1 | S4 is 5.00, its row is 500.00, and its `updated_at` is unchanged. An `UPDATE ventas SET cliente_nombre = ...` on S4 still moves `updated_at` |
| T5 | before T1, inside `SAVEPOINT`: preview for A, pay S4, confirm with the old `huella` | `aplicado` false, `motivo` `VISTA_PREVIA_DESACTUALIZADA`, S4 now under `pagadas`; no adjustments; S4's snapshot unchanged; `ROLLBACK TO` |
| T6 | repeat T1 for A | `motivo` `SIN_CAMBIOS`; adjustment count unchanged; no new audit row |
| T7 | `SAVEPOINT`: A to 6 | S1 +100.00 (600 − 5 − 495), S2 +100.00, S4 rewritten to 6 (`pendientes.diferencia` 100.00) |
| T8 | `SAVEPOINT`: S5 (A, 10000, 0.5) paid; then a `COMPLETADA` return of 2000 with `created_at = clock_timestamp()`; then the tool to 5, X, included | the return row is −10.00 (base 2000); S5's difference is 360.00 (400 − 40) |
| T9 | `SAVEPOINT`: S6 (A, 10000, 0.5) paid; the tool to 5 (+450.00); S6 set to `ANULADA`; the tool again | the annulment row is −50.00; the second run writes −450.00 on S6 (target 0) |
| T10 | T, `TECNICO`, 10, X, included | O1 rewritten 0→10, row 100.00; O1's reception snapshot untouched; O2 gets +50.00 |
| T11 | after T10: annul O2's payout (`anular_pago_comisiones`), then T, `TECNICO`, 10 again | O2 rewritten 5→10 (row 100.00), plus a netting row −50.00; O2's total across rows is 100.00; `compensaciones` 1 |
| T12 | R, `RECEPCION`, 3, X; then `SAVEPOINT`: R, `RECEPCION`, NULL, X | O3's snapshot NULL→3 and a `RECEPCION` row 30.00 appears. With NULL: the snapshot is 2 (shop default) and `users.porcentaje_comision_recepcion` is NULL |
| T13 | B, 7, `p_desde` NULL, confirm | `users.porcentaje_comision` is 7; no document changed; one audit row with `desde` null |
| T14 | errors | `NO_AUTORIZADO` (B as caller); `BENEFICIARIO_NO_ENCONTRADO` (a user of `org-probe-382b`); `ROL_INVALIDO`; `PORCENTAJE_INVALIDO` (101; NULL for `VENDEDOR`); `FECHA_FUTURA` (tomorrow in the shop's zone); `HUELLA_REQUERIDA` |
| T15 | audit | exactly one `audit_logs` row per applied change (T1 ×2, T10, T11, T12, T13), and none for previews, T5 or T6. T1-A's `changes->'cambioTasa'->'documentos'` holds S4 with `porcentajeAnterior` 0.5 |
| T16 | pay A's two T1 rows (`VENTA:<S1>:VENDEDOR:AJUSTE_MANUAL:<id>`, …) | payout ok, items `tipo AJUSTE_MANUAL` |
| T17 | privileges | `prosecdef` false; `has_function_privilege('authenticated', ...)` false; service_role true; the `ventas_updated_at` trigger has a WHEN clause (`tgqual IS NOT NULL`) |

Checked by hand: 10000 × 0.05% = 5.00, and at 5% = 500.00, so +495.00. S2: 500 − 50 = 450. S3: 12000 × 5% − 60 = 540. T8: (10000 − 2000) × 5% = 400, and 50 − 10 = 40, so +360.

- [ ] **Step 1: Write the failing test** (append)

```ts
const probes = () => readByMarker("verify", "Verification of comisiones_cambio_tasa")
describe("382: probes", () => {
  it("synthetic org, roll back, own result table, service_role around every RPC, invariants first", () => {
    const s = stripComments(probes())
    expect(s).toMatch(/^\s*BEGIN\s*;/m); expect(s.trimEnd().endsWith("ROLLBACK;")).toBe(true)
    expect(s).toContain("CREATE TEMP TABLE _r382"); expect(s).toContain("'org-probe-382'")
    const calls = s.split("SET LOCAL ROLE service_role;").slice(1)
    expect(calls.length).toBeGreaterThan(0); for (const c of calls) expect(c).toContain("RESET ROLE;")
    expect(collapse(s)).toContain("EXCEPTION WHEN OTHERS THEN RESET ROLE;")
    expect(probes().indexOf("T0")).toBeLessThan(probes().indexOf("INSERT INTO organizations"))
  })
  it("covers every probe and the acceptance numbers", () => {
    for (let i = 0; i <= 17; i++) expect(probes()).toContain(`T${i}`)
    for (const k of ["945.00", "495.00", "540.00", "VISTA_PREVIA_DESACTUALIZADA", "SIN_CAMBIOS", "tgtype", "updated_at", "clock_timestamp()"]) expect(probes()).toContain(k)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run __tests__/comisiones-cambio-tasa-migration.test.ts`
Expected: FAIL with `No file in supabase/migrations/verify matches marker "Verification of comisiones_cambio_tasa"`

- [ ] **Step 3: Write `verify/382_probes.sql`.**
  - Follow `verify/378_probes.sql`'s shape: a header listing what each probe proves, `_r382 (orden INT, probe TEXT, esperado TEXT, obtenido TEXT)`, a `pg_temp` helper for expected `COMISION_ERROR` codes, and one final SELECT.
  - The fixture copies `verify/372_probes.sql`: insert the org, take its principal `sucursal`, insert users with literal ids.
  - Order: T0, fixture, payments, T5 (savepoint), T1–T4, T6, T7–T9 (savepoints), T10–T17.

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run __tests__/comisiones-cambio-tasa-migration.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/verify/382_probes.sql __tests__/comisiones-cambio-tasa-migration.test.ts
git commit -m "test(db): probe rate changes from a date, closed rows and the preview fingerprint"
```

- [ ] **Step 6: Hand to the controller.** Needs 380 and 381 applied.
  1. Dry-run 382: it must end in ROLLBACK with no error.
  2. With the user's OK, `--apply`.
  3. Dry-run `verify/382_probes.sql`: every row green. A T0 trigger mismatch stops the rollout.

---

### Task 3: Manual adjustments in the database (PR A)

**Files:**
- Create: `supabase/migrations/383_comisiones_ajustes_manuales.sql`, `supabase/migrations/rollback/383_rollback.sql`, `supabase/migrations/verify/383_probes.sql`
- Test: `__tests__/comisiones-ajustes-manuales-migration.test.ts`

**Interfaces:**
- Produces:
  - `comisiones_sincronizar_flags(TEXT, TEXT, TEXT[])` restated. Its only change is `AND i.tipo <> 'AJUSTE_MANUAL'` in both branches.
  - `eliminar_ajuste_comision(p_organization_id TEXT, p_usuario_id TEXT, p_ajuste_id TEXT, p_motivo TEXT) RETURNS JSONB`:
    - returns `{"ajusteId": text}`;
    - errors: `NO_AUTORIZADO`, `MOTIVO_REQUERIDO`, `AJUSTE_NO_ENCONTRADO`, `AJUSTE_NO_MANUAL`, `AJUSTE_PAGADO`.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest"
import { readBySuffix, readByMarker, collapse, stripComments } from "./helpers/sql-text"

const mig = () => collapse(readBySuffix("_comisiones_ajustes_manuales.sql"))
const m378 = () => collapse(readBySuffix("_comisiones_pagar_rpc.sql"))
const rb = () => readByMarker("rollback", "Rollback of comisiones_ajustes_manuales")
const probes = () => readByMarker("verify", "Verification of comisiones_ajustes_manuales")
const sync = (s: string) => s.slice(s.indexOf("CREATE OR REPLACE FUNCTION comisiones_sincronizar_flags("), s.indexOf("REVOKE EXECUTE ON FUNCTION comisiones_sincronizar_flags("))
const del = () => mig().slice(mig().indexOf("CREATE OR REPLACE FUNCTION eliminar_ajuste_comision("))

describe("383: hygiene", () => {
  it("lock_timeout first, no transaction, aborts when a manual item was already paid", () => {
    expect(mig().startsWith("SET LOCAL lock_timeout = '3s';")).toBe(true)
    expect(stripComments(readBySuffix("_comisiones_ajustes_manuales.sql"))).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im)
    expect(mig().indexOf("Abort: hay ajustes manuales pagados")).toBeLessThan(mig().indexOf("CREATE OR REPLACE FUNCTION"))
    expect(mig().indexOf("Abort: hay documentos marcados como pagados sin pago registrado")).toBeLessThan(mig().indexOf("CREATE OR REPLACE FUNCTION"))
  })
})
describe("383: legacy flags ignore manual adjustments", () => {
  it("both branches skip AJUSTE_MANUAL, and nothing else differs from 378", () => {
    expect(sync(mig()).match(/AND i\.tipo <> 'AJUSTE_MANUAL'/g)).toHaveLength(2)
    expect(sync(mig()).replace(/ AND i\.tipo <> 'AJUSTE_MANUAL'/g, "")).toBe(sync(m378()))
  })
})
describe("383: eliminar_ajuste_comision", () => {
  it("admin, reason, payout lock, row by id and org, manual only, unpaid only, then delete and audit", () => {
    const s = del(), at = (k: string) => s.indexOf(k)
    const order = ["COMISION_ERROR:NO_AUTORIZADO", "COMISION_ERROR:MOTIVO_REQUERIDO",
      "PERFORM pg_advisory_xact_lock(hashtext('comisiones:' || p_organization_id))",
      "WHERE id = p_ajuste_id AND organization_id = p_organization_id FOR UPDATE", "COMISION_ERROR:AJUSTE_NO_MANUAL",
      "COMISION_ERROR:AJUSTE_PAGADO", "DELETE FROM comisiones_ajustes", "INSERT INTO audit_logs"]
    order.forEach((k, i) => { expect(at(k)).toBeGreaterThan(-1); if (i) expect(at(order[i - 1])).toBeLessThan(at(k)) })
    expect(s).toContain("i.tipo = 'AJUSTE_MANUAL' AND i.ajuste_ref = p_ajuste_id AND NOT i.anulado")
    expect(s.slice(0, s.indexOf("REVOKE"))).not.toMatch(/SECURITY DEFINER/)
    expect(mig()).toContain("GRANT EXECUTE ON FUNCTION eliminar_ajuste_comision(TEXT, TEXT, TEXT, TEXT) TO service_role")
  })
})
describe("383: rollback and probes", () => {
  it("rollback restores 378's sync verbatim and drops the new function, without 378's marker", () => {
    expect(sync(collapse(rb()))).toBe(sync(m378()))
    expect(collapse(rb())).toContain("DROP FUNCTION IF EXISTS eliminar_ajuste_comision(TEXT, TEXT, TEXT, TEXT)")
    expect(rb()).not.toContain("Rollback of comisiones_pagar_rpc")
  })
  it("probes: synthetic org, roll back, own table, every case", () => {
    const s = stripComments(probes())
    expect(s).toMatch(/^\s*BEGIN\s*;/m); expect(s.trimEnd().endsWith("ROLLBACK;")).toBe(true)
    expect(s).toContain("CREATE TEMP TABLE _r383"); expect(s).toContain("'org-probe-383'")
    const calls = s.split("SET LOCAL ROLE service_role;").slice(1)
    expect(calls.length).toBeGreaterThan(0); for (const c of calls) expect(c).toContain("RESET ROLE;")
    expect(collapse(s)).toContain("EXCEPTION WHEN OTHERS THEN RESET ROLE;")
    for (let i = 0; i <= 7; i++) expect(probes()).toContain(`U${i}`)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run __tests__/comisiones-ajustes-manuales-migration.test.ts`
Expected: FAIL with `No file in supabase/migrations/ matches suffix "_comisiones_ajustes_manuales.sql"`

- [ ] **Step 3: Write 383, its rollback and probes.**
  - **Migration.**
    - The header explains the flag gap (see "Facts verified").
    - The `DO` guard raises `'Abort: hay ajustes manuales pagados; re-sincronizar sus documentos antes de 383'` when any live item has `tipo = 'AJUSTE_MANUAL'`. Nothing could have paid one before this slice's routes ship, so the guard should never fire.
    - A second guard raises `'Abort: hay documentos marcados como pagados sin pago registrado; revisar el backfill antes de 383'` when a sale (order) has `comision_pagada` true and no live item in the `VENDEDOR` (`TECNICO`) role. Why: 378's legacy-paid check (378:213-223) treats "flag true and no live item in the role" as paid outside the system. Once a doc-linked manual item can be paid, that document would either lose its flag in the sync (this fix) or pass the check (378 as is), and its `ORIGINAL` row could be paid twice. The slice 1 backfill gave every flagged document an item and no app code writes the flag any more (only RPCs), so the count must be 0, and this guard keeps it a precondition instead of an assumption.
    - 378's function is copied with the two predicates added, REVOKE/GRANT restated.
  - **`eliminar_ajuste_comision`:**
    1. ADMIN check, the same as 378.
    2. A blank reason raises `MOTIVO_REQUERIDO`.
    3. The lock.
    4. `SELECT * INTO v_aj FROM comisiones_ajustes WHERE id = p_ajuste_id AND organization_id = p_organization_id FOR UPDATE`; not found raises `AJUSTE_NO_ENCONTRADO`.
    5. `origen <> 'MANUAL'` raises `AJUSTE_NO_MANUAL`.
    6. A live item (`organization_id` plus the pinned predicate) raises `AJUSTE_PAGADO`.
    7. `DELETE`.
    8. `INSERT INTO audit_logs`: `action 'DELETE'`, `entity 'comisiones_ajustes'`, `changes = {before: to_jsonb(v_aj), motivo: btrim(p_motivo)}`, description `'Eliminó un ajuste de comisión: ' || btrim(p_motivo)`.
  - **Rollback** (marker `Rollback of comisiones_ajustes_manuales`): 378's function verbatim, plus the `DROP FUNCTION`.
  - **Probes** (marker `Verification of comisiones_ajustes_manuales`). The fixture is `org-probe-383` with an admin, seller A at 5%, and an unpaid sale S of 10000 (row 500.00).

  | Probe | Setup | Expected |
  |---|---|---|
  | U0 | real data | live `AJUSTE_MANUAL` items = 0; flagged documents without a live item in their legacy role = 0 |
  | U1 | MANUAL +100 linked to S; pay only that row; then pay S's `ORIGINAL`; then annul the `ORIGINAL` payout | `ventas.comision_pagada` is false, then true, then false (the manual item is still live) |
  | U2 | MANUAL −50 with no document, paid together with S's +500 | key `-:-:VENDEDOR:AJUSTE_MANUAL:<id>`; payout total 450.00 |
  | U3 | delete an unpaid MANUAL | its row is gone from the table and from `v_comisiones_filas`; one audit row with `before.monto` and `motivo` |
  | U4 | delete a paid MANUAL; annul its payout; delete again | `AJUSTE_PAGADO`, then ok |
  | U5 | a `CAMBIO_TASA` row inserted by the fixture | `AJUSTE_NO_MANUAL` |
  | U6 | another org's adjustment id; a non-admin caller; a blank reason | `AJUSTE_NO_ENCONTRADO`, `NO_AUTORIZADO`, `MOTIVO_REQUERIDO` |
  | U7 | privileges | both functions are invoker and executable only by service_role |

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run __tests__/comisiones-ajustes-manuales-migration.test.ts`, then `./node_modules/.bin/vitest run __tests__/comisiones-pagar-rpc-migration.test.ts`
Expected: PASS (378's own test untouched and green)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/383_comisiones_ajustes_manuales.sql supabase/migrations/rollback/383_rollback.sql supabase/migrations/verify/383_probes.sql __tests__/comisiones-ajustes-manuales-migration.test.ts
git commit -m "feat(db): manual adjustments never mark a document paid and can be deleted while unpaid"
```

- [ ] **Step 6: Hand to the controller.** Dry-run 383 (it aborts if U0's count is not 0). With the user's OK, `--apply`, then dry-run `verify/383_probes.sql`.

---

### Task 4: Rate change API (PR B)

**Files:**
- Create: `lib/commissions/rate-change.ts`, `app/api/comisiones/tasas/route.ts`
- Modify: `lib/commissions/payouts.ts` (`CODE_MAP`), `lib/__tests__/comisiones-suscripciones-access-sweep.test.ts` (comisiones count `>= 14`: 8 today, 2 from slice 2, 4 from this slice)
- Test: `__tests__/lib/commissions-rate-change.test.ts`, `__tests__/api/comisiones-tasas.test.ts`

**Interfaces:**
- Consumes: Task 1's RPC and result JSON.
- Produces (`rate-change.ts`, client-safe):

```ts
export const rateChangeBodySchema: z.ZodType<RateChangeBody>
// { beneficiarioId: string; rol: CommissionRole; porcentaje: number | null (0..100 → round2);
//   desde: "YYYY-MM-DD" | null; incluirPagadas: boolean (default false); confirmar: boolean; huella: string | null (default null) }
// porcentaje null only for RECEPCION ("Indique el porcentaje."); confirmar && desde && !huella → "Revise el impacto antes de confirmar."
// range message "El porcentaje debe estar entre 0 y 100."; bad date "Fecha inválida."
export interface RateChangeResult { aplicado: boolean; motivo: "VISTA_PREVIA_DESACTUALIZADA" | "SIN_CAMBIOS" | null; huella: string | null
  porcentajeAnterior: number | null; porcentajeNuevo: number | null; porcentajeDocumentos: number; desde: string | null
  pendientes: { documentos: number; diferencia: number; compensaciones: number }
  pagadas: { documentos: number; diferencia: number; detalle: RatePaidDetail[] }
  ajustes: number; documentosReescritos: number }
export interface RatePaidDetail { documentoId: string; documentoNumero: number | null; documentoCodigo: string | null; fecha: string; pagado: number; diferencia: number }
export const rateChangeResultSchema: z.ZodType<RateChangeResult>
export const RATE_CONCEPT_LABEL: Record<CommissionRole, string> // VENDEDOR "Ventas", TECNICO "Reparaciones como técnico", RECEPCION "Recepción de equipos"
export const RATE_DOC_NOUN: Record<CommissionRole, { uno: string; varios: string }> // venta/ventas; orden/órdenes (both order roles)
export const RATE_STALE_MESSAGE = "Los datos cambiaron desde la vista previa (por ejemplo, se pagó una comisión). Revise el impacto actualizado y confirme de nuevo."
```

- **POST `/api/comisiones/tasas`:**
  - `requireAdmin`; the body is parsed with `rateChangeBodySchema`, and a zod error gives 400 with the first message.
  - Calls `supabaseAdmin.rpc("cambiar_tasa_comision", { p_organization_id, p_usuario_id, p_beneficiario_id, p_rol, p_porcentaje, p_desde, p_incluir_pagadas, p_confirmar, p_huella })`.
  - An RPC error goes through `commissionRpcError`. Unmapped errors give 500 `No se pudo cambiar el porcentaje`.
  - The data is parsed with `rateChangeResultSchema`; a parse failure gives 500.
  - `motivo === "VISTA_PREVIA_DESACTUALIZADA"` gives 409 `{ error: RATE_STALE_MESSAGE, resultado }`. Anything else gives 200 with the result.
  - Every response has `Cache-Control: no-store`.
- **`CODE_MAP` additions:**

  | Code | Status | Message |
  |---|---|---|
  | `ROL_INVALIDO` | 400 | Concepto inválido. |
  | `PORCENTAJE_INVALIDO` | 400 | El porcentaje debe estar entre 0 y 100. |
  | `FECHA_FUTURA` | 400 | La fecha no puede ser posterior a hoy. |
  | `HUELLA_REQUERIDA` | 400 | Revise el impacto antes de confirmar. |

- [ ] **Step 1: Write the failing tests**

```ts
// __tests__/lib/commissions-rate-change.test.ts — @vitest-environment node
it("porcentaje may be null only for reception, rounds to cents, stays within 0..100", () => {
  const ok = { beneficiarioId: "a1", rol: "VENDEDOR", porcentaje: 5.555, desde: null, confirmar: false }
  expect(rateChangeBodySchema.parse(ok).porcentaje).toBe(5.56)
  expect(rateChangeBodySchema.safeParse({ ...ok, porcentaje: null }).success).toBe(false)
  expect(rateChangeBodySchema.safeParse({ ...ok, rol: "RECEPCION", porcentaje: null }).success).toBe(true)
  expect(rateChangeBodySchema.safeParse({ ...ok, porcentaje: 101 }).error!.issues[0].message).toBe("El porcentaje debe estar entre 0 y 100.")
})
it("confirming from a date needs the preview's fingerprint", () => {
  const b = { beneficiarioId: "a1", rol: "VENDEDOR", porcentaje: 5, desde: "2026-09-01", confirmar: true }
  expect(rateChangeBodySchema.safeParse(b).error!.issues[0].message).toBe("Revise el impacto antes de confirmar.")
  expect(rateChangeBodySchema.safeParse({ ...b, huella: "h1" }).success).toBe(true)
  expect(rateChangeBodySchema.safeParse({ ...b, desde: "01/09/2026", huella: "h1" }).success).toBe(false)
})

// __tests__/api/comisiones-tasas.test.ts — @vitest-environment node
it("non-admins get 403 and the RPC is never called", async () => { /* mockAuthSuccess({ role: "VENDEDOR" }) → 403; rpc not called */ })
it("a preview passes every argument to the RPC and returns its result", async () => {
  // rpc resolves { data: resultado({ huella: "h1", pagadas: { documentos: 2, diferencia: 945, detalle: [] } }), error: null }
  expect(supabaseAdmin.rpc).toHaveBeenCalledWith("cambiar_tasa_comision", { p_organization_id: "org-1", p_usuario_id: "admin-1",
    p_beneficiario_id: "a1", p_rol: "VENDEDOR", p_porcentaje: 5, p_desde: "2026-09-01", p_incluir_pagadas: false, p_confirmar: false, p_huella: null })
  expect(res.status).toBe(200); expect(body.pagadas.diferencia).toBe(945)
})
it("a stale confirm is a 409 carrying the fresh preview", async () => { /* rpc data motivo VISTA_PREVIA_DESACTUALIZADA → 409, body.error === RATE_STALE_MESSAGE, body.resultado.pagadas.documentos === 3 */ })
it("SIN_CAMBIOS is a 200 with aplicado false", async () => { /* … */ })
it.each([["FECHA_FUTURA", 400, "La fecha no puede ser posterior a hoy."], ["BENEFICIARIO_NO_ENCONTRADO", 404, "La persona no existe en este taller."]])(
  "maps %s", async (code, status, msg) => { /* rpc error { message: `COMISION_ERROR:${code}` } → status, body.error === msg */ })
it("an unexpected RPC error or an unparseable result is a 500", async () => { /* … */ })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./node_modules/.bin/vitest run __tests__/lib/commissions-rate-change.test.ts`
Run: `./node_modules/.bin/vitest run __tests__/api/comisiones-tasas.test.ts`
Expected: FAIL with `Failed to resolve import "@/lib/commissions/rate-change"`

- [ ] **Step 3: Implement** `rate-change.ts`, the route and the four `CODE_MAP` rows, then raise the access sweep's count.

- [ ] **Step 4: Run tests and typecheck**

Run: both commands of Step 2, `./node_modules/.bin/vitest run lib/__tests__/comisiones-suscripciones-access-sweep.test.ts`, `./node_modules/.bin/vitest run __tests__/lib/commissions-payouts.test.ts`, `./node_modules/.bin/tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/commissions/rate-change.ts app/api/comisiones/tasas/route.ts lib/commissions/payouts.ts lib/__tests__/comisiones-suscripciones-access-sweep.test.ts __tests__/lib/commissions-rate-change.test.ts __tests__/api/comisiones-tasas.test.ts
git commit -m "feat(comisiones): admin route to preview and confirm a rate change"
```

---

### Task 5: Manual adjustments API (PR B)

**Files:**
- Create: `lib/commissions/adjustments.ts`, `app/api/comisiones/ajustes/route.ts`, `app/api/comisiones/ajustes/[id]/route.ts`
- Modify: `lib/audit.ts` (`AuditEntity` gains `"comisiones_ajustes"`; `ENTITY_DISPLAY` gains "ajuste de comisión"), `lib/commissions/payouts.ts` (`CODE_MAP`)
- Test: `__tests__/lib/commissions-adjustments.test.ts`, `__tests__/api/comisiones-ajustes.test.ts`

**Interfaces:**
- Consumes: Task 3's RPC; the `v_comisiones_filas` columns `ajuste_ref`, `pagado`, `fecha_pago`, `documento_numero`, `documento_codigo`; `traerTodas`.
- Produces (`adjustments.ts`, client-safe):

```ts
export type AdjustmentOrigin = "MANUAL" | "CAMBIO_TASA"
export const ADJUSTMENT_ORIGIN_LABEL: Record<AdjustmentOrigin, string> // { MANUAL: "Manual", CAMBIO_TASA: "Cambio de porcentaje" }
export const newAdjustmentSchema // { beneficiarioId: string; rol: CommissionRole; monto: number → round2, ≠ 0 ("El monto no puede ser 0."), |monto| < 1e10;
                                 //   motivo: trim 1..500 ("Indique el motivo del ajuste."); documento: trim ≤ 40 | null (default null) }
export const deleteAdjustmentSchema // { motivo: trim 1..500 ("Indique el motivo.") }
export interface AdjustmentItem { id: string; beneficiarioId: string; beneficiarioNombre: string; rol: CommissionRole
  documentoTipo: CommissionDocType | null; documentoId: string | null; documentoNumero: number | null; documentoCodigo: string | null
  monto: number; motivo: string; origen: AdjustmentOrigin; creadoPorNombre: string; creadoEl: string
  pagado: boolean; fechaPago: string | null }
```

- **GET `/api/comisiones/ajustes?beneficiarioId=&origen=MANUAL|CAMBIO_TASA|todos&estado=pendiente|pagado|todos`:**
  - `requireAdmin`; an unknown `origen` or `estado` gives 400.
  - Reads `comisiones_ajustes` (org, optional person and origin; `created_at` descending, then `id`) and `v_comisiones_filas` (org, `tipo = 'AJUSTE_MANUAL'`, optional person), both with `traerTodas`.
  - Joins them in memory on `ajuste_ref = id`, then applies `estado`.
  - Names come from `users` with `.in("id", people and creators)` and `.eq("organization_id", ...)`.
  - Returns `{ items: AdjustmentItem[] }` with `no-store`.
- **POST `/api/comisiones/ajustes`:**
  - `requireAdmin`, then `newAdjustmentSchema`.
  - The beneficiary must be in the org, else 404 `La persona no existe en este taller.`
  - **`documento`:**
    - `VENDEDOR`: digits only, else 400 `Indique el número de venta.`; then `ventas.numero_venta`.
    - Order roles: digits mean `numero_orden`; anything else means `codigo_orden = documento.toUpperCase()`.
    - Every lookup filters `organization_id`. A miss gives 404 `No existe la venta N.º 12.` or `No existe la orden CEL-001.`
  - Inserts `origen 'MANUAL'`, `created_by` the caller.
  - Writes `createAuditLogger(org, user, request).create("comisiones_ajustes", id, { beneficiario_id, rol, monto, motivo, documento_tipo, documento_id, origen })`.
  - Returns 201 `{ id }`.
- **DELETE `/api/comisiones/ajustes/[id]`:**
  - `requireAdmin`, then `deleteAdjustmentSchema`.
  - Calls `rpc("eliminar_ajuste_comision", { p_organization_id, p_usuario_id, p_ajuste_id, p_motivo })`, mapped through `commissionRpcError`.
  - Returns 200 `{ ajusteId }`.
- **`CODE_MAP` additions:**

  | Code | Status | Message |
  |---|---|---|
  | `AJUSTE_NO_ENCONTRADO` | 404 | Ajuste no encontrado. |
  | `AJUSTE_PAGADO` | 409 | Este ajuste ya se pagó y no se puede eliminar. Para corregirlo, cargue un ajuste en sentido contrario o anule el pago primero. |
  | `AJUSTE_NO_MANUAL` | 409 | Los ajustes por cambio de porcentaje no se eliminan: vuelva a aplicar el cambio de porcentaje con el valor correcto. |

- [ ] **Step 1: Write the failing tests**

```ts
// commissions-adjustments.test.ts — @vitest-environment node
it.each([0, -0, 0.004])("an amount that rounds to 0 (%s) is refused", (monto) => {
  expect(newAdjustmentSchema.safeParse({ ...ok, monto }).error!.issues[0].message).toBe("El monto no puede ser 0.")
})
it("rounds to cents, keeps the sign, requires a reason", () => {
  expect(newAdjustmentSchema.parse({ ...ok, monto: -120.555 }).monto).toBe(-120.56)
  expect(newAdjustmentSchema.safeParse({ ...ok, motivo: "  " }).error!.issues[0].message).toBe("Indique el motivo del ajuste.")
})

// comisiones-ajustes.test.ts — @vitest-environment node
it("non-admins get 403 on GET, POST and DELETE and nothing is written", async () => { /* mem.escrituras [] */ })
it("GET joins the paid state from the definition and never reads another org", async () => {
  // comisiones_ajustes: aj1 org-1 MANUAL +100, aj2 org-1 CAMBIO_TASA 495, aj3 org-2; v_comisiones_filas: ajuste_ref aj2 pagado true fecha_pago "2026-10-01"
  expect(body.items.map((i) => [i.id, i.pagado])).toEqual([["aj2", true], ["aj1", false]])
  // ?estado=pendiente → only aj1; ?origen=CAMBIO_TASA → only aj2
})
it("POST resolves the sale number in the caller's org, inserts MANUAL, audits", async () => {
  // ventas: v12 org-1 numero_venta 12; v12b org-2 numero_venta 12
  // body { beneficiarioId: "a1", rol: "VENDEDOR", monto: -50, motivo: "Faltante de caja", documento: "12" }
  expect(insertOf("comisiones_ajustes")).toMatchObject({ organization_id: "org-1", documento_tipo: "VENTA", documento_id: "v12", monto: -50, origen: "MANUAL", created_by: "admin-1" })
  expect(insertOf("audit_logs")).toMatchObject({ entity: "comisiones_ajustes", action: "CREATE" })
})
it("POST finds an order by code and answers 404 for an unknown document", async () => { /* "cel-001" → codigo CEL-001; "CEL-999" → 404 "No existe la orden CEL-999." */ })
it("DELETE passes the reason to the RPC and maps AJUSTE_PAGADO to 409", async () => { /* … */ })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./node_modules/.bin/vitest run __tests__/lib/commissions-adjustments.test.ts`
Run: `./node_modules/.bin/vitest run __tests__/api/comisiones-ajustes.test.ts`
Expected: FAIL with `Failed to resolve import "@/lib/commissions/adjustments"`

- [ ] **Step 3: Implement** the lib file, both routes, the audit entity and the three `CODE_MAP` rows.

- [ ] **Step 4: Run tests and typecheck**

Run: both commands of Step 2, `./node_modules/.bin/vitest run lib/__tests__/comisiones-suscripciones-access-sweep.test.ts`, `./node_modules/.bin/tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/commissions/adjustments.ts app/api/comisiones/ajustes lib/audit.ts lib/commissions/payouts.ts __tests__/lib/commissions-adjustments.test.ts __tests__/api/comisiones-ajustes.test.ts
git commit -m "feat(comisiones): admin API for manual commission adjustments"
```

---

### Task 6: Every rate writer leaves an audit row (PR B)

**Files:**
- Create: `lib/commissions/rate-audit.ts`
- Modify:
  - `app/api/vendedores/route.ts` (POST) and `app/api/vendedores/[id]/route.ts` (PUT: destructure `userId`; read `nombre, porcentaje_comision, porcentaje_comision_recepcion` in the existence check);
  - `app/api/tecnicos/route.ts` (POST) and `app/api/tecnicos/[id]/route.ts` (PUT, same reads);
  - `lib/audit.ts` (`FIELD_DISPLAY`: `porcentaje_comision` → "porcentaje de comisión", `porcentaje_comision_recepcion` → "porcentaje de recepción");
  - `lib/__tests__/comisiones-calculo-sweep.test.ts` (append).
- Test: `__tests__/api/tasas-auditoria.test.ts`

**Interfaces:**
- Produces:

```ts
export interface RateSnapshot { porcentaje_comision?: number | null; porcentaje_comision_recepcion?: number | null }
export async function auditRateChange(a: { organizationId: string; userId: string; request: Request
  personaId: string; personaNombre: string | null; antes: RateSnapshot | null; despues: RateSnapshot }): Promise<void>
// antes null → createAuditLogger(...).create("users", personaId, { nombre, ...despues });
// else → update("users", personaId, changedBefore, changedAfter) with only the keys whose value changed; nothing when none changed.
```

- Each of the four routes calls it after its successful write.
- **Calc sweep, new describe "rate writers leave an audit trail".** Comments are stripped first. Every file under `ROOTS` matching `/porcentaje_comision(_recepcion)?\s*(:|=(?!=))/` must be a key of exactly one of these maps:

  | Map | File | Must match |
  |---|---|---|
  | `PERSON_RATE_WRITERS` | `app/api/vendedores/route.ts`, `app/api/vendedores/[id]/route.ts`, `app/api/tecnicos/route.ts`, `app/api/tecnicos/[id]/route.ts` | `/\bauditRateChange\(/` |
  | `PERSON_RATE_WRITERS` | `app/api/usuarios/[id]/rol/route.ts` | `/porcentaje_comision_before/` |
  | `DOCUMENT_SNAPSHOT_WRITERS` | `app/api/ordenes/route.ts`, `app/api/ordenes/[id]/tomar/route.ts`, `app/api/tecnicos/[id]/reasignar/route.ts` | `null`: they copy the assigned technician's rate |
  | `DOCUMENT_SNAPSHOT_WRITERS` | `app/api/ordenes/[id]/route.ts` | `/audit\.update\("ordenes_servicio"/`: its diff audit logs the card's per-order % |

  A "listed files still exist and still write" check guards against stale entries.

- [ ] **Step 1: Write the failing tests**

```ts
// __tests__/api/tasas-auditoria.test.ts — @vitest-environment node (real lib/audit; montarSupabaseEnMemoria records the audit insert)
it.each([["PUT /api/vendedores/[id]", putVendedor], ["PUT /api/tecnicos/[id]", putTecnico]])("%s audits a rate change with before and after", async (_n, put) => {
  // users: p1 org-1 porcentaje_comision 0.5
  await put({ porcentajeComision: 5 })
  expect(auditInsert()).toMatchObject({ organization_id: "org-1", user_id: "admin-1", entity: "users", entity_id: "p1", action: "UPDATE",
    changes: { before: { porcentaje_comision: 0.5 }, after: { porcentaje_comision: 5 } } })
})
it("an edit that leaves the rates alone writes no audit row", async () => { /* put({ nombre: "Ana B" }) → no audit_logs insert */ })
it("POST records the starting rates", async () => { /* POST vendedores { porcentajeComision: 5 } → action CREATE, changes.after.porcentaje_comision 5 */ })
it("the role change keeps auditing the shared rate", async () => { /* PATCH usuarios/[id]/rol → changes.porcentaje_comision_before / _after */ })

// comisiones-calculo-sweep.test.ts (append)
it("every file that writes a rate column is classified", () => { /* found === union of both maps' keys */ })
it("person-rate writers leave an audit row", () => { /* each PERSON_RATE_WRITERS source matches its regex */ })
it("the classified files still exist and still write a rate", () => { /* no stale entry */ })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./node_modules/.bin/vitest run __tests__/api/tasas-auditoria.test.ts`
Run: `./node_modules/.bin/vitest run lib/__tests__/comisiones-calculo-sweep.test.ts`
Expected: FAIL (no audit insert; four writers missing `auditRateChange`)

- [ ] **Step 3: Implement** the helper and the four calls.

- [ ] **Step 4: Run tests and typecheck**

Run: both commands of Step 2, `./node_modules/.bin/vitest run __tests__/api/tasas-recepcion.test.ts`, `./node_modules/.bin/vitest run __tests__/api/usuarios-cambio-de-rol.test.ts`, `./node_modules/.bin/tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/commissions/rate-audit.ts app/api/vendedores app/api/tecnicos/route.ts "app/api/tecnicos/[id]/route.ts" lib/audit.ts lib/__tests__/comisiones-calculo-sweep.test.ts __tests__/api/tasas-auditoria.test.ts
git commit -m "feat(comisiones): every commission rate writer leaves an audit row"
```

---

### Task 7: Rate hint and the change dialog (PR C)

**Files:**
- Create: `lib/commissions/rate-hint.ts`, `components/comisiones/tasa-ayuda.tsx`, `components/comisiones/cambiar-tasa-dialog.tsx`
- Test: `__tests__/lib/commissions-rate-hint.test.ts`, `__tests__/components/cambiar-tasa-dialog.test.tsx`

**Interfaces:**
- Consumes: Task 4 (`RATE_CONCEPT_LABEL`, `RATE_DOC_NOUN`, `RATE_STALE_MESSAGE`, `RateChangeResult`, POST `/api/comisiones/tasas`).
- Produces:

```ts
// rate-hint.ts — client-safe. Not a commission of any document; never reads a rate column (calc sweep ignores it by rule).
export const RATE_EXAMPLE_BASE = 100000
export function parseRateInput(raw: string): number | null   // trims; one "," or "." as decimal separator; "" or non-numeric → null
export function rateExample(porcentaje: number): number      // round2(RATE_EXAMPLE_BASE * porcentaje / 100)
export function isSuspiciousRate(porcentaje: number): boolean // 0 < porcentaje < 1
// tasa-ayuda.tsx
export function TasaAyuda({ valor }: { valor: string }): JSX.Element | null
// cambiar-tasa-dialog.tsx
export function CambiarTasaDialog(props: { open: boolean; onOpenChange: (o: boolean) => void; persona: { id: string; nombre: string }
  rol: CommissionRole; porcentajeActual: number | null; onCambiado: (porcentajeNuevo: number | null) => void }): JSX.Element
```

- **`TasaAyuda`.** Renders nothing when `parseRateInput(valor)` is null. Otherwise:
  - the example line: `Ejemplo: sobre {fmt(100000)} de base, la comisión es {fmt(x)}.`, formatted with `useCurrency()`;
  - when the value is suspicious, a warning with `role="status"`: `Es menos del 1 %. Revise que esté en porcentaje: para un 5 %, escriba 5 (no 0,05).` It warns and never blocks.
- **Dialog behaviour:**
  - **The input** is a text field with `inputMode="decimal"`, and `TasaAyuda` sits under it.
  - **`RECEPCION`** adds the checkbox "Usar el porcentaje por defecto del taller", which sends `porcentaje: null`.
  - **Two radios:** "Desde hoy" (the default) and "Desde una fecha". The second shows a date input with `max` = today.
  - **"Desde una fecha":** once the rate and the date are valid, the dialog requests the preview (`confirmar: false`) 400 ms after the last change. The latest request wins.
  - **The preview shows:**
    - the pending line;
    - the netting note when `compensaciones > 0`;
    - the paid line and the `detalle` list;
    - the checkbox "Cargar la diferencia de las ya pagadas como ajustes", unchecked by default and shown only when `pagadas.documentos > 0`.
  - **"Confirmar cambio":**
    - It sends the preview's `huella`, the current `incluirPagadas`, and `confirmar: true`. For "Desde hoy" it sends `desde: null` and `huella: null`.
    - It is disabled while a request is in flight.
    - It is also disabled when the change would do nothing: same rate, no pending documents, no netting, and the box unticked or no paid differences.
  - **On 409:** replace the preview with `resultado`, show `RATE_STALE_MESSAGE`, keep the dialog open.
  - **`SIN_CAMBIOS`:** `toast.info("No hay cambios para aplicar.")`.
  - **Success:**
    - `toast.success("Porcentaje actualizado", { description })`.
    - The description lists the documents updated and the adjustments loaded. "Desde hoy" uses "Se aplica a las {ventas|órdenes} nuevas." instead.
    - Then `onCambiado(porcentajeNuevo)` and close.
- **Copy (exact):**

  | Part | Copy |
  |---|---|
  | Title | Cambiar porcentaje de comisión |
  | Description | `{RATE_CONCEPT_LABEL[rol]} · {persona.nombre}` |
  | Field | Nuevo porcentaje (%) |
  | Group | ¿Desde cuándo se aplica? |
  | "Desde hoy" help | `VENDEDOR`: Solo para ventas nuevas. Lo anterior no cambia. `TECNICO`: Solo para las órdenes que se le asignen desde ahora. Lo anterior no cambia. `RECEPCION`: Solo para los equipos que reciba desde ahora. Lo anterior no cambia. |
  | "Desde una fecha" help | `VENDEDOR`: También cambia sus ventas desde esa fecha. `TECNICO`: También cambia las órdenes que tiene asignadas desde esa fecha. `RECEPCION`: También cambia los equipos que recibió desde esa fecha. |
  | Pending line | Sin pagar: {n} {uno\|varios}. Diferencia: {±fmt}. — or — No hay {varios} sin pagar desde esa fecha. |
  | Netting note | Incluye {k} ajustes que compensan cambios de porcentaje anteriores. |
  | Paid line | Ya pagadas: {m} {uno\|varios}. Diferencia: {±fmt}. — or — No hay {varios} pagadas desde esa fecha. |
  | Paid help | Lo que ya se pagó no se modifica. Se carga un ajuste por cada una, pendiente de pago. |
  | Shared note, `VENDEDOR` | Este porcentaje es el mismo para ventas y para reparaciones como técnico: también se aplicará a las órdenes que se le asignen desde ahora. Las órdenes anteriores no cambian. |
  | Shared note, `TECNICO` | Este porcentaje es el mismo para reparaciones y para ventas: también se aplicará a sus ventas nuevas. Las ventas anteriores no cambian. |
  | Buttons | Cancelar · Confirmar cambio |

- [ ] **Step 1: Write the failing tests**

```ts
// commissions-rate-hint.test.ts
it.each([["0,05", 0.05], ["5", 5], [" 5,5 ", 5.5], ["0.5", 0.5], ["", null], ["abc", null], ["1,2,3", null]])("parseRateInput(%j) = %j", (r, v) => expect(parseRateInput(r)).toBe(v))
it("the example and the under-1% rule", () => {
  expect(rateExample(5)).toBe(5000); expect(rateExample(0.05)).toBe(50)
  expect([0.05, 0.5, 0.99].every(isSuspiciousRate)).toBe(true); expect([0, 1, 5, 100].some(isSuspiciousRate)).toBe(false)
})

// cambiar-tasa-dialog.test.tsx (fetch mocked; vi.useFakeTimers({ shouldAdvanceTime: true }); sonner mocked)
it("a comma rate shows the example and the warning", async () => { /* type "0,05" → /la comisión es/ and role status /Es menos del 1 %/ */ })
it("from today posts no date and no fingerprint", async () => {
  // type "5", click "Confirmar cambio"
  expect(body(0)).toEqual({ beneficiarioId: "a1", rol: "VENDEDOR", porcentaje: 5, desde: null, incluirPagadas: false, confirmar: true, huella: null })
})
it("from a date: preview splits unpaid and paid, then confirms with the fingerprint (acceptance numbers)", async () => {
  // preview → { …, huella: "h1", pendientes: { documentos: 0, diferencia: 0, compensaciones: 0 }, pagadas: { documentos: 2, diferencia: 945, detalle: [2 rows] } }
  expect(body(0)).toMatchObject({ porcentaje: 5, desde: "2026-09-01", confirmar: false })
  expect(await screen.findByText(/Ya pagadas: 2 ventas/)).toBeInTheDocument()
  expect(screen.getByText(/No hay ventas sin pagar desde esa fecha/)).toBeInTheDocument()
  const box = screen.getByRole("checkbox", { name: /Cargar la diferencia de las ya pagadas/ }); expect(box).not.toBeChecked()
  // tick, confirm → body(1) { …, incluirPagadas: true, confirmar: true, huella: "h1" }; toast.success("Porcentaje actualizado", …)
})
it("a 409 swaps in the fresh preview and keeps the dialog open", async () => { /* confirm → 409 { error, resultado: pagadas.documentos 3 } → /Ya pagadas: 3 ventas/ and RATE_STALE_MESSAGE visible */ })
it("double click on confirm sends one request", async () => { /* two clicks → fetch called once for confirm */ })
it("the shared-rate note shows for sales and technician, not for reception", () => { /* … */ })
it("reception can fall back to the shop default", async () => { /* tick "Usar el porcentaje por defecto del taller" → body porcentaje null */ })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./node_modules/.bin/vitest run __tests__/lib/commissions-rate-hint.test.ts`
Run: `./node_modules/.bin/vitest run __tests__/components/cambiar-tasa-dialog.test.tsx`
Expected: FAIL with unresolved imports

- [ ] **Step 3: Implement** the lib file and both components.

- [ ] **Step 4: Run tests and typecheck**

Run: both commands of Step 2, `./node_modules/.bin/vitest run lib/__tests__/comisiones-calculo-sweep.test.ts`, `./node_modules/.bin/tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/commissions/rate-hint.ts components/comisiones/tasa-ayuda.tsx components/comisiones/cambiar-tasa-dialog.tsx __tests__/lib/commissions-rate-hint.test.ts __tests__/components/cambiar-tasa-dialog.test.tsx
git commit -m "feat(comisiones): rate change dialog with impact preview and unit warning"
```

---

### Task 8: The forms ask "from when", and every rate input shows the example (PR C)

**Files:**
- Modify:
  - `components/vendedores/vendedor-form.tsx`, `components/tecnicos/tecnico-form.tsx`;
  - `components/configuracion/roles-permisos.tsx` (the `comision` input), `components/configuracion/comisiones-config.tsx` (slice 2: the default reception rate);
  - `__tests__/components/tasa-recepcion-forms.test.tsx` (slice 2: its edit-mode cases move to the read-only display), `__tests__/components/roles-permisos.test.tsx`, `__tests__/components/comisiones-config.test.tsx`.
- Test: `__tests__/components/tasa-formularios.test.tsx`

**Interfaces:**
- Consumes: Task 7 (`TasaAyuda`, `CambiarTasaDialog`).
- Produces:
  - **Create mode** (no `vendedor`/`tecnico` prop): the rate inputs stay as they are, each with `<TasaAyuda valor={...} />` under it.
  - **Edit mode:** each rate becomes a read-only row plus a "Cambiar" button that opens `CambiarTasaDialog` for that concept.
    - Rows: "Comisión por ventas" (`VENDEDOR`) and "Comisión por recepción" (`RECEPCION`) in the seller form; "Comisión como técnico" (`TECNICO`) and "Comisión por recepción" in the technician form.
    - Value: "5 %", or "Por defecto del taller" when the reception rate is NULL.
    - `onCambiado` updates the displayed value and calls the form's `onSuccess()`.
    - The edit-mode PUT body no longer carries `porcentajeComision` or `porcentajeComisionRecepcion`. The routes still accept them, audited (Task 6).
  - `roles-permisos` and `comisiones-config` render `<TasaAyuda>` under their rate inputs.

- [ ] **Step 1: Write the failing tests**

```ts
// tasa-formularios.test.tsx
it.each([["VendedorForm", renderVendedor], ["TecnicoForm", renderTecnico]])("%s create mode warns on 0.05", async (_n, render) => {
  render({}); await user.type(screen.getByLabelText(/comisión/i), "0.05"); expect(screen.getByRole("status")).toHaveTextContent("Es menos del 1 %")
})
it("seller edit mode: rates are read-only and «Cambiar» opens the dialog for that concept", async () => {
  renderVendedor({ vendedor: { id: "a1", nombre: "Ana", porcentajeComision: 5, porcentajeComisionRecepcion: null } })
  expect(screen.getByText("Por defecto del taller")).toBeInTheDocument()
  await user.click(screen.getAllByRole("button", { name: "Cambiar" })[0])
  expect(await screen.findByText("Ventas · Ana")).toBeInTheDocument()
})
it("edit-mode save sends no rate fields", async () => { /* submit → PUT body has neither porcentajeComision nor porcentajeComisionRecepcion */ })
// roles-permisos.test.tsx (append): typing 0.05 in "Comisión como …" shows /Es menos del 1 %/
// comisiones-config.test.tsx (append): the default reception rate shows /la comisión es/
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./node_modules/.bin/vitest run __tests__/components/tasa-formularios.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement** the edits in the four components and update slice 2's form test.

- [ ] **Step 4: Run tests and typecheck**

Run: `./node_modules/.bin/vitest run __tests__/components/tasa-formularios.test.tsx`, then the same for `__tests__/components/tasa-recepcion-forms.test.tsx`, `__tests__/components/roles-permisos.test.tsx`, `__tests__/components/comisiones-config.test.tsx`, then `./node_modules/.bin/tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add components/vendedores/vendedor-form.tsx components/tecnicos/tecnico-form.tsx components/configuracion/roles-permisos.tsx components/configuracion/comisiones-config.tsx __tests__/components/tasa-formularios.test.tsx __tests__/components/tasa-recepcion-forms.test.tsx __tests__/components/roles-permisos.test.tsx __tests__/components/comisiones-config.test.tsx
git commit -m "feat(comisiones): seller and technician forms change rates through the dated dialog"
```

---

### Task 9: The Ajustes tab (PR D)

**Files:**
- Create: `components/comisiones/ajustes-view.tsx`, `components/comisiones/nuevo-ajuste-dialog.tsx`, `components/comisiones/eliminar-ajuste-dialog.tsx`
- Modify: `app/(dashboard)/comisiones/page.tsx` (tabs Técnicos | Recepción | Vendedores | Ajustes; the description becomes "Liquidación de comisiones de técnicos, recepción y vendedores, y sus ajustes.")
- Test: `__tests__/components/comisiones-ajustes.test.tsx`

**Interfaces:**
- Consumes:
  - Task 5: GET/POST/DELETE, `AdjustmentItem`, `ADJUSTMENT_ORIGIN_LABEL`, `newAdjustmentSchema`;
  - Task 4: `RATE_CONCEPT_LABEL`;
  - slice 2: `COMMISSION_ROLE_LABEL`;
  - `/api/operadores` for the person picker.
- Produces:
  - `AjustesView()`: SWR key `/api/comisiones/ajustes?beneficiarioId=…&origen=…&estado=…`.
  - `NuevoAjusteDialog({ open, onOpenChange, onCreado })`.
  - `EliminarAjusteDialog({ ajuste, open, onOpenChange, onEliminado })`.
- **Behaviour:**
  - **Filters:** Persona (Todas), Origen (Todos / Manual / Cambio de porcentaje), Estado (Todos / Pendientes / Pagados).
  - **Columns:** Fecha · Persona · Concepto (`COMMISSION_ROLE_LABEL`) · Documento (`Venta #n` / order code / —) · Monto (signed) · Motivo · Origen badge · Estado ("Pendiente" / "Pagado el {fecha}") · Cargado por. A mobile card list carries the same data.
  - **"Eliminar"** appears only on `MANUAL` rows that are not paid.
  - **New adjustment:** the "Suma a favor de la persona" / "Resta" radio plus a positive amount make the sign. Concepto uses `RATE_CONCEPT_LABEL`. The document label changes with the concept: "N.º de venta (opcional)" for `VENDEDOR`, "N.º o código de orden (opcional)" for the order roles.
  - **Submit** is validated with `newAdjustmentSchema` before the POST, and disabled while saving.
- **Copy (exact):**

  | Part | Copy |
  |---|---|
  | Heading | Ajustes de comisiones |
  | Intro | Montos que se suman o se restan a lo que se le debe a una persona. Se pagan junto con las comisiones. |
  | Button | Nuevo ajuste |
  | Empty state | Sin ajustes · Los ajustes manuales y los que genera un cambio de porcentaje aparecen aquí. |
  | New dialog | Title "Nuevo ajuste"; help "El ajuste queda pendiente y se paga desde la pestaña del concepto elegido."; submit "Cargar ajuste"; toast "Ajuste cargado" |
  | Delete dialog | Title "Eliminar ajuste"; body "Solo se puede eliminar un ajuste que todavía no se pagó. Queda registrado en la auditoría con el motivo."; field "Motivo"; submit "Eliminar ajuste"; toast "Ajuste eliminado" |
  | Errors | the server's `error`, else "No se pudo guardar el ajuste" / "No se pudo eliminar el ajuste" |

- [ ] **Step 1: Write the failing test**

```ts
it("lists both origins with their state, and offers delete only on unpaid manual rows", async () => {
  // swr items: aj1 MANUAL pending +100; aj2 CAMBIO_TASA pending 495; aj3 MANUAL paid −50
  expect(screen.getAllByRole("button", { name: "Eliminar" })).toHaveLength(1)
  expect(screen.getByText("Cambio de porcentaje")).toBeInTheDocument(); expect(screen.getByText(/Pagado el/)).toBeInTheDocument()
})
it("a «Resta» adjustment posts a negative amount; one request on double click", async () => {
  // choose person a1, concept Ventas, "Resta", amount "50", document "12", reason "Faltante de caja", double-click "Cargar ajuste"
  expect(fetchCalls("/api/comisiones/ajustes", "POST")).toHaveLength(1)
  expect(lastBody()).toEqual({ beneficiarioId: "a1", rol: "VENDEDOR", monto: -50, motivo: "Faltante de caja", documento: "12" })
})
it("refuses an empty reason or a zero amount before calling the server", async () => { /* "El monto no puede ser 0." / "Indique el motivo del ajuste."; no fetch */ })
it("delete asks for a reason and shows the server's refusal", async () => { /* DELETE → 409 { error: "Este ajuste ya se pagó…" } → toast.error with it */ })
it("the page has an Ajustes tab", () => { /* render page → tab "Ajustes" */ })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run __tests__/components/comisiones-ajustes.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement** the three components and the tab.

- [ ] **Step 4: Run test and typecheck**

Run: `./node_modules/.bin/vitest run __tests__/components/comisiones-ajustes.test.tsx`, then `./node_modules/.bin/tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add components/comisiones/ajustes-view.tsx components/comisiones/nuevo-ajuste-dialog.tsx components/comisiones/eliminar-ajuste-dialog.tsx "app/(dashboard)/comisiones/page.tsx" __tests__/components/comisiones-ajustes.test.tsx
git commit -m "feat(comisiones): adjustments tab to load, review and delete manual adjustments"
```

---

### Task 10: Adjustment rows say what they are, on every list (PR D)

**Files:**
- Modify:
  - `lib/commissions/types.ts`, `lib/commissions/rows.ts`;
  - `app/api/comisiones/route.ts`, `app/api/comisiones/vendedores/route.ts`, `app/api/vendedores/[id]/comisiones/route.ts`;
  - `components/comisiones/comisiones-view.tsx`, `components/comisiones/comisiones-vendedores-view.tsx`, `components/tecnicos/tecnico-comisiones.tsx`, `components/vendedores/liquidar-comisiones-dialog.tsx`, `components/ordenes/orden-comision-card.tsx`.
- Test:
  - append to `__tests__/lib/commissions-rows.test.ts`, `__tests__/lib/commissions-labels.test.ts`, `__tests__/api/comisiones-lectura.test.ts`;
  - append to `__tests__/components/comisiones-vendedores-pago.test.tsx` and `__tests__/components/tecnico-comisiones-pago.test.tsx`.

**Interfaces:**
- **Row fields:** `CommissionRow` gains `ajusteOrigen: AdjustmentOrigin | null` and `ajusteMotivo: string | null`. `toCommissionRow` sets both to null.
- **Enrichment:** `export async function withAdjustmentInfo(organizationId: string, rows: CommissionRow[]): Promise<CommissionRow[]>` in `rows.ts`.
  - One `comisiones_ajustes` read with `.eq("organization_id")` and `.in("id", refs)`, in chunks of 200, only when `AJUSTE_MANUAL` rows exist.
  - `readCommissionRows` and `readDocumentCommissionRows` return enriched rows.
- **Label:** `commissionKindLabel(tipo, documentoTipo, ajusteOrigen?: AdjustmentOrigin | null)` (slice 2) returns "Cambio de %" for `AJUSTE_MANUAL` plus `CAMBIO_TASA`. Everything else is unchanged.
- **API items:** the three list APIs add `ajusteOrigen` and `ajusteMotivo` to each item. The order endpoint passes `CommissionRow` through as it is.
- **Components:**
  - The badge uses `commissionKindLabel(i.tipo, <doc type>, i.ajusteOrigen)`.
  - When `ajusteMotivo` is set, a muted line shows it under the document, on desktop and mobile.
- **CSV:** the technician CSV's "Orden" cell is `""` for a row without a document (it was `#null`).

- [ ] **Step 1: Write the failing tests**

```ts
// commissions-rows.test.ts (append)
it("enriches manual rows with origin and reason from the caller's org only", async () => {
  // v_comisiones_devengadas: one AJUSTE_MANUAL row ajuste_ref aj2; comisiones_ajustes: aj2 org-1 CAMBIO_TASA "Cambio de porcentaje…", aj2x org-2
  expect(rows[0]).toMatchObject({ ajusteOrigen: "CAMBIO_TASA", ajusteMotivo: expect.stringContaining("Cambio de porcentaje") })
})
it("reads no adjustments when there is no manual row", async () => { /* no comisiones_ajustes read recorded */ })
// commissions-labels.test.ts (append)
it("a rate-change adjustment is «Cambio de %»; a manual one stays «Ajuste»", () => {
  expect(commissionKindLabel("AJUSTE_MANUAL", "VENTA", "CAMBIO_TASA")).toBe("Cambio de %")
  expect(commissionKindLabel("AJUSTE_MANUAL", null, "MANUAL")).toBe("Ajuste")
})
// comisiones-lectura.test.ts (append): items carry ajusteOrigen and ajusteMotivo
// comisiones-vendedores-pago.test.tsx (append): a CAMBIO_TASA row shows the badge «Cambio de %» and its reason
// tecnico-comisiones-pago.test.tsx (append): the CSV row of a docless manual adjustment has an empty "Orden" cell, never "#null"
```

- [ ] **Step 2: Run tests to verify they fail**

Run each of: `./node_modules/.bin/vitest run __tests__/lib/commissions-rows.test.ts`, `__tests__/lib/commissions-labels.test.ts`, `__tests__/api/comisiones-lectura.test.ts`, `__tests__/components/comisiones-vendedores-pago.test.tsx`, `__tests__/components/tecnico-comisiones-pago.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement** the type, the reader, the three item mappers and the five components.

- [ ] **Step 4: Run tests and typecheck**

Run: the five commands of Step 2, plus `./node_modules/.bin/vitest run __tests__/components/comisiones-view-pago.test.tsx`, `./node_modules/.bin/vitest run __tests__/components/orden-comision-card.test.tsx`, `./node_modules/.bin/vitest run lib/__tests__/comisiones-calculo-sweep.test.ts`, `./node_modules/.bin/tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/commissions/types.ts lib/commissions/rows.ts app/api/comisiones/route.ts app/api/comisiones/vendedores/route.ts "app/api/vendedores/[id]/comisiones/route.ts" components/comisiones/comisiones-view.tsx components/comisiones/comisiones-vendedores-view.tsx components/tecnicos/tecnico-comisiones.tsx components/vendedores/liquidar-comisiones-dialog.tsx components/ordenes/orden-comision-card.tsx __tests__/lib/commissions-rows.test.ts __tests__/lib/commissions-labels.test.ts __tests__/api/comisiones-lectura.test.ts __tests__/components/comisiones-vendedores-pago.test.tsx __tests__/components/tecnico-comisiones-pago.test.tsx
git commit -m "feat(comisiones): commission lists show what each adjustment is and why"
```

---

## Self-review

- **Spec coverage.**
  - **The tool:** "from today" (person rate only), "from date X" (the spec's document dates in the shop's zone), and a preview split into pending and paid with counts and money (Tasks 1, 2, 4, 7).
  - **Confirm** rewrites unpaid snapshots in one transaction with `audit_logs` (Task 1). Paid rows stay closed. The optional per-document `CAMBIO_TASA` adjustments are dated at the change (Task 1, probes T1/T16).
  - **The acceptance case:** probe T1 plus the dialog test with the same numbers.
  - **The rate writers** audit (Task 6), and the change is offered from the forms (Task 8).
  - **Manual adjustments:** an ADMIN screen with a signed amount, a mandatory reason, an optional document and an audit row. They appear as `AJUSTE_MANUAL` rows and can be paid (Tasks 3, 5, 9; probes U1–U2).
  - **All roles:** probes T1 (sales), T10–T11 (technician) and T12 (reception).
- **Placeholders.** None. Each `/* … */` in a test is an arrange-and-assert written in words, with the exact expected values.
- **Type consistency.**
  - `RateChangeResult` keys match the RPC's JSON keys from Task 1.
  - `AdjustmentOrigin` (Task 5) is the type used in Task 10.
  - `CommissionRole` is the `rol` in Tasks 4, 5, 7 and 9.
  - Error codes match between the SQL (Tasks 1, 3) and `CODE_MAP` (Tasks 4, 5).
- **Numbers checked by hand.** See Task 2. T11: after the annulment the live row is 50 and the `CAMBIO_TASA` row is 50. After the re-run, 100 − 50 nets to 100 in total.
- **Calc sweep.**
  - The tool's only formula lives in SQL, on the frozen paid base, and a text test pins it to one occurrence.
  - Unpaid amounts are read from the definition before and after the rewrite. The TS layer computes nothing.
  - `rate-hint.ts` computes an illustrative example and never reads a rate column. It is not on the allowed list, because no document's commission is computed there.

---

## Calls I made in this plan (for the user to check)

1. **The preview is the confirm, rolled back.** One function does both. It rewrites inside a subtransaction, reads the definition, and rolls back unless it is a confirm whose fingerprint matches. The preview cannot drift from confirm, and no second formula exists for unpaid rows.
2. **A stale confirm is refused, not partially applied.** It gets 409 with the fresh preview, the same per-row rule the pay RPC follows. The admin sees the new numbers and confirms again.
3. **Difference for a paid document.**
   - Target = new rate × (paid base − bases of the post-payment return or credit-note rows). The target is 0 if the sale was annulled.
   - Current = the paid amount + those rows + earlier `CAMBIO_TASA` adjustments.
   - So the tool is idempotent and self-correcting: re-running it with the right rate fixes a wrong earlier run.
   - Gap until slice 5: a return or annulment that happens after a rate correction still claws back at the old rate, so the person keeps the corrected difference. Re-running the tool nets it.
4. **A quiet rewrite through a trigger `WHEN`, not `DISABLE TRIGGER`.** Only `ventas.updated_at` could move. A probe pins the list of UPDATE triggers, so a new one stops the rollout.
5. **The shared rate.**
   - Changing "Ventas" or "Reparaciones como técnico" writes `users.porcentaje_comision`, so both concepts change going forward (the spec's rule until slice 5).
   - "From date X" rewrites only the chosen concept's documents. The dialog says so.
6. **Reception "use the shop default" from a date** writes the default's current value into the documents, the same value the insert trigger would store.
7. **Deviation from the spec's literal flag rule.** The legacy `comision_pagada` ignores manual adjustments. Otherwise paying a bonus linked to a sale would mark the sale's commission paid and block editing the sale.
8. **Manual adjustments can be deleted while unpaid,** with a reason, under the payout lock, with the full row kept in `audit_logs`.
   - Once paid they are closed: the admin loads an opposite adjustment, or annuls the payout first.
   - `CAMBIO_TASA` rows cannot be deleted; re-running the tool corrects them.
   - Soft annulment was rejected because it needs a filter in the definition, and so a restatement of 381's view (two verbatim copies) in this slice.
9. **Edit forms change rates only through the dialog.** The PUT routes still accept rates (any other caller), and they audit them.
10. **The adjustment reason is shown to the person in "Mis comisiones" and in every list.**
11. **The order card's reception % stays read-only,** although slice 2 deferred it to this slice. A per-order change goes through a manual adjustment or the person tool.
12. **The tool accepts any user of the shop, including removed ones,** because their pending rows can still need a correction.
13. **383 refuses to apply while a document is flagged paid without a payout item.** With doc-linked manual items payable, such a document's `ORIGINAL` row could be paid twice (378's legacy-paid check counts any live item). The slice 1 backfill should make the count 0; if not, the backfill gap is fixed first.

---

## Review Workload Forecast

| Task | Content | Est. changed lines |
|---|---|---|
| 1 | 382: trigger, RPC, rollback, text test | ~420 |
| 2 | 382 probes and test | ~480 |
| 3 | 383: sync fix, delete RPC, rollback (378 copy ~65 verbatim), probes, test | ~520 |
| 4 | rate-change lib, route, error codes, sweep count, tests | ~340 |
| 5 | adjustments lib, three handlers, audit entity, tests | ~420 |
| 6 | audit helper, four writers, rate-writer sweep, tests | ~300 |
| 7 | rate hint, `TasaAyuda`, change dialog, tests | ~560 |
| 8 | two forms, two hint mounts, tests | ~260 |
| 9 | Ajustes tab, two dialogs, page, tests | ~620 |
| 10 | row enrichment, label, three APIs, five components, CSV fix, tests | ~240 |
| **Total** | | **~4,160** |

**PR split** (the same shape as slices 1 and 2: the DB PR first, then the app chain in one deploy):

| PR | Tasks | Est. lines | Notes |
|---|---|---|---|
| A — DB | 1–3 | ~1,420 | `size:exception`. SQL, text tests and probes; ~65 lines are a verbatim 378 copy. No effect until applied. Merges to main. |
| B — server | 4–6 | ~1,060 | `size:exception`. Feature branch `feat/comisiones-tasas`, PR 1 of the chain. |
| C — rate UI | 7–8 | ~820 | `size:exception`. Targets B. |
| D — adjustments UI | 9–10 | ~860 | `size:exception`. Targets C. |

**Rollout order** (the controller runs every DB step with the user's OK; dry-run first, then `--apply`):

0. **Slice 2 first.** Slice 2 must be fully rolled out first: 380 and 381 applied and its app chain deployed. 382 aborts without 380 and 381. The app PRs use slice 2's forms, config tab, `commissionKindLabel` and Recepción tab.
1. **Merge PR A** to main. It is SQL only.
2. **382:**
   - dry-run, which must end in ROLLBACK with no error;
   - `--apply`;
   - dry-run `verify/382_probes.sql`: all green. A T0 trigger mismatch stops here.
3. **383:**
   - dry-run, which aborts if a paid manual item exists or a flagged document has no payout item (both expected none);
   - `--apply`;
   - dry-run `verify/383_probes.sql`.
4. **Merge the app chain** (B → C → D) to main in one deploy.
5. **The acceptance case in production.** The shop does it, or the user with the shop's OK, in the app and never by SQL:
   1. In each affected seller's form, open "Cambiar" → "Comisión por ventas".
   2. Enter 5 and choose "Desde una fecha", with the date of that seller's first affected sale.
   3. The preview must show 0 unpaid and the paid sales with their differences.
   4. Tick "Cargar la diferencia de las ya pagadas como ajustes" and confirm.
   5. Pay the "Cambio de %" rows from the Vendedores tab.

   The PR states aggregate counts and money only.
