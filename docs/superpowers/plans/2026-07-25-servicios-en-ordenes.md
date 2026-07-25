# Sección Servicios — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un taller pueda dar de alta servicios con precio fijo (ej. "Instalación de Windows, $25.000") y asignarlos a una orden, con el servicio computando como **ingreso** y no como costo.

**Architecture:** Dos tablas nuevas. `servicios` es el catálogo a nivel organización; `servicios_orden` son las líneas de una orden, con snapshot de nombre y precio. No se toca `repuestos_orden` ni `inventario`. El servicio alimenta `costo_final`, que sigue siendo la única fuente de ingreso de la orden, así que los siete lugares que calculan ganancia siguen correctos sin cambios.

**Tech Stack:** Next.js App Router, PostgreSQL (Supabase), zod, vitest, React con shadcn/ui.

**Spec de referencia:** `docs/superpowers/specs/2026-07-24-servicios-en-ordenes-design.md`, sección 5.

**Depende de:** `docs/superpowers/plans/2026-07-25-estado-cobro-trigger.md` (PR 1). El trigger de la migración 277 tiene que estar aplicado: este plan escribe `costo_final` sin llamar a `recalcular_estado_cobro` explícitamente, y confía en el trigger.

## Global Constraints

- **`servicios_orden.precio_unitario` es PRECIO DE VENTA (ingreso).** Es la semántica **opuesta** a `repuestos_orden.precio_unitario`, que es costo (`151_fix_add_repuesto_precio_compra.sql:72`). No copiar la lógica de repuestos sin invertir el signo mentalmente.
- **Sin columnas de costo en esta entrega.** Ni `servicios.costo` ni `servicios_orden.costo_unitario`. La fórmula `ganancia = costo_final - costo_repuestos` está duplicada en siete lugares (spec, sección 1); exponer un costo de servicio sin actualizar los siete infla ganancia y comisiones en silencio.
- **Sin `sucursal_id`.** Consistente con `inventario`, que es catálogo a nivel organización.
- **Sin `tipo_dispositivo`.** Un servicio es transversal.
- **Precio fijo únicamente.** Sin `precio_hasta` ni tarifa por hora.
- **Numeración de migración:** 279. La 277 es el trigger (PR 1) y la 278 está reservada para el backfill (PR 2).
- **Identificadores de base de datos en español**, extendiendo el esquema existente (`ordenes_servicio`, `repuestos_orden`, `costo_final`). Comentarios SQL en español neutro. Copy de UI en español, como el resto de la app.
- **Comando de test:** `npm run test:run`.

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `supabase/migrations/279_servicios.sql` | Tablas `servicios` y `servicios_orden`, índices, RLS, trigger de `updated_at`. |
| `supabase/migrations/rollback/279_rollback.sql` | Revertir la migración. |
| `types/database.ts` | Tipos `Servicio` y `ServicioOrden` + entradas en el mapa de tablas. |
| `lib/servicios/sincronizar-costo-final.ts` | **Única** implementación de la regla de sincronización de `costo_final`. Función pura, testeable sin base de datos. |
| `app/api/servicios/route.ts` | GET (listado) y POST (alta) del catálogo. |
| `app/api/servicios/[id]/route.ts` | PUT (edición) y DELETE (soft delete) del catálogo. |
| `app/api/ordenes/[id]/servicios/route.ts` | POST y DELETE de líneas de orden. Aplica la regla de sincronización. |
| `components/servicios/servicios-client.tsx` | Pantalla de catálogo: listado, búsqueda, alta y edición. |
| `app/(dashboard)/servicios/page.tsx` | Server component que monta la pantalla. |
| `components/ordenes/orden-servicios-tab.tsx` | Tab de servicios en el detalle de orden. |
| `components/layout/navbar.tsx` | Entrada `/servicios` en el menú. |

La regla de sincronización vive en `lib/servicios/sincronizar-costo-final.ts` y no dentro del route handler, porque es la pieza con más ramas y la que más vale testear en aislamiento.

---

### Task 1: Migración 279 — tablas `servicios` y `servicios_orden`

**Files:**
- Create: `supabase/migrations/279_servicios.sql`
- Create: `supabase/migrations/rollback/279_rollback.sql`

**Interfaces:**
- Produces: tablas `servicios` y `servicios_orden` con las columnas que consumen todas las tasks siguientes.

- [ ] **Step 1: Escribir la migración**

Crear `supabase/migrations/279_servicios.sql`:

```sql
-- 279: Servicios asignables a órdenes
--
-- CONTEXTO
-- Un taller tiene servicios con precio prefijado (ej. instalación de Windows).
-- Hoy no puede cargarlos limpio: inventario exige stock, precio_compra y
-- tipo_dispositivo (001_schema.sql:236, 043:20), y cargarlos como repuesto manual
-- es un bug contable, porque repuestos_orden.precio_unitario es COSTO y se resta
-- de la ganancia (151_fix_add_repuesto_precio_compra.sql:72).
--
-- catalogo_items (143:67) ya modela tipo IN ('PRODUCTO','SERVICIO'), pero es la
-- vitrina pública, que arranca apagada (catalogo_config.activo DEFAULT FALSE, 143:31).
-- Acoplar la operación interna a una vitrina opcional mezcla dos ciclos de vida.
--
-- DECISIONES
--   - Sin columna de costo: la fórmula de ganancia está duplicada en 7 lugares y
--     exponer costo sin actualizarlos infla ganancia y comisiones en silencio.
--   - Sin sucursal_id: consistente con inventario, que es catálogo a nivel org.
--   - Precio fijo: sin rango ni tarifa por hora.

-- ========================================
-- CATÁLOGO DE SERVICIOS
-- ========================================

CREATE TABLE servicios (
  id                    TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id       TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  codigo                TEXT NOT NULL,
  nombre                TEXT NOT NULL,
  descripcion           TEXT,
  categoria             TEXT,
  precio                DECIMAL(10,2) NOT NULL CHECK (precio >= 0),
  duracion_estimada_min INTEGER CHECK (duracion_estimada_min IS NULL OR duracion_estimada_min > 0),
  activo                BOOLEAN NOT NULL DEFAULT TRUE,
  deleted_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice único parcial en vez de UNIQUE(organization_id, codigo): permite
-- reutilizar el código de un servicio borrado. Patrón tomado de
-- 083_inventario_critical_fixes.sql:21, donde el UNIQUE plano tuvo que
-- eliminarse justamente por ser incompatible con el soft delete.
CREATE UNIQUE INDEX servicios_org_codigo_uniq
  ON servicios(organization_id, codigo) WHERE deleted_at IS NULL;

CREATE INDEX servicios_org_activo_idx
  ON servicios(organization_id) WHERE activo = TRUE AND deleted_at IS NULL;

DROP TRIGGER IF EXISTS servicios_updated_at ON servicios;
CREATE TRIGGER servicios_updated_at
  BEFORE UPDATE ON servicios
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS sigue la convención endurecida de 201_rls_hardening_phase1.sql (201:7-12):
--   - El catch-all de service_role lleva TO service_role explícito. Sin rol,
--     una policy FOR ALL USING(true) aplica a PUBLIC, y Postgres OR-combina
--     policies permisivas, así que ese catch-all anularía el aislamiento por
--     org del SELECT para cualquier rol sujeto a RLS.
--   - El SELECT usa public.get_current_organization_id() en vez del GUC
--     current_setting('app.organization_id', true), que nunca se setea en el
--     flujo normal de requests y siempre resuelve a NULL.
ALTER TABLE servicios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS servicios_select ON servicios;
CREATE POLICY servicios_select ON servicios
  FOR SELECT TO authenticated
  USING (organization_id = public.get_current_organization_id());

DROP POLICY IF EXISTS servicios_all_service ON servicios;
CREATE POLICY servicios_all_service ON servicios
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ========================================
-- LÍNEAS DE SERVICIO EN UNA ORDEN
-- ========================================

CREATE TABLE servicios_orden (
  id              TEXT PRIMARY KEY DEFAULT generate_cuid(),
  orden_id        TEXT NOT NULL REFERENCES ordenes_servicio(id) ON DELETE CASCADE,
  servicio_id     TEXT REFERENCES servicios(id) ON DELETE SET NULL,
  nombre          TEXT NOT NULL,
  cantidad        INTEGER NOT NULL DEFAULT 1 CHECK (cantidad > 0),
  precio_unitario DECIMAL(10,2) NOT NULL CHECK (precio_unitario >= 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX servicios_orden_orden_idx ON servicios_orden(orden_id);

COMMENT ON COLUMN servicios_orden.precio_unitario IS
  'PRECIO DE VENTA (ingreso). Semantica OPUESTA a repuestos_orden.precio_unitario, que es costo (ver 151:72). No copiar la logica de repuestos sin invertir el signo.';

COMMENT ON COLUMN servicios_orden.nombre IS
  'Snapshot del nombre al momento de asignar. Se guarda SIEMPRE, tambien cuando servicio_id no es nulo, para que cambiar o borrar el servicio del catalogo no mute ordenes historicas.';

COMMENT ON COLUMN servicios_orden.servicio_id IS
  'Nullable a proposito: habilita servicios ad-hoc sin alta previa, y ON DELETE SET NULL evita que borrar del catalogo rompa ordenes existentes.';

ALTER TABLE servicios_orden ENABLE ROW LEVEL SECURITY;

-- Hereda acceso vía join con la orden, igual que items_factura (053:168-176).
-- Mismo endurecimiento que en servicios más arriba (201:7-12): TO authenticated
-- + TO service_role explícitos y public.get_current_organization_id() en vez
-- del GUC roto.
DROP POLICY IF EXISTS servicios_orden_select ON servicios_orden;
CREATE POLICY servicios_orden_select ON servicios_orden
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ordenes_servicio o
      WHERE o.id = servicios_orden.orden_id
        AND o.organization_id = public.get_current_organization_id()
    )
  );

DROP POLICY IF EXISTS servicios_orden_all_service ON servicios_orden;
CREATE POLICY servicios_orden_all_service ON servicios_orden
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
```

- [ ] **Step 2: Escribir el rollback**

Crear `supabase/migrations/rollback/279_rollback.sql`:

```sql
-- Rollback de 279_servicios.sql
-- Destructivo: elimina el catálogo de servicios y todas las líneas asignadas.

DROP TABLE IF EXISTS servicios_orden;
DROP TABLE IF EXISTS servicios;
```

- [ ] **Step 3: Aplicar y verificar**

Aplicar la migración en Supabase Studio. Verificar:

```sql
BEGIN;

CREATE TEMP TABLE _ctx AS SELECT id AS org_id FROM organizations LIMIT 1;

INSERT INTO servicios (organization_id, codigo, nombre, precio)
SELECT org_id, 'SRV-001', 'Instalacion de Windows', 25000 FROM _ctx;

-- El código duplicado con el servicio vivo debe fallar.
-- ESPERADO: error de unicidad.
INSERT INTO servicios (organization_id, codigo, nombre, precio)
SELECT org_id, 'SRV-001', 'Duplicado', 1 FROM _ctx;

ROLLBACK;
```

Y después, en una transacción aparte, que el soft delete libere el código:

```sql
BEGIN;

CREATE TEMP TABLE _ctx AS SELECT id AS org_id FROM organizations LIMIT 1;

INSERT INTO servicios (organization_id, codigo, nombre, precio)
SELECT org_id, 'SRV-002', 'Original', 100 FROM _ctx;

UPDATE servicios SET deleted_at = NOW() WHERE codigo = 'SRV-002';

-- ESPERADO: inserta sin error.
INSERT INTO servicios (organization_id, codigo, nombre, precio)
SELECT org_id, 'SRV-002', 'Reutiliza el codigo', 200 FROM _ctx;

SELECT 'OK: soft delete libera el codigo' AS resultado;

ROLLBACK;
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/279_servicios.sql supabase/migrations/rollback/279_rollback.sql
git commit -m "feat(servicios): tablas de catalogo y lineas de orden"
```

---

### Task 2: Tipos de base de datos

**Files:**
- Modify: `types/database.ts`

**Interfaces:**
- Produces: `Servicio` y `ServicioOrden`, consumidos por todas las tasks de API y UI.

- [ ] **Step 1: Agregar las interfaces**

En `types/database.ts`, junto a las demás interfaces de fila:

```ts
export interface Servicio {
  id: string
  organization_id: string
  codigo: string
  nombre: string
  descripcion: string | null
  categoria: string | null
  precio: number
  duracion_estimada_min: number | null
  activo: boolean
  deleted_at: string | null
  created_at: string
  updated_at: string
}

export interface ServicioOrden {
  id: string
  orden_id: string
  servicio_id: string | null
  nombre: string
  cantidad: number
  precio_unitario: number
  created_at: string
}
```

- [ ] **Step 2: Registrar las tablas en el mapa**

En el mapa de tablas (junto a `repuestos_orden`, que está en `types/database.ts:423`):

```ts
      servicios: {
        Row: Servicio
        Insert: Omit<Servicio, "id"> & { id?: string }
        Update: Partial<Omit<Servicio, "id">>
      }
      servicios_orden: {
        Row: ServicioOrden
        Insert: Omit<ServicioOrden, "id"> & { id?: string }
        Update: Partial<Omit<ServicioOrden, "id">>
      }
```

- [ ] **Step 3: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: sin errores nuevos.

- [ ] **Step 4: Commit**

```bash
git add types/database.ts
git commit -m "feat(servicios): tipos de base de datos"
```

---

### Task 3: Regla de sincronización de `costo_final`

Esta es la pieza con más ramas del plan. Va en un módulo propio y se testea sin base de datos.

**Files:**
- Create: `lib/servicios/sincronizar-costo-final.ts`
- Test: `__tests__/lib/sincronizar-costo-final.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function calcularCostoFinalSincronizado(input: {
    costoFinalActual: number | string | null
    totalCobrado: number | string | null
    sumaAnterior: number
    sumaNueva: number
  }): { debeActualizar: boolean; nuevoCostoFinal: number | null }
  ```
  Consumida por la Task 5 (`app/api/ordenes/[id]/servicios/route.ts`).

- [ ] **Step 1: Escribir el test que falla**

Crear `__tests__/lib/sincronizar-costo-final.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { calcularCostoFinalSincronizado } from "@/lib/servicios/sincronizar-costo-final"

describe("calcularCostoFinalSincronizado", () => {
  it("autocompleta cuando la orden no tiene costo previo ni cobros", () => {
    const r = calcularCostoFinalSincronizado({
      costoFinalActual: null,
      totalCobrado: 0,
      sumaAnterior: 0,
      sumaNueva: 25000,
    })
    expect(r).toEqual({ debeActualizar: true, nuevoCostoFinal: 25000 })
  })

  it("actualiza cuando el costo actual coincide con la suma anterior", () => {
    const r = calcularCostoFinalSincronizado({
      costoFinalActual: 25000,
      totalCobrado: 0,
      sumaAnterior: 25000,
      sumaNueva: 33000,
    })
    expect(r).toEqual({ debeActualizar: true, nuevoCostoFinal: 33000 })
  })

  it("no pisa un costo editado a mano", () => {
    const r = calcularCostoFinalSincronizado({
      costoFinalActual: 30000,
      totalCobrado: 0,
      sumaAnterior: 25000,
      sumaNueva: 33000,
    })
    expect(r).toEqual({ debeActualizar: false, nuevoCostoFinal: null })
  })

  it("no toca nada si la orden ya tiene cobros", () => {
    const r = calcularCostoFinalSincronizado({
      costoFinalActual: 25000,
      totalCobrado: 10000,
      sumaAnterior: 25000,
      sumaNueva: 33000,
    })
    expect(r).toEqual({ debeActualizar: false, nuevoCostoFinal: null })
  })

  it("deja costo_final en null al eliminar la ultima linea", () => {
    const r = calcularCostoFinalSincronizado({
      costoFinalActual: 25000,
      totalCobrado: 0,
      sumaAnterior: 25000,
      sumaNueva: 0,
    })
    expect(r).toEqual({ debeActualizar: true, nuevoCostoFinal: null })
  })

  it("vuelve a autocompletar despues de haber quedado en null", () => {
    const r = calcularCostoFinalSincronizado({
      costoFinalActual: null,
      totalCobrado: 0,
      sumaAnterior: 0,
      sumaNueva: 8000,
    })
    expect(r).toEqual({ debeActualizar: true, nuevoCostoFinal: 8000 })
  })

  // Supabase devuelve DECIMAL como string. Comparar con === contra un number
  // daria siempre falso y la sincronizacion nunca se dispararia.
  it("compara correctamente cuando costo_final llega como string", () => {
    const r = calcularCostoFinalSincronizado({
      costoFinalActual: "25000.00",
      totalCobrado: "0",
      sumaAnterior: 25000,
      sumaNueva: 33000,
    })
    expect(r).toEqual({ debeActualizar: true, nuevoCostoFinal: 33000 })
  })

  it("tolera diferencias de centavos por redondeo", () => {
    const r = calcularCostoFinalSincronizado({
      costoFinalActual: "25000.00",
      totalCobrado: 0,
      sumaAnterior: 24999.999,
      sumaNueva: 33000,
    })
    expect(r.debeActualizar).toBe(true)
  })
})
```

- [ ] **Step 2: Correr el test — debe fallar**

Run: `npm run test:run -- __tests__/lib/sincronizar-costo-final.test.ts`
Expected: FAIL, no resuelve el módulo `@/lib/servicios/sincronizar-costo-final`.

- [ ] **Step 3: Implementar**

Crear `lib/servicios/sincronizar-costo-final.ts`:

```ts
/**
 * Regla de sincronización entre las líneas de servicio de una orden y su costo_final.
 *
 * Principio: automático mientras nadie pagó nada; explícito cuando ya hay dinero
 * en el medio. Si el cliente ya puso plata, mover el total en silencio cambia lo
 * que debe sin que nadie lo decida, así que ahí decide el humano desde la UI.
 *
 * costo_final sigue siendo la única fuente de ingreso de la orden. Esta función
 * solo decide si se actualiza; la escritura la hace el route handler, y el
 * recálculo de estado_cobro lo cubre el trigger de la migración 277.
 */

/** Tolerancia de comparación: costo_final es DECIMAL(10,2). */
const EPSILON = 0.005

function aNumero(valor: number | string | null): number {
  if (valor === null || valor === undefined) return 0
  const n = typeof valor === "string" ? parseFloat(valor) : valor
  return Number.isFinite(n) ? n : 0
}

export function calcularCostoFinalSincronizado(input: {
  costoFinalActual: number | string | null
  totalCobrado: number | string | null
  sumaAnterior: number
  sumaNueva: number
}): { debeActualizar: boolean; nuevoCostoFinal: number | null } {
  const sinActualizar = { debeActualizar: false, nuevoCostoFinal: null }

  // Ya hay dinero cobrado: no se toca el total automáticamente.
  if (aNumero(input.totalCobrado) > 0) return sinActualizar

  const costoEstabaVacio = input.costoFinalActual === null || input.costoFinalActual === undefined
  const costoSeguiaALasLineas =
    !costoEstabaVacio &&
    Math.abs(aNumero(input.costoFinalActual) - input.sumaAnterior) < EPSILON

  // El costo fue editado a mano: no se pisa.
  if (!costoEstabaVacio && !costoSeguiaALasLineas) return sinActualizar

  // Se eliminó la última línea. NULL, no 0: significa "sin precio definido",
  // igual que hace reject-budget/route.ts:41. Además deja lista la rama de
  // autocompletado para el próximo alta.
  if (input.sumaNueva <= 0) {
    return { debeActualizar: true, nuevoCostoFinal: null }
  }

  return { debeActualizar: true, nuevoCostoFinal: Math.round(input.sumaNueva * 100) / 100 }
}
```

- [ ] **Step 4: Correr el test — debe pasar**

Run: `npm run test:run -- __tests__/lib/sincronizar-costo-final.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/servicios/sincronizar-costo-final.ts __tests__/lib/sincronizar-costo-final.test.ts
git commit -m "feat(servicios): regla de sincronizacion de costo_final"
```

---

### Task 4: API del catálogo — listado y alta

**Files:**
- Create: `app/api/servicios/route.ts`
- Test: `__tests__/api/servicios.test.ts`

**Interfaces:**
- Consumes: `Servicio` (Task 2).
- Produces: `GET /api/servicios` → `{ servicios: ServicioDTO[] }`; `POST /api/servicios` → `{ servicio: ServicioDTO }` con status 201.
  ```ts
  type ServicioDTO = {
    id: string; codigo: string; nombre: string
    descripcion: string | null; categoria: string | null
    precio: number; duracionEstimadaMin: number | null; activo: boolean
  }
  ```
  Consumido por las Tasks 7 y 8. La Task 6 NO usa esta API: consulta la tabla `servicios` directo, porque corre del lado del servidor.

- [ ] **Step 1: Escribir el test que falla**

Crear `__tests__/api/servicios.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createGetRequest,
  createPostRequest,
  parseResponse,
} from "./helpers"

import { GET, POST } from "@/app/api/servicios/route"

describe("GET /api/servicios", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ organizationId: "org-1", role: "ADMIN" })
  })

  it("devuelve los servicios de la organizacion", async () => {
    const chain = createChainMock([
      {
        id: "srv-1", codigo: "SRV-001", nombre: "Instalacion de Windows",
        descripcion: null, categoria: "Software", precio: 25000,
        duracion_estimada_min: 60, activo: true,
      },
    ])
    mockSupabaseFrom({ servicios: chain })

    const res = await GET(createGetRequest("http://localhost:3000/api/servicios"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.servicios).toHaveLength(1)
    expect(body.servicios[0].nombre).toBe("Instalacion de Windows")
    expect(body.servicios[0].precio).toBe(25000)
    expect(chain.eq).toHaveBeenCalledWith("organization_id", "org-1")
  })
})

describe("POST /api/servicios", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("crea un servicio", async () => {
    mockAuthSuccess({ organizationId: "org-1", role: "ADMIN" })
    const chain = createChainMock({
      id: "srv-1", codigo: "SRV-001", nombre: "Instalacion de Windows",
      descripcion: null, categoria: null, precio: 25000,
      duracion_estimada_min: null, activo: true,
    })
    mockSupabaseFrom({ servicios: chain })

    const res = await POST(
      createPostRequest({ codigo: "SRV-001", nombre: "Instalacion de Windows", precio: 25000 })
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(201)
    expect(body.servicio.id).toBe("srv-1")
    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ organization_id: "org-1" })
    )
  })

  it("rechaza precio negativo", async () => {
    mockAuthSuccess({ organizationId: "org-1", role: "ADMIN" })
    mockSupabaseFrom({ servicios: createChainMock(null) })

    const res = await POST(
      createPostRequest({ codigo: "SRV-001", nombre: "Test", precio: -1 })
    )
    const { status } = await parseResponse(res)

    expect(status).toBe(400)
  })

  it("devuelve 403 si el usuario no es ADMIN", async () => {
    mockAuthSuccess({ organizationId: "org-1", role: "TECNICO" })
    mockSupabaseFrom({ servicios: createChainMock(null) })

    const res = await POST(
      createPostRequest({ codigo: "SRV-001", nombre: "Test", precio: 100 })
    )
    const { status } = await parseResponse(res)

    expect(status).toBe(403)
  })

  it("traduce el codigo duplicado a un mensaje claro", async () => {
    mockAuthSuccess({ organizationId: "org-1", role: "ADMIN" })
    mockSupabaseFrom({
      servicios: createChainMock(null, { code: "23505", message: "duplicate key" }),
    })

    const res = await POST(
      createPostRequest({ codigo: "SRV-001", nombre: "Test", precio: 100 })
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body.error).toContain("código")
  })
})
```

- [ ] **Step 2: Correr el test — debe fallar**

Run: `npm run test:run -- __tests__/api/servicios.test.ts`
Expected: FAIL, no resuelve `@/app/api/servicios/route`.

- [ ] **Step 3: Implementar el route**

Crear `app/api/servicios/route.ts`, siguiendo la estructura de `app/api/categorias-gasto/route.ts`:

```ts
import { NextResponse } from "next/server"
import { requireAuth, requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const servicioSchema = z.object({
  codigo: z.string().min(1, "El código es requerido").max(40),
  nombre: z.string().min(1, "El nombre es requerido").max(120),
  descripcion: z.string().max(500).nullable().optional(),
  categoria: z.string().max(80).nullable().optional(),
  precio: z.number().min(0, "El precio no puede ser negativo"),
  duracionEstimadaMin: z.number().int().positive().nullable().optional(),
  activo: z.boolean().default(true),
})

function toDTO(s: any) {
  return {
    id: s.id,
    codigo: s.codigo,
    nombre: s.nombre,
    descripcion: s.descripcion,
    categoria: s.categoria,
    precio: Number(s.precio),
    duracionEstimadaMin: s.duracion_estimada_min,
    activo: s.activo,
  }
}

// GET - Lista los servicios del catálogo de la organización.
// requireAuth (no requireAdmin): un técnico necesita leer el catálogo para
// asignar servicios a su orden, aunque no pueda administrarlo.
export async function GET(request: Request) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { searchParams } = new URL(request.url)
    const incluirInactivos = searchParams.get("incluirInactivos") === "true"
    const buscar = searchParams.get("buscar")?.trim()

    let query = supabaseAdmin
      .from("servicios")
      .select("*")
      .eq("organization_id", organizationId!)
      .is("deleted_at", null)
      .order("nombre", { ascending: true })

    if (!incluirInactivos) query = query.eq("activo", true)
    if (buscar) query = query.ilike("nombre", `%${buscar}%`)

    const { data, error: dbError } = await query

    if (dbError) {
      console.error("Error fetching servicios:", dbError)
      return NextResponse.json({ error: "Error al obtener servicios" }, { status: 500 })
    }

    return NextResponse.json({ servicios: (data || []).map(toDTO) })
  } catch (err) {
    console.error("Error fetching servicios:", err)
    return NextResponse.json({ error: "Error al obtener servicios" }, { status: 500 })
  }
}

// POST - Alta en el catálogo. Solo ADMIN: los precios son decisión comercial.
export async function POST(request: Request) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const body = await request.json()
    const parsed = servicioSchema.parse(body)

    const { data, error: insertError } = await supabaseAdmin
      .from("servicios")
      .insert({
        organization_id: organizationId!,
        codigo: parsed.codigo,
        nombre: parsed.nombre,
        descripcion: parsed.descripcion || null,
        categoria: parsed.categoria || null,
        precio: parsed.precio,
        duracion_estimada_min: parsed.duracionEstimadaMin || null,
        activo: parsed.activo,
      })
      .select("*")
      .single()

    if (insertError) {
      if (insertError.code === "23505") {
        return NextResponse.json(
          { error: "Ya existe un servicio con ese código" },
          { status: 400 }
        )
      }
      console.error("Error creating servicio:", insertError)
      return NextResponse.json({ error: "Error al crear el servicio" }, { status: 500 })
    }

    return NextResponse.json({ servicio: toDTO(data) }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error creating servicio:", err)
    return NextResponse.json({ error: "Error al crear el servicio" }, { status: 500 })
  }
}
```

- [ ] **Step 4: Correr el test — debe pasar**

Run: `npm run test:run -- __tests__/api/servicios.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add app/api/servicios/route.ts __tests__/api/servicios.test.ts
git commit -m "feat(servicios): API de listado y alta del catalogo"
```

---

### Task 5: API del catálogo — edición y baja

**Files:**
- Create: `app/api/servicios/[id]/route.ts`
- Test: `__tests__/api/servicios-id.test.ts`

**Interfaces:**
- Consumes: `toDTO` se reimplementa local (no se exporta desde el route de la Task 4 para no acoplar handlers).
- Produces: `PUT /api/servicios/[id]` → `{ servicio: ServicioDTO }`; `DELETE /api/servicios/[id]` → `{ ok: true }`.

- [ ] **Step 1: Escribir el test que falla**

Crear `__tests__/api/servicios-id.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createPostRequest,
  parseResponse,
} from "./helpers"

import { PUT, DELETE } from "@/app/api/servicios/[id]/route"

function params(id: string) {
  return { params: Promise.resolve({ id }) }
}

describe("PUT /api/servicios/[id]", () => {
  beforeEach(() => vi.clearAllMocks())

  it("actualiza el precio", async () => {
    mockAuthSuccess({ organizationId: "org-1", role: "ADMIN" })
    const chain = createChainMock({
      id: "srv-1", codigo: "SRV-001", nombre: "Instalacion de Windows",
      descripcion: null, categoria: null, precio: 30000,
      duracion_estimada_min: null, activo: true,
    })
    mockSupabaseFrom({ servicios: chain })

    const req = new Request("http://localhost:3000/api/servicios/srv-1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ precio: 30000 }),
    })

    const { status, body } = await parseResponse(await PUT(req, params("srv-1")))

    expect(status).toBe(200)
    expect(body.servicio.precio).toBe(30000)
    expect(chain.eq).toHaveBeenCalledWith("organization_id", "org-1")
  })

  it("devuelve 403 si el usuario no es ADMIN", async () => {
    mockAuthSuccess({ organizationId: "org-1", role: "VENDEDOR" })
    mockSupabaseFrom({ servicios: createChainMock(null) })

    const req = new Request("http://localhost:3000/api/servicios/srv-1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ precio: 1 }),
    })

    const { status } = await parseResponse(await PUT(req, params("srv-1")))
    expect(status).toBe(403)
  })

  it("devuelve 404 si el servicio no existe", async () => {
    mockAuthSuccess({ organizationId: "org-1", role: "ADMIN" })
    mockSupabaseFrom({
      servicios: createChainMock(null, { code: "PGRST116", message: "no rows returned" }),
    })

    const req = new Request("http://localhost:3000/api/servicios/srv-1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ precio: 1 }),
    })

    const { status } = await parseResponse(await PUT(req, params("srv-1")))
    expect(status).toBe(404)
  })
})

describe("DELETE /api/servicios/[id]", () => {
  beforeEach(() => vi.clearAllMocks())

  it("hace soft delete y no borra la fila", async () => {
    mockAuthSuccess({ organizationId: "org-1", role: "ADMIN" })
    const chain = createChainMock({ id: "srv-1" })
    mockSupabaseFrom({ servicios: chain })

    const req = new Request("http://localhost:3000/api/servicios/srv-1", { method: "DELETE" })
    const { status } = await parseResponse(await DELETE(req, params("srv-1")))

    expect(status).toBe(200)
    expect(chain.update).toHaveBeenCalled()
    expect(chain.delete).not.toHaveBeenCalled()
    expect(chain.eq).toHaveBeenCalledWith("organization_id", "org-1")
  })
})
```

- [ ] **Step 2: Correr el test — debe fallar**

Run: `npm run test:run -- __tests__/api/servicios-id.test.ts`
Expected: FAIL, no resuelve el módulo.

- [ ] **Step 3: Implementar**

Crear `app/api/servicios/[id]/route.ts`:

```ts
import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const updateSchema = z.object({
  codigo: z.string().min(1).max(40).optional(),
  nombre: z.string().min(1).max(120).optional(),
  descripcion: z.string().max(500).nullable().optional(),
  categoria: z.string().max(80).nullable().optional(),
  precio: z.number().min(0, "El precio no puede ser negativo").optional(),
  duracionEstimadaMin: z.number().int().positive().nullable().optional(),
  activo: z.boolean().optional(),
})

function toDTO(s: any) {
  return {
    id: s.id,
    codigo: s.codigo,
    nombre: s.nombre,
    descripcion: s.descripcion,
    categoria: s.categoria,
    precio: Number(s.precio),
    duracionEstimadaMin: s.duracion_estimada_min,
    activo: s.activo,
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { id } = await params
    const parsed = updateSchema.parse(await request.json())

    const updateData: Record<string, any> = {}
    if (parsed.codigo !== undefined) updateData.codigo = parsed.codigo
    if (parsed.nombre !== undefined) updateData.nombre = parsed.nombre
    if (parsed.descripcion !== undefined) updateData.descripcion = parsed.descripcion
    if (parsed.categoria !== undefined) updateData.categoria = parsed.categoria
    if (parsed.precio !== undefined) updateData.precio = parsed.precio
    if (parsed.duracionEstimadaMin !== undefined) {
      updateData.duracion_estimada_min = parsed.duracionEstimadaMin
    }
    if (parsed.activo !== undefined) updateData.activo = parsed.activo

    const { data, error: dbError } = await supabaseAdmin
      .from("servicios")
      .update(updateData)
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .is("deleted_at", null)
      .select("*")
      .single()

    if (dbError) {
      if (dbError.code === "23505") {
        return NextResponse.json(
          { error: "Ya existe un servicio con ese código" },
          { status: 400 }
        )
      }
      if (dbError.code === "PGRST116") {
        return NextResponse.json(
          { error: "Servicio no encontrado" },
          { status: 404 }
        )
      }
      console.error("Error updating servicio:", dbError)
      return NextResponse.json({ error: "Error al actualizar el servicio" }, { status: 500 })
    }

    // Defensivo: con .single() supabase-js siempre setea error.code = PGRST116
    // en cero filas, así que esta rama no debería alcanzarse. Se mantiene
    // como guarda de segundo nivel, no como el único camino a 404.
    if (!data) {
      return NextResponse.json({ error: "Servicio no encontrado" }, { status: 404 })
    }

    return NextResponse.json({ servicio: toDTO(data) })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error updating servicio:", err)
    return NextResponse.json({ error: "Error al actualizar el servicio" }, { status: 500 })
  }
}

// DELETE - Soft delete. Las líneas ya asignadas a órdenes conservan su snapshot
// de nombre y precio; servicios_orden.servicio_id queda en NULL solo si la fila
// se borrara de verdad, cosa que acá no pasa.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { id } = await params

    const { error: dbError } = await supabaseAdmin
      .from("servicios")
      .update({ deleted_at: new Date().toISOString(), activo: false })
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .select("id")
      .single()

    if (dbError) {
      if (dbError.code === "PGRST116") {
        return NextResponse.json(
          { error: "Servicio no encontrado" },
          { status: 404 }
        )
      }
      console.error("Error deleting servicio:", dbError)
      return NextResponse.json({ error: "Error al eliminar el servicio" }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("Error deleting servicio:", err)
    return NextResponse.json({ error: "Error al eliminar el servicio" }, { status: 500 })
  }
}
```

- [ ] **Step 4: Correr el test — debe pasar**

Run: `npm run test:run -- __tests__/api/servicios-id.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add "app/api/servicios/[id]/route.ts" __tests__/api/servicios-id.test.ts
git commit -m "feat(servicios): API de edicion y baja del catalogo"
```

---

### Task 6: API de líneas de servicio en una orden

**Files:**
- Create: `app/api/ordenes/[id]/servicios/route.ts`
- Test: `__tests__/api/orden-servicios.test.ts`

**Interfaces:**
- Consumes: `calcularCostoFinalSincronizado` (Task 3).
- Produces: `POST /api/ordenes/[id]/servicios` → `{ servicio: LineaDTO, costoFinalActualizado: boolean, sumaServicios: number }`; `DELETE /api/ordenes/[id]/servicios?servicioOrdenId=<id>` → misma forma sin `servicio`.
  ```ts
  type LineaDTO = {
    id: string; servicioId: string | null; nombre: string
    cantidad: number; precioUnitario: number
  }
  ```
  Consumido por la Task 8.

- [ ] **Step 1: Escribir el test que falla**

Crear `__tests__/api/orden-servicios.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createPostRequest,
  parseResponse,
} from "./helpers"

import { POST } from "@/app/api/ordenes/[id]/servicios/route"

function params(id: string) {
  return { params: Promise.resolve({ id }) }
}

describe("POST /api/ordenes/[id]/servicios", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ organizationId: "org-1", role: "TECNICO" })
  })

  it("agrega una linea ad-hoc y autocompleta costo_final", async () => {
    const ordenChain = createChainMock({
      id: "ord-1", costo_final: null, total_cobrado: 0, organization_id: "org-1",
    })
    const lineasChain = createChainMock([])
    const insertChain = createChainMock({
      id: "lin-1", servicio_id: null, nombre: "Instalacion de Windows",
      cantidad: 1, precio_unitario: 25000,
    })

    let llamadasAServiciosOrden = 0
    vi.mocked(
      (await import("@/lib/supabase")).supabaseAdmin.from
    ).mockImplementation((tabla: string) => {
      if (tabla === "ordenes_servicio") return ordenChain as any
      if (tabla === "servicios_orden") {
        llamadasAServiciosOrden += 1
        return (llamadasAServiciosOrden === 1 ? lineasChain : insertChain) as any
      }
      return createChainMock(null) as any
    })

    const res = await POST(
      createPostRequest({ tipo: "manual", nombre: "Instalacion de Windows", cantidad: 1, precioUnitario: 25000 }),
      params("ord-1")
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(201)
    expect(body.costoFinalActualizado).toBe(true)
    expect(body.sumaServicios).toBe(25000)
    expect(ordenChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ costo_final: 25000 })
    )
  })

  it("no toca costo_final si la orden ya tiene cobros", async () => {
    const ordenChain = createChainMock({
      id: "ord-1", costo_final: 20000, total_cobrado: 10000, organization_id: "org-1",
    })
    const lineasChain = createChainMock([])
    const insertChain = createChainMock({
      id: "lin-1", servicio_id: null, nombre: "Extra", cantidad: 1, precio_unitario: 5000,
    })

    let n = 0
    vi.mocked(
      (await import("@/lib/supabase")).supabaseAdmin.from
    ).mockImplementation((tabla: string) => {
      if (tabla === "ordenes_servicio") return ordenChain as any
      if (tabla === "servicios_orden") { n += 1; return (n === 1 ? lineasChain : insertChain) as any }
      return createChainMock(null) as any
    })

    const res = await POST(
      createPostRequest({ tipo: "manual", nombre: "Extra", cantidad: 1, precioUnitario: 5000 }),
      params("ord-1")
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(201)
    expect(body.costoFinalActualizado).toBe(false)
    expect(ordenChain.update).not.toHaveBeenCalled()
  })

  it("devuelve 404 si la orden es de otra organizacion", async () => {
    mockSupabaseFrom({
      ordenes_servicio: createChainMock(null, { message: "not found" }),
    })

    const res = await POST(
      createPostRequest({ tipo: "manual", nombre: "X", cantidad: 1, precioUnitario: 1 }),
      params("ord-ajena")
    )
    const { status } = await parseResponse(res)

    expect(status).toBe(404)
  })

  it("rechaza cantidad cero", async () => {
    mockSupabaseFrom({
      ordenes_servicio: createChainMock({
        id: "ord-1", costo_final: null, total_cobrado: 0, organization_id: "org-1",
      }),
    })

    const res = await POST(
      createPostRequest({ tipo: "manual", nombre: "X", cantidad: 0, precioUnitario: 100 }),
      params("ord-1")
    )
    const { status } = await parseResponse(res)

    expect(status).toBe(400)
  })
})
```

- [ ] **Step 2: Correr el test — debe fallar**

Run: `npm run test:run -- __tests__/api/orden-servicios.test.ts`
Expected: FAIL, no resuelve el módulo.

- [ ] **Step 3: Implementar**

Crear `app/api/ordenes/[id]/servicios/route.ts`:

```ts
import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { calcularCostoFinalSincronizado } from "@/lib/servicios/sincronizar-costo-final"
import { z } from "zod"

const lineaSchema = z.discriminatedUnion("tipo", [
  z.object({
    tipo: z.literal("catalogo"),
    servicioId: z.string().min(1),
    cantidad: z.number().int().positive("La cantidad debe ser mayor a cero"),
    precioUnitario: z.number().min(0).optional(),
  }),
  z.object({
    tipo: z.literal("manual"),
    nombre: z.string().min(1, "El nombre es requerido").max(120),
    cantidad: z.number().int().positive("La cantidad debe ser mayor a cero"),
    precioUnitario: z.number().min(0, "El precio no puede ser negativo"),
    guardarEnCatalogo: z.boolean().default(false),
  }),
])

function lineaDTO(l: any) {
  return {
    id: l.id,
    servicioId: l.servicio_id,
    nombre: l.nombre,
    cantidad: l.cantidad,
    precioUnitario: Number(l.precio_unitario),
  }
}

function sumar(lineas: any[]): number {
  const total = (lineas || []).reduce(
    (acc, l) => acc + Number(l.cantidad) * Number(l.precio_unitario),
    0
  )
  return Math.round(total * 100) / 100
}

/**
 * Aplica la regla de sincronización y persiste costo_final si corresponde.
 * El recálculo de estado_cobro lo hace el trigger de la migración 277.
 */
async function sincronizarCostoFinal(orden: any, sumaAnterior: number, sumaNueva: number) {
  const decision = calcularCostoFinalSincronizado({
    costoFinalActual: orden.costo_final,
    totalCobrado: orden.total_cobrado,
    sumaAnterior,
    sumaNueva,
  })

  if (!decision.debeActualizar) return false

  const { error } = await supabaseAdmin
    .from("ordenes_servicio")
    .update({ costo_final: decision.nuevoCostoFinal })
    .eq("id", orden.id)

  if (error) {
    console.error("Error sincronizando costo_final:", error)
    return false
  }
  return true
}

async function cargarOrden(ordenId: string, organizationId: string) {
  const { data } = await supabaseAdmin
    .from("ordenes_servicio")
    .select("id, costo_final, total_cobrado, organization_id")
    .eq("id", ordenId)
    .eq("organization_id", organizationId)
    .single()
  return data
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { id: ordenId } = await params
    const parsed = lineaSchema.parse(await request.json())

    const orden = await cargarOrden(ordenId, organizationId!)
    if (!orden) {
      return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 })
    }

    // Snapshot de nombre y precio. Si viene del catálogo, se leen de ahí, pero
    // el precio enviado gana: el catálogo es un default, no una atadura.
    let nombre: string
    let precioUnitario: number
    let servicioId: string | null = null

    if (parsed.tipo === "catalogo") {
      const { data: servicio } = await supabaseAdmin
        .from("servicios")
        .select("id, nombre, precio")
        .eq("id", parsed.servicioId)
        .eq("organization_id", organizationId!)
        .is("deleted_at", null)
        .single()

      if (!servicio) {
        return NextResponse.json({ error: "Servicio no encontrado" }, { status: 404 })
      }

      servicioId = servicio.id
      nombre = servicio.nombre
      precioUnitario = parsed.precioUnitario ?? Number(servicio.precio)
    } else {
      nombre = parsed.nombre
      precioUnitario = parsed.precioUnitario
    }

    const { data: lineasPrevias } = await supabaseAdmin
      .from("servicios_orden")
      .select("cantidad, precio_unitario")
      .eq("orden_id", ordenId)

    const sumaAnterior = sumar(lineasPrevias || [])

    const { data: nueva, error: insertError } = await supabaseAdmin
      .from("servicios_orden")
      .insert({
        orden_id: ordenId,
        servicio_id: servicioId,
        nombre,
        cantidad: parsed.cantidad,
        precio_unitario: precioUnitario,
      })
      .select("*")
      .single()

    if (insertError || !nueva) {
      console.error("Error creating servicio_orden:", insertError)
      return NextResponse.json({ error: "Error al agregar el servicio" }, { status: 500 })
    }

    const sumaNueva = Math.round((sumaAnterior + parsed.cantidad * precioUnitario) * 100) / 100
    const costoFinalActualizado = await sincronizarCostoFinal(orden, sumaAnterior, sumaNueva)

    // Alta oportunista en el catálogo: permite construirlo trabajando, sin
    // configuración previa. Un fallo acá no invalida la línea ya creada.
    if (parsed.tipo === "manual" && parsed.guardarEnCatalogo) {
      const { error: catalogoError } = await supabaseAdmin.from("servicios").insert({
        organization_id: organizationId!,
        codigo: `SRV-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        nombre,
        precio: precioUnitario,
      })
      if (catalogoError) console.error("Error guardando en catalogo:", catalogoError)
    }

    return NextResponse.json(
      { servicio: lineaDTO(nueva), costoFinalActualizado, sumaServicios: sumaNueva },
      { status: 201 }
    )
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error adding servicio a orden:", err)
    return NextResponse.json({ error: "Error al agregar el servicio" }, { status: 500 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { id: ordenId } = await params
    const servicioOrdenId = new URL(request.url).searchParams.get("servicioOrdenId")

    if (!servicioOrdenId) {
      return NextResponse.json({ error: "Falta servicioOrdenId" }, { status: 400 })
    }

    const orden = await cargarOrden(ordenId, organizationId!)
    if (!orden) {
      return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 })
    }

    const { data: lineasPrevias } = await supabaseAdmin
      .from("servicios_orden")
      .select("id, cantidad, precio_unitario")
      .eq("orden_id", ordenId)

    const sumaAnterior = sumar(lineasPrevias || [])
    const eliminada = (lineasPrevias || []).find((l: any) => l.id === servicioOrdenId)

    if (!eliminada) {
      return NextResponse.json({ error: "Servicio no encontrado en la orden" }, { status: 404 })
    }

    const { error: deleteError } = await supabaseAdmin
      .from("servicios_orden")
      .delete()
      .eq("id", servicioOrdenId)
      .eq("orden_id", ordenId)

    if (deleteError) {
      console.error("Error deleting servicio_orden:", deleteError)
      return NextResponse.json({ error: "Error al eliminar el servicio" }, { status: 500 })
    }

    const sumaNueva = Math.round(
      (sumaAnterior - Number(eliminada.cantidad) * Number(eliminada.precio_unitario)) * 100
    ) / 100
    const costoFinalActualizado = await sincronizarCostoFinal(orden, sumaAnterior, sumaNueva)

    return NextResponse.json({ costoFinalActualizado, sumaServicios: sumaNueva })
  } catch (err) {
    console.error("Error deleting servicio de orden:", err)
    return NextResponse.json({ error: "Error al eliminar el servicio" }, { status: 500 })
  }
}
```

- [ ] **Step 4: Correr el test — debe pasar**

Run: `npm run test:run -- __tests__/api/orden-servicios.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add "app/api/ordenes/[id]/servicios/route.ts" __tests__/api/orden-servicios.test.ts
git commit -m "feat(servicios): API de lineas de servicio en ordenes"
```

---

### Task 7: Pantalla del catálogo y entrada de menú

**Files:**
- Create: `app/(dashboard)/servicios/page.tsx`
- Create: `components/servicios/servicios-client.tsx`
- Modify: `components/layout/navbar.tsx`

**Interfaces:**
- Consumes: `GET/POST /api/servicios` (Task 4), `PUT/DELETE /api/servicios/[id]` (Task 5).

- [ ] **Step 1: Crear el client component**

Crear `components/servicios/servicios-client.tsx`: listado con búsqueda por nombre, botón "Nuevo servicio", formulario inline (código, nombre, descripción, categoría, precio, duración estimada, activo), edición y baja con confirmación.

Reutilizar los patrones de la app: `Button`, `Card`, `Input`, `Label` de `@/components/ui/*`, `useCurrency()` de `@/contexts/currency-context` para `formatPrice`, y `useModal()` de `@/contexts/modal-context` para `confirm` y `alert` — igual que `components/ordenes/orden-repuestos-tab.tsx:10-11`.

Estados de la pantalla que deben existir: cargando, vacío ("Todavía no cargaste ningún servicio"), listado, y error de alta o edición mostrado con `alert`.

- [ ] **Step 2: Crear la página**

Crear `app/(dashboard)/servicios/page.tsx` como server component que monte `ServiciosClient`, siguiendo el patrón de las otras páginas del grupo `(dashboard)`.

- [ ] **Step 3: Agregar la entrada de menú**

En `components/layout/navbar.tsx`, agregar el import del ícono `Wrench` si no está ya, y la entrada en **dos** lugares:

En el array plano `navItems`, después de la línea de `/inventario` (`navbar.tsx:80`):

```ts
  { href: "/servicios", label: "Servicios", icon: Wrench, roles: ["ADMIN"] },
```

Y en `navSections`, en el grupo principal (`label: ""`), después de la entrada de `/inventario` (`navbar.tsx:101`):

```ts
      { href: "/servicios", label: "Servicios", icon: Wrench, roles: ["ADMIN"] },
```

Va en el grupo principal y no en "Más": son los dos catálogos de lo que el taller vende, productos y servicios. Enterrarlo en el colapsable lo vuelve invisible.

Nota: `Wrench` ya se usa para `/tecnicos` (`navbar.tsx:125`). Si repetir el ícono confunde, usar `Sparkles` o `Hammer` de `lucide-react`.

- [ ] **Step 4: Verificar en el navegador**

Run: `npm run dev`

Verificar: `/servicios` carga; se puede crear "Instalación de Windows" con precio 25000; aparece en el listado con el precio formateado; se puede editar el precio; se puede eliminar y desaparece del listado.

- [ ] **Step 5: Commit**

```bash
git add "app/(dashboard)/servicios/page.tsx" components/servicios/servicios-client.tsx components/layout/navbar.tsx
git commit -m "feat(servicios): pantalla de catalogo y entrada de menu"
```

---

### Task 8: Tab de servicios en el detalle de orden

**Files:**
- Create: `components/ordenes/orden-servicios-tab.tsx`
- Modify: `components/ordenes/orden-detail.tsx`

**Interfaces:**
- Consumes: `POST/DELETE /api/ordenes/[id]/servicios` (Task 6), `GET /api/servicios` (Task 4).

- [ ] **Step 1: Crear el componente**

Crear `components/ordenes/orden-servicios-tab.tsx`, espejando la estructura de `components/ordenes/orden-repuestos-tab.tsx` con estas diferencias:

- El alternador dice **"Del catálogo"** / **"Manual"** (no "Del inventario").
- Al elegir un servicio del catálogo, el input de precio se **precarga** con `servicio.precio` y queda **editable**. El valor editado es el que se envía como `precioUnitario`.
- El label del input de precio dice **"Precio"**, no "Costo unitario". Es ingreso, no costo.
- En el modo manual, un checkbox **"Guardar en Servicios"** que envía `guardarEnCatalogo: true`.
- El pie muestra **"Subtotal Servicios"**.
- Si la respuesta trae `costoFinalActualizado: false` y `sumaServicios` difiere del `costo_final` de la orden, mostrar un aviso con un botón **"Aplicar al total"** que hace `PUT /api/ordenes/[id]` con `{ costoFinal: sumaServicios }`.

Igual que en la tab de repuestos, esperar el refetch del padre antes de cerrar el formulario y reactivar los controles (ver el comentario en `orden-repuestos-tab.tsx:25-29`): cerrar antes provoca un parpadeo de "sin servicios" que invita a reintentar y duplicar el alta.

- [ ] **Step 2: Montar la tab en el detalle**

En `components/ordenes/orden-detail.tsx`, agregar la tab "Servicios" junto a la de repuestos, pasando `ordenId`, las líneas de `servicios_orden` y el callback de refetch.

Actualizar la consulta que carga la orden para que traiga también `servicios_orden (*)`, del mismo modo que ya trae `repuestos_orden`.

- [ ] **Step 3: Verificar en el navegador**

Run: `npm run dev`

Verificar sobre una orden sin cobros:
1. Agregar "Instalación de Windows" del catálogo → el precio se precarga en 25000 y el costo final de la orden pasa a 25000.
2. Agregar un segundo servicio de 8000 → el costo final pasa a 33000.
3. Editar el costo final a mano a 30000 y agregar un tercer servicio → el costo final **no** cambia y aparece el botón "Aplicar al total".
4. Eliminar todas las líneas → el costo final queda vacío.

Y sobre una orden con un cobro registrado: agregar un servicio → el costo final **no** cambia y aparece el aviso.

- [ ] **Step 4: Correr toda la suite**

Run: `npm run test:run`
Expected: PASS, sin regresiones.

- [ ] **Step 5: Commit**

```bash
git add components/ordenes/orden-servicios-tab.tsx components/ordenes/orden-detail.tsx
git commit -m "feat(servicios): tab de servicios en el detalle de orden"
```

---

## Definition of Done

- [ ] Migración 279 aplicada; los dos probes de la Task 1 dan el resultado esperado.
- [ ] `npm run test:run` en verde, con los 20 tests nuevos (8 de sincronización, 5 + 3 de catálogo, 4 de líneas de orden).
- [ ] `npx tsc --noEmit` sin errores.
- [ ] Los cuatro escenarios manuales de la Task 8 Step 3 verificados en el navegador.
- [ ] Un servicio cargado en una orden **suma** a la ganancia de `v_comisiones_ordenes`; un repuesto la **resta**. Verificar en la card de comisión de una orden que tenga los dos.
- [ ] Una orden que quedó sin líneas de servicio (y por lo tanto con `costo_final` en `NULL`) no puede pasar a REPARADO. Es el comportamiento vigente de `CAMPOS_REQUERIDOS_POR_ESTADO.REPARADO` (`lib/orden-state-machine.ts:81`), acá solo se confirma que la sincronización no lo rompe.
- [ ] Ninguna columna de costo en `servicios` ni en `servicios_orden`.

## Deuda conocida de este plan

Los Steps 1 de las Tasks 7 y 8 describen los componentes de React en prosa en vez de traer el código completo. Es una desviación deliberada: `components/ordenes/orden-repuestos-tab.tsx` es un template casi idéntico (347 líneas) y transcribirlo con variaciones duplicaría el largo del plan sin agregar información que el implementador no pueda leer del original. Si se ejecuta con subagentes, conviene que esas dos tasks reciban el archivo de referencia explícitamente en el prompt.
