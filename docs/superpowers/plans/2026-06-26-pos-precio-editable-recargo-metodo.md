# POS — Editar precio visible + precio por método de pago — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el cajero pueda editar el precio en el POS de forma visible, y que cada método de pago aplique un % configurable que sube el **precio efectivo de la venta** (ingreso real, no interés bancario).

**Architecture:** El % por método vive en una tabla de config por org (`recargos_metodo_pago`). El POS sigue trabajando en **precios base**; el server (`/api/ventas`) determina la condición de la venta (= método del pago de mayor monto), calcula un `factor = 1 + %/100` y lo aplica al `precioUnitario` de cada item ANTES de los totales → subtotal, IVA, total e ingreso reflejan el precio efectivo. Sin cambios en la RPC `crear_venta_atomica` (los precios efectivos se persisten en `items_venta.precio_unitario`).

**Tech Stack:** Next.js (App Router) + TypeScript, Supabase (Postgres + RPC), Zod, Vitest (entorno node para tests de lógica), Tailwind/shadcn.

## Global Constraints

- Spec de referencia: `docs/superpowers/specs/2026-06-25-pos-precio-editable-recargo-metodo-design.md`.
- **Artefactos en español neutro/profesional** (el repo lo usa así). Identificadores y código en inglés cuando el código vecino lo usa; comentarios en español neutro.
- **Commits convencionales, sin atribución AI.**
- **Vitest en Windows:** `node node_modules/vitest/vitest.mjs run <archivo>`. Tests de lógica/API usan docblock `// @vitest-environment node`.
- **El % por método es INGRESO** (sube `items_venta.precio_unitario`), NO `recargo_porcentaje` (que se excluye del ingreso). NO tocar `costo_financiero`.
- **Condición de la venta = método del pago de mayor `monto`** (empate → primero); si no hay `pagos`, usar `metodoPago`; método sin config → factor 1.0.
- **Server-authoritative:** el server parte del precio base del payload y aplica el factor; no confía en un total inflado por el cliente.
- **Migración:** usar el próximo número libre (al escribir esto: `259`; verificar con `ls supabase/migrations | grep -oE '^[0-9]+' | sort -n | tail -1` antes de crear).
- Patrón de RLS de migración: espejar `supabase/migrations/066_cuenta_corriente_pagos_combinados.sql:28-41`.
- Patrón de ruta de config (auth + Zod + supabase): espejar `app/api/clientes/[id]/cuenta-corriente/route.ts`.
- Helpers de test API: `__tests__/api/helpers.ts` (`mockAuthSuccess`, `mockSupabaseFrom`, `createChainMock`).

---

### Task 1: Parte A — Botón "Editar" visible en el carrito del POS

Independiente del resto (UX pura, sin backend). El editor de precio ya existe en el panel expandible (`pos-cart.tsx:418`); hoy solo se abre tocando el nombre con un chevron chico (`:294-316`). Agregamos un botón "✏ Editar" explícito.

**Files:**
- Modify: `components/pos/pos-cart.tsx` (zona de acciones de la línea, ~`:375-415`; imports de íconos ~`:7-20`)
- Test: `components/pos/__tests__/pos-cart-editar.test.tsx` (nuevo)

**Interfaces:**
- Consumes: props existentes de `PosCart` y el estado `expandedItem`/`setExpandedItem`, `setPrecioDraft`, `setGarantiaDraft` (ya en el componente).
- Produces: nada nuevo para otras tasks.

- [ ] **Step 1: Escribir el test que falla**

Crear `components/pos/__tests__/pos-cart-editar.test.tsx`. Renderiza `PosCart` con un item y verifica que el campo "Precio unit." NO está visible hasta tocar "Editar". Usar el patrón de render de `__tests__/components/catalogo-item-dialog-stock-lock.test.tsx` para imports de testing-library. Props mínimas (rellenar callbacks con `vi.fn()`):

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { PosCart } from "@/components/pos/pos-cart"
import type { PosCartItem } from "@/components/pos/pos-types"

function buildItem(): PosCartItem {
  return {
    lineId: "l1", inventarioId: "inv1", nombre: "Teclado",
    precioUnitario: 45000, cantidad: 1, stockDisponible: 10,
    diasGarantia: 0, descuento: 0, tipoDescuento: "MONTO",
    porcentajeDescuento: 0, trackeaSeries: false, serieIds: [],
  } as PosCartItem
}

const noop = vi.fn()
const baseProps = {
  items: [buildItem()],
  onUpdateQuantity: noop, onRemoveItem: noop, onSetPrecio: noop,
  onSetGarantia: noop, onSetItemDescuento: noop, onSetSerieIds: noop,
  // completar el resto de props requeridas por PosCart con noop/valores neutros
}

describe("PosCart — botón Editar", () => {
  it("muestra 'Precio unit.' recién al tocar 'Editar'", () => {
    render(<PosCart {...(baseProps as any)} />)
    expect(screen.queryByText(/Precio unit/i)).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: /editar/i }))
    expect(screen.getByText(/Precio unit/i)).toBeInTheDocument()
  })
})
```

Nota: si `PosCart` requiere más props obligatorias, agregarlas con valores neutros hasta que el render no rompa. NO cambiar la firma del componente.

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `node node_modules/vitest/vitest.mjs run components/pos/__tests__/pos-cart-editar.test.tsx`
Expected: FAIL — no existe un botón con nombre "Editar" (`getByRole` lanza).

- [ ] **Step 3: Implementar el botón "Editar"**

En `components/pos/pos-cart.tsx`:
1. Agregar `Pencil` al import de lucide (`:7-20`), p.ej. `import { ..., Pencil } from "lucide-react"`.
2. En la zona de acciones de la línea (junto al botón Trash, ~`:406-414`), agregar un botón que ejecute el mismo toggle que el nombre. Reusar la lógica de `:297-305`:

```tsx
<Button
  variant="ghost"
  size="sm"
  className="h-8 sm:h-7 px-2 gap-1 text-xs text-muted-foreground shrink-0"
  onClick={() => {
    if (isExpanded) {
      setExpandedItem(null)
    } else {
      setExpandedItem(item.lineId)
      setGarantiaDraft(String(item.diasGarantia))
      setPrecioDraft(String(item.precioUnitario))
    }
  }}
>
  <Pencil className="h-3.5 w-3.5" />
  <span className="hidden sm:inline">Editar</span>
</Button>
```

El chevron del nombre puede quedarse como indicador de estado; no hace falta removerlo.

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `node node_modules/vitest/vitest.mjs run components/pos/__tests__/pos-cart-editar.test.tsx`
Expected: PASS

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` → exit 0
```bash
git add components/pos/pos-cart.tsx components/pos/__tests__/pos-cart-editar.test.tsx
git commit -m "feat(pos): botón Editar visible para editar precio/garantía/descuento por línea"
```

---

### Task 2: Migración — tabla `recargos_metodo_pago`

**Files:**
- Create: `supabase/migrations/259_recargos_metodo_pago.sql` (verificar número libre antes)

**Interfaces:**
- Produces: tabla `recargos_metodo_pago(organization_id, metodo_pago, porcentaje, activo)` con UNIQUE(organization_id, metodo_pago). La leen Task 2-helper y Task 5.

- [ ] **Step 1: Escribir la migración**

Crear `supabase/migrations/259_recargos_metodo_pago.sql`:

```sql
-- ========================================
-- Migration 259: recargos_metodo_pago
-- ========================================
-- % por método de pago que sube el PRECIO EFECTIVO de la venta (ingreso del
-- negocio), no interés bancario. Config por organización. Método sin fila => 0%.

CREATE TABLE IF NOT EXISTS recargos_metodo_pago (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  metodo_pago TEXT NOT NULL,
  porcentaje DECIMAL(5,2) NOT NULL DEFAULT 0 CHECK (porcentaje >= 0),
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, metodo_pago)
);

CREATE INDEX IF NOT EXISTS recargos_metodo_pago_org_idx
  ON recargos_metodo_pago(organization_id);

ALTER TABLE recargos_metodo_pago ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_recargos_metodo_pago" ON recargos_metodo_pago
  FOR ALL TO authenticated
  USING (organization_id = (
    SELECT organization_id FROM users WHERE id = auth.uid()::text
  ))
  WITH CHECK (organization_id = (
    SELECT organization_id FROM users WHERE id = auth.uid()::text
  ));

CREATE POLICY "service_role_recargos_metodo_pago" ON recargos_metodo_pago
  FOR ALL TO service_role USING (true) WITH CHECK (true);
```

- [ ] **Step 2: Verificar que `generate_cuid()` existe (espejo de otras tablas)**

Run: `rg -n "generate_cuid" supabase/migrations/066_cuenta_corriente_pagos_combinados.sql`
Expected: aparece como `DEFAULT generate_cuid()` → confirma que la función existe en el esquema.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/259_recargos_metodo_pago.sql
git commit -m "feat(db): tabla recargos_metodo_pago (precio por método de pago)"
```

Nota: la migración se aplica a Supabase manualmente post-merge (como las 230/238).

---

### Task 3: Helper `getRecargosMetodo`

**Files:**
- Create: `lib/recargos.ts`
- Test: `__tests__/lib/recargos.test.ts`

**Interfaces:**
- Consumes: `supabaseAdmin` de `@/lib/supabase`.
- Produces:
  - `getRecargosMetodo(organizationId: string): Promise<Record<string, number>>` — mapa `metodo_pago → porcentaje` (solo filas `activo=true`). Métodos sin fila no aparecen (el caller asume 0).
  - `factorRecargo(recargos: Record<string, number>, metodo: string): number` — `1 + (recargos[metodo] ?? 0)/100`.

- [ ] **Step 1: Escribir el test que falla**

Crear `__tests__/lib/recargos.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { getRecargosMetodo, factorRecargo } from "@/lib/recargos"

describe("getRecargosMetodo", () => {
  beforeEach(() => vi.clearAllMocks())

  it("devuelve mapa método→porcentaje de filas activas", async () => {
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      then: (resolve: any) =>
        resolve({
          data: [
            { metodo_pago: "CUENTA_CORRIENTE", porcentaje: "15" },
            { metodo_pago: "TARJETA_CREDITO", porcentaje: "20" },
          ],
          error: null,
        }),
    }
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain as any)

    const map = await getRecargosMetodo("org-1")
    expect(map).toEqual({ CUENTA_CORRIENTE: 15, TARJETA_CREDITO: 20 })
  })

  it("devuelve {} ante error de DB (fail-safe: sin recargos)", async () => {
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      then: (resolve: any) => resolve({ data: null, error: { message: "boom" } }),
    }
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain as any)
    expect(await getRecargosMetodo("org-1")).toEqual({})
  })
})

describe("factorRecargo", () => {
  it("1 + %/100; método sin config => 1.0", () => {
    const map = { CUENTA_CORRIENTE: 15 }
    expect(factorRecargo(map, "CUENTA_CORRIENTE")).toBeCloseTo(1.15)
    expect(factorRecargo(map, "EFECTIVO")).toBe(1)
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `node node_modules/vitest/vitest.mjs run __tests__/lib/recargos.test.ts`
Expected: FAIL — `lib/recargos` no existe.

- [ ] **Step 3: Implementar el helper**

Crear `lib/recargos.ts`:

```ts
import { supabaseAdmin } from "@/lib/supabase"

/**
 * Mapa metodo_pago → porcentaje de recargo (precio efectivo) de la org.
 * Solo filas activas. Fail-safe: ante error devuelve {} (sin recargos).
 */
export async function getRecargosMetodo(
  organizationId: string
): Promise<Record<string, number>> {
  const { data, error } = await supabaseAdmin
    .from("recargos_metodo_pago")
    .select("metodo_pago, porcentaje")
    .eq("organization_id", organizationId)
    .eq("activo", true)

  if (error || !data) return {}
  const map: Record<string, number> = {}
  for (const row of data) {
    map[row.metodo_pago] = parseFloat(String(row.porcentaje)) || 0
  }
  return map
}

/** Factor multiplicador del precio para un método: 1 + %/100. Sin config => 1. */
export function factorRecargo(
  recargos: Record<string, number>,
  metodo: string
): number {
  return 1 + (recargos[metodo] ?? 0) / 100
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `node node_modules/vitest/vitest.mjs run __tests__/lib/recargos.test.ts`
Expected: PASS (4 asserts)

- [ ] **Step 5: Commit**

```bash
git add lib/recargos.ts __tests__/lib/recargos.test.ts
git commit -m "feat(recargos): helper getRecargosMetodo + factorRecargo"
```

---

### Task 4: Determinar la condición de la venta (método principal)

Función pura para elegir el método que fija el precio: el pago de mayor `monto`, empate → primero; sin pagos → `metodoPago`.

**Files:**
- Modify: `lib/recargos.ts` (agregar función)
- Test: `__tests__/lib/recargos.test.ts` (agregar describe)

**Interfaces:**
- Produces: `metodoCondicion(pagos: Array<{ metodo: string; monto: number }> | undefined, metodoPagoFallback: string): string`

- [ ] **Step 1: Agregar el test que falla**

Agregar a `__tests__/lib/recargos.test.ts`:

```ts
import { metodoCondicion } from "@/lib/recargos"

describe("metodoCondicion", () => {
  it("elige el método del pago de mayor monto", () => {
    const pagos = [
      { metodo: "EFECTIVO", monto: 100 },
      { metodo: "TARJETA_CREDITO", monto: 400 },
    ]
    expect(metodoCondicion(pagos, "EFECTIVO")).toBe("TARJETA_CREDITO")
  })

  it("empate => primero", () => {
    const pagos = [
      { metodo: "EFECTIVO", monto: 200 },
      { metodo: "TARJETA_CREDITO", monto: 200 },
    ]
    expect(metodoCondicion(pagos, "EFECTIVO")).toBe("EFECTIVO")
  })

  it("sin pagos => fallback metodoPago", () => {
    expect(metodoCondicion(undefined, "CUENTA_CORRIENTE")).toBe("CUENTA_CORRIENTE")
    expect(metodoCondicion([], "TRANSFERENCIA")).toBe("TRANSFERENCIA")
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `node node_modules/vitest/vitest.mjs run __tests__/lib/recargos.test.ts`
Expected: FAIL — `metodoCondicion` no existe.

- [ ] **Step 3: Implementar**

Agregar a `lib/recargos.ts`:

```ts
/**
 * Método que fija el precio de la venta: el pago de mayor monto (empate => el
 * primero). Sin pagos => el metodoPago de fallback.
 */
export function metodoCondicion(
  pagos: Array<{ metodo: string; monto: number }> | undefined,
  metodoPagoFallback: string
): string {
  if (!pagos || pagos.length === 0) return metodoPagoFallback
  let elegido = pagos[0]
  for (const p of pagos) {
    if (p.monto > elegido.monto) elegido = p
  }
  return elegido.metodo
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `node node_modules/vitest/vitest.mjs run __tests__/lib/recargos.test.ts`
Expected: PASS (todos)

- [ ] **Step 5: Commit**

```bash
git add lib/recargos.ts __tests__/lib/recargos.test.ts
git commit -m "feat(recargos): metodoCondicion (método principal por mayor monto)"
```

---

### Task 5: `/api/ventas` — aplicar el factor al precio efectivo (CORE)

Aplicar el factor del método-condición a `precioUnitario` de cada item ANTES de calcular totales y antes de armar `pItems`. Así total/IVA/ingreso reflejan el precio efectivo y los pagos (efectivos) suman ese total. Sin cambios en la RPC.

**Files:**
- Modify: `app/api/ventas/route.ts` (imports `:1-8`; cálculo de totales `:188-266`)
- Test: `__tests__/api/ventas-recargo-metodo.test.ts` (nuevo)

**Interfaces:**
- Consumes: `getRecargosMetodo`, `factorRecargo`, `metodoCondicion` de `@/lib/recargos`.
- Produces: la venta se crea con `items_venta.precio_unitario = precioUnitario_base × factor`.

- [ ] **Step 1: Escribir el test que falla**

Crear `__tests__/api/ventas-recargo-metodo.test.ts`. Mockear `@/lib/recargos.getRecargosMetodo` para devolver `{ CUENTA_CORRIENTE: 20 }`, mockear auth y `supabaseAdmin.rpc` para capturar los params, y verificar que el `p_total` y los `p_items[].precioUnitario` enviados a la RPC están multiplicados por 1.2 cuando el pago principal es CUENTA_CORRIENTE. Patrón de mocks: `__tests__/api/helpers.ts` + el estilo de `__tests__/api/devolucion-atomica.test.ts`.

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, createPostRequest, parseResponse } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

vi.mock("@/lib/recargos", async (orig) => {
  const actual = await orig() as any
  return { ...actual, getRecargosMetodo: vi.fn().mockResolvedValue({ CUENTA_CORRIENTE: 20 }) }
})
vi.mock("@/lib/audit", () => ({ createAuditLogger: () => ({ create: vi.fn() }) }))
vi.mock("@/lib/webhooks/dispatcher", () => ({ emitWebhookEvent: vi.fn() }))

import { POST } from "@/app/api/ventas/route"

describe("POST /api/ventas — precio efectivo por método", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN" })
    // organizations (config fiscal) => EXENTO; sucursales/depositos => null
    mockSupabaseFrom({ organizations: createChainMock({ iva_regimen: "EXENTO" }) })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: { ventaId: "v1", numeroVenta: 1, garantias: [], items: ["i1"] }, error: null,
    } as any)
  })

  it("aplica factor 1.2 al total y a los precios de item cuando el pago principal es CUENTA_CORRIENTE", async () => {
    const body = {
      clienteId: "c1", clienteNombre: "Juan",
      items: [{ inventarioId: "inv1", descripcion: "X", cantidad: 1, precioUnitario: 1000, diasGarantia: 0, descuento: 0, tipoDescuento: "MONTO", porcentajeDescuento: 0 }],
      descuento: 0, tipoDescuento: "MONTO", porcentajeDescuento: 0,
      metodoPago: "CUENTA_CORRIENTE",
      pagos: [{ metodo: "CUENTA_CORRIENTE", monto: 1200 }],
    }
    const res = await POST(createPostRequest(body, "http://localhost/api/ventas"), {} as any)
    await parseResponse(res)

    const [, params] = vi.mocked(supabaseAdmin.rpc).mock.calls[0]
    expect(params.p_total).toBeCloseTo(1200)            // 1000 × 1.2
    expect(params.p_items[0].precioUnitario).toBeCloseTo(1200)
  })

  it("factor 1.0 (sin recargo) cuando el método es EFECTIVO", async () => {
    const body = {
      clienteId: "c1", clienteNombre: "Juan",
      items: [{ inventarioId: "inv1", descripcion: "X", cantidad: 1, precioUnitario: 1000, diasGarantia: 0, descuento: 0, tipoDescuento: "MONTO", porcentajeDescuento: 0 }],
      descuento: 0, tipoDescuento: "MONTO", porcentajeDescuento: 0,
      metodoPago: "EFECTIVO",
      pagos: [{ metodo: "EFECTIVO", monto: 1000 }],
    }
    const res = await POST(createPostRequest(body, "http://localhost/api/ventas"), {} as any)
    await parseResponse(res)
    const [, params] = vi.mocked(supabaseAdmin.rpc).mock.calls[0]
    expect(params.p_total).toBeCloseTo(1000)
    expect(params.p_items[0].precioUnitario).toBeCloseTo(1000)
  })
})
```

Nota: si `POST` requiere más mocks de tablas (p.ej. `organizations` ya está; `clientes` para validación de saldo CC), agregarlos en `mockSupabaseFrom`. Ajustar `createPostRequest`/`parseResponse` a las firmas reales en `helpers.ts`.

- [ ] **Step 2: Correr y verificar que falla**

Run: `node node_modules/vitest/vitest.mjs run __tests__/api/ventas-recargo-metodo.test.ts`
Expected: FAIL — `p_total` = 1000 (todavía sin factor), se esperaba 1200.

- [ ] **Step 3: Implementar el factor en la ruta**

En `app/api/ventas/route.ts`:

1. Import (`:7-8`):
```ts
import { getRecargosMetodo, factorRecargo, metodoCondicion } from "@/lib/recargos"
```

2. Justo después de `const data = ventaSchema.parse(body)` (`:180`) y antes del cálculo de totales (`:186`), derivar el factor:
```ts
// Precio efectivo por método de pago: el método-condición (pago de mayor monto)
// fija un factor que sube el precio de venta (ingreso real, no recargo bancario).
const recargosMetodo = await getRecargosMetodo(organizationId!)
const condicion = metodoCondicion(data.pagos, data.metodoPago)
const factor = factorRecargo(recargosMetodo, condicion)
```

3. En el loop de totales (`:190-198`), usar el precio efectivo:
```ts
for (const item of data.items) {
  const precioEfectivo = round2(item.precioUnitario * factor)
  const lineaBruto = item.cantidad * precioEfectivo
  subtotalBruto += lineaBruto
  const lineaDesc =
    item.tipoDescuento === "PORCENTAJE"
      ? lineaBruto * (item.porcentajeDescuento / 100)
      : Math.min(item.descuento, lineaBruto)
  descuentoItems += lineaDesc
}
```

4. En `pItems` (`:255-266`), enviar el precio efectivo:
```ts
const pItems = data.items.map(item => ({
  inventarioId: item.inventarioId || null,
  descripcion: item.descripcion,
  cantidad: item.cantidad,
  precioUnitario: round2(item.precioUnitario * factor),
  diasGarantia: item.diasGarantia,
  descuento: item.descuento,
  tipoDescuento: item.tipoDescuento,
  porcentajeDescuento: item.porcentajeDescuento,
  ...(item.serieIds && item.serieIds.length > 0 && { serieIds: item.serieIds }),
  ...(item.costo != null && { costo: item.costo }),
}))
```

Nota: el descuento por MONTO (`item.descuento`) se interpreta sobre el precio efectivo (el clamp `Math.min` lo mantiene coherente). El `costo` (snapshot) NO se toca → el margen sube por el mayor precio.

- [ ] **Step 4: Correr y verificar que pasa**

Run: `node node_modules/vitest/vitest.mjs run __tests__/api/ventas-recargo-metodo.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Regresión + typecheck**

Run: `node node_modules/vitest/vitest.mjs run __tests__/api/ventas-pr2.test.ts` (suite de ventas existente) → PASS
Run: `npx tsc --noEmit` → exit 0

- [ ] **Step 6: Commit**

```bash
git add app/api/ventas/route.ts __tests__/api/ventas-recargo-metodo.test.ts
git commit -m "feat(ventas): aplicar precio efectivo por método de pago (ingreso) server-side"
```

---

### Task 6: API de configuración `/api/configuracion/recargos-metodo`

**Files:**
- Create: `app/api/configuracion/recargos-metodo/route.ts`
- Test: `__tests__/api/recargos-metodo-config.test.ts` (nuevo)

**Interfaces:**
- `GET` → `{ recargos: Array<{ metodo: string; porcentaje: number }> }` para los 7 métodos conocidos (0 si no hay fila). `requireAuth`.
- `PUT` body `{ recargos: Array<{ metodo: string; porcentaje: number }> }` → upsert. Solo ADMIN. Zod: `porcentaje >= 0`, `metodo` en el set conocido.

**Métodos conocidos:** `["EFECTIVO","TRANSFERENCIA","TARJETA_DEBITO","TARJETA_CREDITO","MERCADOPAGO","CUENTA_CORRIENTE","OTRO"]`.

- [ ] **Step 1: Escribir el test que falla**

Crear `__tests__/api/recargos-metodo-config.test.ts`. Verificar: (a) GET devuelve 200 con la lista; (b) PUT como no-ADMIN → 403; (c) PUT con `porcentaje` negativo → 400. Usar `mockAuthSuccess({ role })` y `mockSupabaseFrom`. (Reusar el estilo de `__tests__/api/devolucion-atomica.test.ts`.)

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, createPostRequest, parseResponse } from "./helpers"
import { GET, PUT } from "@/app/api/configuracion/recargos-metodo/route"

describe("/api/configuracion/recargos-metodo", () => {
  beforeEach(() => vi.clearAllMocks())

  it("GET devuelve 200 con la lista de métodos", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({ recargos_metodo_pago: createChainMock([{ metodo_pago: "CUENTA_CORRIENTE", porcentaje: "15" }]) })
    const res = await GET(new Request("http://localhost/api/configuracion/recargos-metodo"))
    const { status, body } = await parseResponse(res)
    expect(status).toBe(200)
    expect(body.recargos.find((r: any) => r.metodo === "CUENTA_CORRIENTE").porcentaje).toBe(15)
    expect(body.recargos.find((r: any) => r.metodo === "EFECTIVO").porcentaje).toBe(0)
  })

  it("PUT como VENDEDOR => 403", async () => {
    mockAuthSuccess({ role: "VENDEDOR" })
    const res = await PUT(createPostRequest({ recargos: [{ metodo: "CUENTA_CORRIENTE", porcentaje: 15 }] }, "http://localhost/api/configuracion/recargos-metodo"))
    const { status } = await parseResponse(res)
    expect(status).toBe(403)
  })

  it("PUT con porcentaje negativo => 400", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({ recargos_metodo_pago: createChainMock(null) })
    const res = await PUT(createPostRequest({ recargos: [{ metodo: "CUENTA_CORRIENTE", porcentaje: -5 }] }, "http://localhost/api/configuracion/recargos-metodo"))
    const { status } = await parseResponse(res)
    expect(status).toBe(400)
  })
})
```

Nota: ajustar `createPostRequest` para que soporte método PUT si hace falta (ver `helpers.ts`; si solo arma POST, crear el `Request` con `method: "PUT"` inline).

- [ ] **Step 2: Correr y verificar que falla**

Run: `node node_modules/vitest/vitest.mjs run __tests__/api/recargos-metodo-config.test.ts`
Expected: FAIL — la ruta no existe.

- [ ] **Step 3: Implementar la ruta**

Crear `app/api/configuracion/recargos-metodo/route.ts` (espejar auth/Zod de `app/api/clientes/[id]/cuenta-corriente/route.ts`):

```ts
import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const METODOS = ["EFECTIVO","TRANSFERENCIA","TARJETA_DEBITO","TARJETA_CREDITO","MERCADOPAGO","CUENTA_CORRIENTE","OTRO"] as const

export async function GET() {
  const { error, organizationId } = await requireAuth()
  if (error) return error

  const { data } = await supabaseAdmin
    .from("recargos_metodo_pago")
    .select("metodo_pago, porcentaje")
    .eq("organization_id", organizationId!)

  const porMetodo: Record<string, number> = {}
  for (const row of data || []) porMetodo[row.metodo_pago] = parseFloat(String(row.porcentaje)) || 0

  return NextResponse.json({
    recargos: METODOS.map((metodo) => ({ metodo, porcentaje: porMetodo[metodo] ?? 0 })),
  })
}

const putSchema = z.object({
  recargos: z.array(z.object({
    metodo: z.enum(METODOS),
    porcentaje: z.number().min(0, "El porcentaje no puede ser negativo"),
  })),
})

export async function PUT(request: Request) {
  const { error, organizationId, role } = await requireAuth()
  if (error) return error
  if (role !== "ADMIN") {
    return NextResponse.json({ error: "Solo administradores pueden configurar recargos" }, { status: 403 })
  }

  let data: z.infer<typeof putSchema>
  try {
    data = putSchema.parse(await request.json())
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors[0].message }, { status: 400 })
    return NextResponse.json({ error: "Body inválido" }, { status: 400 })
  }

  const rows = data.recargos.map((r) => ({
    organization_id: organizationId!,
    metodo_pago: r.metodo,
    porcentaje: r.porcentaje,
    activo: true,
    updated_at: new Date().toISOString(),
  }))

  const { error: upsertError } = await supabaseAdmin
    .from("recargos_metodo_pago")
    .upsert(rows, { onConflict: "organization_id,metodo_pago" })

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message || "Error al guardar" }, { status: 400 })
  }
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `node node_modules/vitest/vitest.mjs run __tests__/api/recargos-metodo-config.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` → exit 0
```bash
git add app/api/configuracion/recargos-metodo/route.ts __tests__/api/recargos-metodo-config.test.ts
git commit -m "feat(config): API recargos por método de pago (GET/PUT, ADMIN)"
```

---

### Task 7: Pantalla de configuración + card

**Files:**
- Create: `app/(dashboard)/configuracion/recargos-metodo/page.tsx`
- Create: `components/configuracion/recargos-metodo-form.tsx`
- Modify: `app/(dashboard)/configuracion/page.tsx` (agregar card en la sección Finanzas)

**Interfaces:**
- Consumes: `GET`/`PUT` de Task 6.
- Produces: card navegable en Configuración → Finanzas.

- [ ] **Step 1: Crear la página server + form cliente**

`app/(dashboard)/configuracion/recargos-metodo/page.tsx` (espejar el guard de `app/(dashboard)/configuracion/page.tsx` para ADMIN; usar `PageShell`):

```tsx
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { canEditConfiguration } from "@/lib/auth-utils"
import { PageShell } from "@/components/ui/page-shell"
import { RecargosMetodoForm } from "@/components/configuracion/recargos-metodo-form"

export default async function RecargosMetodoPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (!(await canEditConfiguration())) redirect("/configuracion")

  return (
    <PageShell title="Recargos por método de pago" description="Precio según cómo paga el cliente">
      <RecargosMetodoForm />
    </PageShell>
  )
}
```

`components/configuracion/recargos-metodo-form.tsx` — `"use client"`: hace `fetch("/api/configuracion/recargos-metodo")` al montar, muestra una fila por método con un `Input` numérico de %, y guarda con `PUT`. Estructura (rellenar con los componentes UI del repo `Input`/`Button`/`Label`, patrón de cualquier form cliente existente como `components/configuracion/configuracion-form.tsx`):

```tsx
"use client"
import { useEffect, useState } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"

const LABELS: Record<string, string> = {
  EFECTIVO: "Efectivo", TRANSFERENCIA: "Transferencia", TARJETA_DEBITO: "Tarjeta débito",
  TARJETA_CREDITO: "Tarjeta crédito", MERCADOPAGO: "MercadoPago", CUENTA_CORRIENTE: "Cuenta corriente", OTRO: "Otro",
}

export function RecargosMetodoForm() {
  const [recargos, setRecargos] = useState<Array<{ metodo: string; porcentaje: number }>>([])
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/configuracion/recargos-metodo").then(r => r.json()).then(d => setRecargos(d.recargos ?? []))
  }, [])

  const setPct = (metodo: string, value: number) =>
    setRecargos(prev => prev.map(r => r.metodo === metodo ? { ...r, porcentaje: value } : r))

  const guardar = async () => {
    setSaving(true); setMsg(null)
    const res = await fetch("/api/configuracion/recargos-metodo", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recargos }),
    })
    setSaving(false)
    setMsg(res.ok ? "Guardado" : "Error al guardar")
  }

  return (
    <div className="space-y-3 max-w-md">
      <p className="text-sm text-muted-foreground">El % sube el precio de la venta para ese método. Contado/Transferencia en 0.</p>
      {recargos.map(r => (
        <div key={r.metodo} className="flex items-center justify-between gap-3">
          <Label className="text-sm">{LABELS[r.metodo] ?? r.metodo}</Label>
          <div className="flex items-center gap-1">
            <Input type="number" min={0} step="0.01" value={r.porcentaje}
              onChange={e => setPct(r.metodo, parseFloat(e.target.value) || 0)} className="w-24 text-right" />
            <span className="text-sm text-muted-foreground">%</span>
          </div>
        </div>
      ))}
      <Button onClick={guardar} disabled={saving}>{saving ? "Guardando…" : "Guardar"}</Button>
      {msg && <p className="text-sm">{msg}</p>}
    </div>
  )
}
```

- [ ] **Step 2: Agregar la card en Configuración**

En `app/(dashboard)/configuracion/page.tsx`, sección **Finanzas** (`cards: [...]`, ~`:88`), agregar:

```tsx
{
  href: "/configuracion/recargos-metodo",
  icon: Percent,
  label: "Recargos por método de pago",
  labelShort: "Recargos",
  desc: "Precio según el método de pago",
  descShort: "Precio por método",
},
```

Agregar `Percent` al import de lucide en ese archivo.

- [ ] **Step 3: Typecheck + verificación manual**

Run: `npx tsc --noEmit` → exit 0
Run (lint del archivo modificado): `npx eslint "app/(dashboard)/configuracion/page.tsx"` → exit 0

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/configuracion/recargos-metodo/page.tsx" components/configuracion/recargos-metodo-form.tsx "app/(dashboard)/configuracion/page.tsx"
git commit -m "feat(config): pantalla de recargos por método de pago + card en Finanzas"
```

---

### Task 8: POS — quitar recargo manual + mostrar total efectivo

**Files:**
- Modify: `components/pagos/multi-pago-input.tsx`
- Modify: `components/pos/pos-checkout-dialog.tsx` (cálculo del total efectivo a cobrar)

**Interfaces:**
- Consumes: `GET /api/configuracion/recargos-metodo` (mapa método→%).
- Produces: el cajero ve el total efectivo según el método-condición; el payload sigue mandando precios base (el server aplica el factor).

- [ ] **Step 1: Quitar los inputs de recargo manual de `multi-pago-input.tsx`**

Eliminar los bloques de input manual de recargo: el de tarjeta crédito (`:244-259`, columna "Recargo al cliente %") y el de débito (`:263-281`). Mantener Cuotas, Monto, Costo terminal (`costoFinanciero`), Referencia y los previews que dependen de `costoFinanciero`. El `recargo` deja de cargarse a mano (el precio lo fija la config server-side).

Quitar también el preview de recargo manual (`:303-329`) que depende de `pago.recargo`.

- [ ] **Step 2: Mostrar el total efectivo en el checkout**

En `components/pos/pos-checkout-dialog.tsx`: cargar el mapa de recargos al abrir (`fetch("/api/configuracion/recargos-metodo")`), calcular el método-condición con la misma regla del server (pago de mayor monto; usar un helper compartido o replicar `metodoCondicion`), y mostrar el **total efectivo = total base × (1 + %/100)** de forma prominente cuando el % > 0 ("Total contado: $X · Total {método}: $Y"). El monto pendiente que se pasa a `MultiPagoInput` debe ser el **total efectivo** para que el cajero cobre el importe correcto.

(Implementación concreta: leer el total base que ya calcula el checkout, derivar el factor del método del primer/mayor pago, y usar `montoPendiente = round2(totalBase × factor)`.)

- [ ] **Step 3: Verificación**

Run: `npx tsc --noEmit` → exit 0
Verificación manual (POS): con un % configurado en CUENTA_CORRIENTE, al cobrar con ese método el total mostrado sube ese %, y la venta queda registrada con el precio efectivo.

- [ ] **Step 4: Commit**

```bash
git add components/pagos/multi-pago-input.tsx components/pos/pos-checkout-dialog.tsx
git commit -m "feat(pos): total efectivo por método de pago + quitar recargo manual"
```

---

## Self-Review (cobertura del spec)

- **(A) Editor visible** → Task 1. ✅
- **Tabla config** → Task 2. ✅
- **Helper lectura + factor + condición** → Tasks 3-4. ✅
- **% = ingreso (precio efectivo server-side)** → Task 5 (core, con test de factor en total e items). ✅
- **Enforcement server-authoritative** → Task 5 (parte de precio base + factor; cliente no fija el total). ✅
- **Config API (ADMIN, Zod)** → Task 6. ✅
- **Pantalla config + card** → Task 7. ✅
- **POS: quitar recargo manual + total efectivo** → Task 8. ✅
- **No tocar RPC / costo_financiero** → respetado (Task 5 nota; Task 8 mantiene costoFinanciero). ✅
- **Multi-pago = método principal** → Task 4 (`metodoCondicion`) usado en Task 5 y replicado en Task 8. ✅

**Puntos abiertos del spec resueltos en este plan:**
- Persistencia del % → NO se agrega columna; el precio efectivo queda en `items_venta.precio_unitario` (fuente de verdad del ingreso). Columna dedicada = futuro.
- Venta sin pago (fiado) → `metodoCondicion` cae a `metodoPago`; si es CUENTA_CORRIENTE aplica su %, si no, base.

## Sugerencia de PRs (entrega)

Para mantener PRs revisables (<400 líneas) y de impacto incremental:
- **PR 1 (UX rápida):** Task 1 (botón Editar).
- **PR 2 (config + pricing backend):** Tasks 2-7 (tabla, helper, API ventas, API config, pantalla).
- **PR 3 (POS UI):** Task 8.

Cada PR es desplegable y testeable por separado. La migración 259 se aplica a Supabase manualmente al mergear PR 2.
