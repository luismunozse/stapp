# Cuenta corriente — Reversibilidad (Fase 2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que las reversas/devoluciones reacrediten la cuenta corriente: nueva primitiva `devolver_cuenta_corriente`, trigger de anular-venta net-zero, nota de crédito y devolución que acreditan, y anular cobro con CC que reacredita.

**Architecture:** Migración SQL agrega `devolver_cuenta_corriente` (DEVOLUCION +), redefine `restore_stock_on_cancel` (reversa net-zero por ledger) y `crear_nota_credito` (acredita si metodoDevolucion=CUENTA_CORRIENTE). Rutas API: cobro DELETE reacredita USO; devolución de venta suma CUENTA_CORRIENTE al enum y acredita.

**Tech Stack:** Next.js API routes, Supabase rpc, Postgres plpgsql, Zod, Vitest.

**Convención de tests:** TDD en rutas API (mock `supabaseAdmin.rpc`, assert llamadas). Funciones/trigger SQL: manual. Ignorar pre-existentes: csv-export Buffer; build noise firebase-admin/fonts/superadmin.

**Comandos:** test `npm run test:run -- <ruta>` · typecheck `npx tsc --noEmit` · build `npm run build`.

---

## File Structure

**Crear:**
- `supabase/migrations/235_cc_devolucion_reversibilidad.sql`
- `__tests__/api/cc-reversibilidad.test.ts`

**Modificar:**
- `app/api/ordenes/[id]/cobros/route.ts` — DELETE reacredita USO.
- `app/api/ventas/[id]/devolucion/route.ts` — enum + crédito CC.
- El componente UI del selector de `metodoReembolso` (ubicar con grep).

---

## Task 1: Migración 235 — devolver + trigger + nota de crédito

**Files:**
- Create: `supabase/migrations/235_cc_devolucion_reversibilidad.sql`

- [ ] **Step 1: Confirmar número de migración**

Run: `ls supabase/migrations/ | grep -oE '^[0-9]+' | sort -n | uniq | tail -1`
Si el mayor NO es 234, usar `<mayor>+1`. (Asume 235.)

- [ ] **Step 2: Escribir la migración**

La migración tiene 3 partes. Para las partes 2 y 3 hay que COPIAR el body actual de la función/trigger y aplicar SOLO el cambio indicado (no inventar el resto).

**Parte 1 — `devolver_cuenta_corriente` (nueva), pegar tal cual:**
```sql
CREATE OR REPLACE FUNCTION devolver_cuenta_corriente(
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
  FROM clientes WHERE id = p_cliente_id AND organization_id = p_org_id FOR UPDATE;

  IF v_saldo_actual IS NULL THEN
    RAISE EXCEPTION 'Cliente no encontrado';
  END IF;

  v_nuevo_saldo := COALESCE(v_saldo_actual, 0) + p_monto;

  INSERT INTO cuenta_corriente (
    organization_id, cliente_id, tipo, monto, saldo_posterior,
    referencia_tipo, referencia_id, usuario_id, observaciones
  ) VALUES (
    p_org_id, p_cliente_id, 'DEVOLUCION', p_monto, v_nuevo_saldo,
    p_referencia_tipo, p_referencia_id, p_usuario_id,
    COALESCE(p_observaciones, 'Devolucion a cuenta corriente')
  ) RETURNING id INTO v_mov_id;

  UPDATE clientes SET saldo_cuenta = v_nuevo_saldo WHERE id = p_cliente_id;

  RETURN jsonb_build_object('id', v_mov_id, 'saldoAnterior', v_saldo_actual, 'saldoNuevo', v_nuevo_saldo);
END;
$$ LANGUAGE plpgsql;
```

**Parte 2 — `restore_stock_on_cancel` (redefinir):** Leer su body actual en
`supabase/migrations/225_venta_sin_cobro_cuenta_corriente.sql` (función
`restore_stock_on_cancel`). Reproducirlo VERBATIM con `CREATE OR REPLACE`,
manteniendo TODO el bloque de stock (el `FOR v_item ...` con movimientos e
`incrementar_stock_deposito`), y REEMPLAZAR únicamente el bloque que empieza en
`-- Revertir deuda en cuenta corriente ...` (el `IF NEW.cliente_id IS NOT NULL AND
(NEW.total - NEW.monto_abonado) > 0 THEN ... END IF;`) por:

```sql
    -- Reversa net-zero de TODO lo que la venta movio en cuenta corriente
    IF NEW.cliente_id IS NOT NULL THEN
      SELECT COALESCE(SUM(monto), 0) INTO v_neto
      FROM cuenta_corriente
      WHERE referencia_id = NEW.id AND referencia_tipo = 'VENTA'
        AND tipo IN ('CARGO','USO','PAGO');

      IF v_neto <> 0 THEN
        SELECT saldo_cuenta INTO v_saldo FROM clientes WHERE id = NEW.cliente_id FOR UPDATE;
        v_nuevo := COALESCE(v_saldo, 0) - v_neto;
        INSERT INTO cuenta_corriente (
          organization_id, cliente_id, tipo, monto, saldo_posterior,
          referencia_tipo, referencia_id, observaciones
        ) VALUES (
          NEW.organization_id, NEW.cliente_id, 'AJUSTE', -v_neto, v_nuevo,
          'VENTA', NEW.id, 'Reversa por anulacion de venta'
        );
        UPDATE clientes SET saldo_cuenta = v_nuevo WHERE id = NEW.cliente_id;
      END IF;
    END IF;
```
Agregar `v_neto DECIMAL;` al bloque `DECLARE` del trigger (junto a `v_saldo`,
`v_nuevo` que ya existen). Conservar el resto del trigger sin cambios.

**Parte 3 — `crear_nota_credito` (redefinir):** Leer el body actual en
`supabase/migrations/214_*.sql` (el último `CREATE OR REPLACE FUNCTION
crear_nota_credito`). Reproducirlo VERBATIM con un cambio: declarar
`v_cliente_id TEXT;` en el `DECLARE`, y tras el `RETURNING id INTO v_nc_id`
(después del INSERT en `notas_credito`), agregar:

```sql
  -- Acreditar a cuenta corriente si el reembolso es a CC
  IF p_metodo_devolucion = 'CUENTA_CORRIENTE' THEN
    IF p_venta_id IS NOT NULL THEN
      SELECT cliente_id INTO v_cliente_id FROM ventas WHERE id = p_venta_id;
    ELSIF p_orden_id IS NOT NULL THEN
      SELECT cliente_id INTO v_cliente_id FROM ordenes_servicio WHERE id = p_orden_id;
    END IF;
    IF v_cliente_id IS NOT NULL THEN
      PERFORM devolver_cuenta_corriente(p_org_id, v_cliente_id, p_monto,
        'NOTA_CREDITO', v_nc_id, p_user_id, 'Nota de credito');
    END IF;
  END IF;
```
Conservar el resto (el loop de items/restock) sin cambios.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/235_cc_devolucion_reversibilidad.sql
git commit -m "feat(db): 235 — devolver_cuenta_corriente + reversa anular venta + NC acredita CC"
```
(NO ejecutar git si sos subagente — el controlador commitea.)

---

## Task 2: Anular cobro de orden — reacreditar USO (TDD)

**Files:**
- Modify: `app/api/ordenes/[id]/cobros/route.ts` (DELETE)
- Test: `__tests__/api/cc-reversibilidad.test.ts`

Contexto: el DELETE bloquea órdenes ENTREGADO* (se mantiene). Hoy el select del cobro es `id, monto, anulado`; el de la orden es `estado`. Soft-delete en su lugar; falta reacreditar el USO.

- [ ] **Step 1: Escribir el test (TDD) — debe fallar**

Crear `__tests__/api/cc-reversibilidad.test.ts`. Leer `__tests__/api/helpers.ts` para el patrón de mock de `supabaseAdmin.rpc` (usar `vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: {}, error: null })` en beforeEach).

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, createGetRequest } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"
import { DELETE as cobrosDELETE } from "@/app/api/ordenes/[id]/cobros/route"

describe("anular cobro orden — reacredita USO", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: {}, error: null } as any)
  })

  it("reacredita (devolver) al anular un cobro con CUENTA_CORRIENTE", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    // orden no entregada; cobro método CUENTA_CORRIENTE
    mockSupabaseFrom({
      ordenes_servicio: createChainMock({ estado: "REPARADO", cliente_id: "c1" }),
      cobros_orden: createChainMock({ id: "cob1", monto: 50, anulado: false, metodo_pago: "CUENTA_CORRIENTE" }),
    })

    await cobrosDELETE(
      createGetRequest("http://localhost/api/ordenes/o1/cobros?cobroId=cob1"),
      { params: Promise.resolve({ id: "o1" }) } as any
    )

    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "devolver_cuenta_corriente",
      expect.objectContaining({ p_cliente_id: "c1", p_monto: 50, p_referencia_tipo: "ORDEN", p_referencia_id: "o1" })
    )
  })

  it("NO reacredita al anular un cobro EFECTIVO", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({
      ordenes_servicio: createChainMock({ estado: "REPARADO", cliente_id: "c1" }),
      cobros_orden: createChainMock({ id: "cob1", monto: 50, anulado: false, metodo_pago: "EFECTIVO" }),
    })

    await cobrosDELETE(
      createGetRequest("http://localhost/api/ordenes/o1/cobros?cobroId=cob1"),
      { params: Promise.resolve({ id: "o1" }) } as any
    )

    const calls = vi.mocked(supabaseAdmin.rpc).mock.calls.map((c) => c[0])
    expect(calls).not.toContain("devolver_cuenta_corriente")
  })
})
```

- [ ] **Step 2: Correr — debe FALLAR**

Run: `npm run test:run -- __tests__/api/cc-reversibilidad.test.ts`

- [ ] **Step 3: Implementar**

En `app/api/ordenes/[id]/cobros/route.ts`, DELETE:
- Ampliar el select de la orden (el que trae `estado`) a `estado, cliente_id`.
- Ampliar el select del cobro a `id, monto, anulado, metodo_pago`.
- Tras el soft-delete (el `update({ anulado: true, ... })`) y antes de
  `recalcular_estado_cobro`, agregar:
  ```ts
  if (cobro.metodo_pago === "CUENTA_CORRIENTE" && ordenCheck?.cliente_id) {
    const { error: devError } = await supabaseAdmin.rpc("devolver_cuenta_corriente", {
      p_org_id: organizationId!,
      p_cliente_id: ordenCheck.cliente_id,
      p_monto: parseFloat(cobro.monto as any),
      p_referencia_tipo: "ORDEN",
      p_referencia_id: ordenId,
      p_usuario_id: userId!,
      p_observaciones: "Anulacion de cobro con cuenta corriente",
    })
    if (devError) {
      console.error("Error reacreditando cuenta corriente al anular cobro:", devError)
    }
  }
  ```
  (Confirmar el nombre real de la variable de la orden — en el audit es
  `ordenCheck`. Usar el nombre real del archivo.)

- [ ] **Step 4: Correr — debe PASAR**

Run: `npm run test:run -- __tests__/api/cc-reversibilidad.test.ts`

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add app/api/ordenes/[id]/cobros/route.ts __tests__/api/cc-reversibilidad.test.ts
git commit -m "feat(ordenes): reacreditar cuenta corriente al anular cobro con CC"
```

---

## Task 3: Devolución de venta — método CUENTA_CORRIENTE (TDD + UI)

**Files:**
- Modify: `app/api/ventas/[id]/devolucion/route.ts`
- Test: `__tests__/api/cc-reversibilidad.test.ts` (extender)
- Modify: el componente UI del selector de `metodoReembolso`.

Contexto: `venta` se trae con `select("*, items_venta(*)")` → tiene `cliente_id`. `montoDevolucion` se calcula en `:171-174`. Los items se insertan en `:215-217`. El enum está en `:21`.

- [ ] **Step 1: Agregar tests (deben fallar)**

Añadir a `__tests__/api/cc-reversibilidad.test.ts`:

```ts
import { POST as devolucionPOST } from "@/app/api/ventas/[id]/devolucion/route"

describe("devolucion venta — reembolso a CC", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: {}, error: null } as any)
  })

  function ventaChain() {
    // venta COMPLETADA con un item; devoluciones previas vacías; inserts ok
    const venta = {
      id: "v1", estado: "COMPLETADA", cliente_id: "c1", organization_id: "org-1",
      items_venta: [{ id: "iv1", cantidad: 5, descripcion: "Item", inventario_id: null }],
    }
    return venta
  }

  it("acredita (devolver) cuando metodoReembolso=CUENTA_CORRIENTE", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({
      ventas: createChainMock(ventaChain()),
      devoluciones_venta: createChainMock({ id: "d1" }),
      items_devolucion: createChainMock({ id: "id1" }),
    })

    await devolucionPOST(
      createPostRequest({
        motivo: "Defectuoso",
        metodoReembolso: "CUENTA_CORRIENTE",
        items: [{ itemVentaId: "iv1", cantidad: 2, precioUnitario: 10, restaurarStock: false }],
      }, "http://localhost/api/ventas/v1/devolucion"),
      { params: Promise.resolve({ id: "v1" }) } as any
    )

    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "devolver_cuenta_corriente",
      expect.objectContaining({ p_cliente_id: "c1", p_monto: 20, p_referencia_tipo: "VENTA", p_referencia_id: "v1" })
    )
  })

  it("NO acredita con metodoReembolso=EFECTIVO", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({
      ventas: createChainMock(ventaChain()),
      devoluciones_venta: createChainMock({ id: "d1" }),
      items_devolucion: createChainMock({ id: "id1" }),
    })

    await devolucionPOST(
      createPostRequest({
        motivo: "Defectuoso", metodoReembolso: "EFECTIVO",
        items: [{ itemVentaId: "iv1", cantidad: 2, precioUnitario: 10, restaurarStock: false }],
      }, "http://localhost/api/ventas/v1/devolucion"),
      { params: Promise.resolve({ id: "v1" }) } as any
    )

    const calls = vi.mocked(supabaseAdmin.rpc).mock.calls.map((c) => c[0])
    expect(calls).not.toContain("devolver_cuenta_corriente")
  })
})
```
Asegurar el import de `createPostRequest` en el archivo de test. Nota: la
devolución hace un select extra de `devoluciones_venta` (existentes) + un select
final (`devolucionCompleta`). El chain mock por defecto resuelve esos; si algún
select rompe por falta de datos, ajustar el chain de `devoluciones_venta` para
devolver `{ items_devolucion: [] }` en la lectura de existentes (el helper
`createChainMock` devuelve el mismo data para todas las lecturas — usar un dato
compatible o agregar el campo). Si el `createAuditLogger` real interfiere,
mockearlo como en otros tests (`vi.mock("@/lib/audit", ...)`).

- [ ] **Step 2: Correr — debe FALLAR**

Run: `npm run test:run -- __tests__/api/cc-reversibilidad.test.ts`

- [ ] **Step 3: Implementar (API)**

En `app/api/ventas/[id]/devolucion/route.ts`:
- Enum (`:21`): agregar `"CUENTA_CORRIENTE"`:
  ```ts
  metodoReembolso: z.enum(["EFECTIVO", "TRANSFERENCIA", "TARJETA", "CREDITO_TIENDA", "CUENTA_CORRIENTE", "OTRO"]).optional(),
  ```
- Tras el loop de stock (después de `:282`, el cierre del `for ... items`) y
  antes del audit log (`:285`), agregar:
  ```ts
    // Reembolso a cuenta corriente
    if (data.metodoReembolso === "CUENTA_CORRIENTE" && venta.cliente_id) {
      const { error: devError } = await supabaseAdmin.rpc("devolver_cuenta_corriente", {
        p_org_id: organizationId!,
        p_cliente_id: venta.cliente_id,
        p_monto: montoDevolucion,
        p_referencia_tipo: "VENTA",
        p_referencia_id: id,
        p_usuario_id: userId!,
        p_observaciones: `Devolucion ${numeroDevolucion}`,
      })
      if (devError) {
        console.error("Error reembolsando a cuenta corriente:", devError)
      }
    }
  ```

- [ ] **Step 4: Correr — debe PASAR**

Run: `npm run test:run -- __tests__/api/cc-reversibilidad.test.ts`

- [ ] **Step 5: UI — opción en el selector**

Ubicar el componente del formulario de devolución de venta:
Run: `grep -rln "CREDITO_TIENDA\|metodoReembolso\|reembolso" components/ | grep -i devoluc`
(o `grep -rln "metodoReembolso" components/`). En el selector de método de
reembolso, agregar la opción "Cuenta corriente" con value `CUENTA_CORRIENTE`,
siguiendo el patrón de las opciones existentes (EFECTIVO/TRANSFERENCIA/etc.). Si
las opciones vienen de un arreglo, sumar `{ value: "CUENTA_CORRIENTE", label:
"Cuenta corriente" }`.

- [ ] **Step 6: Typecheck + build**

Run: `npx tsc --noEmit` ; `npm run build`

- [ ] **Step 7: Commit**

```bash
git add app/api/ventas/[id]/devolucion/route.ts __tests__/api/cc-reversibilidad.test.ts components/
git commit -m "feat(ventas): reembolso de devolucion a cuenta corriente"
```

---

## Task 4: Verificación final

- [ ] **Step 1: Suite completa**

Run: `npm run test:run`
Esperado: todo verde, incluido `cc-reversibilidad.test.ts`.

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit` (solo csv-export pre-existente)
Run: `npm run build` ("✓ Compiled successfully")

- [ ] **Step 3: Recorrido manual (requiere migración 235 aplicada)**

Aplicar `235_cc_devolucion_reversibilidad.sql`. Luego:
- Cobro de orden con CC (pre-entrega) → anularlo → saldo del cliente vuelve a subir (DEVOLUCION).
- Venta a fiado, pagada parcial; anular la venta → saldo neto vuelve al estado previo a la venta (reversa net-zero; revisar movimientos CARGO/USO/PAGO neutralizados por un AJUSTE).
- Nota de crédito con método "Cuenta corriente" → el saldo del cliente sube (DEVOLUCION).
- Devolución de venta con método "Cuenta corriente" → saldo sube por montoDevolucion.

NOTA: sin la migración 235 aplicada, los rpc `devolver_cuenta_corriente` fallan (las rutas loguean y siguen; el trigger/NC son SQL y requieren la migración).

- [ ] **Step 4: Commit final (si quedó algo suelto)**

```bash
git add -A
git commit -m "chore(cc): ajustes finales reversibilidad fase 2"
```

---

## Self-Review (completado)

- **Cobertura del spec:** devolver primitiva + trigger + NC (T1), cobro anular USO (T2), devolución CC + UI (T3), verificación (T4). Cubierto.
- **Placeholders:** ninguno. Las partes 2/3 de la migración instruyen copiar el body actual + cambio puntual (no es placeholder: es la forma segura de redefinir funciones largas sin reescribirlas mal); el snippet exacto a insertar está dado.
- **Consistencia:** `devolver_cuenta_corriente` (DEVOLUCION +) definida en T1, llamada con misma firma en T2 (cobro), T3 (devolución) y dentro de `crear_nota_credito` (T1). Discriminador por método consistente.
- **Money-correctness:** trigger net-zero = `SUM(CARGO+USO+PAGO)` y postear `-suma` (CARGO/USO negativos, PAGO positivo → la suma es el efecto neto; negarla lo cancela). DEVOLUCION suma al saldo. Guards de idempotencia intactos (cobro.anulado; transición del trigger).
- **Riesgos marcados:** número de migración (T1 S1), copiar bodies actuales de trigger/NC (T1 S2), nombre real de la var de orden en cobros (T2 S3), selects extra en devolución que el mock debe cubrir (T3 S1), ubicar el componente UI (T3 S5), migración aplicada para verificación (T4 S3).
- **Límite conocido:** caso PAGO de cobro (orden entregada) fuera de alcance por el guard vigente.
