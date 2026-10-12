# Reparaciones express desde el detalle del cliente — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cargar un listado de reparaciones ya hechas desde el detalle de un cliente, que queden como deuda en su cuenta corriente, con reversa disponible y sin que la deuda se cuente dos veces.

**Architecture:** Cada reparación es una `ordenes_servicio` que **nace** en estado terminal `ENTREGADO` (creación, no transición: `RECIBIDO → ENTREGADO` no es válida en `lib/orden-state-machine.ts`), con su `CARGO` en `cuenta_corriente` referenciado a esa orden. Todo el lote va en una sola transacción vía RPC, siguiendo el patrón de `crear_recepcion_multiple`. Antes de agregar la feature se cierran dos huecos que el relevamiento destapó: el doble conteo de deuda de fiado y la ausencia de reversa para cargos de fiado.

**Tech Stack:** Next.js App Router (route handlers), Supabase/PostgreSQL (RPC `plpgsql`, `supabaseAdmin` service role), Zod, Vitest, SWR, shadcn/ui + Radix.

**Spec:** `docs/superpowers/specs/2026-08-24-reparaciones-express-cliente-design.md`

## Global Constraints

- **Idioma de artefactos:** código, comentarios, identificadores y mensajes de commit en inglés. Copy de UI en español (el resto del panel de cliente está en español).
- **Migraciones:** el número se asigna **al mergear**, no al crear la branch. Se aplican a mano con `node scripts/db-run.mjs <archivo>`, un archivo por vez, **dry-run primero**. No hay Supabase CLI ni CI de migraciones.
- **Cierre obligatorio de cada PR:** `npx tsc --noEmit` limpio. Lint verde **no** chequea tipos. Para lint usar `npx eslint <dirs>` acotado — `npm run lint` recorre los ~13 worktrees y no termina.
- **Tests:** `npx vitest run <archivo>`. No correr la suite completa en paralelo con otra instancia: los vitest concurrentes se matan entre sí.
- **RPC nuevas:** toda función `SECURITY DEFINER` lleva `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` + `GRANT ... TO service_role`. Sin eso, el anon key (que viaja en el bundle del browser) puede invocarla por PostgREST ignorando RLS.
- **`sucursal_id` en cuenta corriente:** siempre se deriva del **registro padre** (la orden, el movimiento original), nunca de la cookie de sucursal activa del operador.
- **Gotcha Radix Select:** setear un `Select` desde afuera con el dropdown cerrado borra el valor. Los selects nuevos se setean solo por interacción del usuario.
- **Branch base:** `origin/main`. El `main` local tiene 18 commits sin pushear de otra sesión — **no** branquear desde `main` local ni resolver con `reset --hard`.

## File Structure

**Crear:**
- `supabase/migrations/NNN_deuda_fiado_sin_doble_conteo.sql` — redefine `get_deuda_cliente_sucursal`
- `docs/deuda-fiado-doble-conteo-verificacion.sql` — consultas de solo lectura para medir el impacto antes de aplicar
- `supabase/migrations/NNN_cc_revertir_cargo_orden.sql` — columnas de reversa + RPC `revertir_cargos_orden`
- `app/api/clientes/[id]/cuenta-corriente/revertir/route.ts` — endpoint de reversa
- `components/clientes/detalle/revertir-cargo-dialog.tsx` — diálogo de motivo + confirmación
- `supabase/migrations/NNN_reparaciones_express.sql` — RPC `crear_reparaciones_express` + feature flag + columna de idempotencia
- `app/api/reparaciones-express/route.ts` — endpoint de alta del lote
- `components/clientes/detalle/reparaciones-express-dialog.tsx` — tabla editable del lote
- `__tests__/api/deuda-cliente-sucursal.test.ts`
- `__tests__/api/cc-revertir-cargo.test.ts`
- `__tests__/api/reparaciones-express.test.ts`

**Modificar:**
- `app/api/clientes/[id]/cuenta-corriente/route.ts` — el `GET` devuelve los campos de reversa
- `components/clientes/detalle/cuenta-corriente-panel.tsx:264-320` — acción Revertir + badge Revertido
- `components/clientes/detalle/cliente-detalle.tsx` — botón que abre el diálogo del lote

Cada diálogo es su propio archivo: `cuenta-corriente-panel.tsx` ya tiene 325 líneas y meterle dos flujos más lo vuelve inmanejable.

---

# FASE 1 — PR1: arreglo del doble conteo de deuda

**Branch:** `fix/deuda-fiado-doble-conteo` (ya creada, con la spec commiteada).

**Nota sobre TDD en este PR:** el cambio es SQL puro y este repo **no tiene Postgres local ni tests de SQL** — vitest mockea `supabaseAdmin`, así que un test de route no ejercita una línea del RPC. La disciplina de "rojo antes que verde" se cumple con el script de verificación: primero se escribe la consulta que **demuestra el doble conteo** contra datos reales, se corre y se ve el número mal; después se aplica la migración y se corre de nuevo. No inventes un test de vitest que finja cubrir esto.

### Task 1: Script de verificación que demuestra el doble conteo

**Files:**
- Create: `docs/deuda-fiado-doble-conteo-verificacion.sql`

**Interfaces:**
- Consumes: nada
- Produces: el archivo SQL que la Task 2 vuelve a correr para confirmar el arreglo

- [ ] **Step 1: Escribir el script de verificación**

```sql
-- ============================================================================
-- Verificación del doble conteo de deuda de fiado (solo lectura)
-- ============================================================================
-- Correr ANTES de aplicar la migración: la columna `duplicado` muestra la plata
-- que hoy se está contando dos veces. Correr DESPUÉS: `duplicado` debe ser 0
-- en todas las filas.
--
-- Reemplazar :org_id por la organización a auditar.
-- ============================================================================

-- (1) Órdenes cuya deuda ya migró a cuenta corriente y que además siguen
--     sumando por el lado de `deuda_ordenes`. Cada fila es plata duplicada.
SELECT
  o.id                AS orden_id,
  o.numero_orden,
  o.cliente_id,
  o.estado,
  o.estado_cobro,
  GREATEST(
    COALESCE(o.costo_final, 0) - COALESCE(o.descuento_cobro, 0) - COALESCE(o.total_cobrado, 0),
    0
  )                   AS pendiente_orden,
  ABS(cc.monto)       AS cargo_cuenta_corriente
FROM ordenes_servicio o
JOIN cuenta_corriente cc
  ON  cc.organization_id = o.organization_id
  AND cc.cliente_id      = o.cliente_id
  AND cc.tipo            = 'CARGO'
  AND cc.referencia_tipo = 'ORDEN'
  AND cc.referencia_id   = o.id
WHERE o.organization_id = :'org_id'
  AND o.estado_cobro IN ('PENDIENTE', 'PARCIAL')
ORDER BY o.numero_orden DESC;

-- (2) Impacto por cliente: cuánto le baja la deuda reportada al aplicar el fix.
--    `deuda_reportada_hoy` es lo que hoy devuelve get_deuda_cliente_sucursal
--    con p_sucursal_id NULL; `deuda_real` es lo que devolverá después.
SELECT
  c.id                                        AS cliente_id,
  c.nombre,
  fiado.monto + ordenes_hoy.monto             AS deuda_reportada_hoy,
  fiado.monto + ordenes_fix.monto             AS deuda_real,
  ordenes_hoy.monto - ordenes_fix.monto       AS duplicado
FROM clientes c
CROSS JOIN LATERAL (
  SELECT GREATEST(-COALESCE(SUM(cc.monto), 0), 0) AS monto
  FROM cuenta_corriente cc
  WHERE cc.organization_id = c.organization_id
    AND cc.cliente_id = c.id
) fiado
CROSS JOIN LATERAL (
  SELECT COALESCE(SUM(GREATEST(
    COALESCE(o.costo_final, 0) - COALESCE(o.descuento_cobro, 0) - COALESCE(o.total_cobrado, 0), 0
  )), 0) AS monto
  FROM ordenes_servicio o
  WHERE o.organization_id = c.organization_id
    AND o.cliente_id = c.id
    AND o.estado_cobro IN ('PENDIENTE', 'PARCIAL')
) ordenes_hoy
CROSS JOIN LATERAL (
  SELECT COALESCE(SUM(GREATEST(
    COALESCE(o.costo_final, 0) - COALESCE(o.descuento_cobro, 0) - COALESCE(o.total_cobrado, 0), 0
  )), 0) AS monto
  FROM ordenes_servicio o
  WHERE o.organization_id = c.organization_id
    AND o.cliente_id = c.id
    AND o.estado_cobro IN ('PENDIENTE', 'PARCIAL')
    AND NOT EXISTS (
      SELECT 1 FROM cuenta_corriente cc2
      WHERE cc2.organization_id = o.organization_id
        AND cc2.cliente_id      = o.cliente_id
        AND cc2.tipo            = 'CARGO'
        AND cc2.referencia_tipo = 'ORDEN'
        AND cc2.referencia_id   = o.id
    )
) ordenes_fix
WHERE c.organization_id = :'org_id'
  AND ordenes_hoy.monto - ordenes_fix.monto > 0
ORDER BY duplicado DESC;
```

- [ ] **Step 2: Correr la consulta (2) contra producción y guardar el resultado**

Run: `node scripts/db-run.mjs docs/deuda-fiado-doble-conteo-verificacion.sql --dry-run`

Expected: filas con `duplicado > 0`. **Ese es el rojo.** Si vuelve vacío para todas las organizaciones, frená: el bug no se está manifestando y hay que entender por qué antes de tocar el RPC.

Pegá el resultado (cantidad de clientes afectados y suma de `duplicado`) en la descripción del PR. Es el número que hay que avisarle a los talleres.

- [ ] **Step 3: Commit**

```bash
git add docs/deuda-fiado-doble-conteo-verificacion.sql
git commit -m "docs(deuda): add read-only script proving fiado debt double-count"
```

---

### Task 2: Migración que elimina el doble conteo

**Files:**
- Create: `supabase/migrations/NNN_deuda_fiado_sin_doble_conteo.sql`
- Reference: `supabase/migrations/267_deuda_cliente_sucursal_rpc.sql` (versión que se reemplaza)

**Interfaces:**
- Consumes: `docs/deuda-fiado-doble-conteo-verificacion.sql` (Task 1)
- Produces: `get_deuda_cliente_sucursal(TEXT, TEXT, TEXT)` con la misma firma y las mismas columnas de retorno (`deuda_fiado`, `deuda_ordenes`, `deuda_total`). Ningún caller cambia.

- [ ] **Step 1: Escribir la migración**

```sql
-- ============================================================================
-- NNN: get_deuda_cliente_sucursal — end of the fiado double-count
-- ============================================================================
-- BUG (pre-existing, introduced with mig 267): a fiado order was counted twice.
--
--   deuda_fiado   = GREATEST(-SUM(cuenta_corriente.monto), 0)
--   deuda_ordenes = SUM(GREATEST(costo_final - descuento_cobro - total_cobrado, 0))
--                   over ordenes with estado_cobro IN ('PENDIENTE','PARCIAL')
--
-- When an order is delivered with a pending balance, entregar/route.ts:187 calls
-- cargar_deuda_cuenta_corriente and the debt lands in cuenta_corriente as CARGO.
-- But /entregar never touches estado_cobro, and recalcular_estado_cobro
-- (mig 067:75-93) derives it ONLY from cobros_orden. So the order stays
-- PENDIENTE with total_cobrado = 0 AND carries its CARGO: both terms count the
-- same money.
--
-- This RPC feeds app/api/clientes/[id]/deuda-sucursal/route.ts, which its own
-- comment calls "fuente de verdad para el recordatorio de pago por WhatsApp":
-- clients with fiado were being asked for twice what they owe.
--
-- FIX — one rule: once an order's debt has moved to the cuenta corriente, the
-- cuenta corriente is the ONLY source of truth for that order. The order is
-- excluded from deuda_ordenes whether its CARGO was later reverted or not.
-- Reverting a CARGO must clear the debt on both sides; without the
-- "reverted or not" part, a reversal would bounce the debt back into
-- deuda_ordenes and be worthless.
--
-- Degradation: cargar_deuda_cuenta_corriente errors are logged and do NOT abort
-- the delivery (entregar/route.ts:199-202), so orders with a pending balance and
-- no CARGO exist. Those keep counting in deuda_ordenes, which is correct.
--
-- Everything else is byte-identical to mig 267, including the REVOKE/GRANT
-- block: the function is SECURITY DEFINER and ignores RLS, so without it any
-- anon key (shipped in the browser bundle) could read any client's debt in any
-- organization through PostgREST.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_deuda_cliente_sucursal(
  p_org_id      TEXT,
  p_cliente_id  TEXT,
  p_sucursal_id TEXT DEFAULT NULL
)
RETURNS TABLE (
  deuda_fiado   NUMERIC,
  deuda_ordenes NUMERIC,
  deuda_total   NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    fiado.monto                 AS deuda_fiado,
    ordenes.monto               AS deuda_ordenes,
    fiado.monto + ordenes.monto AS deuda_total
  FROM (
    SELECT GREATEST(-COALESCE(SUM(cc.monto), 0), 0) AS monto
    FROM cuenta_corriente cc
    WHERE cc.organization_id = p_org_id
      AND cc.cliente_id = p_cliente_id
      AND (p_sucursal_id IS NULL OR cc.sucursal_id = p_sucursal_id)
  ) fiado,
  (
    SELECT COALESCE(SUM(
      GREATEST(
        COALESCE(o.costo_final, 0) - COALESCE(o.descuento_cobro, 0) - COALESCE(o.total_cobrado, 0),
        0
      )
    ), 0) AS monto
    FROM ordenes_servicio o
    WHERE o.organization_id = p_org_id
      AND o.cliente_id = p_cliente_id
      AND o.estado_cobro IN ('PENDIENTE', 'PARCIAL')
      AND (p_sucursal_id IS NULL OR o.sucursal_id = p_sucursal_id)
      AND NOT EXISTS (
        SELECT 1
        FROM cuenta_corriente cc2
        WHERE cc2.organization_id = o.organization_id
          AND cc2.cliente_id      = o.cliente_id
          AND cc2.tipo            = 'CARGO'
          AND cc2.referencia_tipo = 'ORDEN'
          AND cc2.referencia_id   = o.id
      )
  ) ordenes;
$$;

REVOKE EXECUTE ON FUNCTION get_deuda_cliente_sucursal(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_deuda_cliente_sucursal(TEXT, TEXT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION get_deuda_cliente_sucursal(TEXT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION get_deuda_cliente_sucursal(TEXT, TEXT, TEXT) TO service_role;

COMMENT ON FUNCTION get_deuda_cliente_sucursal(TEXT, TEXT, TEXT) IS
  'Per-branch combined debt (fiado + unpaid ordenes) for one cliente. '
  'p_sucursal_id NULL = sum across all branches (ADMIN verTodas). '
  'An order whose debt already moved to cuenta corriente (CARGO with '
  'referencia_tipo=ORDEN) is excluded from deuda_ordenes — reverted or not — '
  'so the same money is never counted twice. Supersedes migration 267.';
```

- [ ] **Step 2: Dry-run de la migración**

Run: `node scripts/db-run.mjs supabase/migrations/NNN_deuda_fiado_sin_doble_conteo.sql --dry-run`

Expected: sin errores de sintaxis. `CREATE OR REPLACE` es idempotente.

- [ ] **Step 3: Aplicar y re-verificar**

Run: aplicar la migración, después correr de nuevo la consulta (2) de `docs/deuda-fiado-doble-conteo-verificacion.sql`.

Expected: cero filas — `duplicado` es 0 para todos los clientes. **Ese es el verde.**

- [ ] **Step 4: Chequear que el consumidor sigue respondiendo igual de forma**

Run: `npx tsc --noEmit`

Expected: limpio. La firma y las columnas de retorno no cambiaron, así que `app/api/clientes/[id]/deuda-sucursal/route.ts` no se toca.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/NNN_deuda_fiado_sin_doble_conteo.sql
git commit -m "fix(deuda): stop counting fiado debt twice in get_deuda_cliente_sucursal"
```

- [ ] **Step 6: Abrir el PR1**

En la descripción, incluir: el número de clientes afectados y la suma de `duplicado` medidos en la Task 1, y una línea explícita de que **la deuda mostrada y el recordatorio de WhatsApp bajan** para esos clientes, al valor correcto.

---

# FASE 2 — PR2: reversa de cargos de fiado

**Branch:** `feat/cc-revertir-cargo-orden`, sacada de `fix/deuda-fiado-doble-conteo`.

### Task 3: Migración — columnas de reversa y RPC

**Files:**
- Create: `supabase/migrations/NNN_cc_revertir_cargo_orden.sql`
- Reference: `supabase/migrations/268_cuenta_corriente_sucursal_writers.sql:187-196` (firma de `devolver_cuenta_corriente`)

**Interfaces:**
- Consumes: `devolver_cuenta_corriente(p_org_id, p_cliente_id, p_monto, p_referencia_tipo, p_referencia_id, p_usuario_id, p_observaciones, p_sucursal_id)` — ya existe, no se toca
- Produces:
  - columnas `cuenta_corriente.revertido_at TIMESTAMPTZ`, `cuenta_corriente.revertido_por TEXT`, `cuenta_corriente.revertido_movimiento_id TEXT`
  - `revertir_cargos_orden(p_org_id TEXT, p_cliente_id TEXT, p_movimiento_ids JSONB, p_motivo TEXT, p_usuario_id TEXT) RETURNS JSONB` → `{ revertidos: [{movimientoId, devolucionId, monto}], saldoNuevo }`

- [ ] **Step 1: Escribir la migración**

```sql
-- ============================================================================
-- NNN: revert a fiado CARGO back out of a client's cuenta corriente
-- ============================================================================
-- The reversal primitive already exists: devolver_cuenta_corriente (type
-- DEVOLUCION, positive amount, no balance validation), from the Fase 2
-- reversibility work, signature in mig 268:187-196. It is already wired into
-- sale returns, invoice void/delete and order-payment void. The ONE reversal
-- point never wired is the fiado CARGO produced by delivering an order
-- (entregar/route.ts:187) — and ENTREGADO is a terminal state
-- (lib/orden-state-machine.ts:19, empty list), so there is no "un-deliver"
-- either. This migration closes that hole.
--
-- The three new columns are the double-reversal guard AND what the panel reads
-- to pair a CARGO with the DEVOLUCION that cancelled it. All nullable, purely
-- additive, no backfill: existing rows mean "not reverted", which is true.
--
-- The order itself is deliberately NOT touched: it stays ENTREGADO with its
-- costo_final and its history. The work happened; what is being reverted is the
-- charge. The order does not come back as debt elsewhere because
-- get_deuda_cliente_sucursal excludes orders carrying a CARGO whether reverted
-- or not (see the double-count fix migration).
-- ============================================================================

ALTER TABLE cuenta_corriente
  ADD COLUMN IF NOT EXISTS revertido_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revertido_por           TEXT REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revertido_movimiento_id TEXT;

-- Partial: the overwhelming majority of rows are never reverted, so the classic
-- flow pays no write or space cost for this index.
CREATE INDEX IF NOT EXISTS idx_cuenta_corriente_revertido
  ON cuenta_corriente(revertido_movimiento_id)
  WHERE revertido_movimiento_id IS NOT NULL;

CREATE OR REPLACE FUNCTION revertir_cargos_orden(
  p_org_id         TEXT,
  p_cliente_id     TEXT,
  p_movimiento_ids JSONB,
  p_motivo         TEXT,
  p_usuario_id     TEXT
)
RETURNS JSONB AS $$
DECLARE
  v_id          TEXT;
  v_mov         cuenta_corriente%ROWTYPE;
  v_devolucion  JSONB;
  v_revertidos  JSONB := '[]'::JSONB;
  v_saldo       DECIMAL;
BEGIN
  IF p_movimiento_ids IS NULL OR jsonb_array_length(p_movimiento_ids) = 0 THEN
    RAISE EXCEPTION 'revertir_cargos_orden: no movements given';
  END IF;

  IF COALESCE(TRIM(p_motivo), '') = '' THEN
    RAISE EXCEPTION 'revertir_cargos_orden: motivo is required';
  END IF;

  FOR v_id IN SELECT jsonb_array_elements_text(p_movimiento_ids)
  LOOP
    -- FOR UPDATE: the endpoint validates too, but only this read under lock can
    -- keep two concurrent reversals of the same CARGO from both succeeding.
    SELECT * INTO v_mov
    FROM cuenta_corriente
    WHERE id = v_id
      AND organization_id = p_org_id
      AND cliente_id = p_cliente_id
    FOR UPDATE;

    IF v_mov.id IS NULL THEN
      RAISE EXCEPTION 'revertir_cargos_orden: movement % not found for this client', v_id;
    END IF;

    IF v_mov.tipo <> 'CARGO' OR v_mov.referencia_tipo <> 'ORDEN' THEN
      RAISE EXCEPTION 'revertir_cargos_orden: movement % is not an order fiado charge', v_id;
    END IF;

    IF v_mov.revertido_at IS NOT NULL THEN
      RAISE EXCEPTION 'revertir_cargos_orden: movement % was already reverted', v_id;
    END IF;

    -- sucursal_id comes from the ORIGINAL movement, never from the operator
    -- doing the reversal: the credit has to land in the same branch that took
    -- the debt or the per-branch arqueo goes crooked.
    SELECT devolver_cuenta_corriente(
      p_org_id,
      p_cliente_id,
      ABS(v_mov.monto),
      'ORDEN',
      v_mov.referencia_id,
      p_usuario_id,
      p_motivo,
      v_mov.sucursal_id
    ) INTO v_devolucion;

    UPDATE cuenta_corriente
    SET revertido_at            = NOW(),
        revertido_por           = p_usuario_id,
        revertido_movimiento_id = v_devolucion->>'id'
    WHERE id = v_mov.id;

    v_revertidos := v_revertidos || jsonb_build_object(
      'movimientoId', v_mov.id,
      'devolucionId', v_devolucion->>'id',
      'monto',        ABS(v_mov.monto)
    );
  END LOOP;

  SELECT saldo_cuenta INTO v_saldo FROM clientes WHERE id = p_cliente_id;

  RETURN jsonb_build_object('revertidos', v_revertidos, 'saldoNuevo', v_saldo);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION revertir_cargos_orden(TEXT, TEXT, JSONB, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION revertir_cargos_orden(TEXT, TEXT, JSONB, TEXT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION revertir_cargos_orden(TEXT, TEXT, JSONB, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION revertir_cargos_orden(TEXT, TEXT, JSONB, TEXT, TEXT) TO service_role;

COMMENT ON FUNCTION revertir_cargos_orden(TEXT, TEXT, JSONB, TEXT, TEXT) IS
  'Reverts one or more fiado CARGO movements (referencia_tipo=ORDEN) for a '
  'client, all in one transaction. Posts a DEVOLUCION per charge via '
  'devolver_cuenta_corriente, inheriting the ORIGINAL movement sucursal_id, and '
  'marks the CARGO as reverted. Raises if any movement is missing, is not an '
  'order charge, or was already reverted — nothing is reverted in that case.';
```

- [ ] **Step 2: Dry-run**

Run: `node scripts/db-run.mjs supabase/migrations/NNN_cc_revertir_cargo_orden.sql --dry-run`

Expected: sin errores de sintaxis.

- [ ] **Step 3: Aplicar**

Run: aplicar la migración.

Expected: `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` es idempotente; correrla dos veces no rompe.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/NNN_cc_revertir_cargo_orden.sql
git commit -m "feat(cuenta-corriente): add revertir_cargos_orden RPC and reversal columns"
```

---

### Task 4: Endpoint de reversa

**Files:**
- Create: `app/api/clientes/[id]/cuenta-corriente/revertir/route.ts`
- Test: `__tests__/api/cc-revertir-cargo.test.ts`
- Reference: `app/api/clientes/[id]/cuenta-corriente/route.ts:87` (chequeo de ADMIN)

**Interfaces:**
- Consumes: RPC `revertir_cargos_orden` (Task 3)
- Produces: `POST /api/clientes/[id]/cuenta-corriente/revertir` con body `{ movimientoIds: string[], motivo: string }` → `200 { revertidos, saldoNuevo }`

- [ ] **Step 1: Escribir los tests que fallan**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, createPostRequest } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"
import { POST as revertirPOST } from "@/app/api/clientes/[id]/cuenta-corriente/revertir/route"

const ctx = { params: Promise.resolve({ id: "c1" }) } as any
const url = "http://localhost/api/clientes/c1/cuenta-corriente/revertir"

function movimientoRow(over: Partial<any> = {}) {
  return {
    id: "mov1", organization_id: "org-1", cliente_id: "c1", tipo: "CARGO",
    monto: "-100", referencia_tipo: "ORDEN", referencia_id: "o1",
    sucursal_id: "suc-1", revertido_at: null, ...over,
  }
}

describe("revertir cargos de fiado", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: { revertidos: [{ movimientoId: "mov1", devolucionId: "dev1", monto: 100 }], saldoNuevo: 0 },
      error: null,
    } as any)
  })

  it("revierte un CARGO de orden y llama a la RPC con el motivo", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({ cuenta_corriente: createChainMock([movimientoRow()]) })

    const res = await revertirPOST(
      createPostRequest({ movimientoIds: ["mov1"], motivo: "Cargado por error" }, url),
      ctx
    )

    expect(res.status).toBe(200)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "revertir_cargos_orden",
      expect.objectContaining({
        p_org_id: "org-1",
        p_cliente_id: "c1",
        p_movimiento_ids: ["mov1"],
        p_motivo: "Cargado por error",
      })
    )
  })

  it("rechaza a quien no es ADMIN", async () => {
    mockAuthSuccess({ role: "VENDEDOR" })

    const res = await revertirPOST(
      createPostRequest({ movimientoIds: ["mov1"], motivo: "Cargado por error" }, url),
      ctx
    )

    expect(res.status).toBe(403)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("rechaza un movimiento que no es CARGO de orden", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({
      cuenta_corriente: createChainMock([movimientoRow({ tipo: "DEPOSITO", referencia_tipo: "MANUAL" })]),
    })

    const res = await revertirPOST(
      createPostRequest({ movimientoIds: ["mov1"], motivo: "Cargado por error" }, url),
      ctx
    )

    expect(res.status).toBe(400)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("rechaza un movimiento ya revertido", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({
      cuenta_corriente: createChainMock([movimientoRow({ revertido_at: "2026-08-20T10:00:00Z" })]),
    })

    const res = await revertirPOST(
      createPostRequest({ movimientoIds: ["mov1"], motivo: "Cargado por error" }, url),
      ctx
    )

    expect(res.status).toBe(400)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("no revierte ninguno si un movimiento del lote es invalido", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({
      cuenta_corriente: createChainMock([
        movimientoRow(),
        movimientoRow({ id: "mov2", tipo: "PAGO" }),
      ]),
    })

    const res = await revertirPOST(
      createPostRequest({ movimientoIds: ["mov1", "mov2"], motivo: "Lote equivocado" }, url),
      ctx
    )

    expect(res.status).toBe(400)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("exige motivo", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    const res = await revertirPOST(
      createPostRequest({ movimientoIds: ["mov1"], motivo: "" }, url),
      ctx
    )

    expect(res.status).toBe(400)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("rechaza cuando falta algun movimiento del array", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    // Solo vuelve uno de los dos pedidos: el otro es de otro cliente u otra org.
    mockSupabaseFrom({ cuenta_corriente: createChainMock([movimientoRow()]) })

    const res = await revertirPOST(
      createPostRequest({ movimientoIds: ["mov1", "mov-ajeno"], motivo: "Lote equivocado" }, url),
      ctx
    )

    expect(res.status).toBe(400)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run __tests__/api/cc-revertir-cargo.test.ts`

Expected: FAIL — no existe el módulo `@/app/api/clientes/[id]/cuenta-corriente/revertir/route`.

- [ ] **Step 3: Escribir el endpoint**

```typescript
import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { createAuditLogger } from "@/lib/audit"
import { z } from "zod"

const revertirSchema = z.object({
  movimientoIds: z.array(z.string().min(1)).min(1, "Debe indicar al menos un movimiento"),
  motivo: z.string().trim().min(3, "El motivo es requerido"),
})

// POST - Revertir uno o varios cargos de fiado (CARGO con referencia a una orden).
// Reverting debt is forgiving money, so it is ADMIN-only — same rule the deposit
// endpoint already applies (../route.ts:87).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId, role } = await requireAuth()
    if (error) return error

    if (role !== "ADMIN") {
      return NextResponse.json(
        { error: "Solo administradores pueden revertir cargos" },
        { status: 403 }
      )
    }

    const { id: clienteId } = await params
    const body = await request.json()
    const data = revertirSchema.parse(body)

    // Pre-validation exists to return a message naming the offending movement.
    // The binding check is the one the RPC does under FOR UPDATE.
    const { data: movimientos, error: movError } = await supabaseAdmin
      .from("cuenta_corriente")
      .select("id, tipo, referencia_tipo, revertido_at")
      .eq("organization_id", organizationId!)
      .eq("cliente_id", clienteId)
      .in("id", data.movimientoIds)

    if (movError) throw movError

    const encontrados = movimientos || []
    if (encontrados.length !== data.movimientoIds.length) {
      return NextResponse.json(
        { error: "Alguno de los movimientos no existe o no pertenece a este cliente" },
        { status: 400 }
      )
    }

    const invalido = encontrados.find(
      (m) => m.tipo !== "CARGO" || m.referencia_tipo !== "ORDEN"
    )
    if (invalido) {
      return NextResponse.json(
        { error: "Solo se pueden revertir cargos de fiado de una orden" },
        { status: 400 }
      )
    }

    const yaRevertido = encontrados.find((m) => m.revertido_at != null)
    if (yaRevertido) {
      return NextResponse.json(
        { error: "Alguno de los movimientos ya fue revertido" },
        { status: 400 }
      )
    }

    const { data: result, error: rpcError } = await supabaseAdmin.rpc("revertir_cargos_orden", {
      p_org_id: organizationId!,
      p_cliente_id: clienteId,
      p_movimiento_ids: data.movimientoIds,
      p_motivo: data.motivo,
      p_usuario_id: userId!,
    })

    if (rpcError) {
      console.error("Error en revertir_cargos_orden:", rpcError)
      return NextResponse.json(
        { error: rpcError.message || "Error al revertir los cargos" },
        { status: 400 }
      )
    }

    const audit = createAuditLogger(organizationId!, userId!, request)
    await audit.update("cuenta_corriente", clienteId, {
      accion: "revertir_cargos",
      movimientos: data.movimientoIds,
      motivo: data.motivo,
    })

    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error reverting cargos:", err)
    return NextResponse.json({ error: "Error al revertir los cargos" }, { status: 500 })
  }
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run __tests__/api/cc-revertir-cargo.test.ts`

Expected: PASS, 7 tests.

Si `audit.update` no existe con esa firma, abrí `lib/audit.ts` y usá el método que el resto de los endpoints usa para mutaciones. No inventes uno.

- [ ] **Step 5: Verificar tipos**

Run: `npx tsc --noEmit`

Expected: limpio.

- [ ] **Step 6: Commit**

```bash
git add app/api/clientes/\[id\]/cuenta-corriente/revertir/route.ts __tests__/api/cc-revertir-cargo.test.ts
git commit -m "feat(cuenta-corriente): add endpoint to revert fiado charges"
```

---

### Task 5: UI de reversa en el panel de cuenta corriente

**Files:**
- Create: `components/clientes/detalle/revertir-cargo-dialog.tsx`
- Modify: `app/api/clientes/[id]/cuenta-corriente/route.ts:47-59` (el map del `GET`)
- Modify: `components/clientes/detalle/cuenta-corriente-panel.tsx:36-46` (tipo `Movimiento`) y `:294-318` (fila del movimiento)

**Interfaces:**
- Consumes: `POST /api/clientes/[id]/cuenta-corriente/revertir` (Task 4)
- Produces: `RevertirCargoDialog` con props `{ clienteId: string, movimientos: Array<{id: string, monto: number}>, saldoActual: number, open: boolean, onOpenChange: (v: boolean) => void, onDone: () => void }` — la usa también el modal de éxito del lote express (Task 8)

- [ ] **Step 1: Exponer los campos de reversa en el GET**

En `app/api/clientes/[id]/cuenta-corriente/route.ts`, dentro del `.map(m => ({ ... }))` de `movimientos`, agregar:

```typescript
        revertidoAt: m.revertido_at,
        revertidoMovimientoId: m.revertido_movimiento_id,
```

El `select("*")` ya trae las columnas nuevas: no hace falta tocar la query.

- [ ] **Step 2: Extender el tipo `Movimiento` del panel**

En `components/clientes/detalle/cuenta-corriente-panel.tsx`, dentro de `interface Movimiento`, agregar:

```typescript
  revertidoAt: string | null
  revertidoMovimientoId: string | null
```

- [ ] **Step 3: Escribir el diálogo**

```tsx
"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Loader2, Undo2 } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"
import { toast } from "sonner"

interface RevertirCargoDialogProps {
  clienteId: string
  movimientos: Array<{ id: string; monto: number }>
  saldoActual: number
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: () => void
}

export function RevertirCargoDialog({
  clienteId, movimientos, saldoActual, open, onOpenChange, onDone,
}: RevertirCargoDialogProps) {
  const { formatPrice } = useCurrency()
  const [motivo, setMotivo] = useState("")
  const [loading, setLoading] = useState(false)

  const total = movimientos.reduce((sum, m) => sum + Math.abs(m.monto), 0)
  const saldoResultante = saldoActual + total

  async function handleRevertir() {
    if (motivo.trim().length < 3) {
      toast.error("Escribí el motivo de la reversa")
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`/api/clientes/${clienteId}/cuenta-corriente/revertir`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ movimientoIds: movimientos.map((m) => m.id), motivo }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Error al revertir")
      toast.success(
        movimientos.length === 1 ? "Cargo revertido" : `${movimientos.length} cargos revertidos`
      )
      setMotivo("")
      onOpenChange(false)
      onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al revertir")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {movimientos.length === 1 ? "Revertir cargo" : `Revertir ${movimientos.length} cargos`}
          </DialogTitle>
          <DialogDescription>
            Se le va a devolver {formatPrice(total)} a la cuenta corriente del cliente.
            El saldo queda en {formatPrice(saldoResultante)}. La orden no se modifica.
            Esta acción no se puede deshacer desde la aplicación.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="motivo-reversa">Motivo</Label>
          <Textarea
            id="motivo-reversa"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ej: cargado por error en el cliente equivocado"
            rows={3}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={handleRevertir} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
            Revertir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: Cablear la acción y el badge en el panel**

En `components/clientes/detalle/cuenta-corriente-panel.tsx`:

1. Al lado de `TIPOS_CON_RECIBO`, agregar el predicado:

```typescript
// A fiado charge tied to an order is the only movement kind that can be
// reverted (see the revertir_cargos_orden RPC).
function esCargoReversible(mov: Movimiento): boolean {
  return mov.tipo === "CARGO" && mov.referenciaTipo === "ORDEN" && mov.revertidoAt == null
}
```

2. Estado local para el diálogo, junto al resto de los `useState` del componente:

```typescript
  const [revertirTarget, setRevertirTarget] = useState<Movimiento | null>(null)
```

3. Dentro del bloque de la fila, después del botón de recibo (`:299-317`), agregar el botón de reversa — visible solo para ADMIN. El componente ya tiene la sesión disponible vía `useSession()`:

```tsx
                  {esCargoReversible(mov) && session?.user?.role === "ADMIN" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      title="Revertir cargo"
                      aria-label={`Revertir cargo por ${formatPrice(Math.abs(mov.monto))}`}
                      onClick={() => setRevertirTarget(mov)}
                    >
                      <Undo2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
```

4. Badge para los ya revertidos, dentro del bloque de la izquierda, después del badge de tipo:

```tsx
                      {mov.revertidoAt && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          Revertido
                        </Badge>
                      )}
```

5. Montar el diálogo al final del componente, antes del cierre:

```tsx
      {revertirTarget && (
        <RevertirCargoDialog
          clienteId={cliente.id}
          movimientos={[{ id: revertirTarget.id, monto: revertirTarget.monto }]}
          saldoActual={saldo}
          open={!!revertirTarget}
          onOpenChange={(v) => !v && setRevertirTarget(null)}
          onDone={() => mutate()}
        />
      )}
```

6. Agregar `Undo2` al import de `lucide-react` y el import del diálogo.

Si el nombre del `mutate` de SWR o de la variable de saldo difiere en el archivo, usá los que estén: no renombres nada existente.

- [ ] **Step 5: Verificar tipos y lint**

Run: `npx tsc --noEmit && npx eslint app/api/clientes components/clientes`

Expected: limpio.

- [ ] **Step 6: Prueba manual**

En un cliente con una orden entregada a fiado: aparece el botón de revertir, pide motivo, muestra el total y el saldo resultante, y al confirmar el movimiento queda con badge "Revertido" y aparece el `DEVOLUCION`. Con un usuario VENDEDOR el botón no aparece.

- [ ] **Step 7: Commit**

```bash
git add components/clientes/detalle/revertir-cargo-dialog.tsx components/clientes/detalle/cuenta-corriente-panel.tsx app/api/clientes/\[id\]/cuenta-corriente/route.ts
git commit -m "feat(cuenta-corriente): revert action and reverted badge in the client panel"
```

- [ ] **Step 8: Abrir el PR2** apuntando a la branch del PR1.

---

# FASE 3 — PR3: reparaciones express

**Branch:** `feat/reparaciones-express`, sacada de `feat/cc-revertir-cargo-orden`.

### Task 6: Migración — RPC, feature flag e idempotencia

**Files:**
- Create: `supabase/migrations/NNN_reparaciones_express.sql`
- Reference: `supabase/migrations/288_crear_recepcion_multiple.sql` (patrón), `supabase/migrations/287_recepcion_multiple.sql:160-163` (feature flag), `supabase/migrations/242_cobros_orden_atomico.sql:7-8` (columnas de `pago_idempotency`)

**Interfaces:**
- Consumes: `get_next_order_number(TEXT)`, `cargar_deuda_cuenta_corriente(...)` con `p_sucursal_id`
- Produces: `crear_reparaciones_express(p_organization_id, p_sucursal_id, p_cliente_id, p_reparaciones JSONB, p_operador_id, p_created_by, p_idempotency_key) RETURNS JSONB` → `{ ordenes: [{id, numeroOrden, codigoOrden, dispositivo, precio, publicToken, movimientoId}], totalCargado, saldoNuevo }` o `{ replayed: true, response }`

- [ ] **Step 1: Escribir la migración**

```sql
-- ============================================================================
-- NNN: express repairs charged straight to a client's cuenta corriente
-- ============================================================================
-- N repairs already done for one client, charged as debt in a single pass, with
-- no order lifecycle. Each repair is a real ordenes_servicio row that is BORN in
-- the terminal state ENTREGADO.
--
-- Born, not transitioned: lib/orden-state-machine.ts:12 does not allow
-- RECIBIDO -> ENTREGADO (the path runs through REPARADO). Creating the row
-- already terminal is a creation, so the state machine is neither touched nor
-- weakened — the same move crear_recepcion_multiple makes when it creates its
-- orders already in RECIBIDO.
--
-- Everything runs in ONE transaction, which buys two properties for free, both
-- inherited from mig 288:
--   1. the update_ordenes_count trigger (mig 167) rolls the whole batch back
--      when the organization is over its plan's order limit;
--   2. the sequential cargar_deuda_cuenta_corriente calls take FOR UPDATE on the
--      client row inside this same transaction, so the saldo_posterior chain
--      stays consistent with no race against another terminal.
--
-- get_next_order_number, never MAX+1: two counter terminals of the same
-- organization inserting at once would read the same max and collide against
-- UNIQUE(organization_id, numero_orden), showing a raw database error to
-- whoever is standing at the counter.
--
-- publicToken and the warranty expiry date are computed by the app and arrive in
-- p_reparaciones: tokens so the database does not depend on pgcrypto (mig 288),
-- the expiry because it is a CALENDAR day in the workshop timezone
-- (organizations.zona_horaria) and NOW() + interval would land on the wrong day
-- for any workshop outside UTC.
-- ============================================================================

-- pago_idempotency already carries venta_id / orden_id / factura_id, each added
-- by the flow that needed it (mig 233, 242, 243). A batch has none of those.
ALTER TABLE pago_idempotency ADD COLUMN IF NOT EXISTS cliente_id TEXT;

CREATE OR REPLACE FUNCTION crear_reparaciones_express(
  p_organization_id TEXT,
  p_sucursal_id     TEXT,
  p_cliente_id      TEXT,
  p_reparaciones    JSONB,
  p_operador_id     TEXT,
  p_created_by      TEXT,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_rep          JSONB;
  v_orden_id     TEXT;
  v_numero_orden INTEGER;
  v_codigo_orden TEXT;
  v_prefijo      TEXT;
  v_precio       DECIMAL;
  v_dias         INTEGER;
  v_cargo        JSONB;
  v_ordenes      JSONB := '[]'::JSONB;
  v_total        DECIMAL := 0;
  v_saldo        DECIMAL;
  v_existing     JSONB;
  v_result       JSONB;
BEGIN
  IF p_reparaciones IS NULL OR jsonb_array_length(p_reparaciones) = 0 THEN
    RAISE EXCEPTION 'reparaciones_express: at least one repair is required';
  END IF;

  -- Idempotency claim INSIDE this transaction (same shape as mig 269:651-661).
  -- This is money: without it a double click on a slow connection charges the
  -- client twice.
  IF p_idempotency_key IS NOT NULL THEN
    BEGIN
      INSERT INTO pago_idempotency (organization_id, idempotency_key, cliente_id)
        VALUES (p_organization_id, p_idempotency_key, p_cliente_id);
    EXCEPTION WHEN unique_violation THEN
      SELECT response INTO v_existing
        FROM pago_idempotency
        WHERE organization_id = p_organization_id
          AND idempotency_key = p_idempotency_key;
      RETURN jsonb_build_object('replayed', true, 'response', v_existing);
    END;
  END IF;

  FOR v_rep IN SELECT * FROM jsonb_array_elements(p_reparaciones)
  LOOP
    IF COALESCE(v_rep->>'publicToken', '') = '' THEN
      RAISE EXCEPTION 'reparaciones_express: missing publicToken for %', v_rep->>'dispositivo';
    END IF;

    v_precio := (v_rep->>'precio')::DECIMAL;
    IF v_precio IS NULL OR v_precio <= 0 THEN
      RAISE EXCEPTION 'reparaciones_express: price must be greater than 0 for %', v_rep->>'dispositivo';
    END IF;

    SELECT prefijo_orden INTO v_prefijo
    FROM tipos_dispositivo
    WHERE organization_id = p_organization_id
      AND codigo = (v_rep->>'tipoDispositivo')
      AND activo = TRUE
    LIMIT 1;

    v_prefijo      := COALESCE(v_prefijo, 'ORD');
    v_numero_orden := get_next_order_number(p_organization_id);
    v_codigo_orden := v_prefijo || LPAD(v_numero_orden::TEXT, 3, '0');

    INSERT INTO ordenes_servicio (
      numero_orden, codigo_orden, cliente_id, organization_id, sucursal_id,
      dispositivo, tipo_dispositivo, marca, imei, problema_reportado,
      estado, estado_cobro, costo_final, total_cobrado,
      fecha_entrega, fecha_completado, entregado_por_user_id, recibido_por,
      public_token
    ) VALUES (
      v_numero_orden,
      v_codigo_orden,
      p_cliente_id,
      p_organization_id,
      p_sucursal_id,
      v_rep->>'dispositivo',
      v_rep->>'tipoDispositivo',
      NULLIF(v_rep->>'marca', ''),
      NULLIF(v_rep->>'imei', ''),
      v_rep->>'trabajoRealizado',
      'ENTREGADO',
      'PENDIENTE',
      v_precio,
      0,
      NOW(),
      NOW(),
      p_created_by,
      p_operador_id,
      v_rep->>'publicToken'
    ) RETURNING id INTO v_orden_id;

    INSERT INTO orden_eventos (
      orden_id, organization_id, tipo, estado_nuevo, descripcion, created_by
    ) VALUES (
      v_orden_id, p_organization_id, 'CAMBIO_ESTADO', 'ENTREGADO',
      'Reparación express: el equipo se entregó en el momento, sin recepción previa',
      p_created_by
    );

    v_dias := COALESCE((v_rep->>'diasGarantia')::INTEGER, 0);
    IF v_dias > 0 THEN
      INSERT INTO garantias (orden_id, dias_validez, fecha_inicio, fecha_vencimiento)
      VALUES (
        v_orden_id,
        v_dias,
        NOW(),
        (v_rep->>'fechaVencimientoGarantia')::TIMESTAMPTZ
      );
    END IF;

    SELECT cargar_deuda_cuenta_corriente(
      p_organization_id, p_cliente_id, v_precio, 'ORDEN', v_orden_id,
      p_created_by, p_sucursal_id
    ) INTO v_cargo;

    v_total   := v_total + v_precio;
    v_ordenes := v_ordenes || jsonb_build_object(
      'id',           v_orden_id,
      'numeroOrden',  v_numero_orden,
      'codigoOrden',  v_codigo_orden,
      'dispositivo',  v_rep->>'dispositivo',
      'precio',       v_precio,
      'publicToken',  v_rep->>'publicToken',
      'movimientoId', v_cargo->>'id'
    );
  END LOOP;

  SELECT saldo_cuenta INTO v_saldo FROM clientes WHERE id = p_cliente_id;

  v_result := jsonb_build_object(
    'ordenes',      v_ordenes,
    'totalCargado', v_total,
    'saldoNuevo',   v_saldo
  );

  IF p_idempotency_key IS NOT NULL THEN
    UPDATE pago_idempotency
      SET response = v_result
      WHERE organization_id = p_organization_id
        AND idempotency_key = p_idempotency_key;
  END IF;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION crear_reparaciones_express(TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION crear_reparaciones_express(TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION crear_reparaciones_express(TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION crear_reparaciones_express(TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT) TO service_role;

COMMENT ON FUNCTION crear_reparaciones_express(TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT) IS
  'Creates N express repair orders for one client, born in the terminal state '
  'ENTREGADO, each with its CARGO on the client cuenta corriente, in a single '
  'transaction. Rolls the whole batch back on any failure, plan order limit '
  'included. Idempotent through pago_idempotency.';

-- Feature flag: Profesional y Pro. A dedicated flag and NOT a reuse of
-- recepcion_multiple: they are independent features and a workshop may want one
-- without the other.
UPDATE plans SET
  feature_flags = COALESCE(feature_flags, '{}'::jsonb) || '{"reparaciones_express": true}'::jsonb,
  updated_at = NOW()
WHERE slug IN ('profesional', 'pro');
```

- [ ] **Step 2: Verificar las columnas contra el esquema real antes del dry-run**

Run: `rg -n "ADD COLUMN|CREATE TABLE garantias" supabase/migrations/*.sql | rg -i "garantias|ordenes_servicio"`

Expected: confirmá que `garantias` acepta `orden_id`, `dias_validez`, `fecha_inicio`, `fecha_vencimiento`, y que `ordenes_servicio` tiene `fecha_completado` y `entregado_por_user_id`. Si alguna columna no existe con ese nombre, corregí el `INSERT` — **no** agregues columnas nuevas.

- [ ] **Step 3: Dry-run**

Run: `node scripts/db-run.mjs supabase/migrations/NNN_reparaciones_express.sql --dry-run`

Expected: sin errores de sintaxis.

- [ ] **Step 4: Aplicar**

Run: aplicar la migración.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/NNN_reparaciones_express.sql
git commit -m "feat(ordenes): add crear_reparaciones_express RPC and plan feature flag"
```

---

### Task 7: Endpoint del lote express

**Files:**
- Create: `app/api/reparaciones-express/route.ts`
- Test: `__tests__/api/reparaciones-express.test.ts`
- Reference: `app/api/recepciones/route.ts` (estructura completa a imitar)

**Interfaces:**
- Consumes: RPC `crear_reparaciones_express` (Task 6)
- Produces: `POST /api/reparaciones-express` con body `{ clienteId, reparaciones: [{dispositivo, tipoDispositivo, marca?, imei?, trabajoRealizado, precio, diasGarantia?}], operadorId?, idempotencyKey? }` → `201 { ordenes, totalCargado, saldoNuevo }`

- [ ] **Step 1: Escribir los tests que fallan**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, createPostRequest } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"
import { POST as expressPOST } from "@/app/api/reparaciones-express/route"

vi.mock("@/lib/subscriptions", () => ({ hasPlanFeature: vi.fn().mockResolvedValue(true) }))
vi.mock("@/lib/plan-limits", () => ({
  enforcePlanLimit: vi.fn().mockResolvedValue(null),
  isPlanLimitError: vi.fn().mockReturnValue(false),
  planLimitErrorResponse: vi.fn(),
}))
vi.mock("@/lib/tipos-dispositivo-config", () => ({ tipoValidaImei: vi.fn().mockResolvedValue(true) }))

import { hasPlanFeature } from "@/lib/subscriptions"

const url = "http://localhost/api/reparaciones-express"

function reparacion(over: Partial<any> = {}) {
  return {
    dispositivo: "iPhone 11 Pro", tipoDispositivo: "CELULAR",
    trabajoRealizado: "Cambio de pantalla", precio: 50000, ...over,
  }
}

function body(over: Partial<any> = {}) {
  return { clienteId: "c1", reparaciones: [reparacion()], ...over }
}

describe("reparaciones express", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(hasPlanFeature).mockResolvedValue(true)
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: {
        ordenes: [{ id: "o1", numeroOrden: 1, codigoOrden: "CEL001", dispositivo: "iPhone 11 Pro", precio: 50000, movimientoId: "mov1" }],
        totalCargado: 50000,
        saldoNuevo: -50000,
      },
      error: null,
    } as any)
    mockSupabaseFrom({
      organizations: createChainMock({ zona_horaria: "America/Argentina/Buenos_Aires" }),
    })
  })

  it("crea el lote y llama a la RPC con las reparaciones", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    const res = await expressPOST(createPostRequest(body(), url))

    expect(res.status).toBe(201)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "crear_reparaciones_express",
      expect.objectContaining({
        p_organization_id: "org-1",
        p_cliente_id: "c1",
        p_reparaciones: expect.arrayContaining([
          expect.objectContaining({ dispositivo: "iPhone 11 Pro", precio: 50000 }),
        ]),
      })
    )
  })

  it("genera un publicToken por reparacion", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    await expressPOST(createPostRequest(
      body({ reparaciones: [reparacion(), reparacion({ dispositivo: "Motorola G8" })] }), url
    ))

    const call = vi.mocked(supabaseAdmin.rpc).mock.calls[0][1] as any
    const tokens = call.p_reparaciones.map((r: any) => r.publicToken)
    expect(tokens).toHaveLength(2)
    expect(tokens[0]).toBeTruthy()
    expect(tokens[0]).not.toBe(tokens[1])
  })

  it("rechaza si el plan no tiene la feature", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    vi.mocked(hasPlanFeature).mockResolvedValue(false)

    const res = await expressPOST(createPostRequest(body(), url))

    expect(res.status).toBe(403)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("rechaza un IMEI invalido para un tipo que lo exige", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    const res = await expressPOST(createPostRequest(
      body({ reparaciones: [reparacion({ imei: "123" })] }), url
    ))

    expect(res.status).toBe(400)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("rechaza precio cero o negativo", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    const res = await expressPOST(createPostRequest(
      body({ reparaciones: [reparacion({ precio: 0 })] }), url
    ))

    expect(res.status).toBe(400)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("rechaza un lote vacio", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    const res = await expressPOST(createPostRequest(body({ reparaciones: [] }), url))

    expect(res.status).toBe(400)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("propaga la idempotencyKey a la RPC", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    await expressPOST(createPostRequest(body({ idempotencyKey: "abc-123" }), url))

    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "crear_reparaciones_express",
      expect.objectContaining({ p_idempotency_key: "abc-123" })
    )
  })

  it("calcula fechaVencimientoGarantia cuando hay dias de garantia", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    await expressPOST(createPostRequest(
      body({ reparaciones: [reparacion({ diasGarantia: 30 })] }), url
    ))

    const call = vi.mocked(supabaseAdmin.rpc).mock.calls[0][1] as any
    expect(call.p_reparaciones[0].fechaVencimientoGarantia).toBeTruthy()
  })
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run __tests__/api/reparaciones-express.test.ts`

Expected: FAIL — no existe `@/app/api/reparaciones-express/route`.

- [ ] **Step 3: Escribir el endpoint**

```typescript
import { NextResponse } from "next/server"
import { randomBytes } from "crypto"
import { z } from "zod"
import { requireAdminOrVendedor } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { hasPlanFeature } from "@/lib/subscriptions"
import { enforcePlanLimit, isPlanLimitError, planLimitErrorResponse } from "@/lib/plan-limits"
import { createAuditLogger } from "@/lib/audit"
import { sucursalParaEscritura } from "@/lib/sucursal"
import { resolveOperador } from "@/lib/operadores"
import { tipoValidaImei } from "@/lib/tipos-dispositivo-config"
import { isValidImei } from "@/lib/imei"
import { addDaysInTimeZone, DEFAULT_TIMEZONE } from "@/lib/timezone"

const FEATURE_KEY = "reparaciones_express"

const reparacionSchema = z.object({
  dispositivo: z.string().min(1, "El dispositivo es requerido"),
  tipoDispositivo: z.string().min(1, "El tipo de dispositivo es requerido"),
  marca: z.string().optional(),
  imei: z.string().optional(),
  trabajoRealizado: z.string().min(1, "El trabajo realizado es requerido"),
  precio: z.number().positive("El precio debe ser mayor a 0"),
  diasGarantia: z.number().int().min(0).default(0),
})

const loteSchema = z.object({
  clienteId: z.string().min(1, "El cliente es requerido"),
  reparaciones: z.array(reparacionSchema).min(1, "Debe cargar al menos una reparación"),
  operadorId: z.string().nullable().optional(),
  idempotencyKey: z.string().max(100).nullable().optional(),
})

function generatePublicToken(): string {
  return randomBytes(16).toString("hex")
}

export async function POST(request: Request) {
  try {
    const { error, session, organizationId, userId, role } = await requireAdminOrVendedor()
    if (error) return error

    const hasFeature = await hasPlanFeature(organizationId!, FEATURE_KEY)
    if (!hasFeature) {
      return NextResponse.json(
        {
          error: "Las reparaciones express están disponibles en el plan Profesional",
          code: "FEATURE_REQUIRED",
          feature: FEATURE_KEY,
        },
        { status: 403 },
      )
    }

    const body = await request.json()
    const data = loteSchema.parse(body)

    // Pre-check for the whole batch. The update_ordenes_count trigger validates
    // it again inside the transaction.
    const limitError = await enforcePlanLimit(organizationId!, "ordenes")
    if (limitError) return limitError

    for (const rep of data.reparaciones) {
      if (rep.imei && rep.imei.trim()) {
        const validaImei = await tipoValidaImei(organizationId!, rep.tipoDispositivo)
        if (validaImei && !isValidImei(rep.imei)) {
          return NextResponse.json(
            { error: `El IMEI de ${rep.dispositivo} debe tener exactamente 15 dígitos` },
            { status: 400 },
          )
        }
      }
    }

    const sucursalId = await sucursalParaEscritura({
      role,
      organizationId: organizationId!,
      userSucursalId: session!.user.sucursalId ?? null,
    })
    const operador = await resolveOperador(organizationId!, data.operadorId, userId!)

    // The warranty expiry is a CALENDAR day in the workshop timezone, so it is
    // computed here and not with NOW() + interval inside the RPC.
    const { data: org } = await supabaseAdmin
      .from("organizations")
      .select("zona_horaria")
      .eq("id", organizationId!)
      .single()
    const zonaHoraria = org?.zona_horaria || DEFAULT_TIMEZONE

    const reparacionesRpc = data.reparaciones.map((rep) => ({
      dispositivo: rep.dispositivo,
      tipoDispositivo: rep.tipoDispositivo,
      marca: rep.marca ?? null,
      imei: rep.imei ?? null,
      trabajoRealizado: rep.trabajoRealizado,
      precio: rep.precio,
      diasGarantia: rep.diasGarantia,
      fechaVencimientoGarantia:
        rep.diasGarantia > 0 ? addDaysInTimeZone(rep.diasGarantia, zonaHoraria) : null,
      publicToken: generatePublicToken(),
    }))

    const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc(
      "crear_reparaciones_express",
      {
        p_organization_id: organizationId!,
        p_sucursal_id: sucursalId,
        p_cliente_id: data.clienteId,
        p_reparaciones: reparacionesRpc,
        p_operador_id: operador,
        p_created_by: userId!,
        p_idempotency_key: data.idempotencyKey ?? null,
      },
    )

    if (rpcError) {
      if (isPlanLimitError(rpcError)) return planLimitErrorResponse(rpcError)
      console.error("Error en crear_reparaciones_express:", rpcError)
      return NextResponse.json({ error: "Error al cargar las reparaciones" }, { status: 500 })
    }

    // A replayed request returns the original response: the client already got
    // charged once and must not be charged again.
    const result = rpcResult?.replayed ? rpcResult.response : rpcResult

    const audit = createAuditLogger(organizationId!, userId!, request)
    for (const orden of result.ordenes || []) {
      await audit.create("ordenes_servicio", orden.id, {
        numero_orden: orden.numeroOrden,
        dispositivo: orden.dispositivo,
        cliente_id: data.clienteId,
        precio: orden.precio,
        origen: "reparacion_express",
      })
    }

    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error creating reparaciones express:", err)
    return NextResponse.json({ error: "Error al cargar las reparaciones" }, { status: 500 })
  }
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run __tests__/api/reparaciones-express.test.ts`

Expected: PASS, 8 tests.

- [ ] **Step 5: Verificar tipos**

Run: `npx tsc --noEmit`

Expected: limpio.

- [ ] **Step 6: Commit**

```bash
git add app/api/reparaciones-express/route.ts __tests__/api/reparaciones-express.test.ts
git commit -m "feat(ordenes): add express repairs batch endpoint"
```

---

### Task 8: Diálogo del lote y botón en el detalle del cliente

**Files:**
- Create: `components/clientes/detalle/reparaciones-express-dialog.tsx`
- Modify: `components/clientes/detalle/cliente-detalle.tsx` (botón de disparo)

**Interfaces:**
- Consumes: `POST /api/reparaciones-express` (Task 7), `RevertirCargoDialog` (Task 5)
- Produces: `ReparacionesExpressDialog` con props `{ cliente: Cliente, open: boolean, onOpenChange: (v: boolean) => void, onDone: () => void }`

- [ ] **Step 1: Escribir el diálogo**

```tsx
"use client"

import { useState, useMemo } from "react"
import useSWR from "swr"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Plus, Trash2, Loader2, Wrench } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"
import { toast } from "sonner"
import type { Cliente } from "@/types"
import { RevertirCargoDialog } from "./revertir-cargo-dialog"

// This app has no global SWR fetcher: every component declares its own
// (see cliente-detalle.tsx:20). useSWR(key) with no fetcher would throw.
const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface OrdenCreada {
  id: string
  numeroOrden: number
  codigoOrden: string
  dispositivo: string
  precio: number
  movimientoId: string
}

interface Fila {
  key: string
  dispositivo: string
  tipoDispositivo: string
  marca: string
  imei: string
  trabajoRealizado: string
  precio: string
  diasGarantia: string
}

function filaVacia(key: string): Fila {
  return {
    key, dispositivo: "", tipoDispositivo: "", marca: "", imei: "",
    trabajoRealizado: "", precio: "", diasGarantia: "0",
  }
}

interface ReparacionesExpressDialogProps {
  cliente: Cliente
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: () => void
}

export function ReparacionesExpressDialog({
  cliente, open, onOpenChange, onDone,
}: ReparacionesExpressDialogProps) {
  const { formatPrice } = useCurrency()
  const [filas, setFilas] = useState<Fila[]>([filaVacia("f0")])
  const [loading, setLoading] = useState(false)
  // Success state: the batch just landed. Keeping it on screen is what makes
  // "Revertir lote" reachable exactly when the mistake is still in sight.
  const [creadas, setCreadas] = useState<OrdenCreada[]>([])
  const [revertirOpen, setRevertirOpen] = useState(false)
  const { data: tipos } = useSWR<Array<{ codigo: string; nombre: string }>>(
    open ? "/api/tipos-dispositivo?activo=true" : null,
    fetcher,
    { revalidateOnFocus: false }
  )

  const total = useMemo(
    () => filas.reduce((sum, f) => sum + (parseFloat(f.precio) || 0), 0),
    [filas]
  )
  const saldoActual = Number(cliente.saldoCuenta ?? 0)

  function actualizar(key: string, campo: keyof Fila, valor: string) {
    setFilas((prev) => prev.map((f) => (f.key === key ? { ...f, [campo]: valor } : f)))
  }

  async function handleGuardar() {
    const reparaciones = filas.map((f) => ({
      dispositivo: f.dispositivo.trim(),
      tipoDispositivo: f.tipoDispositivo,
      marca: f.marca.trim() || undefined,
      imei: f.imei.trim() || undefined,
      trabajoRealizado: f.trabajoRealizado.trim(),
      precio: parseFloat(f.precio) || 0,
      diasGarantia: parseInt(f.diasGarantia, 10) || 0,
    }))

    const incompleta = reparaciones.find(
      (r) => !r.dispositivo || !r.tipoDispositivo || !r.trabajoRealizado || r.precio <= 0
    )
    if (incompleta) {
      toast.error("Completá equipo, tipo, trabajo y precio en todas las filas")
      return
    }

    setLoading(true)
    try {
      const res = await fetch("/api/reparaciones-express", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clienteId: cliente.id,
          reparaciones,
          // One stable key per submit attempt: an offline retry reuses it and
          // the barrier replays instead of charging the client twice.
          idempotencyKey: crypto.randomUUID(),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Error al cargar las reparaciones")
      toast.success(
        `${json.ordenes.length} ${json.ordenes.length === 1 ? "reparación cargada" : "reparaciones cargadas"} · ${formatPrice(json.totalCargado)}`
      )
      setFilas([filaVacia("f0")])
      setCreadas(json.ordenes)
      onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al cargar las reparaciones")
    } finally {
      setLoading(false)
    }
  }

  function cerrar() {
    setCreadas([])
    setFilas([filaVacia("f0")])
    onOpenChange(false)
  }

  if (creadas.length > 0) {
    return (
      <>
        <Dialog open={open} onOpenChange={(v) => !v && cerrar()}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reparaciones cargadas</DialogTitle>
              <DialogDescription>
                Quedaron en la cuenta corriente de {cliente.nombre}.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-1 text-sm max-h-[40vh] overflow-y-auto">
              {creadas.map((o) => (
                <div key={o.id} className="flex items-center justify-between rounded-lg bg-muted/50 p-2">
                  <a
                    href={`/ordenes/${o.id}`}
                    className="underline underline-offset-2"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {o.codigoOrden} · {o.dispositivo}
                  </a>
                  <span>{formatPrice(o.precio)}</span>
                </div>
              ))}
            </div>

            <DialogFooter>
              <Button variant="destructive" onClick={() => setRevertirOpen(true)}>
                Revertir lote
              </Button>
              <Button onClick={cerrar}>Listo</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <RevertirCargoDialog
          clienteId={cliente.id}
          movimientos={creadas.map((o) => ({ id: o.movimientoId, monto: o.precio }))}
          saldoActual={saldoActual - creadas.reduce((s, o) => s + o.precio, 0)}
          open={revertirOpen}
          onOpenChange={setRevertirOpen}
          onDone={() => { onDone(); cerrar() }}
        />
      </>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Cargar reparaciones</DialogTitle>
          <DialogDescription>
            Se cargan como deuda en la cuenta corriente de {cliente.nombre}. No se cobra nada ahora.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 max-h-[50vh] overflow-y-auto">
          {filas.map((fila) => (
            <div key={fila.key} className="grid grid-cols-12 gap-2 items-end border-b pb-3">
              <div className="col-span-3 space-y-1">
                <Label className="text-xs">Equipo</Label>
                <Input
                  value={fila.dispositivo}
                  onChange={(e) => actualizar(fila.key, "dispositivo", e.target.value)}
                  placeholder="iPhone 11 Pro"
                />
              </div>
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">Tipo</Label>
                {/* Radix Select set only by user interaction: setting it from
                    outside while the dropdown is closed wipes the value. */}
                <Select
                  value={fila.tipoDispositivo}
                  onValueChange={(v) => actualizar(fila.key, "tipoDispositivo", v)}
                >
                  <SelectTrigger><SelectValue placeholder="Tipo" /></SelectTrigger>
                  <SelectContent>
                    {(tipos || []).map((t) => (
                      <SelectItem key={t.codigo} value={t.codigo}>{t.nombre}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-3 space-y-1">
                <Label className="text-xs">Trabajo realizado</Label>
                <Input
                  value={fila.trabajoRealizado}
                  onChange={(e) => actualizar(fila.key, "trabajoRealizado", e.target.value)}
                  placeholder="Cambio de pantalla"
                />
              </div>
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">Precio</Label>
                <Input
                  inputMode="decimal"
                  value={fila.precio}
                  onChange={(e) => actualizar(fila.key, "precio", e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="col-span-1 space-y-1">
                <Label className="text-xs">Gar.</Label>
                <Input
                  inputMode="numeric"
                  value={fila.diasGarantia}
                  onChange={(e) => actualizar(fila.key, "diasGarantia", e.target.value)}
                />
              </div>
              <div className="col-span-1 flex justify-end">
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={filas.length === 1}
                  aria-label="Quitar reparación"
                  onClick={() => setFilas((prev) => prev.filter((f) => f.key !== fila.key))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <div className="col-span-6 space-y-1">
                <Label className="text-xs">Marca</Label>
                <Input
                  value={fila.marca}
                  onChange={(e) => actualizar(fila.key, "marca", e.target.value)}
                  placeholder="Apple"
                />
              </div>
              <div className="col-span-6 space-y-1">
                <Label className="text-xs">IMEI / N° de serie</Label>
                <Input
                  value={fila.imei}
                  onChange={(e) => actualizar(fila.key, "imei", e.target.value)}
                />
              </div>
            </div>
          ))}

          <Button
            variant="outline"
            size="sm"
            onClick={() => setFilas((prev) => [...prev, filaVacia(`f${prev.length}-${Date.now()}`)])}
          >
            <Plus className="h-4 w-4" /> Agregar reparación
          </Button>
        </div>

        <div className="flex items-center justify-between rounded-lg bg-muted/50 p-3 text-sm">
          <span>Total a cargar: <strong>{formatPrice(total)}</strong></span>
          <span className="text-muted-foreground">
            Saldo del cliente: {formatPrice(saldoActual)} → {formatPrice(saldoActual - total)}
          </span>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={handleGuardar} disabled={loading || total <= 0}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />}
            Cargar a cuenta corriente
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Cablear el botón en el detalle del cliente**

En `components/clientes/detalle/cliente-detalle.tsx`, junto al panel de cuenta corriente:

```tsx
  const [expressOpen, setExpressOpen] = useState(false)
```

```tsx
        <Button variant="outline" size="sm" onClick={() => setExpressOpen(true)}>
          <Wrench className="h-4 w-4" /> Cargar reparaciones
        </Button>

        <ReparacionesExpressDialog
          cliente={cliente}
          open={expressOpen}
          onOpenChange={setExpressOpen}
          onDone={() => mutate()}
        />
```

Usá el `mutate` de SWR que el componente ya tenga para refrescar cliente y movimientos. Si el endpoint de tipos de dispositivo no es `/api/tipos-dispositivo?activo=true`, buscá el que usa `components/ordenes/orden-form.tsx` y usá ese.

- [ ] **Step 3: Verificar tipos y lint**

Run: `npx tsc --noEmit && npx eslint app/api/reparaciones-express components/clientes`

Expected: limpio.

- [ ] **Step 4: Prueba manual**

En un cliente real: cargar 2 reparaciones, confirmar, y verificar que (a) aparecen 2 movimientos `CARGO` en el panel, (b) el saldo bajó por el total, (c) las 2 órdenes existen en `ENTREGADO`, (d) el buscador global las encuentra por IMEI, (e) el botón de revertir aparece en cada `CARGO`, (f) con plan Free el botón devuelve el 403 de feature.

Después, en un lote nuevo: usar **Revertir lote** desde el modal de éxito y verificar que los N movimientos quedan con badge "Revertido", que aparecen N `DEVOLUCION` y que el saldo vuelve exactamente al valor previo al lote.

- [ ] **Step 5: Commit**

```bash
git add components/clientes/detalle/reparaciones-express-dialog.tsx components/clientes/detalle/cliente-detalle.tsx
git commit -m "feat(clientes): express repairs batch dialog in client detail"
```

- [ ] **Step 6: Abrir el PR3** apuntando a la branch del PR2.

---

## Verificación final antes de mergear la cadena

- [ ] `npx tsc --noEmit` limpio en la punta de la cadena
- [ ] `npx vitest run __tests__/api/cc-revertir-cargo.test.ts __tests__/api/reparaciones-express.test.ts __tests__/api/cc-fiado.test.ts __tests__/api/cc-reversibilidad.test.ts` — los dos últimos son la regresión: la reversa y el fiado existentes no cambiaron
- [ ] `npx vitest run lib/__tests__/orden-state-machine.test.ts` — `TRANSICIONES_VALIDAS` intacta
- [ ] Las tres migraciones aplicadas en orden, cada una con dry-run previo
- [ ] `docs/deuda-fiado-doble-conteo-verificacion.sql` corrido después de todo: cero filas con `duplicado > 0`
