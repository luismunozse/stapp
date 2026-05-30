# POS: consumo de series en venta + idempotencia + costo manual — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrar el consumo de `inventario_series` en la venta POS (fase 2 de migración 175), agregar idempotencia a la creación de venta, y permitir costo en ítems manuales.

**Architecture:** Una migración SQL (200) redefine `crear_venta_atomica` para consumir series inline (auto FIFO + override) y persistir una `idempotency_key` con índice único. El consumo de series NO llama `salida_serie` (evita doble descuento de stock/movimiento). La capa API/React pasa `serieIds` e `idempotencyKey`, y maneja el reintento idempotente vía violación de unique (23505).

**Tech Stack:** PostgreSQL (Supabase RPC plpgsql), Next.js App Router (route handlers), React 18 client components, Zod, Vitest (mocks de `supabaseAdmin`).

**Spec:** `docs/superpowers/specs/2026-05-30-pos-series-venta-idempotencia-design.md`

**Branch:** `feat/pos-series-idempotencia` (ya creada)

---

## File Structure

| Archivo | Responsabilidad | Acción |
|---------|-----------------|--------|
| `supabase/migrations/200_series_en_venta_e_idempotencia.sql` | Columna `idempotency_key` + índice único + `crear_venta_atomica` v200 | Crear |
| `app/api/inventario/search/route.ts` | Exponer `trackeaSeries` en el payload de búsqueda | Modificar |
| `app/api/ventas/route.ts` | Zod `items[].serieIds` + `idempotencyKey`; pasar a RPC; manejar 23505 | Modificar |
| `components/pos/pos-types.ts` | Campos de cart item: `trackeaSeries`, `serieIds`, `costo`; helper `autoSelectSeries` | Modificar |
| `components/pos/pos-terminal.tsx` | `addProduct`/`addManualProduct` con nuevos campos | Modificar |
| `components/pos/pos-product-search.tsx` | Input `costo` opcional en producto manual; propagar `trackeaSeries` | Modificar |
| `components/pos/pos-cart.tsx` | Picker de series por línea serializada (auto FIFO + override) | Modificar |
| `components/pos/pos-checkout-dialog.tsx` | Enviar `serieIds` + `idempotencyKey`; validar `serieIds.length == cantidad` | Modificar |
| `components/pos/__tests__/pos-series.test.ts` | Unit test de `autoSelectSeries` | Crear |
| `__tests__/api/ventas.test.ts` | Tests de la ruta POST (serieIds, idempotencia 23505) | Crear |
| `__tests__/api/inventario-search.test.ts` | Test de `trackeaSeries` en search | Crear |

**Nota de testing:** la lógica SQL de la RPC no tiene harness automatizado (no hay pgTAP; `supabase/tests/` vacío). Las Tasks 1–2 (SQL) se verifican con un script de verificación manual contra la base. Las Tasks de API y de frontend usan Vitest (`supabaseAdmin` ya mockeado en `vitest.setup.ts`, `.rpc` es `vi.fn()`).

---

## Task 1: Migración 200 — columna idempotency_key + índice único

**Files:**
- Create: `supabase/migrations/200_series_en_venta_e_idempotencia.sql`

- [ ] **Step 1: Crear el archivo de migración con encabezado + columna + índice**

Crear `supabase/migrations/200_series_en_venta_e_idempotencia.sql` con este contenido inicial (la RPC se agrega en Task 2, al final del mismo archivo):

```sql
-- ============================================
-- Migration 200: Series en venta + idempotencia
-- ============================================
-- Implementa la "fase 2" prometida en migración 175 (líneas 15-16): consumo de
-- inventario_series dentro de crear_venta_atomica. Además agrega idempotencia a
-- la creación de venta.
--
-- Cambios:
--   (A) crear_venta_atomica consume series inline para items con
--       inventario.trackea_series = true (auto FIFO + override por serieIds).
--       NO llama salida_serie (esa RPC decrementa stock e inserta movimiento;
--       llamarla aquí duplicaría ambos). El decremento de stock agregado no cambia.
--   (B) crear_venta_atomica persiste p_idempotency_key. Un índice único parcial
--       sobre (organization_id, idempotency_key) permite que la API trate la
--       violación 23505 como reintento idempotente.
--
-- HUMAN-REVIEW: crear_venta_atomica se reproduce desde migración 199 (líneas
-- 209-494). Diffear contra 199 antes de db push para confirmar que no hubo drift
-- de transcripción fuera de los bloques marcados (A)/(B).
-- ============================================

-- (B) Columna + índice de idempotencia
ALTER TABLE ventas
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

COMMENT ON COLUMN ventas.idempotency_key IS
  'Clave de idempotencia provista por el cliente (UUID por intento de checkout). '
  'Único por organización cuando no es NULL: un reintento con la misma clave no '
  'crea una segunda venta.';

CREATE UNIQUE INDEX IF NOT EXISTS ventas_idempotency_key_unique
  ON ventas (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
```

- [ ] **Step 2: Verificar sintaxis SQL (lint local, sin aplicar)**

Run: `Get-Content supabase/migrations/200_series_en_venta_e_idempotencia.sql | Select-String "CREATE UNIQUE INDEX"`
Expected: imprime la línea del índice (confirma que el archivo se escribió).

No hay linter SQL en el repo; la validación real ocurre al aplicar (Task 2, Step final). No aplicar todavía — la RPC aún no está en el archivo.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/200_series_en_venta_e_idempotencia.sql
git commit -m "feat(db): columna idempotency_key + indice unico en ventas (mig 200)"
```

---

## Task 2: Migración 200 — crear_venta_atomica v200 (series inline + idempotencia)

**Files:**
- Modify: `supabase/migrations/200_series_en_venta_e_idempotencia.sql` (append)
- Reference (NO editar): `supabase/migrations/199_fix_series_integrity.sql:209-494`

**Estrategia:** copiar la definición completa de `crear_venta_atomica` desde 199 (líneas 209-494) al final del archivo 200, agregar el parámetro `p_idempotency_key`, y aplicar tres ediciones puntuales (firma, declaración de variables, persistencia de la key, y el bloque de consumo de series dentro del loop de items). Como la firma cambia (nuevo parámetro), hay que `DROP` la sobrecarga vieja para evitar ambigüedad de overload en PostgREST.

- [ ] **Step 1: Append DROP de la firma vieja + apertura de la nueva función**

Agregar al final de `200_series_en_venta_e_idempotencia.sql`:

```sql
-- ============================================
-- (A)+(B) crear_venta_atomica v200
-- Reproducida desde 199 (líneas 209-494) con: nuevo p_idempotency_key,
-- persistencia de la key, y consumo de series inline.
-- ============================================

-- La nueva firma agrega p_idempotency_key → es una sobrecarga distinta.
-- Dropear la firma de 199 para que PostgREST no quede con dos overloads.
DROP FUNCTION IF EXISTS crear_venta_atomica(
  TEXT, TEXT, TEXT, TEXT, TEXT, DECIMAL, DECIMAL, TEXT, DECIMAL, DECIMAL,
  TEXT, TEXT, TEXT, INTEGER, DECIMAL, DECIMAL, JSONB, JSONB
);

CREATE OR REPLACE FUNCTION crear_venta_atomica(
  p_org_id TEXT,
  p_vendedor_id TEXT,
  p_cliente_id TEXT,
  p_cliente_nombre TEXT,
  p_cliente_telefono TEXT,
  p_subtotal DECIMAL,
  p_descuento DECIMAL,
  p_tipo_descuento TEXT,
  p_porcentaje_descuento DECIMAL,
  p_total DECIMAL,
  p_metodo_pago TEXT,
  p_observaciones TEXT,
  p_numero_referencia TEXT,
  p_cuotas INTEGER,
  p_recargo_porcentaje DECIMAL,
  p_monto_original DECIMAL,
  p_items JSONB,
  p_pagos JSONB DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_venta_id TEXT;
  v_numero_venta INTEGER;
  v_item JSONB;
  v_pago JSONB;
  v_item_id TEXT;
  v_inv_stock INTEGER;
  v_inv_nombre TEXT;
  v_inv_costo DECIMAL;
  v_garantia_numero TEXT;
  v_garantias JSONB := '[]'::JSONB;
  v_items_ids JSONB := '[]'::JSONB;
  v_metodo metodo_pago_venta;
  v_total_pagos DECIMAL := 0;
  v_monto_abonado DECIMAL;
  v_estado_pago TEXT;
  v_cc_result JSONB;
  v_total_costo_mercaderia DECIMAL := 0;
  v_inv_id TEXT;
  v_req_total INTEGER;
  v_rows INTEGER;
  -- (A) series
  v_trackea_series BOOLEAN;
  v_serie_ids_in JSONB;
  v_serie_ids_out TEXT[];
  v_serie_id TEXT;
  v_serie_count INTEGER;
  v_dias_garantia INTEGER;
BEGIN
  v_metodo := p_metodo_pago::metodo_pago_venta;

  -- 1. Get next sale number atomically
  SELECT get_next_sale_number(p_org_id) INTO v_numero_venta;
```

> **Importante:** copiar el cuerpo COMPLETO restante (pasos 2 a 7 + `RETURN` + `END; $$ LANGUAGE plpgsql;`) desde `199_fix_series_integrity.sql:264-494` **verbatim**, y luego aplicar los Steps 2–4 de abajo. Los pasos 2 y 3 de la función (validación de stock y estado de pago) no cambian.

- [ ] **Step 2: Persistir idempotency_key en el INSERT de ventas (bloque B)**

En el bloque "4. Create the sale", el INSERT a `ventas` de 199 tiene esta lista de columnas/valores (199:307-326):

```sql
  INSERT INTO ventas (
    numero_venta, cliente_id, cliente_nombre, cliente_telefono,
    vendedor_id, subtotal, descuento, tipo_descuento, porcentaje_descuento,
    total, metodo_pago, monto_abonado, estado_pago, observaciones, organization_id
  ) VALUES (
    v_numero_venta,
    NULLIF(p_cliente_id, ''),
    p_cliente_nombre,
    NULLIF(p_cliente_telefono, ''),
    p_vendedor_id,
    p_subtotal,
    p_descuento,
    COALESCE(p_tipo_descuento, 'MONTO'),
    COALESCE(p_porcentaje_descuento, 0),
    p_total,
    v_metodo,
    v_monto_abonado,
    v_estado_pago,
    NULLIF(p_observaciones, ''),
    p_org_id
  ) RETURNING id INTO v_venta_id;
```

Reemplazarlo por (agrega `idempotency_key` como última columna/valor):

```sql
  INSERT INTO ventas (
    numero_venta, cliente_id, cliente_nombre, cliente_telefono,
    vendedor_id, subtotal, descuento, tipo_descuento, porcentaje_descuento,
    total, metodo_pago, monto_abonado, estado_pago, observaciones, organization_id,
    idempotency_key
  ) VALUES (
    v_numero_venta,
    NULLIF(p_cliente_id, ''),
    p_cliente_nombre,
    NULLIF(p_cliente_telefono, ''),
    p_vendedor_id,
    p_subtotal,
    p_descuento,
    COALESCE(p_tipo_descuento, 'MONTO'),
    COALESCE(p_porcentaje_descuento, 0),
    p_total,
    v_metodo,
    v_monto_abonado,
    v_estado_pago,
    NULLIF(p_observaciones, ''),
    p_org_id,
    NULLIF(p_idempotency_key, '')
  ) RETURNING id INTO v_venta_id;
```

> Si dos requests con la misma `(org, idempotency_key)` corren a la vez, este INSERT lanza `23505` (unique violation) en el segundo. La RPC propaga el error; la API (Task 4) lo traduce a reintento idempotente.

- [ ] **Step 3: Consumo de series inline dentro del loop de items (bloque A)**

En el bloque "6. Insert items...", el loop de 199 termina cada ítem con el descuento de stock guardado y la creación de garantía. Justo **después** del bloque `GET DIAGNOSTICS v_rows = ROW_COUNT; IF v_rows = 0 THEN RAISE ... END IF;` (199:444-449) y **antes** del comentario `-- Create warranty if applicable` (199:451), insertar el bloque de consumo de series:

```sql
    -- (A) Consumo de series para items serializados.
    -- Se ejecuta SOLO si el item está linkeado y su inventario.trackea_series.
    -- NO se llama salida_serie: el stock agregado y el movimiento ya se
    -- manejan arriba; salida_serie los duplicaría. Aquí solo se marcan las
    -- filas inventario_series como vendidas y se ajusta su garantía.
    IF (v_item->>'inventarioId') IS NOT NULL AND (v_item->>'inventarioId') != '' THEN
      SELECT trackea_series INTO v_trackea_series
      FROM inventario WHERE id = (v_item->>'inventarioId');

      IF COALESCE(v_trackea_series, false) THEN
        v_dias_garantia := COALESCE((v_item->>'diasGarantia')::INTEGER, 0);
        v_serie_ids_in := v_item->'serieIds';
        v_serie_ids_out := ARRAY[]::TEXT[];

        IF v_serie_ids_in IS NOT NULL AND jsonb_typeof(v_serie_ids_in) = 'array'
           AND jsonb_array_length(v_serie_ids_in) > 0 THEN
          -- Override: usar las series elegidas por el cajero. Validar count,
          -- pertenencia y estado DISPONIBLE bajo lock.
          IF jsonb_array_length(v_serie_ids_in) <> (v_item->>'cantidad')::INTEGER THEN
            RAISE EXCEPTION 'Cantidad de series (%) no coincide con cantidad del item "%" (%)',
              jsonb_array_length(v_serie_ids_in), v_item->>'descripcion', v_item->>'cantidad'
              USING ERRCODE = '22023';
          END IF;

          SELECT array_agg(s.id) INTO v_serie_ids_out
          FROM inventario_series s
          WHERE s.id IN (SELECT jsonb_array_elements_text(v_serie_ids_in))
            AND s.inventario_id = (v_item->>'inventarioId')
            AND s.organization_id = p_org_id
            AND s.estado = 'DISPONIBLE'
          FOR UPDATE;

          IF v_serie_ids_out IS NULL
             OR array_length(v_serie_ids_out, 1) <> (v_item->>'cantidad')::INTEGER THEN
            RAISE EXCEPTION 'Series seleccionadas inválidas o no disponibles para "%"',
              v_item->>'descripcion'
              USING ERRCODE = 'P0003';
          END IF;
        ELSE
          -- Auto FIFO: tomar las N más viejas DISPONIBLE.
          SELECT array_agg(s.id) INTO v_serie_ids_out
          FROM (
            SELECT id FROM inventario_series
            WHERE inventario_id = (v_item->>'inventarioId')
              AND organization_id = p_org_id
              AND estado = 'DISPONIBLE'
            ORDER BY created_at ASC
            LIMIT (v_item->>'cantidad')::INTEGER
            FOR UPDATE
          ) s;

          IF v_serie_ids_out IS NULL
             OR array_length(v_serie_ids_out, 1) <> (v_item->>'cantidad')::INTEGER THEN
            RAISE EXCEPTION 'Producto serializado "%" sin series suficientes disponibles (necesita %)',
              v_item->>'descripcion', v_item->>'cantidad'
              USING ERRCODE = 'P0003';
          END IF;
        END IF;

        -- Marcar cada serie como vendida. diasGarantia POS manda: si > 0,
        -- recalcula fecha_garantia_vence = hoy + dias y estado GARANTIA_ACTIVA.
        UPDATE inventario_series
          SET estado = CASE WHEN v_dias_garantia > 0 THEN 'GARANTIA_ACTIVA' ELSE 'VENDIDO' END,
              venta_id = v_venta_id,
              cliente_id = NULLIF(p_cliente_id, ''),
              fecha_venta = NOW(),
              fecha_garantia_vence = CASE
                WHEN v_dias_garantia > 0 THEN CURRENT_DATE + v_dias_garantia
                ELSE fecha_garantia_vence END,
              updated_at = NOW()
          WHERE id = ANY(v_serie_ids_out);

        -- Registrar las series consumidas en el movimiento del item.
        UPDATE movimientos_inventario
          SET serie_ids = v_serie_ids_out
          WHERE referencia_id = v_venta_id
            AND inventario_id = (v_item->>'inventarioId')
            AND tipo = 'VENTA';
      END IF;
    END IF;
```

> El `UPDATE movimientos_inventario ... SET serie_ids` apunta al movimiento insertado unas líneas antes (199:413-432, el `INSERT ... 'VENTA' ...` con `referencia_id = v_venta_id`). Verificar que la columna `serie_ids` existe en `movimientos_inventario` (la usa `salida_serie` en 199:171; existe).

- [ ] **Step 4: Actualizar el COMMENT de la función**

Al final del archivo, después del `$$ LANGUAGE plpgsql;` de la función, agregar:

```sql
COMMENT ON FUNCTION crear_venta_atomica(
  TEXT, TEXT, TEXT, TEXT, TEXT, DECIMAL, DECIMAL, TEXT, DECIMAL, DECIMAL,
  TEXT, TEXT, TEXT, INTEGER, DECIMAL, DECIMAL, JSONB, JSONB, TEXT
) IS
  'Crea venta atómica. v200: consume inventario_series inline para items con '
  'trackea_series (auto FIFO u override por serieIds, diasGarantia recalcula '
  'garantía de la serie); persiste idempotency_key (único por org).';
```

- [ ] **Step 5: Aplicar la migración a la base de desarrollo**

Run (PowerShell, en la raíz del repo):
`npx supabase db push`
Expected: aplica `200_series_en_venta_e_idempotencia.sql` sin error de sintaxis. Si no hay Supabase CLI configurada, aplicar el archivo con el cliente psql del entorno de desarrollo.

Si la migración falla por `DROP FUNCTION` (firma no coincide exactamente con la de 199), ajustar la lista de tipos del `DROP` para que matchee la firma real impresa por:
`\df crear_venta_atomica` (en psql).

- [ ] **Step 6: Verificación manual de la RPC (script SQL)**

Ejecutar contra la base de desarrollo un script que: (1) crea un item con `trackea_series=true` + 2 series DISPONIBLE, (2) llama `crear_venta_atomica` con cantidad 2 sin `serieIds`, (3) verifica que 2 series quedaron `VENDIDO`/`GARANTIA_ACTIVA` con `venta_id`, stock bajó 2, y el movimiento tiene `serie_ids`. Ejemplo:

```sql
-- (sustituir <ORG> por una organization_id válida de desarrollo)
SELECT crear_venta_atomica(
  '<ORG>','<USER>',NULL,'Test Serie',NULL,
  0,0,'MONTO',0,0,'EFECTIVO',NULL,NULL,NULL,NULL,NULL,
  '[{"inventarioId":"<INV_SERIE>","descripcion":"Notebook","cantidad":2,"precioUnitario":100,"diasGarantia":365}]'::jsonb,
  NULL,
  'test-idem-001'
);
-- Esperado: 2 filas en inventario_series con estado GARANTIA_ACTIVA y venta_id seteado;
-- inventario.stock decrementado en 2; movimientos_inventario.serie_ids con 2 ids.

-- Reintento idempotente: misma key debe fallar con 23505 (la API lo traduce).
SELECT crear_venta_atomica(
  '<ORG>','<USER>',NULL,'Test Serie',NULL,
  0,0,'MONTO',0,0,'EFECTIVO',NULL,NULL,NULL,NULL,NULL,
  '[{"inventarioId":"<INV_SERIE>","descripcion":"Notebook","cantidad":1,"precioUnitario":100,"diasGarantia":0}]'::jsonb,
  NULL,
  'test-idem-001'
);
-- Esperado: ERROR 23505 ventas_idempotency_key_unique
```

Expected: el primer call devuelve `{"ventaId": ...}`; las series cambian de estado; el segundo call lanza `23505`. Documentar el resultado en el commit/PR.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/200_series_en_venta_e_idempotencia.sql
git commit -m "feat(db): crear_venta_atomica v200 consume series inline + idempotencia"
```

---

## Task 3: API search — exponer trackeaSeries

**Files:**
- Modify: `app/api/inventario/search/route.ts:22,46-54`
- Test: `__tests__/api/inventario-search.test.ts` (crear)

- [ ] **Step 1: Escribir el test que falla**

Crear `__tests__/api/inventario-search.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess, mockAuthError, createChainMock, mockSupabaseFrom,
  createGetRequest, parseResponse,
} from "./helpers"
import { GET } from "@/app/api/inventario/search/route"

describe("GET /api/inventario/search", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 401 when not authenticated", async () => {
    mockAuthError()
    const res = await GET(createGetRequest("http://localhost:3000/api/inventario/search?q=note"))
    const { status } = await parseResponse(res)
    expect(status).toBe(401)
  })

  it("incluye trackeaSeries en el payload", async () => {
    mockAuthSuccess()
    const invChain = createChainMock([
      { id: "i1", codigo: "C1", nombre: "Notebook", stock: 5, stock_reservado: 0,
        precio_venta: 100, precio_compra: 60, trackea_series: true },
    ])
    mockSupabaseFrom({ inventario: invChain })

    const res = await GET(createGetRequest("http://localhost:3000/api/inventario/search?q=note"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body[0].trackeaSeries).toBe(true)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm run test:run -- __tests__/api/inventario-search.test.ts`
Expected: FAIL en `expect(body[0].trackeaSeries).toBe(true)` (es `undefined`).

- [ ] **Step 3: Implementar — agregar columna y campo**

En `app/api/inventario/search/route.ts:22`, agregar `trackea_series` al select:

```ts
      .select("id, codigo, nombre, stock, stock_reservado, precio_venta, precio_compra, trackea_series")
```

En el `.map` (líneas 46-54), agregar el campo:

```ts
    const formatted = (items || []).map((item) => ({
      id: item.id,
      codigo: item.codigo,
      nombre: item.nombre,
      stock: item.stock,
      stockReservado: item.stock_reservado ?? 0,
      precioVenta: item.precio_venta,
      precioCompra: item.precio_compra ?? 0,
      trackeaSeries: item.trackea_series ?? false,
    }))
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm run test:run -- __tests__/api/inventario-search.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/inventario/search/route.ts __tests__/api/inventario-search.test.ts
git commit -m "feat(api): search expone trackeaSeries"
```

---

## Task 4: API ventas POST — serieIds + idempotencyKey + manejo 23505

**Files:**
- Modify: `app/api/ventas/route.ts:9-45` (zod), `:184-223` (rpc params), `:225-234` (error handling)
- Test: `__tests__/api/ventas.test.ts` (crear)

- [ ] **Step 1: Escribir los tests que fallan**

Crear `__tests__/api/ventas.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess, createChainMock, mockSupabaseFrom,
  createPostRequest, parseResponse,
} from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

vi.mock("@/lib/audit", () => ({
  createAuditLogger: vi.fn(() => ({ create: vi.fn().mockResolvedValue(undefined) })),
}))
vi.mock("@/lib/webhooks/dispatcher", () => ({
  emitWebhookEvent: vi.fn().mockResolvedValue(undefined),
}))

import { POST } from "@/app/api/ventas/route"

const baseBody = {
  clienteNombre: "Consumidor Final",
  items: [{ inventarioId: "i1", descripcion: "Notebook", cantidad: 1, precioUnitario: 100, diasGarantia: 0 }],
  metodoPago: "EFECTIVO",
}

describe("POST /api/ventas", () => {
  beforeEach(() => vi.clearAllMocks())

  it("pasa serieIds e idempotencyKey a la RPC", async () => {
    mockAuthSuccess()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { ventaId: "v1" }, error: null } as any)
    // venta completa para el SELECT posterior
    mockSupabaseFrom({
      ventas: createChainMock({ id: "v1", numero_venta: 1, total: 100 }),
      organizations: createChainMock({ nombre: "Org", nombre_mostrar: "Org" }),
    })

    const res = await POST(createPostRequest({
      ...baseBody,
      idempotencyKey: "idem-123",
      items: [{ ...baseBody.items[0], serieIds: ["s1"] }],
    }))
    const { status } = await parseResponse(res)

    expect(status).toBe(201)
    const rpcArgs = vi.mocked(supabaseAdmin.rpc).mock.calls[0][1] as any
    expect(rpcArgs.p_idempotency_key).toBe("idem-123")
    expect(rpcArgs.p_items[0].serieIds).toEqual(["s1"])
  })

  it("23505: devuelve la venta existente (reintento idempotente)", async () => {
    mockAuthSuccess()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null,
      error: { code: "23505", message: "duplicate key ventas_idempotency_key_unique" },
    } as any)
    // SELECT de la venta existente por idempotency_key
    mockSupabaseFrom({
      ventas: createChainMock({ id: "v-existing", numero_venta: 7, total: 100 }),
      organizations: createChainMock({ nombre: "Org", nombre_mostrar: "Org" }),
    })

    const res = await POST(createPostRequest({ ...baseBody, idempotencyKey: "idem-dup" }))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(201)
    expect(body.numeroVenta).toBe(7)
  })
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npm run test:run -- __tests__/api/ventas.test.ts`
Expected: FAIL — `p_idempotency_key` es `undefined` (no se pasa), y el caso 23505 devuelve 400 en vez de 201.

- [ ] **Step 3: Implementar — zod**

En `app/api/ventas/route.ts`, agregar `serieIds` al `itemSchema` (después de `porcentajeDescuento`, línea 17):

```ts
  porcentajeDescuento: z.number().min(0).max(100).default(0),
  serieIds: z.array(z.string()).optional(),
  costo: z.number().min(0).nullable().optional(),
```

Y agregar `idempotencyKey` al `ventaSchema` (después de `pagosParcial`, línea 35):

```ts
  pagosParcial: z.boolean().optional(),
  idempotencyKey: z.string().max(100).nullable().optional(),
```

- [ ] **Step 4: Implementar — pasar a la RPC**

En el `.map` que arma `pItems` (líneas 184-193), incluir `serieIds` y `costo`:

```ts
    const pItems = data.items.map(item => ({
      inventarioId: item.inventarioId || null,
      descripcion: item.descripcion,
      cantidad: item.cantidad,
      precioUnitario: item.precioUnitario,
      diasGarantia: item.diasGarantia,
      descuento: item.descuento,
      tipoDescuento: item.tipoDescuento,
      porcentajeDescuento: item.porcentajeDescuento,
      ...(item.serieIds && item.serieIds.length > 0 && { serieIds: item.serieIds }),
      ...(item.costo != null && { costo: item.costo }),
    }))
```

Agregar el parámetro al `rpcParams` (después de `p_items: pItems,`, línea 213):

```ts
      p_items: pItems,
      p_idempotency_key: data.idempotencyKey || null,
    }
```

- [ ] **Step 5: Implementar — manejo 23505 (reintento idempotente)**

Reemplazar el bloque de manejo de error de la RPC (líneas 227-234):

```ts
    if (rpcError) {
      // 23505: violación del índice único de idempotencia → la venta ya existe.
      // Reintento idempotente: devolver la venta original sin duplicar.
      if ((rpcError as any).code === "23505" && data.idempotencyKey) {
        const { data: existente } = await supabaseAdmin
          .from("ventas")
          .select(`
            *,
            clientes (*),
            users:vendedor_id (id, nombre),
            items_venta (*, inventario (*)),
            garantias_venta (*),
            pagos_venta (*),
            devoluciones_venta (*, items_devolucion(*))
          `)
          .eq("organization_id", organizationId!)
          .eq("idempotency_key", data.idempotencyKey)
          .single()

        if (existente) {
          const { data: org } = await supabaseAdmin
            .from("organizations")
            .select("nombre, nombre_mostrar")
            .eq("id", organizationId!)
            .single()
          return NextResponse.json({
            ...formatVenta(existente),
            organizationName: org?.nombre_mostrar || org?.nombre || null,
          }, { status: 201 })
        }
      }

      console.error("Error en crear_venta_atomica:", rpcError)
      return NextResponse.json(
        { error: rpcError.message || "Error al crear venta" },
        { status: 400 }
      )
    }
```

- [ ] **Step 6: Correr los tests y verificar que pasan**

Run: `npm run test:run -- __tests__/api/ventas.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add app/api/ventas/route.ts __tests__/api/ventas.test.ts
git commit -m "feat(api): ventas POST acepta serieIds/idempotencyKey + reintento idempotente 23505"
```

---

## Task 5: pos-types — campos de cart + helper autoSelectSeries

**Files:**
- Modify: `components/pos/pos-types.ts`
- Test: `components/pos/__tests__/pos-series.test.ts` (crear)

- [ ] **Step 1: Escribir el test que falla**

Crear `components/pos/__tests__/pos-series.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { autoSelectSeries } from "../pos-types"

describe("autoSelectSeries", () => {
  const series = [
    { id: "s1", numeroSerie: "A1" },
    { id: "s2", numeroSerie: "A2" },
    { id: "s3", numeroSerie: "A3" },
  ]

  it("toma las primeras N (FIFO ya ordenado)", () => {
    expect(autoSelectSeries(series, 2)).toEqual(["s1", "s2"])
  })

  it("si cantidad excede disponibles, devuelve todas", () => {
    expect(autoSelectSeries(series, 5)).toEqual(["s1", "s2", "s3"])
  })

  it("cantidad 0 devuelve vacío", () => {
    expect(autoSelectSeries(series, 0)).toEqual([])
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm run test:run -- components/pos/__tests__/pos-series.test.ts`
Expected: FAIL con "autoSelectSeries is not a function".

- [ ] **Step 3: Implementar — tipos + helper**

En `components/pos/pos-types.ts`, modificar `PosCartItem` y agregar tipo `SerieDisponible` + helper:

```ts
export interface PosCartItem {
  lineId: string
  inventarioId: string | null
  codigo: string
  nombre: string
  precioUnitario: number
  cantidad: number
  stockDisponible: number
  diasGarantia: number
  trackeaSeries: boolean
  serieIds: string[]
  costo?: number
}

export interface SerieDisponible {
  id: string
  numeroSerie: string
}

// FIFO: la lista llega ya ordenada por created_at asc desde la API.
// Toma las primeras N. Si N excede, devuelve todas las disponibles.
export function autoSelectSeries(series: SerieDisponible[], cantidad: number): string[] {
  if (cantidad <= 0) return []
  return series.slice(0, cantidad).map((s) => s.id)
}
```

Y extender `InventarioResult` con `trackeaSeries`:

```ts
export interface InventarioResult {
  id: string
  codigo: string
  nombre: string
  stock: number
  precioVenta: number
  trackeaSeries?: boolean
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm run test:run -- components/pos/__tests__/pos-series.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add components/pos/pos-types.ts components/pos/__tests__/pos-series.test.ts
git commit -m "feat(pos): tipos de cart con series + helper autoSelectSeries"
```

---

## Task 6: pos-terminal — addProduct/addManualProduct con nuevos campos

**Files:**
- Modify: `components/pos/pos-terminal.tsx:151-192`

- [ ] **Step 1: Actualizar addProduct para llevar trackeaSeries + serieIds**

En `components/pos/pos-terminal.tsx`, dentro de `addProduct` (líneas 151-176), el objeto nuevo del cart (rama "no existe") debe incluir los campos nuevos:

```ts
      return [
        ...prev,
        {
          lineId: nextLineId(),
          inventarioId: product.id,
          codigo: product.codigo,
          nombre: product.nombre,
          precioUnitario: product.precioVenta,
          cantidad: 1,
          stockDisponible: product.stock,
          diasGarantia: 0,
          trackeaSeries: product.trackeaSeries ?? false,
          serieIds: [],
        },
      ]
```

- [ ] **Step 2: Actualizar addManualProduct para llevar costo + flags**

Cambiar la firma de `addManualProduct` (línea 178) y el objeto agregado:

```ts
  const addManualProduct = useCallback((product: { nombre: string; precioUnitario: number; costo?: number }) => {
    setCartItems((prev) => [
      ...prev,
      {
        lineId: nextLineId(),
        inventarioId: null,
        codigo: "",
        nombre: product.nombre,
        precioUnitario: product.precioUnitario,
        cantidad: 1,
        stockDisponible: 999,
        diasGarantia: 0,
        trackeaSeries: false,
        serieIds: [],
        costo: product.costo,
      },
    ])
  }, [])
```

- [ ] **Step 3: Verificar typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores nuevos en `pos-terminal.tsx`. (Pueden quedar errores en `pos-cart.tsx`/`pos-checkout-dialog.tsx` que se resuelven en Tasks 8–9; verificar que NO haya errores en `pos-terminal.tsx` específicamente.)

- [ ] **Step 4: Commit**

```bash
git add components/pos/pos-terminal.tsx
git commit -m "feat(pos): terminal propaga trackeaSeries/serieIds/costo al cart"
```

---

## Task 7: pos-product-search — input costo opcional en producto manual

**Files:**
- Modify: `components/pos/pos-product-search.tsx:10-13,36-38,95-105,191-251`

- [ ] **Step 1: Extender el tipo ManualProduct y el estado**

En `components/pos/pos-product-search.tsx`, cambiar la interface (líneas 10-13):

```ts
interface ManualProduct {
  nombre: string
  precioUnitario: number
  costo?: number
}
```

Agregar estado para costo (después de línea 38):

```ts
    const [manualPrecio, setManualPrecio] = useState<number | "">(0)
    const [manualCosto, setManualCosto] = useState<number | "">("")
```

- [ ] **Step 2: Pasar costo en handleAddManual y limpiar**

Reemplazar `handleAddManual` (líneas 95-105):

```ts
    const handleAddManual = useCallback(() => {
      const nombre = manualNombre.trim()
      if (!nombre || !manualPrecio || manualPrecio <= 0) return
      onAddManualProduct({
        nombre,
        precioUnitario: manualPrecio,
        costo: manualCosto === "" ? undefined : manualCosto,
      })
      setManualNombre("")
      setManualPrecio(0)
      setManualCosto("")
      setShowManualForm(false)
      setQuery("")
      setResults([])
      inputRef.current?.focus()
    }, [manualNombre, manualPrecio, manualCosto, onAddManualProduct])
```

También limpiar costo en `openManualForm` (después de `setManualPrecio(0)` dentro de esa función, ~línea 110):

```ts
      setManualPrecio(0)
      setManualCosto("")
```

- [ ] **Step 3: Agregar el input de costo en el form manual**

En el form manual (dentro del `<div className="flex gap-2">` que contiene nombre y precio, líneas 205-248), agregar un tercer input de costo entre el de precio y el botón Agregar. Reemplazar el bloque del input de precio + botón por:

```tsx
                <div className="w-28">
                  <Input
                    ref={manualPriceRef}
                    type="text"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    value={manualPrecio || ""}
                    onChange={(e) => setManualPrecio(e.target.value ? parseFloat(e.target.value) : "")}
                    placeholder="Precio"
                    className="h-11 text-base font-medium"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        handleAddManual()
                      }
                    }}
                  />
                </div>
                <div className="w-24">
                  <Input
                    type="text"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    value={manualCosto === "" ? "" : manualCosto}
                    onChange={(e) => setManualCosto(e.target.value ? parseFloat(e.target.value) : "")}
                    placeholder="Costo"
                    className="h-11 text-sm"
                    title="Costo (opcional) — para margen correcto en reportes"
                  />
                </div>
                <Button
                  className="h-11 px-4"
                  onClick={handleAddManual}
                  disabled={!manualNombre.trim() || !manualPrecio || manualPrecio <= 0}
                >
                  <Plus className="h-4 w-4 sm:mr-1.5" />
                  <span className="hidden sm:inline">Agregar</span>
                </Button>
```

- [ ] **Step 4: Verificar typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores nuevos en `pos-product-search.tsx`.

- [ ] **Step 5: Commit**

```bash
git add components/pos/pos-product-search.tsx
git commit -m "feat(pos): costo opcional en producto manual"
```

---

## Task 8: pos-cart — picker de series por línea serializada (auto FIFO + override)

**Files:**
- Modify: `components/pos/pos-cart.tsx`

**Diseño del componente:** cuando un ítem tiene `trackeaSeries`, la fila expandida (la que hoy muestra garantía) muestra además: un fetch de series `DISPONIBLE`, auto-selección FIFO igual a `cantidad`, y una lista de checkboxes para override. La selección se sube al padre vía un nuevo callback `onSetSerieIds(lineId, serieIds)`. Un badge avisa si `serieIds.length != cantidad`.

- [ ] **Step 1: Agregar el prop onSetSerieIds + tipo de serie**

En `components/pos/pos-cart.tsx`, agregar al `PosCartProps` (líneas 26-40):

```ts
  onSetGarantia: (lineId: string, dias: number) => void
  onSetSerieIds: (lineId: string, serieIds: string[]) => void
```

Importar el helper y tipo (línea 24):

```ts
import { autoSelectSeries, type PosCartItem, type PosCliente, type SerieDisponible } from "./pos-types"
```

Y desestructurar el prop en la función (junto a `onSetGarantia`):

```ts
  onSetGarantia,
  onSetSerieIds,
```

- [ ] **Step 2: Estado local para series disponibles por línea**

Dentro de `PosCart`, después de `const [garantiaDraft, setGarantiaDraft] = useState<string>("")` (línea 68):

```ts
  const [seriesDisp, setSeriesDisp] = useState<Record<string, SerieDisponible[]>>({})
  const [seriesLoading, setSeriesLoading] = useState<string | null>(null)
```

- [ ] **Step 3: Fetch de series disponibles al expandir una línea serializada**

Agregar un `useEffect` después del de client search (después de línea 101):

```ts
  // Cargar series DISPONIBLE cuando se expande una línea serializada.
  useEffect(() => {
    if (!expandedItem) return
    const item = items.find((i) => i.lineId === expandedItem)
    if (!item || !item.trackeaSeries || !item.inventarioId) return
    if (seriesDisp[item.lineId]) return // ya cargado

    let cancelled = false
    setSeriesLoading(item.lineId)
    fetch(`/api/inventario/${item.inventarioId}/series?estado=DISPONIBLE&limit=500`)
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((data) => {
        if (cancelled) return
        const list: SerieDisponible[] = (data.data ?? []).map((s: any) => ({
          id: s.id, numeroSerie: s.numero_serie,
        }))
        setSeriesDisp((prev) => ({ ...prev, [item.lineId]: list }))
        // Auto FIFO si la línea aún no tiene selección.
        if (item.serieIds.length === 0) {
          onSetSerieIds(item.lineId, autoSelectSeries(list, item.cantidad))
        }
      })
      .catch(() => { if (!cancelled) setSeriesDisp((prev) => ({ ...prev, [item.lineId]: [] })) })
      .finally(() => { if (!cancelled) setSeriesLoading(null) })
    return () => { cancelled = true }
  }, [expandedItem, items, seriesDisp, onSetSerieIds])
```

- [ ] **Step 4: UI del picker dentro del bloque expandido**

En el bloque `{isExpanded && (...)}` (líneas 304-321), agregar después del `<label>` de garantía, dentro del mismo contenedor `<div className="mt-2 pl-1 ...">` (cambiar a `flex-col` para apilar garantía + series):

Reemplazar la apertura del div expandido:

```tsx
                  {isExpanded && (
                    <div className="mt-2 pl-1 flex flex-col gap-2 text-xs">
                      <label className="flex items-center gap-1.5">
                        <Shield className="h-3 w-3 text-muted-foreground" />
                        <span className="text-muted-foreground">Garantía (días):</span>
                        <Input
                          type="number"
                          min={0}
                          value={garantiaDraft}
                          onChange={(e) => {
                            setGarantiaDraft(e.target.value)
                            onSetGarantia(item.lineId, parseInt(e.target.value, 10) || 0)
                          }}
                          className="h-7 w-16 text-xs text-center"
                        />
                      </label>

                      {item.trackeaSeries && (
                        <div className="rounded border bg-muted/30 p-2 space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground font-medium">
                              Series ({item.serieIds.length}/{item.cantidad})
                            </span>
                            {item.serieIds.length !== item.cantidad && (
                              <span className="text-red-500">
                                Seleccioná {item.cantidad}
                              </span>
                            )}
                          </div>
                          {seriesLoading === item.lineId ? (
                            <span className="text-muted-foreground">Cargando series…</span>
                          ) : (
                            <div className="max-h-32 overflow-y-auto grid grid-cols-2 gap-1">
                              {(seriesDisp[item.lineId] ?? []).map((s) => {
                                const checked = item.serieIds.includes(s.id)
                                return (
                                  <label key={s.id} className="flex items-center gap-1.5 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      className="h-3.5 w-3.5 rounded"
                                      checked={checked}
                                      onChange={() => {
                                        if (checked) {
                                          onSetSerieIds(item.lineId, item.serieIds.filter((id) => id !== s.id))
                                        } else if (item.serieIds.length < item.cantidad) {
                                          onSetSerieIds(item.lineId, [...item.serieIds, s.id])
                                        }
                                      }}
                                    />
                                    <span className="font-mono truncate">{s.numeroSerie}</span>
                                  </label>
                                )
                              })}
                              {(seriesDisp[item.lineId] ?? []).length === 0 && (
                                <span className="text-red-500 col-span-2">Sin series disponibles</span>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
```

- [ ] **Step 5: Verificar typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores en `pos-cart.tsx`. Queda 1 error esperado: `pos-terminal.tsx` no pasa aún `onSetSerieIds` → se arregla en Step 6.

- [ ] **Step 6: Conectar onSetSerieIds desde pos-terminal**

En `components/pos/pos-terminal.tsx`, agregar el callback junto a `setGarantia` (después de línea 216):

```ts
  const setSerieIds = useCallback((lineId: string, serieIds: string[]) => {
    setCartItems((prev) =>
      prev.map((item) => (item.lineId === lineId ? { ...item, serieIds } : item))
    )
  }, [])
```

Pasarlo a AMBAS instancias de `<PosCart ... />` (desktop ~línea 593 y mobile ~línea 625), agregando junto a `onSetGarantia={setGarantia}`:

```tsx
            onSetGarantia={setGarantia}
            onSetSerieIds={setSerieIds}
```

Además, cuando cambia la cantidad de un ítem serializado, su selección puede quedar inconsistente. En `updateQuantity` (líneas 194-206), al cambiar cantidad resetear `serieIds` de esa línea para forzar re-selección FIFO:

```ts
  const updateQuantity = useCallback((lineId: string, delta: number) => {
    setCartItems((prev) =>
      prev
        .map((item) => {
          if (item.lineId !== lineId) return item
          const newQty = item.cantidad + delta
          if (newQty <= 0) return null
          if (item.inventarioId && newQty > item.stockDisponible) return item
          return { ...item, cantidad: newQty, serieIds: item.trackeaSeries ? [] : item.serieIds }
        })
        .filter(Boolean) as PosCartItem[]
    )
  }, [])
```

- [ ] **Step 7: Verificar typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores nuevos en POS.

- [ ] **Step 8: Commit**

```bash
git add components/pos/pos-cart.tsx components/pos/pos-terminal.tsx
git commit -m "feat(pos): picker de series por linea (auto FIFO + override)"
```

---

## Task 9: pos-checkout-dialog — enviar serieIds + idempotencyKey + validar

**Files:**
- Modify: `components/pos/pos-checkout-dialog.tsx:1-3,44-71,93-156`

- [ ] **Step 1: Generar idempotencyKey estable por intento de checkout**

En `components/pos/pos-checkout-dialog.tsx`, agregar estado para la key y regenerarla al abrir (dentro del `useEffect` de apertura, líneas 64-71). Agregar primero el estado (después de línea 49):

```ts
  const [idempotencyKey, setIdempotencyKey] = useState<string>("")
```

Modificar el `useEffect` de apertura (líneas 64-71) para generar la key una vez por apertura:

```ts
  useEffect(() => {
    if (open && total > 0) {
      setPagosLines([createPagoLine(total)])
      setMontoRecibido("")
      setObservaciones("")
      setPagoParcial(false)
      setIdempotencyKey(crypto.randomUUID())
    }
  }, [open, total])
```

- [ ] **Step 2: Validar selección de series antes de enviar**

En `handleSubmit`, después de las validaciones de cuenta corriente (después de línea 119, antes de `setLoading(true)`):

```ts
    // Validar selección de series para items serializados
    const itemSinSeries = items.find(
      (it) => it.trackeaSeries && it.serieIds.length !== it.cantidad
    )
    if (itemSinSeries) {
      await showError(
        `Seleccioná ${itemSinSeries.cantidad} serie(s) para "${itemSinSeries.nombre}" antes de cobrar`
      )
      return
    }
```

- [ ] **Step 3: Incluir serieIds, costo e idempotencyKey en el payload**

Modificar el `payload` (líneas 126-156). En el `.map` de items agregar `serieIds` y `costo`, y agregar `idempotencyKey` al nivel raíz:

```ts
      const payload = {
        clienteId: cliente.id || null,
        clienteNombre: cliente.nombre || "Consumidor Final",
        clienteTelefono: cliente.telefono || undefined,
        pagosParcial: pagoParcial,
        idempotencyKey,
        items: items.map((item) => ({
          inventarioId: item.inventarioId || null,
          descripcion: item.nombre,
          cantidad: item.cantidad,
          precioUnitario: item.precioUnitario,
          diasGarantia: item.diasGarantia,
          descuento: 0,
          tipoDescuento: "MONTO" as const,
          porcentajeDescuento: 0,
          ...(item.trackeaSeries && item.serieIds.length > 0 && { serieIds: item.serieIds }),
          ...(item.costo != null && { costo: item.costo }),
        })),
        descuento: 0,
        tipoDescuento: "MONTO" as const,
        porcentajeDescuento: 0,
        metodoPago: pagosConMonto.length > 0 ? pagosConMonto[0].metodo : "EFECTIVO",
        observaciones: observaciones || undefined,
        ...(pagosConMonto.length > 0 && {
          pagos: pagosConMonto.map((p) => ({
            metodo: p.metodo,
            monto: p.monto,
            ...(p.referencia && { referencia: p.referencia }),
            ...(p.cuotas && { cuotas: p.cuotas }),
            ...(p.recargo && p.recargo > 0 && { recargo: p.recargo }),
            ...(p.recargo && p.recargo > 0 && { montoOriginal: p.monto + p.monto * (p.recargo / 100) }),
          })),
        }),
      }
```

- [ ] **Step 4: Verificar typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores. `item.trackeaSeries`, `item.serieIds`, `item.costo` existen en `PosCartItem` (Task 5).

- [ ] **Step 5: Correr toda la suite de tests**

Run: `npm run test:run`
Expected: PASS — incluye los tests nuevos (search, ventas, autoSelectSeries) y sin regresiones en los existentes.

- [ ] **Step 6: Commit**

```bash
git add components/pos/pos-checkout-dialog.tsx
git commit -m "feat(pos): checkout envia serieIds/costo/idempotencyKey + valida series"
```

---

## Task 10: Verificación end-to-end manual + regresión

**Files:** ninguno (verificación)

- [ ] **Step 1: Build de producción**

Run: `npm run build`
Expected: build exitoso, sin errores de tipos.

- [ ] **Step 2: Verificación funcional en la app (dev)**

Run: `npm run dev` y verificar manualmente:

1. **Producto serializado:** crear/usar un ítem con `trackea_series=true` y ≥2 series DISPONIBLE. Agregarlo al POS, cantidad 2. Expandir la línea → ver 2 series auto-seleccionadas (FIFO). Cobrar. Verificar en DB: 2 series `VENDIDO`/`GARANTIA_ACTIVA` con `venta_id`, `inventario.stock` bajó 2, movimiento con `serie_ids`.
2. **Override:** con cantidad 1, destildar la FIFO y elegir otra serie. Cobrar. Verificar que salió la serie elegida.
3. **Series insuficientes:** ítem serializado cantidad 3 con solo 2 disponibles → el checkout bloquea ("Seleccioná 3 serie(s)"); si se fuerza vía API, la RPC rechaza con P0003.
4. **Idempotencia:** simular doble POST con misma `idempotencyKey` (reenviar request en devtools) → una sola venta creada, segundo response = misma venta, stock baja una vez.
5. **Ítem manual con costo:** agregar producto manual con costo → verificar `items_venta.costo_unitario_snapshot` poblado.
6. **Regresión no serializado:** vender un ítem normal (sin trackea_series) → comportamiento idéntico al actual, sin tocar series.

- [ ] **Step 3: Documentar resultados de la verificación manual**

Anotar en el PR el resultado de cada uno de los 6 checks (con evidencia: número de venta, estado de series, valores de stock). Marcar este step solo cuando los 6 pasen.

- [ ] **Step 4: Verificación final de la suite + lint**

Run: `npm run test:run`
Expected: PASS (toda la suite).

Run: `npm run lint`
Expected: sin errores nuevos.

- [ ] **Step 5: Finalizar la rama**

Usar la skill `superpowers:finishing-a-development-branch` para decidir merge/PR.

---

## Notas de implementación

- **No tocar migración 199.** La 200 hace `DROP FUNCTION` de la firma vieja + `CREATE OR REPLACE` de la nueva. Si `db push` falla en el DROP, ajustar la lista de tipos con la firma real (`\df crear_venta_atomica`).
- **serie_ids en movimientos_inventario:** ya existe (la usa `salida_serie`). El `UPDATE` del movimiento en Task 2 Step 3 setea esa columna para el movimiento de la venta.
- **No se llama `salida_serie`** desde la venta — el consumo es inline para no duplicar stock/movimiento. `salida_serie` queda para egresos no-venta.
- **Idempotencia atómica:** la garantía contra duplicados la da el índice único parcial + el manejo de 23505 en la API; no hay ventana de carrera porque el INSERT es lo que choca.
