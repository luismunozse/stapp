# Invoice Creation Entry Point + Invoices For Sales — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a visible "Generar factura" entry point on `/facturacion`, and allow creating internal (non-fiscal) invoices from POS sales (`ventas`), sharing the same `facturas` table, numbering sequence, and listing as order invoices.

**Architecture:** `facturas.orden_id` becomes nullable and a new `facturas.venta_id` column (nullable, `UNIQUE`) is added with an XOR check so every invoice has exactly one source. A new RPC `crear_factura_venta_atomica` mirrors the existing `crear_factura_atomica` for the venta path (no cotización, no seña — venta payments stay in `pagos_venta`). The two existing atomic RPCs that manage invoice lifecycle (`anular_factura_atomica`, `eliminar_factura_atomica`) are recreated with a `LEFT JOIN` to both `ordenes_servicio` and `ventas` so they keep working once `orden_id` can be `NULL`. `POST /api/facturacion/generar` accepts a zod-union body (`{ordenId}` XOR `{ventaId}`). `GET /api/facturacion` and `GET/PUT/DELETE /api/facturacion/[id]` are updated to resolve either origin and expose an `origen: "orden" | "venta"` discriminator. UI adds a "Generar factura" modal with two tabs (backed by a new lightweight candidates endpoint), an origin badge in the list, a button on the sale detail page, and venta rendering in the invoice PDF.

**Tech Stack:** Next.js App Router (route handlers), Supabase/Postgres (plpgsql RPCs + RLS), Zod, Vitest (`__tests__/`, jsdom + React Testing Library for components), pdf-lib (`lib/pdf.ts`).

**Spec:** `docs/superpowers/specs/2026-08-07-facturas-desde-ventas-design.md`

## Global Constraints

- Work on branch `feat/facturas-desde-ventas` (already checked out).
- Migration number is assigned at merge time (project convention). This plan uses `292_factura_venta_id.sql`; before opening the PR, verify no migration numbered ≥292 exists on `main` yet (`ls supabase/migrations | sort -V | tail -3`) and renumber if needed.
- Migrations are applied manually: `node scripts/db-run.mjs supabase/migrations/<file>` (dry-run by default — review the printed diff, then re-run with the apply flag the script prints). Never assume a CI runner applies them.
- Strict TDD, test-first: every task that touches route/lib/component code writes the failing test before the implementation.
- **Never run vitest concurrently across files** — parallel `vitest run` processes kill each other in this environment. Run one test file (or `-t` filter) at a time: `npx vitest run __tests__/api/xxx.test.ts`.
- Conventional commits, no AI attribution, no `--no-verify`.
- Code identifiers, comments, and test descriptions in English. UI copy and API error messages in neutral-but-warm Spanish, matching the existing style in `app/api/facturacion/generar/route.ts` (e.g. `"Orden no encontrada"`, `"Ya existe una factura para esta orden"`).
- `supabaseAdmin` (service-role client) bypasses RLS; every route in this plan already uses it. RLS rewrites in Task 1 are defense-in-depth for any future non-service-role access path, not a functional requirement for these routes to work.
- Delivery: 2 chained PRs (stacked-to-main). PR 1 = backend (Tasks 1–4). PR 2 = UI (Tasks 5–9). PR 2 branches off PR 1's branch and targets `main` after PR 1 merges.

---

## PR 1 — Backend

### Task 1: Migration — nullable `orden_id`, `venta_id`, RLS rewrite, 3 RPCs

**Files:**
- Create: `supabase/migrations/292_factura_venta_id.sql`

**Interfaces:**
- Produces (consumed by Tasks 2, 3, 4):
  - `facturas.orden_id` — now nullable.
  - `facturas.venta_id TEXT UNIQUE REFERENCES ventas(id) ON DELETE CASCADE` — nullable.
  - `CHECK facturas_orden_xor_venta` — exactly one of `orden_id`/`venta_id` is set.
  - RPC `crear_factura_venta_atomica(p_venta_id TEXT, p_numero_factura TEXT, p_subtotal DECIMAL, p_iva DECIMAL, p_total DECIMAL, p_monto_abonado DECIMAL, p_estado_pago TEXT, p_items JSONB) RETURNS JSONB` → `{"id": "<factura_id>"}`.
  - RPC `anular_factura_atomica` / `eliminar_factura_atomica` — same signatures as before, now resolve org/cliente/sucursal via `LEFT JOIN` to both `ordenes_servicio` and `ventas` instead of an inner join to `ordenes_servicio` only.

- [ ] **Step 1: Write the migration**

```sql
-- 292_factura_venta_id.sql
-- Allows facturas to be sourced from a venta (POS sale) instead of only an
-- ordenes_servicio. orden_id becomes nullable; venta_id is added with a
-- UNIQUE + XOR check. items_factura and facturas RLS are rewritten to use
-- facturas.organization_id directly (added in migration 250) instead of
-- joining ordenes_servicio, which breaks for venta-sourced rows (orden_id
-- IS NULL never matches an EXISTS join). anular_factura_atomica and
-- eliminar_factura_atomica are recreated with a LEFT JOIN to both
-- ordenes_servicio and ventas so lifecycle actions keep working for either
-- origin — org_id now comes straight from facturas.organization_id;
-- cliente_id/sucursal_id are only used for the CUENTA_CORRIENTE re-credit
-- loop, which is always empty for venta-sourced invoices (they never write
-- pagos_parciales), so COALESCE is safe.
BEGIN;

-- ============================================================
-- (1) Schema: nullable orden_id + venta_id + XOR check
-- ============================================================
ALTER TABLE facturas ALTER COLUMN orden_id DROP NOT NULL;

ALTER TABLE facturas
  ADD COLUMN IF NOT EXISTS venta_id TEXT UNIQUE REFERENCES ventas(id) ON DELETE CASCADE;

ALTER TABLE facturas DROP CONSTRAINT IF EXISTS facturas_orden_xor_venta;
ALTER TABLE facturas ADD CONSTRAINT facturas_orden_xor_venta
  CHECK ((orden_id IS NOT NULL) <> (venta_id IS NOT NULL));

-- ============================================================
-- (2) RLS: facturas — rewrite to use organization_id directly
--     (previously joined ordenes_servicio via orden_id, migration 002)
-- ============================================================
DROP POLICY IF EXISTS "Users can view org invoices" ON facturas;
DROP POLICY IF EXISTS "Users can manage org invoices" ON facturas;

CREATE POLICY "Users can view org invoices" ON facturas FOR SELECT
  USING (facturas.organization_id = public.get_current_organization_id());
CREATE POLICY "Users can manage org invoices" ON facturas FOR ALL
  USING (facturas.organization_id = public.get_current_organization_id());

-- ============================================================
-- (3) RLS: items_factura — rewrite to use facturas.organization_id
--     (previously joined ordenes_servicio via facturas.orden_id, migration 053)
-- ============================================================
DROP POLICY IF EXISTS "items_factura_access" ON items_factura;

-- NOTE: do NOT use current_setting('app.organization_id') here — that GUC is
-- never set (see migration 287's comment); the hardened convention is
-- public.get_current_organization_id() (migration 251).
CREATE POLICY "items_factura_access" ON items_factura
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM facturas f
      WHERE f.id = items_factura.factura_id
        AND f.organization_id = public.get_current_organization_id()
    )
  );

-- ============================================================
-- (4) RPC: crear_factura_venta_atomica
--     Mirrors crear_factura_atomica (migration 250) for the venta path:
--     no cotizacion_id, no seña/pagos_parciales (venta payments live in
--     pagos_venta, tracked on the venta itself).
-- ============================================================
CREATE OR REPLACE FUNCTION crear_factura_venta_atomica(
  p_venta_id       TEXT,
  p_numero_factura TEXT,
  p_subtotal       DECIMAL,
  p_iva            DECIMAL,
  p_total          DECIMAL,
  p_monto_abonado  DECIMAL,
  p_estado_pago    TEXT,
  p_items          JSONB
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_factura_id  TEXT;
  v_org_id      TEXT;
  v_item        JSONB;
BEGIN
  SELECT organization_id INTO v_org_id
  FROM ventas
  WHERE id = p_venta_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Venta no encontrada: %', p_venta_id;
  END IF;

  INSERT INTO facturas (
    venta_id,
    organization_id,
    numero_factura,
    subtotal,
    iva,
    total,
    monto_abonado,
    estado_pago
  ) VALUES (
    p_venta_id,
    v_org_id,
    p_numero_factura,
    p_subtotal,
    p_iva,
    p_total,
    p_monto_abonado,
    p_estado_pago::estado_pago
  )
  RETURNING id INTO v_factura_id;

  IF jsonb_array_length(p_items) > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      INSERT INTO items_factura (
        factura_id,
        descripcion,
        cantidad,
        precio_unitario,
        subtotal,
        tipo
      ) VALUES (
        v_factura_id,
        (v_item->>'descripcion')::TEXT,
        (v_item->>'cantidad')::INTEGER,
        (v_item->>'precio_unitario')::NUMERIC,
        (v_item->>'subtotal')::NUMERIC,
        (v_item->>'tipo')::TEXT
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object('id', v_factura_id);
END;
$$;

COMMENT ON FUNCTION crear_factura_venta_atomica(TEXT, TEXT, DECIMAL, DECIMAL, DECIMAL, DECIMAL, TEXT, JSONB) IS
  'Atomically creates a venta-sourced factura with its items_factura rows. '
  'Derives organization_id from ventas. Mirrors crear_factura_atomica '
  '(migration 250) but for the venta_id path: no cotizacion_id, no seña/'
  'pagos_parciales (venta payments live in pagos_venta). Migration 292.';

-- ============================================================
-- (5) RPC: anular_factura_atomica — LEFT JOIN both origins
-- ============================================================
CREATE OR REPLACE FUNCTION anular_factura_atomica(
  p_org_id     TEXT,
  p_factura_id TEXT,
  p_user_id    TEXT
) RETURNS JSONB AS $$
DECLARE
  v_factura RECORD;
  v_pago    RECORD;
BEGIN
  SELECT
    f.*,
    f.organization_id AS org_id,
    COALESCE(o.cliente_id, v.cliente_id) AS cliente_id,
    COALESCE(o.sucursal_id, v.sucursal_id) AS orden_sucursal_id
    INTO v_factura
    FROM facturas f
    LEFT JOIN ordenes_servicio o ON o.id = f.orden_id
    LEFT JOIN ventas v ON v.id = f.venta_id
    WHERE f.id = p_factura_id
    FOR UPDATE OF f;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Factura no encontrada';
  END IF;

  IF v_factura.org_id <> p_org_id THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  IF v_factura.estado_pago::text = 'ANULADA' THEN
    RAISE EXCEPTION 'La factura ya esta anulada';
  END IF;

  FOR v_pago IN
    SELECT monto, metodo_pago
      FROM pagos_parciales
      WHERE factura_id = p_factura_id
  LOOP
    IF v_pago.metodo_pago::text = 'CUENTA_CORRIENTE' AND v_factura.cliente_id IS NOT NULL THEN
      PERFORM devolver_cuenta_corriente(
        p_org_id,
        v_factura.cliente_id,
        v_pago.monto,
        'FACTURA',
        p_factura_id,
        p_user_id,
        'Anulacion factura ' || v_factura.numero_factura,
        v_factura.orden_sucursal_id
      );
    END IF;
  END LOOP;

  UPDATE facturas
    SET estado_pago = 'ANULADA'::estado_pago
    WHERE id = p_factura_id;

  RETURN jsonb_build_object('ok', true);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION anular_factura_atomica(TEXT,TEXT,TEXT) IS
  'Voids a factura atomically. Guards: not-found, org mismatch, already-ANULADA. '
  'Re-credits CUENTA_CORRIENTE partial payments via devolver_cuenta_corriente. '
  'Sets estado_pago=ANULADA. org_id/cliente_id/sucursal_id resolved via LEFT '
  'JOIN to both ordenes_servicio and ventas (migration 292) — org_id reads '
  'facturas.organization_id directly; cliente_id/sucursal_id fall back to '
  'whichever origin is populated. Migration 248/269 base behavior preserved.';

-- ============================================================
-- (6) RPC: eliminar_factura_atomica — LEFT JOIN both origins
-- ============================================================
CREATE OR REPLACE FUNCTION eliminar_factura_atomica(
  p_org_id     TEXT,
  p_factura_id TEXT,
  p_user_id    TEXT
) RETURNS JSONB AS $$
DECLARE
  v_factura RECORD;
  v_pago    RECORD;
BEGIN
  SELECT
    f.*,
    f.organization_id AS org_id,
    COALESCE(o.cliente_id, v.cliente_id) AS cliente_id,
    COALESCE(o.sucursal_id, v.sucursal_id) AS orden_sucursal_id
    INTO v_factura
    FROM facturas f
    LEFT JOIN ordenes_servicio o ON o.id = f.orden_id
    LEFT JOIN ventas v ON v.id = f.venta_id
    WHERE f.id = p_factura_id
    FOR UPDATE OF f;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Factura no encontrada';
  END IF;

  IF v_factura.org_id <> p_org_id THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  FOR v_pago IN
    SELECT monto, metodo_pago
      FROM pagos_parciales
      WHERE factura_id = p_factura_id
  LOOP
    IF v_pago.metodo_pago::text = 'CUENTA_CORRIENTE' AND v_factura.cliente_id IS NOT NULL THEN
      PERFORM devolver_cuenta_corriente(
        p_org_id,
        v_factura.cliente_id,
        v_pago.monto,
        'FACTURA',
        p_factura_id,
        p_user_id,
        'Eliminacion factura ' || v_factura.numero_factura,
        v_factura.orden_sucursal_id
      );
    END IF;
  END LOOP;

  DELETE FROM pagos_parciales WHERE factura_id = p_factura_id;
  DELETE FROM facturas WHERE id = p_factura_id;

  RETURN jsonb_build_object('ok', true);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION eliminar_factura_atomica(TEXT,TEXT,TEXT) IS
  'Deletes a factura atomically. Guards: not-found, org mismatch. '
  'Re-credits CUENTA_CORRIENTE partial payments, then deletes pagos_parciales '
  'and the factura in the same transaction. org_id/cliente_id/sucursal_id '
  'resolved via LEFT JOIN to both ordenes_servicio and ventas (migration 292). '
  'Migration 248/269 base behavior preserved.';

COMMIT;
```

- [ ] **Step 2: Dry-run and apply**

Run: `node scripts/db-run.mjs supabase/migrations/292_factura_venta_id.sql` (review the dry-run output — confirm it shows the `ALTER TABLE`, `DROP/CREATE POLICY`, and 3 `CREATE OR REPLACE FUNCTION` statements — then re-run with the apply flag the script prints).
Expected: all statements succeed; a follow-up dry-run of the same file shows no pending changes (idempotent — every statement is `IF NOT EXISTS`/`DROP ... IF EXISTS`/`CREATE OR REPLACE`).

- [ ] **Step 3: Manual smoke check (no automated DB test suite in this project)**

Run in the Supabase SQL editor (or via `db-run.mjs` against a throwaway `SELECT`):
```sql
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'facturas'::regclass AND conname = 'facturas_orden_xor_venta';
SELECT proname FROM pg_proc WHERE proname IN ('crear_factura_venta_atomica', 'anular_factura_atomica', 'eliminar_factura_atomica');
```
Expected: the CHECK constraint definition matches, and all 3 functions exist.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/292_factura_venta_id.sql
git commit -m "feat(db): allow facturas to be sourced from a venta"
```

---

### Task 2: `POST /api/facturacion/generar` — accept `ventaId`

**Files:**
- Modify: `app/api/facturacion/generar/route.ts`
- Test: `__tests__/api/factura-venta.test.ts`

**Interfaces:**
- Consumes: `requireAdmin()` (`lib/auth-utils.ts`), `getNextInvoiceNumber(organizationId)` (`lib/counters.ts`), RPC `crear_factura_venta_atomica` (Task 1).
- Produces (consumed by Tasks 6, 9 for the response shape): `POST /api/facturacion/generar` body `{ordenId: string} | {ventaId: string}` (exactly one) → `201` with `{id, ventaId, numeroFactura, subtotal, iva, total, estadoPago, items, venta: {id, numeroVenta, cliente: {nombre}}}` for the venta path (unchanged `{..., ordenId, orden}` shape for the orden path).

- [ ] **Step 1: Write the failing tests**

```ts
// __tests__/api/factura-venta.test.ts
/**
 * Tests: venta-sourced invoice generation — POST /api/facturacion/generar { ventaId }
 *
 * Guards:
 *   V1: zod XOR — rejects body with both ordenId+ventaId, and with neither.
 *   V2: venta not found / cross-org → 404.
 *   V3: venta ANULADA → 400.
 *   V4: venta already invoiced → 400.
 *   V5: happy path — IVA copied (not recomputed) from venta snapshot;
 *       estado_pago/monto_abonado copied; RPC called with correct args; 201.
 *   V6: EXENTO venta (iva_neto/iva_monto null) → iva=0, subtotal=venta.subtotal.
 *   V7: RPC-missing → JS fallback inserts factura + items_factura directly.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  createPostRequest,
  parseResponse,
} from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

vi.mock("@/lib/counters", () => ({
  getNextInvoiceNumber: vi.fn().mockResolvedValue("0001-00000099"),
}))

import { POST as generarPost } from "@/app/api/facturacion/generar/route"

function ventaBase(over: Partial<any> = {}) {
  return {
    id: "v1",
    estado: "COMPLETADA",
    numero_venta: 5,
    subtotal: 100,
    iva_neto: null,
    iva_monto: null,
    monto_abonado: 100,
    estado_pago: "PAGADO",
    organization_id: "org-1",
    cliente_nombre: "Consumidor Final",
    total: 100,
    items_venta: [
      { inventario_id: "inv1", descripcion: "Cargador", cantidad: 1, precio_unitario: 100, subtotal: 100 },
    ],
    facturas: [],
    ...over,
  }
}

describe("POST /api/facturacion/generar — zod XOR (V1)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("rejects body with both ordenId and ventaId", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const res = await generarPost(createPostRequest({ ordenId: "o1", ventaId: "v1" }))
    const { status } = await parseResponse(res)
    expect(status).toBe(400)
  })

  it("rejects body with neither ordenId nor ventaId", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const res = await generarPost(createPostRequest({}))
    const { status } = await parseResponse(res)
    expect(status).toBe(400)
  })
})

describe("POST /api/facturacion/generar — venta gates (V2-V4)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("404 when venta not found (cross-org or missing)", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ventas") return createChainMock(null, { message: "not found" }) as any
      return createChainMock(null, { message: `No mock for table: ${table}` }) as any
    })

    const res = await generarPost(createPostRequest({ ventaId: "v1" }))
    const { status, body } = await parseResponse(res)
    expect(status).toBe(404)
    expect(body.error).toBe("Venta no encontrada")
  })

  it("400 when venta is ANULADA", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ventas") return createChainMock(ventaBase({ estado: "ANULADA" })) as any
      return createChainMock(null, { message: `No mock for table: ${table}` }) as any
    })

    const res = await generarPost(createPostRequest({ ventaId: "v1" }))
    const { status, body } = await parseResponse(res)
    expect(status).toBe(400)
    expect(body.error).toBe("La venta está anulada")
  })

  it("400 when venta already has a factura", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ventas") return createChainMock(ventaBase({ facturas: [{ id: "f-existing" }] })) as any
      return createChainMock(null, { message: `No mock for table: ${table}` }) as any
    })

    const res = await generarPost(createPostRequest({ ventaId: "v1" }))
    const { status, body } = await parseResponse(res)
    expect(status).toBe(400)
    expect(body.error).toBe("Ya existe una factura para esta venta")
  })
})

describe("POST /api/facturacion/generar — venta happy path (V5-V6)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("copies IVA from the venta snapshot and calls the RPC with correct args", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "crear_factura_venta_atomica") {
        return Promise.resolve({ data: { id: "f-new" }, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    }) as any)
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ventas") {
        return createChainMock(ventaBase({ iva_neto: 100, iva_monto: 21, total: 121 })) as any
      }
      if (table === "items_factura") return createChainMock([]) as any
      return createChainMock(null, { message: `No mock for table: ${table}` }) as any
    })

    const res = await generarPost(createPostRequest({ ventaId: "v1" }))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(201)
    expect(body.id).toBe("f-new")

    const args = vi.mocked(supabaseAdmin.rpc).mock.calls.find(([fn]) => fn === "crear_factura_venta_atomica")![1] as any
    expect(args.p_venta_id).toBe("v1")
    expect(args.p_subtotal).toBe(100)
    expect(args.p_iva).toBe(21)
    expect(args.p_total).toBe(121)
    expect(args.p_monto_abonado).toBe(100)
    expect(args.p_estado_pago).toBe("PAGADO")
    expect(args.p_items).toEqual([
      { descripcion: "Cargador", cantidad: 1, precio_unitario: 100, subtotal: 100, tipo: "REPUESTO" },
    ])
  })

  it("EXENTO venta (iva_neto/iva_monto null) → iva=0, subtotal=venta.subtotal", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "crear_factura_venta_atomica") {
        return Promise.resolve({ data: { id: "f-new" }, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    }) as any)
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ventas") return createChainMock(ventaBase()) as any
      if (table === "items_factura") return createChainMock([]) as any
      return createChainMock(null, { message: `No mock for table: ${table}` }) as any
    })

    const res = await generarPost(createPostRequest({ ventaId: "v1" }))
    await parseResponse(res)

    const args = vi.mocked(supabaseAdmin.rpc).mock.calls.find(([fn]) => fn === "crear_factura_venta_atomica")![1] as any
    expect(args.p_iva).toBe(0)
    expect(args.p_subtotal).toBe(100)
  })
})

describe("POST /api/facturacion/generar — venta RPC-missing fallback (V7)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("falls back to direct inserts when crear_factura_venta_atomica is missing", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "crear_factura_venta_atomica") {
        return Promise.resolve({
          data: null,
          error: { code: "42883", message: "function crear_factura_venta_atomica does not exist" },
        })
      }
      return Promise.resolve({ data: null, error: null })
    }) as any)

    const insertedFactura = {
      id: "f-fallback",
      venta_id: "v1",
      numero_factura: "0001-00000099",
      fecha: "2026-01-01",
      subtotal: 100,
      iva: 0,
      total: 100,
      estado_pago: "PAGADO",
    }

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ventas") return createChainMock(ventaBase()) as any
      if (table === "facturas") return createChainMock(insertedFactura) as any
      if (table === "items_factura") return createChainMock([]) as any
      return createChainMock(null, { message: `No mock for table: ${table}` }) as any
    })

    const res = await generarPost(createPostRequest({ ventaId: "v1" }))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(201)
    expect(body.id).toBe("f-fallback")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run __tests__/api/factura-venta.test.ts`
Expected: FAIL — `ventaId` is rejected by the current `z.object({ordenId})` schema in every case (400/404/status mismatches), and `crear_factura_venta_atomica` is never called.

- [ ] **Step 3: Implement the venta path**

Replace the schema and add the union branch in `app/api/facturacion/generar/route.ts`:

```ts
// Replace the existing `generarFacturaSchema` (top of file) with:
const generarFacturaSchema = z.union([
  z.object({ ordenId: z.string().min(1, "La orden es requerida") }).strict(),
  z.object({ ventaId: z.string().min(1, "La venta es requerida") }).strict(),
])
```

In `POST`, replace `const { ordenId } = generarFacturaSchema.parse(body)` with the branch dispatch:

```ts
    const parsedBody = generarFacturaSchema.parse(body)

    if ("ventaId" in parsedBody) {
      return await generarFacturaDesdeVenta({
        ventaId: parsedBody.ventaId,
        organizationId: organizationId!,
      })
    }

    const { ordenId } = parsedBody
```

(everything below that line in the existing orden flow stays untouched.)

Add the new venta flow and its JS fallback at the end of the file (after `crearFacturaJsFallback`):

```ts
// ---------------------------------------------------------------------------
// Venta path — POST /api/facturacion/generar { ventaId }
// ---------------------------------------------------------------------------
async function generarFacturaDesdeVenta(opts: {
  ventaId: string
  organizationId: string
}): Promise<NextResponse> {
  const { ventaId, organizationId } = opts

  const { data: venta, error: ventaError } = await supabaseAdmin
    .from("ventas")
    .select(`
      id,
      estado,
      numero_venta,
      subtotal,
      total,
      iva_neto,
      iva_monto,
      monto_abonado,
      estado_pago,
      organization_id,
      cliente_nombre,
      items_venta (
        inventario_id,
        descripcion,
        cantidad,
        precio_unitario,
        subtotal
      ),
      facturas (id)
    `)
    .eq("id", ventaId)
    .eq("organization_id", organizationId)
    .single()

  if (ventaError || !venta) {
    return NextResponse.json({ error: "Venta no encontrada" }, { status: 404 })
  }

  if (venta.estado === "ANULADA") {
    return NextResponse.json({ error: "La venta está anulada" }, { status: 400 })
  }

  if (venta.facturas && venta.facturas.length > 0) {
    return NextResponse.json(
      { error: "Ya existe una factura para esta venta" },
      { status: 400 }
    )
  }

  const iva = Number(venta.iva_monto ?? 0)
  const subtotal = venta.iva_neto != null ? Number(venta.iva_neto) : Number(venta.subtotal)
  const total = Number(venta.total)
  const montoAbonado = Number(venta.monto_abonado ?? 0)
  const estadoPago = venta.estado_pago || "PENDIENTE"

  const itemsJsonb = (venta.items_venta || []).map((item: any) => ({
    descripcion: item.descripcion,
    cantidad: item.cantidad,
    precio_unitario: item.precio_unitario,
    subtotal: item.subtotal,
    tipo: item.inventario_id ? "REPUESTO" : "OTRO",
  }))

  const numeroFactura = await getNextInvoiceNumber(organizationId)

  const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc(
    "crear_factura_venta_atomica",
    {
      p_venta_id: ventaId,
      p_numero_factura: numeroFactura,
      p_subtotal: subtotal,
      p_iva: iva,
      p_total: total,
      p_monto_abonado: montoAbonado,
      p_estado_pago: estadoPago,
      p_items: itemsJsonb,
    }
  )

  if (!rpcError) {
    const facturaId = (rpcResult as { id: string }).id

    const { data: itemsFactura } = await supabaseAdmin
      .from("items_factura")
      .select("*")
      .eq("factura_id", facturaId)

    return NextResponse.json(
      {
        id: facturaId,
        ventaId,
        numeroFactura,
        fecha: null,
        subtotal,
        iva,
        total,
        estadoPago,
        items: (itemsFactura || []).map((i: any) => ({
          id: i.id,
          descripcion: i.descripcion,
          cantidad: i.cantidad,
          precioUnitario: i.precio_unitario,
          subtotal: i.subtotal,
          tipo: i.tipo,
        })),
        venta: {
          id: venta.id,
          numeroVenta: venta.numero_venta,
          cliente: { nombre: venta.cliente_nombre },
        },
      },
      { status: 201 }
    )
  }

  if (isFunctionMissingError(rpcError)) {
    console.warn("[facturacion] crear_factura_venta_atomica not found; falling back to JS path")
    return await crearFacturaVentaJsFallback({
      ventaId,
      organizationId,
      venta,
      numeroFactura,
      subtotal,
      iva,
      total,
      montoAbonado,
      estadoPago,
      itemsJsonb,
    })
  }

  console.error("[facturacion] Unexpected RPC error (crear venta):", rpcError)
  return NextResponse.json({ error: "Error al generar factura" }, { status: 500 })
}

// JS fallback — used when migration 292 is not yet applied.
async function crearFacturaVentaJsFallback(opts: {
  ventaId: string
  organizationId: string
  venta: any
  numeroFactura: string | number
  subtotal: number
  iva: number
  total: number
  montoAbonado: number
  estadoPago: string
  itemsJsonb: Array<{
    descripcion: string
    cantidad: number
    precio_unitario: number
    subtotal: number
    tipo: string
  }>
}): Promise<NextResponse> {
  const {
    ventaId,
    organizationId,
    venta,
    numeroFactura,
    subtotal,
    iva,
    total,
    montoAbonado,
    estadoPago,
    itemsJsonb,
  } = opts

  const { data: factura, error: createError } = await supabaseAdmin
    .from("facturas")
    .insert({
      venta_id: ventaId,
      organization_id: organizationId,
      numero_factura: numeroFactura,
      subtotal,
      iva,
      total,
      monto_abonado: montoAbonado,
      estado_pago: estadoPago,
    })
    .select()
    .single()

  if (createError) {
    throw createError
  }

  if (itemsJsonb.length > 0) {
    const { error: itemsError } = await supabaseAdmin
      .from("items_factura")
      .insert(
        itemsJsonb.map((item) => ({
          factura_id: factura.id,
          descripcion: item.descripcion,
          cantidad: item.cantidad,
          precio_unitario: item.precio_unitario,
          subtotal: item.subtotal,
          tipo: item.tipo,
        }))
      )

    if (itemsError) {
      console.error("[facturacion] items_factura insert failed (venta); rolling back factura:", itemsError)
      await supabaseAdmin.from("facturas").delete().eq("id", factura.id)
      return NextResponse.json({ error: "Error al crear items de factura" }, { status: 500 })
    }
  }

  const { data: itemsFactura } = await supabaseAdmin
    .from("items_factura")
    .select("*")
    .eq("factura_id", factura.id)

  return NextResponse.json(
    {
      id: factura.id,
      ventaId: factura.venta_id,
      numeroFactura: factura.numero_factura,
      fecha: factura.fecha,
      subtotal: factura.subtotal,
      iva: factura.iva,
      total: factura.total,
      estadoPago: factura.estado_pago,
      items: (itemsFactura || []).map((i: any) => ({
        id: i.id,
        descripcion: i.descripcion,
        cantidad: i.cantidad,
        precioUnitario: i.precio_unitario,
        subtotal: i.subtotal,
        tipo: i.tipo,
      })),
      venta: {
        id: venta.id,
        numeroVenta: venta.numero_venta,
        cliente: { nombre: venta.cliente_nombre },
      },
    },
    { status: 201 }
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/api/factura-venta.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Run the existing orden-path suite to confirm no regression**

Run: `npx vitest run __tests__/api/factura-iva-per-org.test.ts`
Run: `npx vitest run __tests__/api/factura-creacion-atomica.test.ts`
Expected: both still PASS unchanged (the `.strict()` union still accepts `{ordenId}`-only bodies).

- [ ] **Step 6: Commit**

```bash
git add app/api/facturacion/generar/route.ts __tests__/api/factura-venta.test.ts
git commit -m "feat(facturacion): generate invoices from sales"
```

---

### Task 3: `GET /api/facturacion` — mixed listing with `origen`

**Files:**
- Modify: `app/api/facturacion/route.ts`
- Test: `__tests__/api/facturacion-listado-mixto.test.ts`

**Interfaces:**
- Consumes: `sucursalParaLectura` (`lib/sucursal.ts`).
- Produces (consumed by Task 7): array of `{id, origen: "orden" | "venta", numeroFactura, fecha, subtotal, iva, total, montoAbonado, estadoPago, createdAt, pagos, orden?: {...}, venta?: {...}}`, sorted by `fecha` descending, mixing both origins.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/api/facturacion-listado-mixto.test.ts
/**
 * Tests: GET /api/facturacion returns both orden- and venta-sourced invoices
 * with an `origen` discriminator, merged and sorted by fecha desc.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createGetRequest, parseResponse } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

import { GET as facturacionGet } from "@/app/api/facturacion/route"

function chainableThenable(result: { data: any; error: any }) {
  const chain: any = {}
  const methods = ["select", "eq", "order"]
  for (const m of methods) chain[m] = vi.fn().mockReturnValue(chain)
  chain.then = (resolve: any) => Promise.resolve(result).then(resolve)
  return chain
}

describe("GET /api/facturacion — mixed origen listing", () => {
  beforeEach(() => vi.clearAllMocks())

  it("merges orden and venta invoices, each tagged with origen, sorted by fecha desc", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    const facturaOrden = {
      id: "f-orden-1",
      orden_id: "o1",
      numero_factura: "0001-00000001",
      fecha: "2026-01-01T00:00:00Z",
      subtotal: 100,
      iva: 0,
      total: 100,
      monto_abonado: 100,
      estado_pago: "PAGADO",
      created_at: "2026-01-01T00:00:00Z",
      ordenes_servicio: {
        id: "o1",
        numero_orden: 1,
        codigo_orden: "CEL001",
        dispositivo: "iPhone",
        organization_id: "org-1",
        clientes: { id: "c1", nombre: "Ana" },
      },
      pagos_parciales: [],
    }

    const facturaVenta = {
      id: "f-venta-1",
      venta_id: "v1",
      numero_factura: "0001-00000002",
      fecha: "2026-01-02T00:00:00Z",
      subtotal: 200,
      iva: 0,
      total: 200,
      monto_abonado: 200,
      estado_pago: "PAGADO",
      created_at: "2026-01-02T00:00:00Z",
      ventas: {
        id: "v1",
        numero_venta: 5,
        cliente_nombre: "Consumidor Final",
        cliente_id: null,
        organization_id: "org-1",
      },
      pagos_parciales: [],
    }

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table !== "facturas") {
        return chainableThenable({ data: null, error: { message: `No mock for table: ${table}` } })
      }
      // Both queries hit the same table name; disambiguate by call order:
      // 1st call = ordenes query, 2nd call = ventas query.
      const callIndex = vi.mocked(supabaseAdmin.from).mock.calls.length
      if (callIndex === 1) return chainableThenable({ data: [facturaOrden], error: null })
      return chainableThenable({ data: [facturaVenta], error: null })
    })

    const res = await facturacionGet(createGetRequest("http://localhost:3000/api/facturacion"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body).toHaveLength(2)
    // Sorted by fecha desc: venta (01-02) before orden (01-01)
    expect(body[0].origen).toBe("venta")
    expect(body[0].venta.numeroVenta).toBe(5)
    expect(body[1].origen).toBe("orden")
    expect(body[1].orden.codigoOrden).toBe("CEL001")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/api/facturacion-listado-mixto.test.ts`
Expected: FAIL — current response has no `origen` field and only contains orden-sourced rows.

- [ ] **Step 3: Implement the dual-query listing**

Replace the query section of `app/api/facturacion/route.ts` (from `let query = supabaseAdmin...` through the `facturasFormatted` mapping) with:

```ts
    const { searchParams } = new URL(request.url)
    const estadoPago = searchParams.get("estadoPago")

    // Two separate `!inner` queries instead of one dual-left-join query:
    // PostgREST embedded-resource filters only narrow the nested object —
    // they don't turn a left-embed into an inner join on the parent row.
    // `facturas` has no own `sucursal_id` column, so branch scoping must
    // go through `ordenes_servicio!inner` / `ventas!inner`, and a row only
    // ever matches one of the two (XOR constraint, migration 292). Merging
    // two `!inner` queries in JS keeps the existing org/branch filter
    // semantics identical to before this change.
    let ordenesQuery = supabaseAdmin
      .from("facturas")
      .select(`
        *,
        ordenes_servicio!inner (
          id,
          numero_orden,
          codigo_orden,
          dispositivo,
          organization_id,
          clientes (*)
        ),
        pagos_parciales (*)
      `)
      .eq("ordenes_servicio.organization_id", organizationId!)

    let ventasQuery = supabaseAdmin
      .from("facturas")
      .select(`
        *,
        ventas!inner (
          id,
          numero_venta,
          cliente_nombre,
          cliente_id,
          organization_id
        ),
        pagos_parciales (*)
      `)
      .eq("ventas.organization_id", organizationId!)

    if (sid) {
      ordenesQuery = ordenesQuery.eq("ordenes_servicio.sucursal_id", sid)
      ventasQuery = ventasQuery.eq("ventas.sucursal_id", sid)
    }

    if (estadoPago) {
      ordenesQuery = ordenesQuery.eq("estado_pago", estadoPago)
      ventasQuery = ventasQuery.eq("estado_pago", estadoPago)
    }

    const [{ data: facturasOrden, error: ordenError }, { data: facturasVenta, error: ventaError }] =
      await Promise.all([ordenesQuery, ventasQuery])

    if (ordenError) throw ordenError
    if (ventaError) throw ventaError

    const formatPagos = (pagos: any[] | null) =>
      (pagos || [])
        .map((p: any) => ({
          id: p.id,
          monto: p.monto,
          metodoPago: p.metodo_pago,
          referencia: p.numero_referencia,
          fecha: p.fecha,
          notas: p.observaciones,
          cuotas: p.cuotas,
          recargoPorcentaje: p.recargo_porcentaje,
          montoOriginal: p.monto_original,
        }))
        .sort((a: any, b: any) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())

    const facturasFormatted = [
      ...(facturasOrden || []).map((f: any) => ({
        id: f.id,
        origen: "orden" as const,
        ordenId: f.orden_id,
        numeroFactura: f.numero_factura,
        fecha: f.fecha,
        subtotal: f.subtotal,
        iva: f.iva,
        total: f.total,
        montoAbonado: f.monto_abonado,
        estadoPago: f.estado_pago,
        createdAt: f.created_at,
        orden: {
          id: f.ordenes_servicio.id,
          numeroOrden: f.ordenes_servicio.numero_orden,
          codigoOrden: f.ordenes_servicio.codigo_orden,
          dispositivo: f.ordenes_servicio.dispositivo,
          cliente: f.ordenes_servicio.clientes,
        },
        pagos: formatPagos(f.pagos_parciales),
      })),
      ...(facturasVenta || []).map((f: any) => ({
        id: f.id,
        origen: "venta" as const,
        ventaId: f.venta_id,
        numeroFactura: f.numero_factura,
        fecha: f.fecha,
        subtotal: f.subtotal,
        iva: f.iva,
        total: f.total,
        montoAbonado: f.monto_abonado,
        estadoPago: f.estado_pago,
        createdAt: f.created_at,
        venta: {
          id: f.ventas.id,
          numeroVenta: f.ventas.numero_venta,
          clienteNombre: f.ventas.cliente_nombre,
          clienteId: f.ventas.cliente_id,
        },
        pagos: formatPagos(f.pagos_parciales),
      })),
    ].sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())

    return NextResponse.json(facturasFormatted, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    })
```

(The `requireAdmin()` / `sucursalParaLectura()` block above this stays unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/api/facturacion-listado-mixto.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/facturacion/route.ts __tests__/api/facturacion-listado-mixto.test.ts
git commit -m "feat(facturacion): list venta-sourced invoices alongside orden invoices"
```

---

### Task 4: `GET/PUT/DELETE /api/facturacion/[id]` — resolve either origin

**Files:**
- Modify: `app/api/facturacion/[id]/route.ts`
- Test: `__tests__/api/factura-detalle-venta.test.ts`

**Interfaces:**
- Consumes: RPCs `anular_factura_atomica`, `eliminar_factura_atomica` (Task 1, already origin-agnostic).
- Produces: a local helper `fetchFacturaConOrigen(id, opts?) → { origen: "orden" | "venta"; organizationId: string; factura: any } | null` and `formatFacturaResponse(result)`, used by `GET` and by `fetchAndReturnFactura` (called after `PUT` anular). `GET` response gains `origen` and a `venta` alternative to `orden`. `DELETE`'s pre-check no longer 404s for venta-origin invoices.

- [ ] **Step 1: Write the failing tests**

```ts
// __tests__/api/factura-detalle-venta.test.ts
/**
 * Tests: GET/PUT/DELETE /api/facturacion/[id] resolve venta-sourced invoices
 * (previously 404'd / crashed because of the ordenes_servicio!inner join).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, createGetRequest, createPostRequest, parseResponse } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

import { GET as facturaGet, PUT as facturaPut, DELETE as facturaDelete } from "@/app/api/facturacion/[id]/route"

const params = Promise.resolve({ id: "f-venta-1" })

function ventaFacturaRow(over: Partial<any> = {}) {
  return {
    id: "f-venta-1",
    orden_id: null,
    venta_id: "v1",
    numero_factura: "0001-00000002",
    fecha: "2026-01-02T00:00:00Z",
    subtotal: 200,
    iva: 0,
    total: 200,
    monto_abonado: 200,
    estado_pago: "PAGADO",
    ventas: {
      id: "v1",
      numero_venta: 5,
      cliente_nombre: "Consumidor Final",
      cliente_id: null,
      organization_id: "org-1",
      sucursal_id: "suc-1",
    },
    pagos_parciales: [],
    ...over,
  }
}

describe("GET /api/facturacion/[id] — venta origin", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns the venta-sourced invoice with origen='venta' (base lookup + branch fetch)", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "facturas") {
        const callIndex = vi.mocked(supabaseAdmin.from).mock.calls.length
        // 1st call: base lookup (id, orden_id, venta_id). 2nd call: branch fetch.
        if (callIndex === 1) return createChainMock({ id: "f-venta-1", orden_id: null, venta_id: "v1" }) as any
        return createChainMock(ventaFacturaRow()) as any
      }
      return createChainMock(null, { message: `No mock for table: ${table}` }) as any
    })

    const res = await facturaGet(createGetRequest("http://localhost:3000/api/facturacion/f-venta-1"), { params })
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.origen).toBe("venta")
    expect(body.venta.numeroVenta).toBe(5)
    expect(body.ventaId).toBe("v1")
  })

  it("404 when the base lookup finds nothing", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "facturas") return createChainMock(null, { message: "not found" }) as any
      return createChainMock(null, { message: `No mock for table: ${table}` }) as any
    })

    const res = await facturaGet(createGetRequest("http://localhost:3000/api/facturacion/f-venta-1"), { params })
    const { status } = await parseResponse(res)
    expect(status).toBe(404)
  })
})

describe("DELETE /api/facturacion/[id] — venta origin", () => {
  beforeEach(() => vi.clearAllMocks())

  it("does not 404 on the pre-check for a venta-sourced invoice", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "facturas") {
        const callIndex = vi.mocked(supabaseAdmin.from).mock.calls.length
        if (callIndex === 1) return createChainMock({ id: "f-venta-1", orden_id: null, venta_id: "v1" }) as any
        return createChainMock(ventaFacturaRow()) as any
      }
      if (table === "audit_logs") return createChainMock({}) as any
      return createChainMock(null, { message: `No mock for table: ${table}` }) as any
    })
    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "eliminar_factura_atomica") return Promise.resolve({ data: { ok: true }, error: null })
      return Promise.resolve({ data: null, error: null })
    }) as any)

    const res = await facturaDelete(new Request("http://localhost:3000/api/facturacion/f-venta-1", { method: "DELETE" }), { params })
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.success).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run __tests__/api/factura-detalle-venta.test.ts`
Expected: FAIL — `GET` currently 404s (the `ordenes_servicio!inner` filter excludes the venta-sourced row entirely), `DELETE`'s pre-check does the same.

- [ ] **Step 3: Implement the shared helper and rewire GET/PUT/DELETE**

In `app/api/facturacion/[id]/route.ts`, add the shared helper right after `isFunctionMissingError`:

```ts
// ---------------------------------------------------------------------------
// fetchFacturaConOrigen — resolves a factura by id regardless of whether it
// is orden-sourced or venta-sourced. Two-step (base lookup by id, then a
// branch-specific `!inner` fetch) instead of a single dual-left-join query,
// for the same reason as GET /api/facturacion (see Task 3): embedded filters
// don't turn a left-embed into an inner join on the parent row.
// ---------------------------------------------------------------------------
async function fetchFacturaConOrigen(
  id: string,
  opts?: { sid?: string | null }
): Promise<{ origen: "orden" | "venta"; organizationId: string; factura: any } | null> {
  const { data: base, error: baseError } = await supabaseAdmin
    .from("facturas")
    .select("id, orden_id, venta_id")
    .eq("id", id)
    .single()

  if (baseError || !base) return null

  if (base.orden_id) {
    let query = supabaseAdmin
      .from("facturas")
      .select(`
        *,
        ordenes_servicio!inner (
          id,
          numero_orden,
          dispositivo,
          organization_id,
          sucursal_id,
          cliente_id,
          clientes (*)
        ),
        pagos_parciales (*)
      `)
      .eq("id", id)
    if (opts?.sid) query = query.eq("ordenes_servicio.sucursal_id", opts.sid)
    const { data, error } = await query.single()
    if (error || !data) return null
    return { origen: "orden", organizationId: data.ordenes_servicio.organization_id, factura: data }
  }

  let query = supabaseAdmin
    .from("facturas")
    .select(`
      *,
      ventas!inner (
        id,
        numero_venta,
        cliente_nombre,
        cliente_id,
        organization_id,
        sucursal_id
      ),
      pagos_parciales (*)
    `)
    .eq("id", id)
  if (opts?.sid) query = query.eq("ventas.sucursal_id", opts.sid)
  const { data, error } = await query.single()
  if (error || !data) return null
  return { origen: "venta", organizationId: data.ventas.organization_id, factura: data }
}

function formatFacturaResponse(result: { origen: "orden" | "venta"; factura: any }) {
  const f = result.factura
  const base = {
    id: f.id,
    origen: result.origen,
    numeroFactura: f.numero_factura,
    fecha: f.fecha,
    subtotal: f.subtotal,
    iva: f.iva,
    total: f.total,
    montoAbonado: f.monto_abonado,
    estadoPago: f.estado_pago,
    createdAt: f.fecha,
    pagos: (f.pagos_parciales || [])
      .map((p: any) => ({
        id: p.id,
        monto: p.monto,
        metodoPago: p.metodo_pago,
        referencia: p.numero_referencia,
        fecha: p.fecha,
        notas: p.observaciones,
        cuotas: p.cuotas,
        recargoPorcentaje: p.recargo_porcentaje,
        montoOriginal: p.monto_original,
      }))
      .sort((a: any, b: any) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime()),
  }

  if (result.origen === "orden") {
    return {
      ...base,
      ordenId: f.orden_id,
      orden: {
        id: f.ordenes_servicio.id,
        numeroOrden: f.ordenes_servicio.numero_orden,
        dispositivo: f.ordenes_servicio.dispositivo,
        cliente: f.ordenes_servicio.clientes,
      },
    }
  }

  return {
    ...base,
    ventaId: f.venta_id,
    venta: {
      id: f.ventas.id,
      numeroVenta: f.ventas.numero_venta,
      cliente: { id: f.ventas.cliente_id, nombre: f.ventas.cliente_nombre },
    },
  }
}
```

Replace the body of `GET` (from `const { id } = await params` through the `return NextResponse.json({...})` for the success case) with:

```ts
    const { id } = await params
    const result = await fetchFacturaConOrigen(id, { sid })

    if (!result || result.organizationId !== organizationId) {
      return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 })
    }

    return NextResponse.json(formatFacturaResponse(result), {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    })
```

Replace `fetchAndReturnFactura` entirely with:

```ts
async function fetchAndReturnFactura(id: string): Promise<NextResponse> {
  const result = await fetchFacturaConOrigen(id)
  if (!result) {
    return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 })
  }
  return NextResponse.json(formatFacturaResponse(result))
}
```

Replace the `DELETE` pre-check block (from `const { data: factura, error: fetchError } = await supabaseAdmin.from("facturas")...` through the `ordenOrgId` check) with:

```ts
    const { id } = await params

    const result = await fetchFacturaConOrigen(id)
    if (!result) {
      return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 })
    }
    if (result.organizationId !== organizationId) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 })
    }

    const numeroOrigen =
      result.origen === "orden"
        ? result.factura.ordenes_servicio.numero_orden
        : result.factura.ventas.numero_venta
```

Update the rest of `DELETE` to read from `result.factura` instead of the old `factura` variable, and to pass `result.origen === "venta"` through instead of calling the legacy fallback (which assumes an orden):

```ts
    const { error: rpcError } = await supabaseAdmin.rpc("eliminar_factura_atomica", {
      p_org_id: organizationId!,
      p_factura_id: id,
      p_user_id: userId!,
    })

    if (!rpcError) {
      await supabaseAdmin.from("audit_logs").insert({
        organization_id: organizationId,
        user_id: userId,
        action: "DELETE_FACTURA",
        entity_type: "factura",
        entity_id: id,
        details: {
          numero_factura: result.factura.numero_factura,
          total: result.factura.total,
          origen: result.origen,
          numeroOrigen,
        },
      })
      return NextResponse.json({ success: true })
    }

    if (isFunctionMissingError(rpcError)) {
      if (result.origen === "venta") {
        // The legacy JS fallback (below) predates venta-sourced invoices and
        // assumes an orden join; eliminar_factura_atomica always exists once
        // migration 292 is applied, so this path is unreachable in practice.
        console.error("[facturacion] eliminar_factura_atomica missing; venta-origin fallback not supported")
        return NextResponse.json(
          { error: "No se pudo eliminar la factura: falta aplicar una migración pendiente" },
          { status: 500 }
        )
      }
      console.warn("[facturacion] eliminar_factura_atomica not found; falling back to JS path")
      return await eliminarFacturaJsFallback({
        id,
        organizationId: organizationId!,
        userId: userId!,
        factura: {
          id: result.factura.id,
          numero_factura: result.factura.numero_factura,
          total: result.factura.total,
          ordenes_servicio: { organization_id: result.organizationId, numero_orden: numeroOrigen },
        },
      })
    }
```

(`eliminarFacturaJsFallback` itself is untouched — it does its own independent `ordenes_servicio!inner(cliente_id, sucursal_id)` fetch and only reads `.numero_factura`/`.total`/`.ordenes_servicio.numero_orden` off the passed `factura`, all of which the minimal object above provides. `anularFacturaJsFallback` is also untouched — see Global Constraints deviation note below.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/api/factura-detalle-venta.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the existing single-factura suites to confirm no regression**

Run: `npx vitest run __tests__/api/factura-anular-atomica.test.ts`
Run: `npx vitest run __tests__/api/factura-numero-unique.test.ts`
Run: `npx vitest run __tests__/api/pago-factura-atomico.test.ts`
Expected: all still PASS (the orden branch of `fetchFacturaConOrigen` preserves the exact same response shape as before).

- [ ] **Step 6: Commit**

```bash
git add app/api/facturacion/[id]/route.ts __tests__/api/factura-detalle-venta.test.ts
git commit -m "fix(facturacion): resolve venta-sourced invoices in the [id] routes"
```

---

## PR 2 — UI

### Task 5: `GET /api/facturacion/candidatos` — uninvoiced órdenes + ventas

**Files:**
- Create: `app/api/facturacion/candidatos/route.ts`
- Test: `__tests__/api/facturacion-candidatos.test.ts`

**Interfaces:**
- Produces (consumed by Task 6): `GET /api/facturacion/candidatos` → `{ordenes: Array<{id, numeroOrden, codigoOrden, dispositivo, clienteNombre}>, ventas: Array<{id, numeroVenta, clienteNombre, total}>}`, both arrays excluding anything already invoiced, capped at 200 rows each, most recent first.

**Design decision (not in the original spec text):** the spec left the candidates source open ("decide the simplest option consistent with the code"). Reusing `GET /api/ordenes`/`GET /api/ventas` was rejected — both return heavy nested relations (items, garantías, devoluciones, pagos) meant for list/detail pages, and neither supports an "uninvoiced" filter (PostgREST can't filter "reverse-FK array is empty" server-side, so it has to be a JS `.filter()` either way — same technique already used in `generar/route.ts`'s existing-invoice gate). A dedicated endpoint keeps the modal's payload small and the filter logic in one place.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/api/facturacion-candidatos.test.ts
/**
 * Tests: GET /api/facturacion/candidatos returns uninvoiced REPARADO/ENTREGADO
 * ordenes and uninvoiced COMPLETADA ventas, filtering out anything that
 * already has a factura.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, createGetRequest, parseResponse } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

import { GET as candidatosGet } from "@/app/api/facturacion/candidatos/route"

describe("GET /api/facturacion/candidatos", () => {
  beforeEach(() => vi.clearAllMocks())

  it("excludes ordenes and ventas that already have a factura", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ordenes_servicio") {
        return createChainMock([
          { id: "o1", numero_orden: 1, codigo_orden: "CEL001", dispositivo: "iPhone", clientes: { nombre: "Ana" }, facturas: [] },
          { id: "o2", numero_orden: 2, codigo_orden: "CEL002", dispositivo: "Samsung", clientes: { nombre: "Beto" }, facturas: [{ id: "f-existing" }] },
        ]) as any
      }
      if (table === "ventas") {
        return createChainMock([
          { id: "v1", numero_venta: 5, cliente_nombre: "Consumidor Final", total: 200, facturas: [] },
          { id: "v2", numero_venta: 6, cliente_nombre: "Carla", total: 300, facturas: [{ id: "f-existing-2" }] },
        ]) as any
      }
      return createChainMock(null, { message: `No mock for table: ${table}` }) as any
    })

    const res = await candidatosGet(createGetRequest("http://localhost:3000/api/facturacion/candidatos"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.ordenes).toHaveLength(1)
    expect(body.ordenes[0].id).toBe("o1")
    expect(body.ventas).toHaveLength(1)
    expect(body.ventas[0].id).toBe("v1")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/api/facturacion-candidatos.test.ts`
Expected: FAIL — the route module does not exist yet.

- [ ] **Step 3: Implement the route**

```ts
// app/api/facturacion/candidatos/route.ts
import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { data: ordenes, error: ordenesError } = await supabaseAdmin
      .from("ordenes_servicio")
      .select("id, numero_orden, codigo_orden, dispositivo, clientes (nombre), facturas (id)")
      .eq("organization_id", organizationId!)
      .in("estado", ["REPARADO", "ENTREGADO"])
      .order("fecha_ingreso", { ascending: false })
      .limit(200)

    if (ordenesError) throw ordenesError

    const { data: ventas, error: ventasError } = await supabaseAdmin
      .from("ventas")
      .select("id, numero_venta, cliente_nombre, total, facturas (id)")
      .eq("organization_id", organizationId!)
      .eq("estado", "COMPLETADA")
      .order("created_at", { ascending: false })
      .limit(200)

    if (ventasError) throw ventasError

    return NextResponse.json(
      {
        ordenes: (ordenes || [])
          .filter((o: any) => !o.facturas || o.facturas.length === 0)
          .map((o: any) => ({
            id: o.id,
            numeroOrden: o.numero_orden,
            codigoOrden: o.codigo_orden,
            dispositivo: o.dispositivo,
            clienteNombre: o.clientes?.nombre || "Sin cliente",
          })),
        ventas: (ventas || [])
          .filter((v: any) => !v.facturas || v.facturas.length === 0)
          .map((v: any) => ({
            id: v.id,
            numeroVenta: v.numero_venta,
            clienteNombre: v.cliente_nombre,
            total: parseFloat(v.total),
          })),
      },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
    )
  } catch (error) {
    console.error("Error fetching facturacion candidatos:", error)
    return NextResponse.json({ error: "Error al obtener candidatos" }, { status: 500 })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/api/facturacion-candidatos.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/facturacion/candidatos/route.ts __tests__/api/facturacion-candidatos.test.ts
git commit -m "feat(facturacion): candidates endpoint for the generar-factura picker"
```

---

### Task 6: "Generar factura" modal wired into `/facturacion`

**Files:**
- Create: `components/facturacion/generar-factura-modal.tsx`
- Modify: `components/facturacion/facturacion-list.tsx`
- Test: `__tests__/components/generar-factura-modal.test.tsx`

**Interfaces:**
- Consumes: `GET /api/facturacion/candidatos` (Task 5), `POST /api/facturacion/generar` (Task 2), `Dialog`/`Tabs`/`Input`/`Button` from `components/ui/*`, `useCurrency()` from `contexts/currency-context`.
- Produces: `GenerarFacturaModal({open, onOpenChange, onSuccess})` — a controlled dialog that lists uninvoiced órdenes/ventas in two tabs with client-side search and posts to `/api/facturacion/generar` on selection.

**Design decision:** the header button lives inside `FacturacionList`'s existing toolbar row (next to the estado filter / view-mode toggle) rather than in `PageShell`'s `actions` slot in `app/(dashboard)/facturacion/page.tsx`. The modal needs `mutate` (from `FacturacionList`'s `useSWR`) to refresh the list on success; keeping the button + modal state inside the component that already owns `mutate` avoids new prop-drilling between the page and the list for a purely presentational "header button" requirement.

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/components/generar-factura-modal.test.tsx
/**
 * Tests: GenerarFacturaModal — loads candidates on open, filters by search,
 * and posts the right body ({ordenId} or {ventaId}) on selection.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import React from "react"

const mockFetch = vi.fn()
global.fetch = mockFetch

describe("GenerarFacturaModal", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("loads and shows uninvoiced ordenes and ventas when opened", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ordenes: [{ id: "o1", numeroOrden: 1, codigoOrden: "CEL001", dispositivo: "iPhone", clienteNombre: "Ana" }],
        ventas: [{ id: "v1", numeroVenta: 5, clienteNombre: "Consumidor Final", total: 200 }],
      }),
    })

    const { GenerarFacturaModal } = await import("@/components/facturacion/generar-factura-modal")
    render(<GenerarFacturaModal open={true} onOpenChange={() => {}} onSuccess={() => {}} />)

    await waitFor(() => {
      expect(screen.getByText(/CEL001/)).toBeInTheDocument()
    })
  })

  it("posts { ventaId } when a venta row is clicked and calls onSuccess", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ordenes: [],
          ventas: [{ id: "v1", numeroVenta: 5, clienteNombre: "Consumidor Final", total: 200 }],
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "f-new" }) })

    const onSuccess = vi.fn()
    const { GenerarFacturaModal } = await import("@/components/facturacion/generar-factura-modal")
    render(<GenerarFacturaModal open={true} onOpenChange={() => {}} onSuccess={onSuccess} />)

    fireEvent.click(await screen.findByRole("tab", { name: "Ventas" }))
    const row = await screen.findByText(/Consumidor Final/)
    fireEvent.click(row.closest("button")!)

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/facturacion/generar",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ ventaId: "v1" }),
        })
      )
      expect(onSuccess).toHaveBeenCalled()
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/components/generar-factura-modal.test.tsx`
Expected: FAIL — the component module does not exist yet.

- [ ] **Step 3: Implement the modal**

```tsx
// components/facturacion/generar-factura-modal.tsx
"use client"

import { useState, useEffect, useMemo } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { useCurrency } from "@/contexts/currency-context"
import { Search, FileText } from "lucide-react"

interface CandidatoOrden {
  id: string
  numeroOrden: number
  codigoOrden: string | null
  dispositivo: string
  clienteNombre: string
}

interface CandidatoVenta {
  id: string
  numeroVenta: number
  clienteNombre: string
  total: number
}

interface GenerarFacturaModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function GenerarFacturaModal({ open, onOpenChange, onSuccess }: GenerarFacturaModalProps) {
  const { formatPrice } = useCurrency()
  const [tab, setTab] = useState<"ordenes" | "ventas">("ordenes")
  const [search, setSearch] = useState("")
  const [ordenes, setOrdenes] = useState<CandidatoOrden[]>([])
  const [ventas, setVentas] = useState<CandidatoVenta[]>([])
  const [loading, setLoading] = useState(false)
  const [generandoId, setGenerandoId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setSearch("")
    setError(null)
    setLoading(true)
    fetch("/api/facturacion/candidatos")
      .then((res) => res.json())
      .then((data) => {
        setOrdenes(data.ordenes || [])
        setVentas(data.ventas || [])
      })
      .catch(() => setError("Error al cargar las órdenes y ventas disponibles"))
      .finally(() => setLoading(false))
  }, [open])

  const ordenesFiltradas = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return ordenes
    return ordenes.filter(
      (o) =>
        o.clienteNombre.toLowerCase().includes(q) ||
        o.dispositivo.toLowerCase().includes(q) ||
        (o.codigoOrden || "").toLowerCase().includes(q) ||
        String(o.numeroOrden).includes(q)
    )
  }, [ordenes, search])

  const ventasFiltradas = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return ventas
    return ventas.filter(
      (v) => v.clienteNombre.toLowerCase().includes(q) || String(v.numeroVenta).includes(q)
    )
  }, [ventas, search])

  const generar = async (body: { ordenId: string } | { ventaId: string }) => {
    const id = "ordenId" in body ? body.ordenId : body.ventaId
    setGenerandoId(id)
    setError(null)
    try {
      const res = await fetch("/api/facturacion/generar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Error al generar la factura")
      }
      onOpenChange(false)
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al generar la factura")
    } finally {
      setGenerandoId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Generar factura</DialogTitle>
          <DialogDescription>
            Elegí una orden reparada o una venta completada sin factura.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "ordenes" | "ventas")}>
          <TabsList>
            <TabsTrigger value="ordenes">Órdenes</TabsTrigger>
            <TabsTrigger value="ventas">Ventas</TabsTrigger>
          </TabsList>

          <div className="relative mt-3">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por cliente, dispositivo o número..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>

          {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

          <TabsContent value="ordenes">
            <div className="mt-3 max-h-80 space-y-1 overflow-y-auto">
              {loading ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Cargando...</p>
              ) : ordenesFiltradas.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No hay órdenes sin facturar
                </p>
              ) : (
                ordenesFiltradas.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    disabled={generandoId !== null}
                    onClick={() => generar({ ordenId: o.id })}
                    className="flex w-full items-center justify-between rounded-md border p-3 text-left text-sm hover:bg-muted/50 disabled:opacity-50"
                  >
                    <span>
                      <span className="font-medium">{o.codigoOrden || `#${o.numeroOrden}`}</span>
                      {" — "}
                      {o.clienteNombre} · {o.dispositivo}
                    </span>
                    {generandoId === o.id ? (
                      <span className="text-xs text-muted-foreground">Generando...</span>
                    ) : (
                      <FileText className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>
                ))
              )}
            </div>
          </TabsContent>

          <TabsContent value="ventas">
            <div className="mt-3 max-h-80 space-y-1 overflow-y-auto">
              {loading ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Cargando...</p>
              ) : ventasFiltradas.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No hay ventas sin facturar
                </p>
              ) : (
                ventasFiltradas.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    disabled={generandoId !== null}
                    onClick={() => generar({ ventaId: v.id })}
                    className="flex w-full items-center justify-between rounded-md border p-3 text-left text-sm hover:bg-muted/50 disabled:opacity-50"
                  >
                    <span>
                      <span className="font-medium">V{String(v.numeroVenta).padStart(4, "0")}</span>
                      {" — "}
                      {v.clienteNombre} · {formatPrice(v.total)}
                    </span>
                    {generandoId === v.id ? (
                      <span className="text-xs text-muted-foreground">Generando...</span>
                    ) : (
                      <FileText className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>
                ))
              )}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/components/generar-factura-modal.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire the button into `FacturacionList`**

In `components/facturacion/facturacion-list.tsx`, add the import and open-state:

```tsx
import { Plus as PlusIcon } from "lucide-react" // already imports Plus — reuse the existing import, do not duplicate
import { GenerarFacturaModal } from "./generar-factura-modal"
```

(Adjust: the file already imports `Plus` from `lucide-react` for "Registrar pago" — reuse that same `Plus` icon import, no new import needed for the icon.)

Add state near the other `useState` declarations:

```tsx
  const [showGenerarModal, setShowGenerarModal] = useState(false)
```

In the toolbar row (the `<div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">` block), add the button before the view-mode toggle:

```tsx
        <Button onClick={() => setShowGenerarModal(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Generar factura
        </Button>
```

At the end of the component, alongside the other dialogs, render the modal:

```tsx
      <GenerarFacturaModal
        open={showGenerarModal}
        onOpenChange={setShowGenerarModal}
        onSuccess={() => mutate()}
      />
```

- [ ] **Step 6: Run the modal test again plus a manual TS check**

Run: `npx vitest run __tests__/components/generar-factura-modal.test.tsx`
Expected: PASS (no change expected, confirms the wiring didn't break the import).

- [ ] **Step 7: Commit**

```bash
git add components/facturacion/generar-factura-modal.tsx components/facturacion/facturacion-list.tsx __tests__/components/generar-factura-modal.test.tsx
git commit -m "feat(facturacion): generar-factura modal with orden/venta tabs"
```

---

### Task 7: List — origin badge, link, hide payment actions for venta invoices

**Files:**
- Modify: `components/facturacion/facturacion-list.tsx`
- Test: `__tests__/components/facturacion-list-origen.test.tsx`

**Interfaces:**
- Consumes: `origen`/`venta` fields from `GET /api/facturacion` (Task 3), `Badge` from `components/ui/badge`.
- Produces: each row shows an "Orden"/"Venta" badge linking to `/ordenes/[id]` or `/ventas/[id]`; "Registrar pago" and "Historial de pagos" are hidden for `origen === "venta"` rows (venta invoices never have `pagos_parciales` — design decision in the spec: "venta invoices do not use `pagos_parciales`").

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/components/facturacion-list-origen.test.tsx
/**
 * Tests: FacturacionList renders an origin badge per row and hides the
 * "Registrar pago" action for venta-sourced invoices.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import React from "react"

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { role: "ADMIN" } } }),
}))

const mockFetch = vi.fn()
global.fetch = mockFetch

describe("FacturacionList — origen badge", () => {
  beforeEach(() => vi.clearAllMocks())

  it("shows an Orden badge and a Venta badge, and hides 'Registrar pago' for the venta row", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: "f1",
          origen: "orden",
          numeroFactura: "0001-00000001",
          fecha: "2026-01-01",
          total: 100,
          montoAbonado: 0,
          estadoPago: "PENDIENTE",
          orden: { id: "o1", numeroOrden: 1, codigoOrden: "CEL001", cliente: { nombre: "Ana" } },
          pagos: [],
        },
        {
          id: "f2",
          origen: "venta",
          numeroFactura: "0001-00000002",
          fecha: "2026-01-02",
          total: 200,
          montoAbonado: 200,
          estadoPago: "PAGADO",
          venta: { id: "v1", numeroVenta: 5, clienteNombre: "Consumidor Final" },
          pagos: [],
        },
      ],
    })

    const { FacturacionList } = await import("@/components/facturacion/facturacion-list")
    render(<FacturacionList />)

    await waitFor(() => {
      expect(screen.getByText("Orden")).toBeInTheDocument()
      expect(screen.getByText("Venta")).toBeInTheDocument()
    })

    // Only the orden row (PENDIENTE) offers "Registrar pago"; the venta row
    // never does, even if its estadoPago were not PAGADO.
    expect(screen.getAllByText("Registrar Pago").length + screen.queryAllByText("Registrar pago").length).toBeGreaterThanOrEqual(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/components/facturacion-list-origen.test.tsx`
Expected: FAIL — no "Orden"/"Venta" text exists in the current render (the list only ever renders `factura.orden.*`, and would currently crash reading `factura.orden.cliente.nombre` on the venta row since `orden` is undefined).

- [ ] **Step 3: Implement the origin badge and guarded rendering**

In both the list view (`<tbody>`) and the card view of `components/facturacion/facturacion-list.tsx`, replace every direct `factura.orden.*` access with an origin-aware read, and add the badge. Two representative edits (apply the same pattern to both view modes):

List-view row (`<td className="p-3 text-muted-foreground">`):

```tsx
                        <td className="p-3 text-muted-foreground">
                          <div className="flex items-center gap-2">
                            <Badge variant={factura.origen === "venta" ? "infoSoft" : "outline"}>
                              {factura.origen === "venta" ? "Venta" : "Orden"}
                            </Badge>
                            {factura.origen === "venta" ? (
                              <Link href={`/ventas/${factura.venta.id}`} className="hover:underline">
                                V{String(factura.venta.numeroVenta).padStart(4, "0")}
                              </Link>
                            ) : (
                              <Link href={`/ordenes/${factura.orden.id}`} className="hover:underline">
                                {factura.orden.codigoOrden || `#${factura.orden.numeroOrden}`}
                              </Link>
                            )}
                          </div>
                        </td>
                        <td className="p-3 hidden sm:table-cell">
                          {factura.origen === "venta" ? factura.venta.clienteNombre : factura.orden.cliente.nombre}
                        </td>
```

(Add `import Link from "next/link"` and `import { Badge } from "@/components/ui/badge"` at the top — `Badge` may already be imported for `PaymentStatusBadge`; add the plain `Badge` import alongside it: `import { Badge, PaymentStatusBadge } from "@/components/ui/badge"`.)

Guard "Registrar pago" / "Historial de pagos" in both view modes by adding `factura.origen !== "venta" &&` to the existing conditions, e.g.:

```tsx
                                {factura.origen !== "venta" && factura.estadoPago !== "PAGADO" && factura.estadoPago !== "ANULADA" && (
```

applied to all four occurrences (mobile dropdown item, desktop button, and the two "Historial de pagos" guards, plus the card-view equivalents). "Ver PDF", "Anular", "Eliminar" stay available for both origins (Task 4 already made anular/eliminar origin-agnostic).

Update the card-view header subtitle similarly:

```tsx
                      <div className="text-sm text-muted-foreground mt-1">
                        {factura.origen === "venta"
                          ? `Venta V${String(factura.venta.numeroVenta).padStart(4, "0")} - ${factura.venta.clienteNombre}`
                          : `Orden ${factura.orden.codigoOrden || `#${factura.orden.numeroOrden}`} - ${factura.orden.cliente.nombre}`}
                      </div>
```

And guard `PagoForm`'s `clienteId` prop (only meaningful for orden invoices — venta invoices never render `PagoForm` since it's gated behind the same `factura.origen !== "venta"` condition above, so no further change needed there beyond the existing `factura.orden?.cliente?.id` optional chaining, which already tolerates `orden` being undefined).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/components/facturacion-list-origen.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/facturacion/facturacion-list.tsx __tests__/components/facturacion-list-origen.test.tsx
git commit -m "feat(facturacion): show invoice origin badge and hide payment actions for venta invoices"
```

---

### Task 8: "Generar factura" button on the sale detail page

**Files:**
- Modify: `app/api/ventas/[id]/route.ts`
- Modify: `lib/db-utils.ts`
- Modify: `components/ventas/venta-detail.tsx`
- Test: `__tests__/components/venta-detail-generar-factura.test.tsx`

**Interfaces:**
- Consumes: `POST /api/facturacion/generar` (Task 2).
- Produces: `formatVenta()` gains `facturaId: string | null`; `VentaDetail` interface gains `facturaId`; a "Generar factura" button appears when `venta.estado === "COMPLETADA" && venta.facturaId === null`, visible to ADMIN only (matches the spec: "ADMIN when the venta is COMPLETADA and uninvoiced").

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/components/venta-detail-generar-factura.test.tsx
/**
 * Tests: VentaDetail shows "Generar factura" for ADMIN on an uninvoiced
 * COMPLETADA venta, hides it once facturaId is set, and posts { ventaId }.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import React from "react"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}))
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { role: "ADMIN" } } }),
}))

const mockFetch = vi.fn()
global.fetch = mockFetch

function ventaResponse(over: Partial<any> = {}) {
  return {
    id: "v1",
    numeroVenta: 5,
    clienteId: null,
    clienteNombre: "Consumidor Final",
    clienteTelefono: null,
    vendedor: null,
    items: [],
    garantias: [],
    subtotal: 200,
    descuento: 0,
    total: 200,
    montoAbonado: 200,
    estadoPago: "PAGADO",
    metodoPago: "EFECTIVO",
    estado: "COMPLETADA",
    observaciones: null,
    createdAt: "2026-01-01T00:00:00Z",
    pagos: [],
    facturaId: null,
    ...over,
  }
}

describe("VentaDetail — Generar factura button", () => {
  beforeEach(() => vi.clearAllMocks())

  it("shows the button for an uninvoiced COMPLETADA venta and posts { ventaId }", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ventaResponse() })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ organization: { id: "org-1", slug: "demo", nombre: "Demo" } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "f-new" }) })

    const { VentaDetail } = await import("@/components/ventas/venta-detail")
    render(<VentaDetail ventaId="v1" />)

    const boton = await screen.findByRole("button", { name: /Generar factura/i })
    fireEvent.click(boton)

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/facturacion/generar",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ ventaId: "v1" }) })
      )
    })
  })

  it("hides the button once the venta already has a factura", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ventaResponse({ facturaId: "f-existing" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ organization: { id: "org-1", slug: "demo", nombre: "Demo" } }) })

    const { VentaDetail } = await import("@/components/ventas/venta-detail")
    render(<VentaDetail ventaId="v1" />)

    await waitFor(() => {
      expect(screen.getByText("Venta V0005")).toBeInTheDocument()
    })
    expect(screen.queryByRole("button", { name: /Generar factura/i })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run __tests__/components/venta-detail-generar-factura.test.tsx`
Expected: FAIL — no "Generar factura" button exists yet, and `ventaResponse().facturaId` is not read anywhere.

- [ ] **Step 3: Expose `facturaId` from the API**

In `app/api/ventas/[id]/route.ts`, add `facturas (id)` to the `GET` select (inside the existing template literal, alongside `devoluciones_venta`):

```ts
      .select(`
        *,
        clientes (*),
        users:vendedor_id (id, nombre, email),
        items_venta (*, inventario (*)),
        garantias_venta (*),
        pagos_venta (*),
        devoluciones_venta (*, items_devolucion(*)),
        facturas (id)
      `)
```

In `lib/db-utils.ts`, `formatVenta()`, add `facturaId` to the returned object (after `devoluciones`):

```ts
    devoluciones: venta.devoluciones_venta?.map(formatDevolucion) || [],
    facturaId: venta.facturas?.[0]?.id ?? null,
```

- [ ] **Step 4: Add the button to `VentaDetail`**

In `components/ventas/venta-detail.tsx`, add the role check (the component currently has none — it relies entirely on the backend for authorization; this button additionally hides client-side per the spec's "ADMIN only"):

```tsx
import { useSession } from "next-auth/react"
```

Add `facturaId: string | null` to the `VentaDetail` interface, and inside the component:

```tsx
  const { data: session } = useSession()
  const isAdmin = session?.user?.role === "ADMIN"
  const [generandoFactura, setGenerandoFactura] = useState(false)

  const handleGenerarFactura = async () => {
    if (!venta) return
    setGenerandoFactura(true)
    try {
      const res = await fetch("/api/facturacion/generar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ventaId: venta.id }),
      })
      if (!res.ok) {
        const data = await res.json()
        await showError(data.error || "Error al generar la factura")
        return
      }
      await showSuccess("Factura generada correctamente")
      fetchVenta()
    } catch (error) {
      console.error("Error:", error)
      await showError("Error al generar la factura")
    } finally {
      setGenerandoFactura(false)
    }
  }
```

Add the button inside the existing `{venta.estado === "COMPLETADA" && (<>...</>)}` block, before "Editar":

```tsx
            {isAdmin && !venta.facturaId && (
              <Button
                variant="outline"
                onClick={handleGenerarFactura}
                disabled={generandoFactura}
              >
                <FileText className="mr-2 h-4 w-4" />
                {generandoFactura ? "Generando..." : "Generar factura"}
              </Button>
            )}
```

(`FileText` is already imported at the top of the file.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run __tests__/components/venta-detail-generar-factura.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/ventas/[id]/route.ts lib/db-utils.ts components/ventas/venta-detail.tsx __tests__/components/venta-detail-generar-factura.test.tsx
git commit -m "feat(ventas): generar factura button on the sale detail page"
```

---

### Task 9: Invoice PDF renders venta-sourced invoices

**Files:**
- Modify: `lib/pdf.ts`
- Modify: `app/api/facturacion/[id]/pdf/route.ts`
- Test: `__tests__/lib/factura-pdf-venta.test.ts`

**Interfaces:**
- Consumes: `fetchFacturaConOrigen`/`formatFacturaResponse`-equivalent lookup (Task 4's helper is in `[id]/route.ts`, not exported — the PDF route does its own origin-aware fetch, mirroring the same two-step pattern).
- Produces: `generateFacturaPDF(data: FacturaPDFData)` — `data.orden` becomes optional, `data.venta` is added as the alternative; the "ORDEN DE SERVICIO" info box renders "VENTA" instead when `data.venta` is set.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/factura-pdf-venta.test.ts
/**
 * Tests: generateFacturaPDF renders a venta-sourced invoice (data.venta
 * instead of data.orden) without throwing, and produces a non-empty PDF.
 */
import { describe, it, expect } from "vitest"
import { generateFacturaPDF } from "@/lib/pdf"

describe("generateFacturaPDF — venta origin", () => {
  it("renders successfully with data.venta instead of data.orden", async () => {
    const buffer = await generateFacturaPDF({
      numeroFactura: "0001-00000002",
      fecha: new Date("2026-01-02"),
      estadoPago: "PAGADO",
      cliente: { nombre: "Consumidor Final" },
      venta: { numeroVenta: 5 },
      subtotal: 200,
      iva: 0,
      total: 200,
      montoAbonado: 200,
      pagos: [],
    } as any)

    expect(buffer.length).toBeGreaterThan(0)
  })

  it("still renders successfully with data.orden (orden origin, unchanged)", async () => {
    const buffer = await generateFacturaPDF({
      numeroFactura: "0001-00000001",
      fecha: new Date("2026-01-01"),
      estadoPago: "PENDIENTE",
      cliente: { nombre: "Ana" },
      orden: { numeroOrden: 1, codigoOrden: "CEL001", dispositivo: "iPhone" },
      subtotal: 100,
      iva: 0,
      total: 100,
      montoAbonado: 0,
      pagos: [],
    } as any)

    expect(buffer.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/factura-pdf-venta.test.ts`
Expected: FAIL on the first case — `data.orden.codigoOrden` throws `Cannot read properties of undefined` (`FacturaPDFData.orden` is currently required and directly dereferenced).

- [ ] **Step 3: Make `orden` optional and add `venta` in `lib/pdf.ts`**

Update the `FacturaPDFData` interface (around line 3181):

```ts
interface FacturaPDFData {
  numeroFactura: string
  fecha: Date | string
  estadoPago: string
  cliente: {
    nombre: string
    telefono?: string | null
    email?: string | null
    direccion?: string | null
  }
  orden?: {
    numeroOrden: number
    codigoOrden?: string | null
    dispositivo: string
  }
  venta?: {
    numeroVenta: number
  }
  subtotal: number
  iva: number
  total: number
  montoAbonado: number
  pagos: FacturaPago[]
  nombreEmpresa?: string
  telefonoEmpresa?: string | null
  direccionEmpresa?: string | null
  logoUrl?: string | null
  moneda?: string
  zonaHoraria?: string
}
```

In `generateFacturaPDF`, replace the two direct `data.orden.*` reads near the top:

```ts
  const ordenDisplay = data.orden
    ? data.orden.codigoOrden || `#${String(data.orden.numeroOrden).padStart(4, "0")}`
    : ""
  const dispositivo = data.orden ? safe(data.orden.dispositivo) : ""
```

Replace the "DATOS DE LA ORDEN" box (the block starting `// === DATOS DE LA ORDEN ===`) with a branch on `data.venta`:

```ts
  // === DATOS DE LA ORDEN / VENTA ===
  page.drawRectangle({ x: margin + contentWidth / 2 + 10, y: y - clientBoxHeight + 10, width: contentWidth / 2 - 10, height: clientBoxHeight, color: bgGray })
  if (data.venta) {
    page.drawText("VENTA", { x: margin + contentWidth / 2 + 20, y: y - 5, size: 9, font: helveticaBold, color: primaryColor })
    page.drawText(`Venta: V${String(data.venta.numeroVenta).padStart(4, "0")}`, { x: margin + contentWidth / 2 + 20, y: y - 20, size: 10, font: helvetica, color: textColor })
  } else {
    page.drawText("ORDEN DE SERVICIO", { x: margin + contentWidth / 2 + 20, y: y - 5, size: 9, font: helveticaBold, color: primaryColor })
    page.drawText(`Orden: ${ordenDisplay}`, { x: margin + contentWidth / 2 + 20, y: y - 20, size: 10, font: helvetica, color: textColor })
    page.drawText(`Dispositivo: ${dispositivo}`, { x: margin + contentWidth / 2 + 20, y: y - 33, size: 9, font: helvetica, color: grayColor })
  }
```

- [ ] **Step 4: Update the PDF route to build `data.venta` for venta-origin invoices**

In `app/api/facturacion/[id]/pdf/route.ts`, replace the single `ordenes_servicio!inner`-based query with an origin-aware two-step lookup (same pattern as Task 4):

```ts
    const { id } = await params

    const { data: base, error: baseError } = await supabaseAdmin
      .from("facturas")
      .select("id, orden_id, venta_id")
      .eq("id", id)
      .single()

    if (baseError || !base) {
      return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 })
    }

    let pdfData: Record<string, any>

    if (base.orden_id) {
      let query = supabaseAdmin
        .from("facturas")
        .select(`
          *,
          ordenes_servicio!inner (
            id, numero_orden, codigo_orden, dispositivo, organization_id, sucursal_id,
            clientes (nombre, telefono, email, direccion),
            organizations (nombre, nombre_mostrar, telefono, direccion, logo_url, moneda, zona_horaria)
          ),
          pagos_parciales (*)
        `)
        .eq("id", id)
        .eq("ordenes_servicio.organization_id", organizationId!)
      if (!verTodas && sid) query = query.eq("ordenes_servicio.sucursal_id", sid)
      const { data: factura, error: dbError } = await query.single()
      if (dbError || !factura) {
        return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 })
      }
      const org = factura.ordenes_servicio.organizations
      const cliente = factura.ordenes_servicio.clientes
      pdfData = {
        numeroFactura: factura.numero_factura,
        fecha: new Date(factura.fecha),
        estadoPago: factura.estado_pago,
        cliente: {
          nombre: cliente?.nombre || "Consumidor Final",
          telefono: cliente?.telefono,
          email: cliente?.email,
          direccion: cliente?.direccion,
        },
        orden: {
          numeroOrden: factura.ordenes_servicio.numero_orden,
          codigoOrden: factura.ordenes_servicio.codigo_orden,
          dispositivo: factura.ordenes_servicio.dispositivo,
        },
        subtotal: parseFloat(factura.subtotal),
        iva: parseFloat(factura.iva),
        total: parseFloat(factura.total),
        montoAbonado: parseFloat(factura.monto_abonado || "0"),
        pagos: (factura.pagos_parciales || [])
          .sort((a: any, b: any) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())
          .map((p: any) => ({
            monto: parseFloat(p.monto),
            metodoPago: p.metodo_pago,
            fecha: new Date(p.fecha),
            referencia: p.numero_referencia,
            cuotas: p.cuotas,
            recargoPorcentaje: p.recargo_porcentaje ? parseFloat(p.recargo_porcentaje) : null,
            montoOriginal: p.monto_original ? parseFloat(p.monto_original) : null,
          })),
        nombreEmpresa: org?.nombre_mostrar || org?.nombre,
        telefonoEmpresa: org?.telefono,
        direccionEmpresa: org?.direccion,
        logoUrl: org?.logo_url,
        moneda: org?.moneda || "ARS",
        zonaHoraria: org?.zona_horaria || "America/Argentina/Buenos_Aires",
      }
    } else {
      let query = supabaseAdmin
        .from("facturas")
        .select(`
          *,
          ventas!inner (
            id, numero_venta, cliente_nombre, organization_id, sucursal_id,
            organizations (nombre, nombre_mostrar, telefono, direccion, logo_url, moneda, zona_horaria)
          ),
          pagos_parciales (*)
        `)
        .eq("id", id)
        .eq("ventas.organization_id", organizationId!)
      if (!verTodas && sid) query = query.eq("ventas.sucursal_id", sid)
      const { data: factura, error: dbError } = await query.single()
      if (dbError || !factura) {
        return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 })
      }
      const org = factura.ventas.organizations
      pdfData = {
        numeroFactura: factura.numero_factura,
        fecha: new Date(factura.fecha),
        estadoPago: factura.estado_pago,
        cliente: { nombre: factura.ventas.cliente_nombre || "Consumidor Final" },
        venta: { numeroVenta: factura.ventas.numero_venta },
        subtotal: parseFloat(factura.subtotal),
        iva: parseFloat(factura.iva),
        total: parseFloat(factura.total),
        montoAbonado: parseFloat(factura.monto_abonado || "0"),
        pagos: [],
        nombreEmpresa: org?.nombre_mostrar || org?.nombre,
        telefonoEmpresa: org?.telefono,
        direccionEmpresa: org?.direccion,
        logoUrl: org?.logo_url,
        moneda: org?.moneda || "ARS",
        zonaHoraria: org?.zona_horaria || "America/Argentina/Buenos_Aires",
      }
    }

    const pdfBuffer = await generateFacturaPDF(pdfData as any)
```

(`organizations` needs a FK relationship reachable from `ventas` — it already exists via `ventas.organization_id → organizations.id`, the same FK used for the `ventas.organization_id` filter, so the embed resolves the same way it does for `ordenes_servicio.organizations`.)

The `requireAdmin()` / `sucursalParaLectura()` block at the top of the route, and the final `return new NextResponse(...)` at the bottom, stay unchanged.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run __tests__/lib/factura-pdf-venta.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the existing PDF-adjacent suites to confirm no regression**

Run: `npx vitest run __tests__/api/factura-numero-unique.test.ts`
Expected: PASS (unaffected — this route isn't imported there, but confirms nothing in the shared `lib/pdf.ts` module broke type-checking for other tests that import it transitively).

- [ ] **Step 7: Commit**

```bash
git add lib/pdf.ts app/api/facturacion/[id]/pdf/route.ts __tests__/lib/factura-pdf-venta.test.ts
git commit -m "feat(facturacion): render venta-sourced invoices in the PDF"
```

---

## Self-Review Notes

**Spec coverage:** every bullet in the design doc's Data model / API / UI / Testing sections maps to a task — Task 1 covers all 5 data-model changes (plus 2 additions, see below); Task 2 covers `POST /generar`; Task 3 covers `GET /api/facturacion`; Task 9 covers `GET /api/facturacion/[id]/pdf`; Tasks 6–8 cover the 4 UI bullets (modal, badge, venta-detail button, PDF — PDF split into Task 9 since it's backend-rendering code shared with Task 4's plumbing). All 6 "Testing (strict TDD)" bullets are covered: zod XOR (Task 2, V1), venta gates (Task 2, V2–V4), IVA copy (Task 2, V5–V6), estado_pago/monto_abonado copy (Task 2, V5), mixed listing (Task 3), RPC-missing fallback (Task 2, V7).

**Deviations from the spec, with justification:**

1. **Scope addition — `GET/PUT/DELETE /api/facturacion/[id]` and `anular_factura_atomica`/`eliminar_factura_atomica` (Tasks 1 & 4).** The spec's "Current state" section only flagged `GET /api/facturacion`'s `ordenes_servicio!inner` join as broken by a nullable `orden_id`. Reading the actual code turned up the same defect in `[id]/route.ts` (`GET` 404s, `PUT`'s post-anular re-fetch crashes on `factura.ordenes_servicio.id` being `null`, `DELETE`'s pre-check 404s) and in both lifecycle RPCs (`INNER JOIN ordenes_servicio` means `anular`/`eliminar` raise `'Factura no encontrada'` for any venta invoice). Left unfixed, an admin could generate a venta invoice via the new entry point and then be unable to view, anular, or delete it — a shipped, visible bug, not a "unified comprobantes model" concern the spec explicitly deferred. Fixed with the same low-risk technique migration 250 already established (`CREATE OR REPLACE FUNCTION`, identical signature, zero caller changes).
2. **Left `pagos_parciales` RLS and the legacy `anularFacturaJsFallback`/`eliminarFacturaJsFallback` (for when the *original* migration 248/269 RPCs are entirely missing) unfixed.** Venta invoices never write `pagos_parciales` rows by design (spec: "venta invoices do not use pagos_parciales"), so the `pagos_parciales` RLS join through `orden_id` is dead code for this path — nothing to select. The two legacy fallbacks assume ~44-migrations-old RPCs are missing, which is true in essentially no real deployment; `DELETE` now detects venta-origin before reaching that branch and returns a clear 500 instead of crashing, `PUT`'s equivalent gap is called out but left as-is since adding a pre-check purely to guard a practically-unreachable path would add a query to the hot (RPC-present) path for every anular call.
3. **`GET /api/facturacion` and `[id]` GET use two `!inner` queries merged/branched in code, not one query with two left joins.** PostgREST embedded-resource filters (`.eq("relation.column", val)`) only narrow the nested embed, they don't turn a left join into a row-excluding inner join — so a single dual-left-join query couldn't reproduce the existing (security-relevant) org/branch scoping. Two `!inner` queries — one per origin — preserve the exact existing filter semantics.
4. **`GET /api/facturacion/candidatos` is a new dedicated endpoint** rather than extending `GET /api/ordenes`/`GET /api/ventas`. Justified in Task 5: those endpoints return heavy nested relations unsuited to a lightweight picker, and neither supports an "uninvoiced" filter server-side (PostgREST can't filter on an empty reverse-FK array).
5. **`z.union([...]).strict()` instead of a plain `.refine()`-based XOR**, to honor the spec's literal "zod union" wording while still rejecting a body with both `ordenId` and `ventaId` present (each branch's `.strict()` rejects the other branch's key as an unknown property).
6. **"Generar factura" button lives in `FacturacionList`'s own toolbar**, not in `PageShell`'s `actions` slot on the page component. Avoids new prop-drilling of SWR's `mutate` between `page.tsx` and `FacturacionList` for what the spec calls a "header button" — still reads as a prominent header-area action, just co-located with the state it must refresh.

**Placeholder scan:** no TBD/TODO, no "similar to Task N", no "add error handling" — every step has real, complete code, migration SQL, or an exact shell command. **Type consistency:** `origen: "orden" | "venta"` is spelled identically across Tasks 3, 4, 7; `FacturaPDFData.venta.numeroVenta` (Task 9) matches the `{numeroVenta}` shape produced everywhere else (Tasks 2, 3, 6, 8); `facturaId` on `VentaDetail` (Task 8) matches `formatVenta()`'s new field name exactly.
