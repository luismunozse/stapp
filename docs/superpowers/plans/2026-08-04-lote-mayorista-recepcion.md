# Wholesale Batch (Lote) on Multi-Device Reception â€” Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add batch discount, a batch detail view, and single-charge batch delivery on top of the existing multi-device reception (`recepciones`) model.

**Architecture:** The reception stays a document; batch totals are always derived from member orders. A discount (`descuento_tipo`/`descuento_valor`) lives on `recepciones`. Batch delivery is one atomic Postgres RPC that transitions every member order `REPARADO â†’ ENTREGADO` and records prorated `cobros_orden` rows per order (so caja reconciliation and comisiones keep working untouched), driven by one API call from a single dialog.

**Tech Stack:** Next.js App Router (route handlers), Supabase/Postgres (plpgsql RPCs), Zod, Vitest (`__tests__/`), Playwright (`e2e/`).

**Spec:** `docs/superpowers/specs/2026-08-04-lote-mayorista-recepcion-design.md`

## Global Constraints

- **Sequencing gate:** `feat/recepcion-multiple` (migrations 278â€“279) and `feat/cobro-en-entrega` MUST be merged to `main` and their migrations applied before starting. Verify with `git log main --oneline` and stop if missing.
- Work on a new branch off fresh `main`: `feat/lote-mayorista`.
- Migration numbers are assigned at merge time (project convention). This plan uses `293_recepcion_descuento.sql` and `294_entregar_lote_recepcion.sql` (renumbered twice: 280/281 → 289/290 once 287/288 went to recepcion-multiple, then → 293/294 once 291/292 landed in main and were applied); before opening the PR, re-verify they are still the next free numbers.
- Migrations are applied manually: `node scripts/db-run.mjs supabase/migrations/<file>` (dry-run by default; pass its apply flag after reviewing output). Never assume a CI runner applies them.
- Feature gating reuses the existing flag key `recepcion_multiple` â€” no new flag, no org toggle. Server: `hasPlanFeature(organizationId, "recepcion_multiple")` â†’ 403 `{ error, code: "FEATURE_REQUIRED", feature: "recepcion_multiple" }`. Client: `useHasFeature("recepcion_multiple")`.
- Payments/charges require `role === "ADMIN"` (same as `POST /api/ordenes/[id]/cobros`).
- All estado changes go through the state machine (`lib/orden-state-machine.ts`); the batch RPC enforces `estado = 'REPARADO'` before setting `ENTREGADO` (mirrors `esTransicionValida`).
- Batch delivery v1 accepts ONE payment method for the whole batch. Multi-method split, sin-cobro flows, cuenta corriente, garantÃ­a capture, and delivery signatures stay on the existing per-order flow (spec: out of scope).
- UI copy in neutral Spanish (project convention); code identifiers and comments in English.
- Strict TDD: every task writes the failing test first. Unit/API: `npx vitest run <file>`. E2E: `npm run test:e2e`.
- Conventional commits, no AI attribution.

---

### Task 1: Batch math library (`lote-utils`)

**Files:**
- Create: `lib/lote-utils.ts`
- Test: `__tests__/lib/lote-utils.test.ts`

**Interfaces:**
- Consumes: nothing (pure functions).
- Produces (used by Tasks 3, 4, 6, 7, 8):
  - `type DescuentoTipo = "porcentaje" | "monto"`
  - `calcularTotalLote(subtotal: number, tipo: DescuentoTipo | null, valor: number | null): number`
  - `prorratearLote(montos: number[], totalCobrado: number): number[]`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/lote-utils.test.ts
import { describe, it, expect } from "vitest"
import { calcularTotalLote, prorratearLote } from "@/lib/lote-utils"

describe("calcularTotalLote", () => {
  it("returns subtotal when no discount", () => {
    expect(calcularTotalLote(1000, null, null)).toBe(1000)
  })
  it("applies percentage discount", () => {
    expect(calcularTotalLote(1000, "porcentaje", 10)).toBe(900)
  })
  it("applies fixed-amount discount", () => {
    expect(calcularTotalLote(1000, "monto", 250)).toBe(750)
  })
  it("floors at zero when discount exceeds subtotal", () => {
    expect(calcularTotalLote(1000, "monto", 1500)).toBe(0)
  })
  it("rounds percentage results to 2 decimals", () => {
    expect(calcularTotalLote(999.99, "porcentaje", 33)).toBe(669.99)
  })
  it("ignores non-positive discount values", () => {
    expect(calcularTotalLote(1000, "monto", 0)).toBe(1000)
  })
})

describe("prorratearLote", () => {
  it("returns proportional shares that sum exactly to the charged total", () => {
    const shares = prorratearLote([100, 200, 300], 540) // 10% off 600
    expect(shares).toEqual([90, 180, 270])
    expect(shares.reduce((a, b) => a + b, 0)).toBe(540)
  })
  it("assigns rounding remainder to the last order", () => {
    const shares = prorratearLote([100, 100, 100], 100)
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 2)
    expect(shares[0]).toBe(33.33)
    expect(shares[1]).toBe(33.33)
    expect(shares[2]).toBe(33.34)
  })
  it("returns zeros when subtotal is zero", () => {
    expect(prorratearLote([0, 0], 0)).toEqual([0, 0])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/lote-utils.test.ts`
Expected: FAIL â€” cannot resolve `@/lib/lote-utils`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/lote-utils.ts
export type DescuentoTipo = "porcentaje" | "monto"

const round2 = (n: number) => Math.round(n * 100) / 100

export function calcularTotalLote(
  subtotal: number,
  tipo: DescuentoTipo | null,
  valor: number | null
): number {
  if (!tipo || !valor || valor <= 0) return round2(subtotal)
  const descuento = tipo === "porcentaje" ? subtotal * (valor / 100) : valor
  return Math.max(0, round2(subtotal - descuento))
}

export function prorratearLote(montos: number[], totalCobrado: number): number[] {
  const subtotal = montos.reduce((a, b) => a + b, 0)
  if (subtotal <= 0 || montos.length === 0) return montos.map(() => 0)
  const shares = montos.map((m) => round2((m * totalCobrado) / subtotal))
  const acumulado = shares.reduce((a, b) => a + b, 0)
  const resto = round2(totalCobrado - acumulado)
  shares[shares.length - 1] = round2(shares[shares.length - 1] + resto)
  return shares
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/lote-utils.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/lote-utils.ts __tests__/lib/lote-utils.test.ts
git commit -m "feat(lotes): batch total and proration math for reception batches"
```

---

### Task 2: Discount columns on `recepciones`

**Files:**
- Create: `supabase/migrations/293_recepcion_descuento.sql`

**Interfaces:**
- Consumes: `recepciones` table (migration 278).
- Produces (read by Tasks 3, 4, 6): columns `recepciones.descuento_tipo TEXT`, `recepciones.descuento_valor NUMERIC(10,2)`.

- [ ] **Step 1: Write the migration**

```sql
-- 293_recepcion_descuento.sql
-- Batch discount negotiated for a multi-device reception.
-- Totals are always derived from member orders; only the discount is stored.
BEGIN;

ALTER TABLE recepciones
  ADD COLUMN IF NOT EXISTS descuento_tipo TEXT,
  ADD COLUMN IF NOT EXISTS descuento_valor NUMERIC(10,2);

ALTER TABLE recepciones DROP CONSTRAINT IF EXISTS recepciones_descuento_check;
-- NULL-safe: every clause is guarded so no branch can evaluate to NULL (CHECK only rejects FALSE).
ALTER TABLE recepciones ADD CONSTRAINT recepciones_descuento_check CHECK (
  (descuento_tipo IS NULL) = (descuento_valor IS NULL)
  AND (descuento_tipo IS NULL OR descuento_tipo IN ('monto', 'porcentaje'))
  AND (descuento_valor IS NULL OR descuento_valor > 0)
  AND (descuento_tipo IS DISTINCT FROM 'porcentaje' OR descuento_valor <= 100)
);

COMMENT ON COLUMN recepciones.descuento_tipo IS 'porcentaje | monto. NULL = sin descuento de lote';

COMMIT;
```

- [ ] **Step 2: Dry-run and apply**

Run: `node scripts/db-run.mjs supabase/migrations/293_recepcion_descuento.sql` (review dry-run output, then re-run with the apply flag the script prints).
Expected: `ALTER TABLE` succeeds; verify with a follow-up dry-run showing no pending changes.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/293_recepcion_descuento.sql
git commit -m "feat(db): batch discount columns on recepciones"
```

---

### Task 3: `GET /api/recepciones/[id]` â€” batch detail with derived totals

**Files:**
- Create: `app/api/recepciones/[id]/route.ts`
- Test: `__tests__/api/recepcion-detalle.test.ts`

**Interfaces:**
- Consumes: `requireAuth()` from `lib/auth-utils.ts`; `hasPlanFeature` from `lib/subscriptions.ts`; `calcularTotalLote` from Task 1; columns from Task 2.
- Produces (consumed by Tasks 4, 7, 8): response shape

```ts
type RecepcionDetalleResponse = {
  recepcion: {
    id: string; numero: number; codigo: string
    clienteId: string; clienteNombre: string
    descuentoTipo: "porcentaje" | "monto" | null
    descuentoValor: number | null
    observaciones: string | null; createdAt: string
  }
  ordenes: Array<{
    id: string; numeroOrden: number; codigoOrden: string | null
    dispositivo: string; marca: string | null; estado: string
    presupuesto: number | null; costoFinal: number | null
  }>
  totales: {
    subtotal: number          // sum of costo_final ?? presupuesto ?? 0
    totalLote: number         // calcularTotalLote(subtotal, tipo, valor)
    entregadas: number        // count of estado in ENTREGADO/ENTREGADO_SIN_REPARACION/ENTREGADO_SIN_COBRO
    pendientes: number
  }
}
```

- [ ] **Step 1: Write the failing test**

Follow the structure of `__tests__/api/recepcion-multiple-gate.test.ts` (same mocks: `vi.mock("@/lib/subscriptions")`, `vi.mock("@/lib/auth-utils")`, shared `mockAuthSuccess` / `parseResponse` helpers from `__tests__/api/helpers`; mock the Supabase admin client's chained `.from().select()` calls to return fixture rows). Cases:

```ts
// __tests__/api/recepcion-detalle.test.ts â€” test cases (adapt mocks to helpers file):
// 1. returns 403 FEATURE_REQUIRED when hasPlanFeature resolves false
// 2. returns 404 when recepcion does not belong to the org
// 3. returns recepcion + ordenes + totales with:
//    - subtotal = sum(costo_final ?? presupuesto ?? 0) over member orders
//    - totalLote honoring descuento_tipo/valor ("porcentaje" 10 over 600 â†’ 540)
//    - entregadas/pendientes counts split by ENTREGADO* estados
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/api/recepcion-detalle.test.ts`
Expected: FAIL â€” route module does not exist.

- [ ] **Step 3: Implement the route**

```ts
// app/api/recepciones/[id]/route.ts
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { hasPlanFeature } from "@/lib/subscriptions"
import { supabaseAdmin } from "@/lib/supabase" // match the import used in app/api/recepciones/route.ts
import { calcularTotalLote, type DescuentoTipo } from "@/lib/lote-utils"

const FEATURE_KEY = "recepcion_multiple"
const ESTADOS_ENTREGADOS = ["ENTREGADO", "ENTREGADO_SIN_REPARACION", "ENTREGADO_SIN_COBRO"]

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { error, organizationId } = await requireAuth()
  if (error) return error

  if (!(await hasPlanFeature(organizationId!, FEATURE_KEY))) {
    return NextResponse.json(
      { error: "La recepcion de varios equipos esta disponible en el plan Profesional",
        code: "FEATURE_REQUIRED", feature: FEATURE_KEY },
      { status: 403 }
    )
  }

  const { data: recepcion } = await supabaseAdmin
    .from("recepciones")
    .select("id, numero, codigo, cliente_id, descuento_tipo, descuento_valor, observaciones, created_at, clientes(nombre)")
    .eq("id", id)
    .eq("organization_id", organizationId!)
    .single()
  if (!recepcion) {
    return NextResponse.json({ error: "Recepcion no encontrada" }, { status: 404 })
  }

  const { data: ordenes } = await supabaseAdmin
    .from("ordenes_servicio")
    .select("id, numero_orden, codigo_orden, dispositivo, marca, estado, presupuesto, costo_final")
    .eq("recepcion_id", id)
    .eq("organization_id", organizationId!)
    .order("numero_orden", { ascending: true })

  const lista = ordenes ?? []
  const subtotal = lista.reduce((acc, o) => acc + Number(o.costo_final ?? o.presupuesto ?? 0), 0)
  const totalLote = calcularTotalLote(
    subtotal,
    (recepcion.descuento_tipo as DescuentoTipo | null) ?? null,
    recepcion.descuento_valor != null ? Number(recepcion.descuento_valor) : null
  )
  const entregadas = lista.filter((o) => ESTADOS_ENTREGADOS.includes(o.estado)).length

  return NextResponse.json({
    recepcion: {
      id: recepcion.id, numero: recepcion.numero, codigo: recepcion.codigo,
      clienteId: recepcion.cliente_id,
      clienteNombre: (recepcion as { clientes?: { nombre?: string } }).clientes?.nombre ?? "",
      descuentoTipo: recepcion.descuento_tipo ?? null,
      descuentoValor: recepcion.descuento_valor != null ? Number(recepcion.descuento_valor) : null,
      observaciones: recepcion.observaciones ?? null,
      createdAt: recepcion.created_at,
    },
    ordenes: lista.map((o) => ({
      id: o.id, numeroOrden: o.numero_orden, codigoOrden: o.codigo_orden ?? null,
      dispositivo: o.dispositivo, marca: o.marca ?? null, estado: o.estado,
      presupuesto: o.presupuesto != null ? Number(o.presupuesto) : null,
      costoFinal: o.costo_final != null ? Number(o.costo_final) : null,
    })),
    totales: { subtotal, totalLote, entregadas, pendientes: lista.length - entregadas },
  })
}
```

Adjust the `supabaseAdmin` import and the `requireAuth` destructuring to exactly match `app/api/recepciones/route.ts` (same file conventions).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/api/recepcion-detalle.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/recepciones/[id]/route.ts __tests__/api/recepcion-detalle.test.ts
git commit -m "feat(api): reception batch detail with derived totals"
```

---

### Task 4: `PATCH /api/recepciones/[id]` â€” edit batch discount

**Files:**
- Modify: `app/api/recepciones/[id]/route.ts` (add `PATCH` export)
- Test: `__tests__/api/recepcion-descuento.test.ts`

**Interfaces:**
- Consumes: Task 3's route file, `ESTADOS_ENTREGADOS` const.
- Produces (consumed by Task 7): `PATCH` body `{ descuentoTipo: "porcentaje" | "monto" | null, descuentoValor: number | null }` â†’ 200 `{ ok: true }`.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/api/recepcion-descuento.test.ts â€” test cases (same mock style as Task 3):
// 1. 403 FEATURE_REQUIRED when plan lacks the feature
// 2. 403 when role !== "ADMIN" (discount edits are pricing edits)
// 3. 400 on invalid pairing (tipo set without valor; porcentaje > 100; valor <= 0)
// 4. 409 when any member order is already in an ENTREGADO* estado
// 5. 200 persists descuento_tipo/descuento_valor; also accepts {null, null} to clear
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/api/recepcion-descuento.test.ts`
Expected: FAIL â€” `PATCH` is not exported.

- [ ] **Step 3: Implement PATCH**

```ts
// add to app/api/recepciones/[id]/route.ts
import { z } from "zod"

const descuentoSchema = z
  .object({
    descuentoTipo: z.enum(["porcentaje", "monto"]).nullable(),
    descuentoValor: z.number().positive().nullable(),
  })
  .refine(
    (d) =>
      (d.descuentoTipo === null && d.descuentoValor === null) ||
      (d.descuentoTipo !== null && d.descuentoValor !== null &&
        (d.descuentoTipo !== "porcentaje" || d.descuentoValor <= 100)),
    { message: "Descuento invalido" }
  )

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { error, organizationId, role } = await requireAuth()
  if (error) return error
  if (role !== "ADMIN") {
    return NextResponse.json({ error: "Solo un administrador puede modificar el descuento" }, { status: 403 })
  }
  if (!(await hasPlanFeature(organizationId!, FEATURE_KEY))) {
    return NextResponse.json(
      { error: "La recepcion de varios equipos esta disponible en el plan Profesional",
        code: "FEATURE_REQUIRED", feature: FEATURE_KEY },
      { status: 403 }
    )
  }

  const parsed = descuentoSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos invalidos" }, { status: 400 })
  }

  const { data: entregadas } = await supabaseAdmin
    .from("ordenes_servicio")
    .select("id")
    .eq("recepcion_id", id)
    .eq("organization_id", organizationId!)
    .in("estado", ESTADOS_ENTREGADOS)
    .limit(1)
  if (entregadas && entregadas.length > 0) {
    return NextResponse.json(
      { error: "No se puede modificar el descuento: el lote ya tiene equipos entregados" },
      { status: 409 }
    )
  }

  const { error: updateError, data: updated } = await supabaseAdmin
    .from("recepciones")
    .update({ descuento_tipo: parsed.data.descuentoTipo, descuento_valor: parsed.data.descuentoValor })
    .eq("id", id)
    .eq("organization_id", organizationId!)
    .select("id")
  if (updateError || !updated?.length) {
    return NextResponse.json({ error: "Recepcion no encontrada" }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/api/recepcion-descuento.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/recepciones/[id]/route.ts __tests__/api/recepcion-descuento.test.ts
git commit -m "feat(api): edit batch discount on undelivered receptions"
```

---

### Task 5: Atomic batch-delivery RPC

> **POST-REVIEW NOTE:** the shipped migration `supabase/migrations/294_entregar_lote_recepcion.sql` is canonical and diverges from the template below in reviewed, deliberate ways: no BEGIN/COMMIT wrapper (db-run.mjs 40-line detection footgun), mirrors `fecha_entrega`/`entregado_por_user_id`/firmas/`motivo_sin_cobro` and the `orden_eventos` insert instead of the template's column set (`updated_at` does not exist), records the per-order discount share via `p_descuento` (phantom-receivable fix), maps 242's ceiling raise to `LOTE_ERROR:COBRO_EXCEDE_PENDIENTE:<id>`, adds `COSTO_FINAL_INVALIDO`/`MONTO_COBRO_INVALIDO` payload guards, and REVOKEs EXECUTE from PUBLIC/anon/authenticated (service_role only).

**Files:**
- Create: `supabase/migrations/294_entregar_lote_recepcion.sql`

**Interfaces:**
- Consumes: `registrar_cobros_orden_atomica(p_org_id, p_orden_id, p_usuario_id, p_pagos, p_observaciones, p_descuento, p_idempotency_key)` (migration `242_cobros_orden_atomico.sql`); `recepciones`, `ordenes_servicio`.
- Produces (called by Task 6): RPC `entregar_lote_recepcion(...) RETURNS JSONB` â€” see signature below.

- [ ] **Step 1: Read the single-order delivery route and list its DB side effects**

Read `app/api/ordenes/[id]/entregar/route.ts` end to end. Write down every column it writes on `ordenes_servicio` when transitioning to `ENTREGADO` (e.g. `estado`, `costo_final`, `fecha_completado`, `notas_entrega`, `updated_at` â€” plus any estado-history insert it performs). The RPC below MUST mirror that exact set for the plain `REPARADO â†’ ENTREGADO` path; extend the `UPDATE` if the route writes more columns.

- [ ] **Step 2: Write the migration**

```sql
-- 294_entregar_lote_recepcion.sql
-- Atomic batch delivery: all member orders REPARADO -> ENTREGADO plus prorated
-- charges in one transaction. Prorated amounts are computed app-side (lib/lote-utils)
-- and passed in; this function validates and persists.
BEGIN;

CREATE OR REPLACE FUNCTION entregar_lote_recepcion(
  p_organization_id TEXT,
  p_recepcion_id    TEXT,
  p_usuario_id      TEXT,
  p_ordenes         JSONB,   -- [{"id": text, "costoFinal": numeric, "montoCobro": numeric}]
  p_metodo_pago     TEXT,
  p_referencia      TEXT DEFAULT NULL,
  p_observaciones   TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_item      JSONB;
  v_orden     RECORD;
  v_monto     NUMERIC;
  v_entregadas JSONB := '[]'::jsonb;
  v_pendientes INTEGER;
BEGIN
  PERFORM 1 FROM recepciones
    WHERE id = p_recepcion_id AND organization_id = p_organization_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'LOTE_ERROR:RECEPCION_NOT_FOUND';
  END IF;

  IF jsonb_array_length(p_ordenes) = 0 THEN
    RAISE EXCEPTION 'LOTE_ERROR:SIN_ORDENES';
  END IF;

  -- Every undelivered member order must be included in the payload.
  SELECT COUNT(*) INTO v_pendientes
    FROM ordenes_servicio o
    WHERE o.recepcion_id = p_recepcion_id
      AND o.organization_id = p_organization_id
      AND o.estado NOT IN ('ENTREGADO','ENTREGADO_SIN_REPARACION','ENTREGADO_SIN_COBRO','CANCELADO')
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_ordenes) e WHERE e->>'id' = o.id
      );
  IF v_pendientes > 0 THEN
    RAISE EXCEPTION 'LOTE_ERROR:LOTE_INCOMPLETO';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_ordenes) LOOP
    SELECT * INTO v_orden FROM ordenes_servicio
      WHERE id = v_item->>'id'
        AND organization_id = p_organization_id
        AND recepcion_id = p_recepcion_id
      FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'LOTE_ERROR:ORDEN_FUERA_DE_LOTE:%', v_item->>'id';
    END IF;
    IF v_orden.estado <> 'REPARADO' THEN
      RAISE EXCEPTION 'LOTE_ERROR:ORDEN_NO_REPARADA:%:%', v_orden.id, v_orden.estado;
    END IF;

    -- Mirror the column writes of POST /api/ordenes/[id]/entregar (verified in Step 1).
    UPDATE ordenes_servicio
      SET estado = 'ENTREGADO',
          costo_final = (v_item->>'costoFinal')::numeric,
          fecha_completado = COALESCE(fecha_completado, NOW()),
          updated_at = NOW()
      WHERE id = v_orden.id;

    v_monto := (v_item->>'montoCobro')::numeric;
    IF v_monto > 0 THEN
      PERFORM registrar_cobros_orden_atomica(
        p_organization_id,
        v_orden.id,
        p_usuario_id,
        jsonb_build_array(jsonb_build_object(
          'monto', v_monto,
          'metodo', p_metodo_pago,
          'referencia', p_referencia
        )),
        p_observaciones,
        NULL,
        CASE WHEN p_idempotency_key IS NULL THEN NULL
             ELSE p_idempotency_key || ':' || v_orden.id END
      );
    END IF;

    v_entregadas := v_entregadas || jsonb_build_object(
      'id', v_orden.id, 'numeroOrden', v_orden.numero_orden, 'montoCobrado', COALESCE(v_monto, 0)
    );
  END LOOP;

  RETURN jsonb_build_object('recepcionId', p_recepcion_id, 'ordenes', v_entregadas);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;
```

If Step 1 found an estado-history insert or extra columns in the route, replicate them inside the loop before committing this file. If `registrar_cobros_orden_atomica` has a different argument order in `242_cobros_orden_atomico.sql`, match it exactly.

- [ ] **Step 3: Dry-run and apply**

Run: `node scripts/db-run.mjs supabase/migrations/294_entregar_lote_recepcion.sql` (dry-run, then apply).
Expected: `CREATE FUNCTION` succeeds.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/294_entregar_lote_recepcion.sql
git commit -m "feat(db): atomic batch delivery RPC for reception batches"
```

---

### Task 6: `POST /api/recepciones/[id]/entregar` â€” batch delivery endpoint

**Files:**
- Create: `app/api/recepciones/[id]/entregar/route.ts`
- Test: `__tests__/api/entregar-lote.test.ts`

**Interfaces:**
- Consumes: Task 5 RPC; `calcularTotalLote`, `prorratearLote` (Task 1); `requireAuth`, `hasPlanFeature`; payment method enum values from `app/api/ordenes/[id]/cobros/route.ts` (`EFECTIVO`, `TRANSFERENCIA`, `TARJETA_DEBITO`, `TARJETA_CREDITO`, `MERCADOPAGO`, `OTRO` â€” exclude `CUENTA_CORRIENTE`, out of scope for batches).
- Produces (called by Task 8's dialog): request/response

```ts
// request
{ ordenes: Array<{ id: string; costoFinal: number }>,
  metodoPago: "EFECTIVO" | "TRANSFERENCIA" | "TARJETA_DEBITO" | "TARJETA_CREDITO" | "MERCADOPAGO" | "OTRO",
  referencia?: string | null,
  observaciones?: string | null,
  idempotencyKey?: string | null }
// response 200
{ recepcionId: string, totalCobrado: number,
  ordenes: Array<{ id: string; numeroOrden: number; montoCobrado: number }> }
```

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/api/entregar-lote.test.ts â€” test cases (same mock style as Tasks 3-4;
// mock supabaseAdmin.rpc to capture arguments):
// 1. 403 FEATURE_REQUIRED when plan lacks the feature
// 2. 403 when role !== "ADMIN"
// 3. 400 when body fails schema (empty ordenes, negative costoFinal, bad metodoPago)
// 4. 409 when a member order is not REPARADO (RPC raises LOTE_ERROR:ORDEN_NO_REPARADA -> mapped)
// 5. happy path: with orders [100, 200, 300] and descuento porcentaje 10,
//    rpc called once with montoCobro shares [90, 180, 270] and totalCobrado 540;
//    per-order costoFinal passed through verbatim
// 6. discount larger than subtotal -> shares all 0, RPC still called (delivery without charge)
// 7. RPC error LOTE_ERROR:COBRO_EXCEDE_PENDIENTE -> 409 with the pagos-previos message;
//    LOTE_ERROR:COSTO_FINAL_INVALIDO -> 400; LOTE_ERROR:ORDEN_FUERA_DE_LOTE -> 404 lote message
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/api/entregar-lote.test.ts`
Expected: FAIL â€” route module does not exist.

- [ ] **Step 3: Implement the route**

```ts
// app/api/recepciones/[id]/entregar/route.ts
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { requireAuth } from "@/lib/auth-utils"
import { hasPlanFeature } from "@/lib/subscriptions"
import { supabaseAdmin } from "@/lib/supabase"
import { calcularTotalLote, prorratearLote, type DescuentoTipo } from "@/lib/lote-utils"

const FEATURE_KEY = "recepcion_multiple"

const entregarLoteSchema = z.object({
  ordenes: z.array(z.object({ id: z.string().min(1), costoFinal: z.number().min(0) })).min(1),
  metodoPago: z.enum(["EFECTIVO", "TRANSFERENCIA", "TARJETA_DEBITO", "TARJETA_CREDITO", "MERCADOPAGO", "OTRO"]),
  referencia: z.string().nullable().optional(),
  observaciones: z.string().nullable().optional(),
  idempotencyKey: z.string().max(100).nullable().optional(),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { error, organizationId, userId, role } = await requireAuth()
  if (error) return error
  if (role !== "ADMIN") {
    return NextResponse.json({ error: "Solo un administrador puede entregar y cobrar un lote" }, { status: 403 })
  }
  if (!(await hasPlanFeature(organizationId!, FEATURE_KEY))) {
    return NextResponse.json(
      { error: "La recepcion de varios equipos esta disponible en el plan Profesional",
        code: "FEATURE_REQUIRED", feature: FEATURE_KEY },
      { status: 403 }
    )
  }

  const parsed = entregarLoteSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos invalidos" }, { status: 400 })
  }
  const { ordenes, metodoPago, referencia, observaciones, idempotencyKey } = parsed.data

  const { data: recepcion } = await supabaseAdmin
    .from("recepciones")
    .select("id, descuento_tipo, descuento_valor")
    .eq("id", id)
    .eq("organization_id", organizationId!)
    .single()
  if (!recepcion) {
    return NextResponse.json({ error: "Recepcion no encontrada" }, { status: 404 })
  }

  const costos = ordenes.map((o) => o.costoFinal)
  const subtotal = costos.reduce((a, b) => a + b, 0)
  const totalCobrado = calcularTotalLote(
    subtotal,
    (recepcion.descuento_tipo as DescuentoTipo | null) ?? null,
    recepcion.descuento_valor != null ? Number(recepcion.descuento_valor) : null
  )
  const shares = prorratearLote(costos, totalCobrado)

  const { data, error: rpcError } = await supabaseAdmin.rpc("entregar_lote_recepcion", {
    p_organization_id: organizationId!,
    p_recepcion_id: id,
    p_usuario_id: userId!,
    p_ordenes: ordenes.map((o, i) => ({ id: o.id, costoFinal: o.costoFinal, montoCobro: shares[i] })),
    p_metodo_pago: metodoPago,
    p_referencia: referencia ?? null,
    p_observaciones: observaciones ?? null,
    p_idempotency_key: idempotencyKey ?? null,
  })

  if (rpcError) {
    const msg = rpcError.message ?? ""
    if (msg.includes("LOTE_ERROR:ORDEN_NO_REPARADA") || msg.includes("LOTE_ERROR:LOTE_INCOMPLETO")) {
      return NextResponse.json(
        { error: "Todos los equipos del lote deben estar reparados para entregar" },
        { status: 409 }
      )
    }
    if (msg.includes("LOTE_ERROR:COBRO_EXCEDE_PENDIENTE")) {
      return NextResponse.json(
        { error: "Un equipo del lote tiene pagos o descuentos previos que superan su parte del total. Entregalo individualmente." },
        { status: 409 }
      )
    }
    if (msg.includes("LOTE_ERROR:COSTO_FINAL_INVALIDO") || msg.includes("LOTE_ERROR:MONTO_COBRO_INVALIDO")) {
      return NextResponse.json({ error: "Datos de cobro invalidos para el lote" }, { status: 400 })
    }
    if (msg.includes("LOTE_ERROR:RECEPCION_NOT_FOUND")) {
      return NextResponse.json({ error: "Recepcion no encontrada" }, { status: 404 })
    }
    if (msg.includes("LOTE_ERROR:ORDEN_FUERA_DE_LOTE")) {
      return NextResponse.json({ error: "Una de las ordenes no pertenece a este lote" }, { status: 404 })
    }
    return NextResponse.json({ error: "No se pudo entregar el lote" }, { status: 500 })
  }

  return NextResponse.json({ recepcionId: id, totalCobrado, ordenes: (data as { ordenes: unknown[] }).ordenes })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/api/entregar-lote.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/recepciones/[id]/entregar/route.ts __tests__/api/entregar-lote.test.ts
git commit -m "feat(api): batch delivery with single prorated charge"
```

---

### Task 7: Batch detail page (list, totals, discount editor)

**Files:**
- Create: `app/(dashboard)/ordenes/recepcion/[id]/page.tsx` (server component, mirrors the gating of `app/(dashboard)/ordenes/recepcion/page.tsx`: `hasPlanFeature` â†’ `FeatureLockedView` fallback)
- Create: `components/ordenes/recepcion-detail.tsx` (client component)
- Test: `__tests__/components/recepcion-detail.test.tsx`

**Interfaces:**
- Consumes: `GET`/`PATCH /api/recepciones/[id]` (Tasks 3-4), `RecepcionDetalleResponse` shape, `useHasFeature`, `FeatureLockedView` (`featureName`, `description`, `benefits`, `targetPlanSlug`).
- Produces (used by Task 8): `RecepcionDetail` renders a "Entregar lote" button when `totales.pendientes > 0` and every pending order is `REPARADO`; exposes `onEntregarLote()` callback slot where Task 8 mounts the dialog; refetches after dialog success.

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/components/recepcion-detail.test.tsx â€” test cases (jsdom, mock fetch):
// 1. renders one row per order with estado badge and formatted presupuesto/costo
// 2. shows subtotal, descuento and total lote from the API payload
// 3. "Entregar lote" button disabled when any pending order is not REPARADO
//    (tooltip/help text explains why), enabled when all pending are REPARADO
// 4. discount editor hidden once totales.entregadas > 0
// 5. saving the discount PATCHes /api/recepciones/[id] and refetches
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/components/recepcion-detail.test.tsx`
Expected: FAIL â€” component does not exist.

- [ ] **Step 3: Implement page + component**

Component structure (follow the visual conventions of `components/ordenes/orden-detail.tsx` â€” cards, badges, `useCurrency` for money formatting):

- Header card: `codigo`, `clienteNombre`, `createdAt`, progress line "X de N entregados".
- Orders table/cards: link each row to `/ordenes/{id}` (reuse the estado badge component used by `ordenes-list.tsx`).
- Totals card: `subtotal`, discount row (inline editor: select `porcentaje`/`monto` + numeric input + save button, ADMIN only, hidden when `entregadas > 0`), `totalLote` highlighted.
- Footer: "Entregar lote" button (renders Task 8's dialog; until Task 8 lands, gate it behind a `disabled` state with no dialog).
- Page server component: resolve org, `hasPlanFeature(orgId, "recepcion_multiple")`; on false render `<FeatureLockedView featureName="RecepciÃ³n mÃºltiple" description="GestionÃ¡ lotes de equipos con precio mayorista" benefits={["Carga N equipos en una sola recepciÃ³n", "Descuento sobre el total del lote", "Entrega y cobro del lote en una sola operaciÃ³n"]} />`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/components/recepcion-detail.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire entry points**

- `components/ordenes/recepcion-creada-modal.tsx`: add a "Ver lote" link/button to `/ordenes/recepcion/{recepcion.id}`.
- `components/ordenes/orden-detail.tsx`: when the fetched orden has `recepcion_id`, render a small badge/link "Parte del lote {codigo}" â†’ `/ordenes/recepcion/{recepcion_id}` (requires adding `recepcion_id` to the order-detail fetch/select if absent).

- [ ] **Step 6: Run the full unit suite**

Run: `npx vitest run`
Expected: PASS â€” no regressions in existing component tests.

- [ ] **Step 7: Commit**

```bash
git add app/(dashboard)/ordenes/recepcion/[id]/ components/ordenes/recepcion-detail.tsx components/ordenes/recepcion-creada-modal.tsx components/ordenes/orden-detail.tsx __tests__/components/recepcion-detail.test.tsx
git commit -m "feat(ordenes): reception batch detail view with discount editor"
```

---

### Task 8: Batch delivery dialog

**Files:**
- Create: `components/ordenes/entrega-lote-dialog.tsx`
- Modify: `components/ordenes/recepcion-detail.tsx` (mount the dialog on "Entregar lote")
- Test: `__tests__/components/entrega-lote-dialog.test.tsx`

**Interfaces:**
- Consumes: `POST /api/recepciones/[id]/entregar` (Task 6 request/response shape); visual conventions of `components/ordenes/entrega-dialog.tsx` (confirmation summary + payment method selection).
- Produces:

```ts
interface EntregaLoteDialogProps {
  open: boolean
  onClose: () => void
  onSuccess: () => void            // parent refetches batch detail
  recepcionId: string
  ordenes: Array<{ id: string; numeroOrden: number; dispositivo: string; costoFinal: number | null; presupuesto: number | null }>
  descuentoTipo: "porcentaje" | "monto" | null
  descuentoValor: number | null
}
```

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/components/entrega-lote-dialog.test.tsx â€” test cases (jsdom, mock fetch):
// 1. lists each device with an editable costo final input,
//    prefilled with costoFinal ?? presupuesto ?? 0
// 2. recomputes subtotal / descuento / total live as costs are edited
//    (mirror calcularTotalLote â€” import it, do not duplicate the math)
// 3. confirm button disabled until a metodoPago is selected
// 4. on confirm POSTs { ordenes: [{id, costoFinal}], metodoPago, idempotencyKey }
//    to /api/recepciones/{id}/entregar and calls onSuccess on 200
// 5. renders API error message (409 not-repaired) without closing the dialog
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/components/entrega-lote-dialog.test.tsx`
Expected: FAIL â€” component does not exist.

- [ ] **Step 3: Implement the dialog**

Structure (reuse patterns from `entrega-dialog.tsx`: dialog scaffold, currency formatting, payment-method options list â€” same labels as the single-order cobro UI):

- Per-device rows: `#numeroOrden dispositivo` + numeric input for final cost.
- Summary block: `Subtotal`, `Descuento (10% / $500)`, `Total a cobrar` â€” computed with `calcularTotalLote` from `lib/lote-utils`.
- Payment method radio/select (EFECTIVO, TRANSFERENCIA, TARJETA_DEBITO, TARJETA_CREDITO, MERCADOPAGO, OTRO) + optional `referencia` and `observaciones`.
- `idempotencyKey`: generate once per dialog open (`crypto.randomUUID()`).
- Confirm â†’ POST; on success `onSuccess()` + `onClose()`; on error keep open and show message.

Mount in `recepcion-detail.tsx`: "Entregar lote" opens it with the pending (non-delivered) orders only; after success, refetch.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/components/entrega-lote-dialog.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/ordenes/entrega-lote-dialog.tsx components/ordenes/recepcion-detail.tsx __tests__/components/entrega-lote-dialog.test.tsx
git commit -m "feat(ordenes): single-charge batch delivery dialog"
```

---

### Task 9: End-to-end flow (Playwright)

**Files:**
- Create: `e2e/lote-mayorista.auth.spec.ts`

**Interfaces:**
- Consumes: `test, expect` from `./fixtures/auth`, `ROUTES`/`settle` helpers (same imports as `e2e/recepcion-multiple.auth.spec.ts`); the full stack from Tasks 1-8 with migrations applied.

- [ ] **Step 1: Write the spec**

Follow `e2e/recepcion-multiple.auth.spec.ts` exactly for setup/skip conventions (`test.skip(true, ...)` when the QA tenant lacks the `recepcion_multiple` flag). Flow:

```ts
// e2e/lote-mayorista.auth.spec.ts â€” scenario:
// 1. create a multi-device reception (2 devices) through the existing reception form
// 2. open the batch detail view from the success modal ("Ver lote")
// 3. set a 10% discount, verify totals update
// 4. via UI (or API request fixture if the UI path is slow): move both orders to REPARADO
//    with a costo final each
// 5. "Entregar lote": select EFECTIVO, confirm â€” assert success
// 6. assert both orders show ENTREGADO and the batch view shows "2 de 2 entregados"
//    and the charged total equals sum of costs minus 10%
```

- [ ] **Step 2: Run it**

Run: `npx playwright test e2e/lote-mayorista.auth.spec.ts`
Expected: PASS (or graceful skip without credentials â€” must PASS in the credentialed environment before the PR).

- [ ] **Step 3: Run the full suites**

Run: `npx vitest run` then `npm run test:e2e`
Expected: all green / known skips only.

- [ ] **Step 4: Commit**

```bash
git add e2e/lote-mayorista.auth.spec.ts
git commit -m "test(e2e): wholesale batch flow from reception to single-charge delivery"
```

---

## PR checklist (after Task 9)

- Renumber migrations if `280`/`281` were taken at merge time; re-apply under the final names.
- Fresh-context review before the PR (project rule), then PR against `main` titled `feat(ordenes): lotes mayoristas con descuento y entrega con cobro Ãºnico`.
- PR body: note the two manual migrations and that batch delivery requires `registrar_cobros_orden_atomica` (migration 242) to exist in prod.

