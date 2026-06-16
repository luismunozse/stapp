# Cuenta corriente — Fiado unificado (Fase 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el saldo de la cuenta corriente refleje el fiado neto: órdenes (al entregar) y ventas impagas debitan (CARGO), y los pagos posteriores acreditan (PAGO).

**Architecture:** Migración SQL agrega tipos `CARGO`/`PAGO`, cambia `cargar_deuda_cuenta_corriente` para usar `CARGO`, y crea `pagar_fiado_cuenta_corriente` (crédito). Las rutas API llaman estas funciones: `entregar` carga el pendiente como fiado; `cobros` (orden) y `ventas/[id]/pagos` acreditan los pagos externos posteriores. "Pagar con CC" (`usar`/`USO`) queda intacto y separado del fiado.

**Tech Stack:** Next.js API routes, Supabase (`supabaseAdmin.rpc`), Postgres plpgsql, Zod, Vitest.

**Convención de tests:** TDD en las rutas API (mockear `supabaseAdmin.rpc` y afirmar las llamadas). Las funciones/constraint SQL se verifican manual (sin infra de test SQL). Errores/ruido pre-existentes a ignorar: `__tests__/lib/csv-export.test.ts` Buffer; build warnings firebase-admin / fonts / superadmin DYNAMIC_SERVER_USAGE.

**Comandos:** test `npm run test:run -- <ruta>` · typecheck `npx tsc --noEmit` · build `npm run build`.

---

## File Structure

**Crear:**
- `supabase/migrations/233_cc_fiado_tipos_y_funciones.sql` — CHECK + cargar_deuda→CARGO + pagar_fiado.
- `__tests__/api/cc-fiado.test.ts` — tests de reconciliación (cobros + ventas pagos + entregar si es factible).

**Modificar:**
- `app/(dashboard)/../api/ordenes/[id]/entregar/route.ts` (ruta real: `app/api/ordenes/[id]/entregar/route.ts`) — cargar fiado al entregar.
- `app/api/ordenes/[id]/cobros/route.ts` — acreditar pagos externos post-entrega.
- `app/api/ventas/[id]/pagos/route.ts` — acreditar pagos externos.

---

## Task 1: Migración 233 — tipos + funciones

**Files:**
- Create: `supabase/migrations/233_cc_fiado_tipos_y_funciones.sql`

- [ ] **Step 1: Confirmar número de migración**

Run: `ls supabase/migrations/ | grep -oE '^[0-9]+' | sort -n | uniq | tail -1`
Si el mayor NO es 232, usar `<mayor>+1`. (El plan asume 233.)

- [ ] **Step 2: Crear la migración**

`supabase/migrations/233_cc_fiado_tipos_y_funciones.sql`:

```sql
-- 1) Tipos de movimiento: agregar CARGO (fiado) y PAGO (pago de fiado)
ALTER TABLE cuenta_corriente DROP CONSTRAINT IF EXISTS cuenta_corriente_tipo_check;
ALTER TABLE cuenta_corriente ADD CONSTRAINT cuenta_corriente_tipo_check
  CHECK (tipo IN ('DEPOSITO','USO','DEVOLUCION','AJUSTE','CARGO','PAGO'));

-- 2) cargar_deuda ahora inserta CARGO (antes USO). Misma firma y semántica.
CREATE OR REPLACE FUNCTION cargar_deuda_cuenta_corriente(
  p_org_id TEXT,
  p_cliente_id TEXT,
  p_monto DECIMAL,
  p_referencia_tipo TEXT,
  p_referencia_id TEXT,
  p_usuario_id TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_saldo_actual DECIMAL;
  v_nuevo_saldo DECIMAL;
  v_mov_id TEXT;
BEGIN
  SELECT saldo_cuenta INTO v_saldo_actual
  FROM clientes
  WHERE id = p_cliente_id AND organization_id = p_org_id
  FOR UPDATE;

  IF v_saldo_actual IS NULL THEN
    RAISE EXCEPTION 'Cliente no encontrado';
  END IF;

  v_nuevo_saldo := COALESCE(v_saldo_actual, 0) - p_monto;

  INSERT INTO cuenta_corriente (
    organization_id, cliente_id, tipo, monto, saldo_posterior,
    referencia_tipo, referencia_id, usuario_id, observaciones
  ) VALUES (
    p_org_id, p_cliente_id, 'CARGO', -p_monto, v_nuevo_saldo,
    p_referencia_tipo, p_referencia_id, p_usuario_id,
    'Cargo a cuenta corriente (saldo pendiente)'
  ) RETURNING id INTO v_mov_id;

  UPDATE clientes SET saldo_cuenta = v_nuevo_saldo WHERE id = p_cliente_id;

  RETURN jsonb_build_object('id', v_mov_id, 'saldoAnterior', v_saldo_actual, 'saldoNuevo', v_nuevo_saldo);
END;
$$ LANGUAGE plpgsql;

-- 3) pagar_fiado: crédito (+) que baja el fiado. No valida saldo (un pago siempre entra).
CREATE OR REPLACE FUNCTION pagar_fiado_cuenta_corriente(
  p_org_id TEXT,
  p_cliente_id TEXT,
  p_monto DECIMAL,
  p_referencia_tipo TEXT,
  p_referencia_id TEXT,
  p_usuario_id TEXT DEFAULT NULL,
  p_observaciones TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_saldo_actual DECIMAL;
  v_nuevo_saldo DECIMAL;
  v_mov_id TEXT;
BEGIN
  SELECT saldo_cuenta INTO v_saldo_actual
  FROM clientes
  WHERE id = p_cliente_id AND organization_id = p_org_id
  FOR UPDATE;

  IF v_saldo_actual IS NULL THEN
    RAISE EXCEPTION 'Cliente no encontrado';
  END IF;

  v_nuevo_saldo := COALESCE(v_saldo_actual, 0) + p_monto;

  INSERT INTO cuenta_corriente (
    organization_id, cliente_id, tipo, monto, saldo_posterior,
    referencia_tipo, referencia_id, usuario_id, observaciones
  ) VALUES (
    p_org_id, p_cliente_id, 'PAGO', p_monto, v_nuevo_saldo,
    p_referencia_tipo, p_referencia_id, p_usuario_id,
    COALESCE(p_observaciones, 'Pago de fiado')
  ) RETURNING id INTO v_mov_id;

  UPDATE clientes SET saldo_cuenta = v_nuevo_saldo WHERE id = p_cliente_id;

  RETURN jsonb_build_object('id', v_mov_id, 'saldoAnterior', v_saldo_actual, 'saldoNuevo', v_nuevo_saldo);
END;
$$ LANGUAGE plpgsql;
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/233_cc_fiado_tipos_y_funciones.sql
git commit -m "feat(db): 233 — tipos CARGO/PAGO + pagar_fiado_cuenta_corriente"
```

(NO ejecutar git si trabajás como subagente — el controlador commitea.)

---

## Task 2: Órdenes — cargar fiado al entregar

**Files:**
- Modify: `app/api/ordenes/[id]/entregar/route.ts`

Contexto: el handler ya bloquea entregar dos veces (`:53-56`, estados ENTREGADO*). Tras actualizar la orden (`updatedOrden`, `:93-110`) tenemos `costo_final`, `descuento_cobro`, `total_cobrado`, `clientes`. `sinCobro` (`:58`) indica entrega sin cobro.

- [ ] **Step 1: Agregar el cargo de fiado tras la actualización**

Justo después de `if (updateError) throw updateError` (`:110`), insertar:

```ts
    // Fiado: si se entrega con saldo pendiente (y no es entrega sin cobro),
    // debitar la cuenta corriente del cliente.
    if (!sinCobro && orden.cliente_id) {
      const costoFinal = parseFloat(updatedOrden.costo_final || "0")
      const descuento = parseFloat(updatedOrden.descuento_cobro || "0")
      const cobrado = parseFloat(updatedOrden.total_cobrado || "0")
      const pendiente = Math.round((costoFinal - descuento - cobrado) * 100) / 100
      if (pendiente > 0) {
        const { error: fiadoError } = await supabaseAdmin.rpc("cargar_deuda_cuenta_corriente", {
          p_org_id: organizationId!,
          p_cliente_id: orden.cliente_id,
          p_monto: pendiente,
          p_referencia_tipo: "ORDEN",
          p_referencia_id: id,
          p_usuario_id: userId!,
        })
        if (fiadoError) {
          // No abortar la entrega por un error de CC; registrar y seguir
          // (mismo criterio que consumir_reservas más abajo).
          console.error("Error cargando fiado a cuenta corriente:", fiadoError)
        }
      }
    }
```

Nota: `orden.cliente_id` viene del primer fetch (`:37-42`, `select *`). Si no estuviera, usar `updatedOrden.cliente_id`. Confirmar que el campo existe en el row.

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit` (sin errores nuevos)
Run: `npm run build` ("✓ Compiled successfully")

- [ ] **Step 3: Commit**

```bash
git add "app/api/ordenes/[id]/entregar/route.ts"
git commit -m "feat(ordenes): cargar fiado a cuenta corriente al entregar con saldo pendiente"
```

---

## Task 3: Órdenes — acreditar pagos externos post-entrega (TDD)

**Files:**
- Modify: `app/api/ordenes/[id]/cobros/route.ts`
- Test: `__tests__/api/cc-fiado.test.ts`

Contexto: el POST trae la orden (`:90-95`) — hay que sumar `estado` al select. Tras el loop de cobros (`:124-162`) y antes/después de `recalcular_estado_cobro` (`:165`), acreditar los pagos NO-CC si la orden ya está entregada.

- [ ] **Step 1: Escribir el test (TDD) — debe fallar**

Crear `__tests__/api/cc-fiado.test.ts` con los casos de órdenes (ventas se agregan en Task 4). Antes, leer `__tests__/api/helpers.ts` y confirmar cómo se mockea `supabaseAdmin.rpc` (si no hay helper, usar `vi.mocked(supabaseAdmin.rpc)` directamente y `mockResolvedValue({ data: {}, error: null })`).

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, createPostRequest, parseResponse } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"
import { POST as cobrosPOST } from "@/app/api/ordenes/[id]/cobros/route"

function ordenRow(over: Partial<any> = {}) {
  return {
    id: "o1", costo_final: "100", total_cobrado: "0", estado_cobro: "PENDIENTE",
    descuento_cobro: "0", cliente_id: "c1", organization_id: "org-1",
    estado: "ENTREGADO", ...over,
  }
}

describe("cobros orden — reconciliación de fiado", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: {}, error: null } as any)
  })

  it("acredita PAGO al cobrar en efectivo una orden ENTREGADA", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({ ordenes_servicio: createChainMock(ordenRow()), cobros_orden: createChainMock({ id: "cob1" }) })

    await cobrosPOST(
      createPostRequest({ pagos: [{ monto: 40, metodo: "EFECTIVO" }] }, "http://localhost/api/ordenes/o1/cobros"),
      { params: Promise.resolve({ id: "o1" }) } as any
    )

    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "pagar_fiado_cuenta_corriente",
      expect.objectContaining({ p_cliente_id: "c1", p_monto: 40, p_referencia_tipo: "ORDEN", p_referencia_id: "o1" })
    )
  })

  it("NO acredita si la orden NO está entregada", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({ ordenes_servicio: createChainMock(ordenRow({ estado: "REPARADO" })), cobros_orden: createChainMock({ id: "cob1" }) })

    await cobrosPOST(
      createPostRequest({ pagos: [{ monto: 40, metodo: "EFECTIVO" }] }, "http://localhost/api/ordenes/o1/cobros"),
      { params: Promise.resolve({ id: "o1" }) } as any
    )

    const calls = vi.mocked(supabaseAdmin.rpc).mock.calls.map((c) => c[0])
    expect(calls).not.toContain("pagar_fiado_cuenta_corriente")
  })

  it("con método CUENTA_CORRIENTE usa usar_cuenta_corriente, no pagar_fiado", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({ ordenes_servicio: createChainMock(ordenRow()), cobros_orden: createChainMock({ id: "cob1" }) })

    await cobrosPOST(
      createPostRequest({ pagos: [{ monto: 40, metodo: "CUENTA_CORRIENTE" }] }, "http://localhost/api/ordenes/o1/cobros"),
      { params: Promise.resolve({ id: "o1" }) } as any
    )

    const calls = vi.mocked(supabaseAdmin.rpc).mock.calls.map((c) => c[0])
    expect(calls).toContain("usar_cuenta_corriente")
    expect(calls).not.toContain("pagar_fiado_cuenta_corriente")
  })
})
```

Nota mock: `recalcular_estado_cobro` también es un rpc — el `mockResolvedValue` por defecto cubre todas las llamadas rpc. Si el handler hace más `from()` (p.ej. update de descuento), agregar esos chains; con `descuento` ausente no se dispara ese update.

- [ ] **Step 2: Correr — debe FALLAR**

Run: `npm run test:run -- __tests__/api/cc-fiado.test.ts`
Esperado: fallan los casos de "acredita PAGO" (aún no existe la lógica).

- [ ] **Step 3: Implementar**

En `app/api/ordenes/[id]/cobros/route.ts`:
- En el select de la orden (`:92`), agregar `estado`:
  ```ts
  .select("id, costo_final, total_cobrado, estado_cobro, descuento_cobro, cliente_id, organization_id, estado")
  ```
- Después del loop `for (const pago of data.pagos)` (cierra en `:162`), antes de `recalcular_estado_cobro` (`:165`), agregar:
  ```ts
    // Reconciliar fiado: si la orden ya fue entregada, los pagos externos
    // (no CC) acreditan la cuenta corriente y bajan el fiado.
    const entregada = orden.estado === "ENTREGADO" || orden.estado === "ENTREGADO_SIN_REPARACION"
    if (entregada && orden.cliente_id) {
      const totalExterno = data.pagos
        .filter((p) => p.metodo !== "CUENTA_CORRIENTE")
        .reduce((sum, p) => sum + p.monto, 0)
      if (totalExterno > 0) {
        const { error: pagoFiadoError } = await supabaseAdmin.rpc("pagar_fiado_cuenta_corriente", {
          p_org_id: organizationId!,
          p_cliente_id: orden.cliente_id,
          p_monto: totalExterno,
          p_referencia_tipo: "ORDEN",
          p_referencia_id: ordenId,
          p_usuario_id: userId!,
        })
        if (pagoFiadoError) {
          console.error("Error acreditando pago de fiado:", pagoFiadoError)
        }
      }
    }
  ```

- [ ] **Step 4: Correr — debe PASAR**

Run: `npm run test:run -- __tests__/api/cc-fiado.test.ts`

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add app/api/ordenes/[id]/cobros/route.ts __tests__/api/cc-fiado.test.ts
git commit -m "feat(ordenes): acreditar pagos externos al fiado tras entrega"
```

---

## Task 4: Ventas — acreditar pagos externos (TDD)

**Files:**
- Modify: `app/api/ventas/[id]/pagos/route.ts`
- Test: `__tests__/api/cc-fiado.test.ts` (extender)

Contexto: el POST normaliza pagos (`:56-71`), trae la venta (`:74-79`), descuenta CC en método CUENTA_CORRIENTE (`:108-123`), inserta `pagos_venta`, y actualiza `monto_abonado` (`:151-161`). `clienteId = data.clienteId || venta.cliente_id` (`:102`).

- [ ] **Step 1: Agregar tests (deben fallar)**

Añadir a `__tests__/api/cc-fiado.test.ts`:

```ts
import { POST as ventaPagosPOST } from "@/app/api/ventas/[id]/pagos/route"

describe("pagos venta — reconciliación de fiado", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: {}, error: null } as any)
  })

  it("acredita PAGO al pagar en efectivo una venta a fiado", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({
      ventas: createChainMock({ id: "v1", total: "100", monto_abonado: "0", estado: "COMPLETADA", cliente_id: "c1", organization_id: "org-1" }),
      pagos_venta: createChainMock({ id: "p1", monto: 40, metodo_pago: "EFECTIVO" }),
    })

    await ventaPagosPOST(
      createPostRequest({ pagos: [{ monto: 40, metodo: "EFECTIVO" }] }, "http://localhost/api/ventas/v1/pagos"),
      { params: Promise.resolve({ id: "v1" }) } as any
    )

    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "pagar_fiado_cuenta_corriente",
      expect.objectContaining({ p_cliente_id: "c1", p_monto: 40, p_referencia_tipo: "VENTA", p_referencia_id: "v1" })
    )
  })

  it("con CUENTA_CORRIENTE usa usar, no pagar_fiado", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({
      ventas: createChainMock({ id: "v1", total: "100", monto_abonado: "0", estado: "COMPLETADA", cliente_id: "c1", organization_id: "org-1" }),
      pagos_venta: createChainMock({ id: "p1" }),
    })

    await ventaPagosPOST(
      createPostRequest({ pagos: [{ monto: 40, metodo: "CUENTA_CORRIENTE" }] }, "http://localhost/api/ventas/v1/pagos"),
      { params: Promise.resolve({ id: "v1" }) } as any
    )

    const calls = vi.mocked(supabaseAdmin.rpc).mock.calls.map((c) => c[0])
    expect(calls).toContain("usar_cuenta_corriente")
    expect(calls).not.toContain("pagar_fiado_cuenta_corriente")
  })
})
```

- [ ] **Step 2: Correr — debe FALLAR**

Run: `npm run test:run -- __tests__/api/cc-fiado.test.ts`

- [ ] **Step 3: Implementar**

En `app/api/ventas/[id]/pagos/route.ts`, después del loop `for (const pagoLine of pagosToProcess)` (cierra en `:149`) y antes de "Actualizar venta" (`:151`), agregar:

```ts
    // Reconciliar fiado: los pagos externos (no CC) acreditan la cuenta corriente.
    if (clienteId) {
      const totalExterno = pagosToProcess
        .filter((p) => p.metodo !== "CUENTA_CORRIENTE")
        .reduce((sum, p) => sum + p.monto, 0)
      if (totalExterno > 0) {
        const { error: pagoFiadoError } = await supabaseAdmin.rpc("pagar_fiado_cuenta_corriente", {
          p_org_id: organizationId!,
          p_cliente_id: clienteId,
          p_monto: totalExterno,
          p_referencia_tipo: "VENTA",
          p_referencia_id: ventaId,
          p_usuario_id: userId!,
        })
        if (pagoFiadoError) {
          console.error("Error acreditando pago de fiado (venta):", pagoFiadoError)
        }
      }
    }
```

- [ ] **Step 4: Correr — debe PASAR**

Run: `npm run test:run -- __tests__/api/cc-fiado.test.ts`

- [ ] **Step 5: Typecheck + build**

Run: `npx tsc --noEmit` ; `npm run build`

- [ ] **Step 6: Commit**

```bash
git add app/api/ventas/[id]/pagos/route.ts __tests__/api/cc-fiado.test.ts
git commit -m "feat(ventas): acreditar pagos externos al fiado en cuenta corriente"
```

---

## Task 5: Verificación final

- [ ] **Step 1: Suite completa**

Run: `npm run test:run`
Esperado: todo verde, incluido `cc-fiado.test.ts`. Si algún test existente de ventas/ordenes esperaba el tipo `USO` para la deuda de venta, ajustarlo a `CARGO` (revisar fallos y corregir el mock/aserción).

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit` (solo csv-export pre-existente)
Run: `npm run build` ("✓ Compiled successfully")

- [ ] **Step 3: Recorrido manual (requiere migración 233 aplicada)**

Aplicar `233_cc_fiado_tipos_y_funciones.sql` en dev. Luego:
- Crear orden, fijar costo final, entregar SIN cobrar → saldo del cliente baja (fiado, CARGO).
- Cobrar esa orden en efectivo → saldo sube (PAGO), fiado se reduce.
- Entregar orden ya pagada → NO genera fiado.
- Venta a fiado (parcial) → CARGO; pagar el resto en efectivo → PAGO.
- Pagar con "cuenta corriente" (cliente con saldo a favor) → USO, no CARGO/PAGO.

NOTA: sin la migración aplicada, los rpc `cargar_deuda_cuenta_corriente`/`pagar_fiado_cuenta_corriente` fallan (las rutas loguean y siguen, no rompen el flujo principal). Documentar como paso pendiente del usuario.

- [ ] **Step 4: Commit final (si quedó algo suelto)**

```bash
git add -A
git commit -m "chore(cc): ajustes finales fiado fase 1"
```

---

## Self-Review (completado)

- **Cobertura del spec:** tipos+funciones (T1), orden fiado al entregar (T2), orden pago post-entrega acredita (T3), venta pago acredita (T4), verificación (T5). Cubierto.
- **Placeholders:** ninguno; código concreto.
- **Consistencia:** `pagar_fiado_cuenta_corriente` definida en T1 y llamada con misma firma en T3/T4. `cargar_deuda`→CARGO en T1, usada en T2 (orden) y ya en `crear_venta_atomica` (venta, sin tocar). Discriminador no-CC consistente (filter `metodo !== "CUENTA_CORRIENTE"`).
- **Invariante anti-doble-conteo:** T2 solo carga si `!sinCobro && pendiente>0`; T3 solo acredita si `entregada`; pagos CC van por `usar` (no acreditan). Tests cubren cada rama.
- **Riesgos marcados:** número de migración (T1 S1), mock de `supabaseAdmin.rpc` (T3 S1), tests existentes que esperen tipo USO de deuda venta (T5 S1), migración aplicada para verificación manual (T5 S3).
- **Dependencia:** independiente de Fase 2/3. Sin la migración, las rutas degradan (loguean, no rompen).
