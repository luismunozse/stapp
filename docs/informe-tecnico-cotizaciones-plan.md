# Informe técnico para seguros — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que una cotización se emita sin ítems como informe técnico para una aseguradora, con veredicto, diagnóstico, causa del daño y entidad destinataria.

**Architecture:** El informe no es una entidad nueva: es una cotización con cero ítems y un veredicto que no admite presupuesto. Cuatro columnas nuevas en `cotizaciones`, una función pura de validación compartida entre POST y PUT, una variante de layout en el PDF existente, y dos ajustes de UI. No se agrega ningún estado ni ningún `tipo`.

**Tech Stack:** Next.js (App Router), TypeScript, Zod, Supabase (PostgREST + `supabaseAdmin` service role), pdf-lib, Vitest.

**Spec:** `docs/informe-tecnico-cotizaciones.md`

## Global Constraints

- **Worktree:** todo el trabajo va en `C:\Users\LUIS\Desktop\stapp\.worktrees\informe-tecnico`, rama `feat/informe-tecnico-cotizaciones`. No trabajar en el clon principal: otros agentes hacen `checkout` sobre él.
- **Migración:** el número es **324**. El **322 ya está tomado** por `feat/tecnicos-cobran-cotizaciones` (rama sin mergear). Reverificar antes de abrir el PR con el comando de §3 del spec.
- **Aplicar la migración ANTES de mergear.** Si el código llega a producción sin la columna, PostgREST devuelve `PGRST204` y el fallo es **mudo**: el deploy queda verde y las escrituras se pierden en silencio.
- **Migraciones a mano:** no hay Supabase CLI ni CI de migraciones. Se corre `node scripts/db-run.mjs <archivo>`, un archivo por vez, dry-run por default.
- **Idempotencia SQL:** `ADD COLUMN IF NOT EXISTS` para columnas; los `CHECK` con nombre van envueltos en `DO $$ ... END $$` con guarda sobre `pg_constraint`, porque `ADD CONSTRAINT` no tiene `IF NOT EXISTS` en Postgres.
- **Tests:** Vitest. `npm run test:run` corre todo; `npx vitest run <archivo>` corre uno. El entorno global es `jsdom`; los tests que necesitan Node puro llevan `// @vitest-environment node` en la primera línea.
- **Idioma de los artefactos:** el repo escribe comentarios, mensajes de commit y copy de UI en español. Los comentarios de migración van en español **sin acentos** (convención vigente en `supabase/migrations/`). El copy de UI sí lleva acentos.
- **Mensajes de error:** las rutas de cotizaciones hacen `.parse` y devuelven **solo `error.errors[0].message`** con status 400. Cada mensaje de validación es literalmente lo que ve el taller: redactarlo como instrucción, no como código de error.
- **Commits:** conventional commits, sin atribución de IA.
- **Verificación antes de decir "listo":** `npx tsc --noEmit` además de los tests. El lint no chequea tipos y la suite verde ha convivido con errores de `tsc` que rompían `next build`.
- **`npm run lint` no termina:** recorre los ~17 worktrees. Usar `npx eslint app lib components` con directorios explícitos.
- **Nunca escribir `rg "patrón"` sin ruta.** Un `rg` desnudo camina `.` y choca con la regla `deny` sobre `.env`, forzando un prompt de permisos. Pasar rutas explícitas (`rg -n "patrón" app lib`) o `-` para stdin.

---

## File Structure

| Archivo | Responsabilidad | Acción |
|---|---|---|
| `supabase/migrations/324_informe_tecnico_cotizacion.sql` | Cuatro columnas + dos CHECK + índice del autocompletado | Crear |
| `supabase/migrations/rollback/324_rollback.sql` | Deshacer lo anterior | Crear |
| `lib/cotizacion-informe.ts` | Vocabulario del dominio (veredictos, causas) y la regla de validación como función pura | Crear |
| `__tests__/lib/cotizacion-informe.test.ts` | Tests unitarios de la regla | Crear |
| `app/api/cotizaciones/route.ts` | POST: schema + refine + insert | Modificar |
| `app/api/cotizaciones/[id]/route.ts` | PUT: schema + validación post-merge + update + saltear transición | Modificar |
| `app/api/cotizaciones/[id]/enviar/route.ts` | Saltear la transición de orden | Modificar |
| `app/api/cotizaciones/entidades/route.ts` | Autocompletado de `presentado_ante` | Crear |
| `lib/cotizacion-pdf.ts` | Propagar los cuatro campos a los cuatro call sites del PDF | Modificar |
| `lib/pdf.ts` | Título, bloque de dictamen, salteo de la tabla de ítems | Modificar |
| `components/cotizaciones/cotizacion-form.tsx` | Sección "Informe técnico" | Modificar |
| `components/cotizaciones/cotizacion-publica.tsx` | Ocultar aprobar/rechazar/firma | Modificar |
| `components/cotizaciones/item-row.tsx` | Invertir el default del selector | Modificar |

**Por qué `lib/cotizacion-informe.ts` existe.** Los schemas de Zod de cotizaciones están **duplicados** hoy entre `app/api/cotizaciones/route.ts:13-71` y `app/api/cotizaciones/[id]/route.ts:30-88`, y ya divergieron (el `itemSchema` del PUT tiene un `id` que el del POST no tiene; los mensajes de `equipoSchema` difieren entre los dos). Meter la regla nueva dos veces la condena a divergir igual. El módulo compartido es la única forma de que POST y PUT no se separen.

---

## PR 1 — Dominio

Este PR no cambia nada visible. Las columnas quedan escritas, la regla validando y el PDF sabiendo dibujar el informe, pero ningún formulario expone los campos todavía. Eso permite mergear y aplicar la migración sin coordinar con los talleres.

---

### Task 0: Preparar el worktree

**Files:**
- Ninguno (setup)

- [ ] **Step 1: Instalar dependencias en el worktree**

El worktree es nuevo y no tiene `node_modules` (los worktrees de git no comparten archivos ignorados). El `node_modules` del clon principal está roto (~105 paquetes, sin vitest) — no copiarlo ni linkearlo.

```bash
cd C:/Users/LUIS/Desktop/stapp/.worktrees/informe-tecnico
npm ci
```

- [ ] **Step 2: Verificar que la suite corre**

```bash
npx vitest run __tests__/lib/cotizacion-presupuesto.test.ts
```

Esperado: PASS. Si falla por dependencias faltantes, `npm ci` no terminó bien — repetirlo antes de seguir.

---

### Task 1: Migración 324 y su rollback

**Files:**
- Create: `supabase/migrations/324_informe_tecnico_cotizacion.sql`
- Create: `supabase/migrations/rollback/324_rollback.sql`

**Interfaces:**
- Consumes: nada
- Produces: columnas `cotizaciones.veredicto`, `cotizaciones.diagnostico_tecnico`, `cotizaciones.causa_dano`, `cotizaciones.presentado_ante` (todas `TEXT NULL`)

- [ ] **Step 1: Confirmar que el numero sigue libre**

```bash
cd C:/Users/LUIS/Desktop/stapp/.worktrees/informe-tecnico
git log --all --diff-filter=A --name-only --pretty=format: -- 'supabase/migrations/32*' | rg -v '^$' - | sort -u
```

Esperado: aparecen `321_email_delivery_tracking.sql` y `322_tecnicos_cobran_cotizaciones.sql`, y un 323 (`323_tecnicos_count_cambio_de_rol.sql`), pero **no** un 324. Si apareció un 324, usar el siguiente número libre y ajustar los dos nombres de archivo.

- [ ] **Step 2: Escribir la migración**

Crear `supabase/migrations/324_informe_tecnico_cotizacion.sql`:

```sql
-- ============================================================================
-- 324: informe tecnico para aseguradoras sobre la cotizacion
-- ============================================================================
-- Contexto: los talleres que trabajan con seguros necesitan emitir un documento
-- que acredite que un tecnico reviso el equipo y dictamino si tiene reparacion.
-- Hasta ahora una cotizacion exigia al menos un item, asi que un equipo
-- irreparable no tenia documento posible y el flujo entero quedaba trabado.
--
-- POR QUE NO HAY TABLA NUEVA NI TIPO NUEVO
-- El informe es una cotizacion sin items, no otra entidad. Comparte numeracion,
-- cliente, orden, envio por mail, link publico y PDF: una tabla aparte
-- duplicaria las seis cosas. Y `tipo` (ORDEN|PRESUPUESTO, migracion 126)
-- responde otra pregunta -si el documento cuelga de una orden o vuela solo- que
-- es ortogonal al veredicto. Un informe irreparable puede ser cualquiera de los
-- dos, asi que meter 'INFORME' ahi mezclaria dos ejes.
--
-- POR QUE diagnostico_tecnico Y NO diagnostico
-- Ya existe un `diagnostico` adentro de equipo_snapshot->condiciones, pero se
-- guarda SOLO para tipo PRESUPUESTO: en una cotizacion colgada de una orden ese
-- JSONB es null. Son dos campos distintos y el nombre corto ya estaba tomado.
--
-- POR QUE LA REGLA "SIN ITEMS EXIGE VEREDICTO" NO ES UN CHECK
-- Depende del conteo de items_cotizacion, que es otra tabla. Expresarlo aca
-- pediria triggers en las dos puntas, con el riesgo de orden de operaciones
-- dentro de la misma transaccion. Se enforcea en la capa de API.
-- ============================================================================

ALTER TABLE cotizaciones
  ADD COLUMN IF NOT EXISTS veredicto TEXT,
  ADD COLUMN IF NOT EXISTS diagnostico_tecnico TEXT,
  ADD COLUMN IF NOT EXISTS causa_dano TEXT,
  ADD COLUMN IF NOT EXISTS presentado_ante TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cotizaciones_veredicto_check'
      AND conrelid = 'cotizaciones'::regclass
  ) THEN
    ALTER TABLE cotizaciones
      ADD CONSTRAINT cotizaciones_veredicto_check
      CHECK (veredicto IS NULL OR veredicto IN ('REPARABLE', 'IRREPARABLE', 'SIN_FALLA'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cotizaciones_causa_dano_check'
      AND conrelid = 'cotizaciones'::regclass
  ) THEN
    ALTER TABLE cotizaciones
      ADD CONSTRAINT cotizaciones_causa_dano_check
      CHECK (causa_dano IS NULL OR causa_dano IN
        ('CAIDA', 'LIQUIDO', 'SOBRETENSION', 'DESGASTE', 'USO_INDEBIDO', 'FALLA_FABRICA', 'DESCONOCIDA'));
  END IF;
END $$;

COMMENT ON COLUMN cotizaciones.veredicto IS
  'Dictamen del tecnico: REPARABLE | IRREPARABLE | SIN_FALLA. NULL en toda cotizacion anterior a esta migracion y en las que no lo cargan. Con cero items pasa a ser obligatorio, pero esa regla vive en la API y no aca.';

COMMENT ON COLUMN cotizaciones.diagnostico_tecnico IS
  'Diagnostico que se imprime en el informe. Es una copia CONGELADA: se precarga de ordenes_servicio.diagnostico al crear el documento y no se vuelve a sincronizar, porque un documento presentado ante una aseguradora no puede cambiar solo. Distinto de equipo_snapshot->condiciones->diagnostico, que es PRESUPUESTO-only.';

COMMENT ON COLUMN cotizaciones.causa_dano IS
  'Causa probable del dano. La aseguradora la usa para decidir si cubre.';

COMMENT ON COLUMN cotizaciones.presentado_ante IS
  'Entidad ante la cual se presenta el documento: aseguradora, ART, juzgado. Texto libre a proposito. El autocompletado sale de un DISTINCT por organizacion, no de una tabla de entidades.';

-- Alimenta el autocompletado de presentado_ante sin escanear la tabla entera.
CREATE INDEX IF NOT EXISTS cotizaciones_presentado_ante_idx
  ON cotizaciones (organization_id, presentado_ante)
  WHERE presentado_ante IS NOT NULL AND deleted_at IS NULL;
```

- [ ] **Step 3: Escribir el rollback**

Crear `supabase/migrations/rollback/324_rollback.sql`:

```sql
-- Rollback de la migracion 324.
--
-- Saca las cuatro columnas del informe tecnico. Se PIERDE el contenido de todo
-- informe ya emitido: veredicto, diagnostico, causa del dano y entidad
-- destinataria. Los PDFs que ya se enviaron siguen existiendo del lado del
-- cliente, pero la app no puede volver a dibujarlos.
--
-- Antes de correr esto, exportar:
--   SELECT id, numero_cotizacion, organization_id, veredicto,
--          diagnostico_tecnico, causa_dano, presentado_ante
--   FROM cotizaciones WHERE veredicto IS NOT NULL;
--
-- Ojo con las cotizaciones de cero items: no se borran -son documentos
-- emitidos- pero sin veredicto la UI las muestra como presupuestos vacios en
-- total cero. Anotar sus numeros antes de correr el rollback.
--
-- Los CHECK se van solos con las columnas; no hace falta DROP CONSTRAINT.

DROP INDEX IF EXISTS cotizaciones_presentado_ante_idx;

ALTER TABLE cotizaciones
  DROP COLUMN IF EXISTS veredicto,
  DROP COLUMN IF EXISTS diagnostico_tecnico,
  DROP COLUMN IF EXISTS causa_dano,
  DROP COLUMN IF EXISTS presentado_ante;
```

- [ ] **Step 4: Dry-run de la migración**

```bash
node scripts/db-run.mjs supabase/migrations/324_informe_tecnico_cotizacion.sql
```

Esperado: el script corre en dry-run por default e imprime el SQL sin aplicarlo. Verificar que no reporte error de parseo. **No aplicar todavía** — la aplicación real va justo antes de mergear (ver Task 10).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/324_informe_tecnico_cotizacion.sql supabase/migrations/rollback/324_rollback.sql
git commit -m "feat(cotizaciones): migracion 324 para el informe tecnico"
```

---

### Task 2: Módulo compartido de dominio y validación

**Files:**
- Create: `lib/cotizacion-informe.ts`
- Test: `__tests__/lib/cotizacion-informe.test.ts`

**Interfaces:**
- Consumes: `zod`
- Produces:
  - `VEREDICTOS: readonly ["REPARABLE","IRREPARABLE","SIN_FALLA"]`, tipo `Veredicto`
  - `CAUSAS_DANO: readonly [...7 strings]`, tipo `CausaDano`
  - `veredictoSchema: z.ZodEnum`, `causaDanoSchema: z.ZodEnum`
  - `interface DatosInforme { cantidadItems: number; veredicto?: string | null; diagnosticoTecnico?: string | null; causaDano?: string | null }`
  - `esInforme(datos: DatosInforme): boolean`
  - `validarInforme(datos: DatosInforme): string | null`

- [ ] **Step 1: Escribir el test que falla**

Crear `__tests__/lib/cotizacion-informe.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { validarInforme, esInforme } from "@/lib/cotizacion-informe"

const DICTAMEN_COMPLETO = {
  veredicto: "IRREPARABLE",
  diagnosticoTecnico: "Placa madre con corrosion por liquido, sin reparacion posible.",
  causaDano: "LIQUIDO",
}

describe("validarInforme", () => {
  it("acepta una cotizacion con items aunque no tenga veredicto", () => {
    expect(validarInforme({ cantidadItems: 3 })).toBeNull()
  })

  it("acepta una cotizacion con items y veredicto REPARABLE", () => {
    expect(
      validarInforme({ cantidadItems: 1, veredicto: "REPARABLE", diagnosticoTecnico: "Pantalla rota" })
    ).toBeNull()
  })

  it("acepta cero items cuando el dictamen esta completo", () => {
    expect(validarInforme({ cantidadItems: 0, ...DICTAMEN_COMPLETO })).toBeNull()
  })

  it("acepta cero items con veredicto SIN_FALLA", () => {
    expect(
      validarInforme({ ...DICTAMEN_COMPLETO, cantidadItems: 0, veredicto: "SIN_FALLA" })
    ).toBeNull()
  })

  it("rechaza cero items sin veredicto", () => {
    const msg = validarInforme({ cantidadItems: 0 })
    expect(msg).toContain("veredicto")
  })

  it("rechaza cero items con veredicto REPARABLE", () => {
    const msg = validarInforme({ ...DICTAMEN_COMPLETO, cantidadItems: 0, veredicto: "REPARABLE" })
    expect(msg).toContain("al menos un ítem")
  })

  it("rechaza cero items sin diagnostico", () => {
    const msg = validarInforme({ ...DICTAMEN_COMPLETO, cantidadItems: 0, diagnosticoTecnico: null })
    expect(msg).toContain("diagnóstico")
  })

  it("rechaza un diagnostico que es solo espacios", () => {
    const msg = validarInforme({ ...DICTAMEN_COMPLETO, cantidadItems: 0, diagnosticoTecnico: "   " })
    expect(msg).toContain("diagnóstico")
  })

  it("rechaza cero items sin causa del dano", () => {
    const msg = validarInforme({ ...DICTAMEN_COMPLETO, cantidadItems: 0, causaDano: null })
    expect(msg).toContain("causa")
  })
})

describe("esInforme", () => {
  it("es informe cuando no hay items y el veredicto no admite presupuesto", () => {
    expect(esInforme({ cantidadItems: 0, veredicto: "IRREPARABLE" })).toBe(true)
    expect(esInforme({ cantidadItems: 0, veredicto: "SIN_FALLA" })).toBe(true)
  })

  it("no es informe si hay items, aunque el veredicto sea IRREPARABLE", () => {
    expect(esInforme({ cantidadItems: 2, veredicto: "IRREPARABLE" })).toBe(false)
  })

  it("no es informe sin veredicto ni con veredicto REPARABLE", () => {
    expect(esInforme({ cantidadItems: 0 })).toBe(false)
    expect(esInforme({ cantidadItems: 0, veredicto: "REPARABLE" })).toBe(false)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

```bash
npx vitest run __tests__/lib/cotizacion-informe.test.ts
```

Esperado: FAIL — `Failed to resolve import "@/lib/cotizacion-informe"`.

- [ ] **Step 3: Escribir la implementación mínima**

Crear `lib/cotizacion-informe.ts`:

```ts
import { z } from "zod"

export const VEREDICTOS = ["REPARABLE", "IRREPARABLE", "SIN_FALLA"] as const
export type Veredicto = (typeof VEREDICTOS)[number]

export const CAUSAS_DANO = [
  "CAIDA",
  "LIQUIDO",
  "SOBRETENSION",
  "DESGASTE",
  "USO_INDEBIDO",
  "FALLA_FABRICA",
  "DESCONOCIDA",
] as const
export type CausaDano = (typeof CAUSAS_DANO)[number]

export const veredictoSchema = z.enum(VEREDICTOS)
export const causaDanoSchema = z.enum(CAUSAS_DANO)

/** Los dos veredictos que hacen que no haya nada que presupuestar. */
const SIN_PRESUPUESTO: readonly string[] = ["IRREPARABLE", "SIN_FALLA"]

export interface DatosInforme {
  cantidadItems: number
  veredicto?: string | null
  diagnosticoTecnico?: string | null
  causaDano?: string | null
}

/**
 * Un documento es un informe tecnico cuando no tiene items y el tecnico
 * dictamino que no hay reparacion que presupuestar. No hay flag ni tipo: el
 * informe es la consecuencia del veredicto.
 */
export function esInforme(datos: DatosInforme): boolean {
  return datos.cantidadItems === 0 && !!datos.veredicto && SIN_PRESUPUESTO.includes(datos.veredicto)
}

/**
 * Devuelve el mensaje a mostrarle al taller, o null si el documento es valido.
 *
 * Es una funcion pura y no un refine de Zod porque el PUT valida DESPUES de
 * fusionar el payload con la fila existente: un pedido puede cambiar el
 * veredicto sin mandar `items`, y el refine solo ve el payload.
 *
 * Las rutas devuelven unicamente error.errors[0].message, asi que estos textos
 * son literalmente lo que lee el usuario. Van redactados como instruccion.
 */
export function validarInforme(datos: DatosInforme): string | null {
  if (datos.cantidadItems > 0) return null

  if (!datos.veredicto) {
    return "Una cotización sin ítems necesita un veredicto técnico: elegí Irreparable o Sin falla detectada para emitirla como informe."
  }

  if (!SIN_PRESUPUESTO.includes(datos.veredicto)) {
    return "Si el equipo es reparable, el presupuesto necesita al menos un ítem."
  }

  if (!datos.diagnosticoTecnico || !datos.diagnosticoTecnico.trim()) {
    return "El informe técnico necesita el diagnóstico del técnico."
  }

  if (!datos.causaDano) {
    return "El informe técnico necesita la causa probable del daño."
  }

  return null
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

```bash
npx vitest run __tests__/lib/cotizacion-informe.test.ts
```

Esperado: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/cotizacion-informe.ts __tests__/lib/cotizacion-informe.test.ts
git commit -m "feat(cotizaciones): regla de validacion del informe tecnico"
```

---

### Task 3: POST acepta el dictamen y permite cero ítems

**Files:**
- Modify: `app/api/cotizaciones/route.ts` (líneas 1-11 imports, 56-71 schema, 274-275 parse, 424-447 insert)
- Test: `__tests__/api/cotizaciones-informe-tecnico.test.ts`

**Interfaces:**
- Consumes: `validarInforme`, `veredictoSchema`, `causaDanoSchema` de Task 2
- Produces: el POST acepta `veredicto`, `diagnosticoTecnico`, `causaDano`, `presentadoAnte` y escribe `veredicto`, `diagnostico_tecnico`, `causa_dano`, `presentado_ante`

- [ ] **Step 1: Escribir el test que falla**

Crear `__tests__/api/cotizaciones-informe-tecnico.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createPostRequest,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn().mockResolvedValue(true),
}))

import { supabaseAdmin } from "@/lib/supabase"
import { POST } from "@/app/api/cotizaciones/route"

const DICTAMEN = {
  veredicto: "IRREPARABLE",
  diagnosticoTecnico: "Placa madre con corrosion por liquido. Sin reparacion posible.",
  causaDano: "LIQUIDO",
}

describe("POST /api/cotizaciones — informe tecnico sin items", () => {
  let cotizaciones: ReturnType<typeof createChainMock>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: 1, error: null } as any)
    cotizaciones = createChainMock({ id: "cot-1", numero_cotizacion: "COT-0001" })
    mockSupabaseFrom({
      clientes: createChainMock({ id: "cli-1", nombre: "Cliente Uno" }),
      organizations: createChainMock({ zona_horaria: "America/Argentina/Buenos_Aires" }),
      cotizaciones,
      items_cotizacion: createChainMock(null, null),
    })
  })

  it("guarda el dictamen y la entidad destinataria cuando no hay items", async () => {
    mockAuthSuccess()

    const res = await POST(
      createPostRequest({
        clienteId: "cli-1",
        items: [],
        presentadoAnte: "La Segunda ART",
        ...DICTAMEN,
      })
    )

    expect(res.status).not.toBe(400)
    const fila = cotizaciones.insert.mock.calls[0][0]
    expect(fila.veredicto).toBe("IRREPARABLE")
    expect(fila.causa_dano).toBe("LIQUIDO")
    expect(fila.diagnostico_tecnico).toContain("corrosion")
    expect(fila.presentado_ante).toBe("La Segunda ART")
  })

  it("deja el documento en total cero cuando no hay items", async () => {
    mockAuthSuccess()

    await POST(createPostRequest({ clienteId: "cli-1", items: [], ...DICTAMEN }))

    const fila = cotizaciones.insert.mock.calls[0][0]
    expect(fila.subtotal).toBe(0)
    expect(fila.iva).toBe(0)
    expect(fila.total).toBe(0)
  })

  it("rechaza cero items sin veredicto", async () => {
    mockAuthSuccess()

    const res = await POST(createPostRequest({ clienteId: "cli-1", items: [] }))
    const body = await parseResponse(res)

    expect(res.status).toBe(400)
    expect(body.error).toContain("veredicto")
  })

  it("rechaza cero items con veredicto REPARABLE", async () => {
    mockAuthSuccess()

    const res = await POST(
      createPostRequest({ clienteId: "cli-1", items: [], ...DICTAMEN, veredicto: "REPARABLE" })
    )
    const body = await parseResponse(res)

    expect(res.status).toBe(400)
    expect(body.error).toContain("al menos un ítem")
  })

  it("sigue guardando el dictamen cuando ademas hay items", async () => {
    mockAuthSuccess()

    await POST(
      createPostRequest({
        clienteId: "cli-1",
        items: [{ descripcion: "Cambio de pantalla", cantidad: 1, precioUnitario: 50000 }],
        veredicto: "REPARABLE",
        diagnosticoTecnico: "Pantalla rota por caida.",
        causaDano: "CAIDA",
      })
    )

    const fila = cotizaciones.insert.mock.calls[0][0]
    expect(fila.veredicto).toBe("REPARABLE")
    expect(fila.causa_dano).toBe("CAIDA")
  })

  it("deja las columnas nuevas en null cuando no se mandan", async () => {
    mockAuthSuccess()

    await POST(
      createPostRequest({
        clienteId: "cli-1",
        items: [{ descripcion: "Mano de obra", cantidad: 1, precioUnitario: 8000 }],
      })
    )

    const fila = cotizaciones.insert.mock.calls[0][0]
    expect(fila.veredicto).toBeNull()
    expect(fila.diagnostico_tecnico).toBeNull()
    expect(fila.causa_dano).toBeNull()
    expect(fila.presentado_ante).toBeNull()
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

```bash
npx vitest run __tests__/api/cotizaciones-informe-tecnico.test.ts
```

Esperado: FAIL. El primer test falla con status 400 y el mensaje `"Debe tener al menos un item"`, porque el `.min(1)` todavía está.

- [ ] **Step 3: Agregar el import**

En `app/api/cotizaciones/route.ts`, después de la línea 9 (`import { totalPresupuestoDeOrden } ...`):

```ts
import { validarInforme, veredictoSchema, causaDanoSchema } from "@/lib/cotizacion-informe"
```

- [ ] **Step 4: Cambiar el schema**

**Chequear primero si el schema se deriva en otro lado.** `.superRefine()`
devuelve un `ZodEffects`, que pierde `.partial()`, `.extend()`, `.pick()` y
`.omit()`:

```bash
rg -n "cotizacionSchema" app lib components
```

Si aparece sólo dentro de `app/api/cotizaciones/route.ts`, seguir. Si algún
otro archivo lo deriva, no envolver el schema: dejar el `z.object` como está y
llamar a `validarInforme` en el handler justo después del `.parse()`,
devolviendo `NextResponse.json({ error: mensaje }, { status: 400 })`.

Reemplazar el bloque de las líneas 56-71 (`const cotizacionSchema = z.object({ ... })`) por:

```ts
const cotizacionSchema = z.object({
  tipo: z.enum(["ORDEN", "PRESUPUESTO"]).default("ORDEN"),
  ordenId: z.string().optional(),
  clienteId: z.string().optional(),
  sectorId: z.string().optional(),
  // Sin .min(1): una cotizacion sin items es un informe tecnico. La regla que
  // decide cuando eso es valido vive en validarInforme (lib/cotizacion-informe).
  items: z.array(itemSchema),
  notas: z.string().optional(),
  fechaVencimiento: z.string().optional(),
  terminos: z.string().optional(),
  descuentoGlobalTipo: z.enum(["porcentaje", "fijo"]).optional(),
  descuentoGlobalValor: z.number().min(0).optional(),
  ivaPorcentaje: z.number().min(0).max(100).optional(),
  tipoCambio: z.number().positive().optional(),
  equipo: equipoSchema.optional(),
  checklist: checklistSchema.optional(),
  veredicto: veredictoSchema.nullable().optional(),
  diagnosticoTecnico: z.string().max(4000).nullable().optional(),
  causaDano: causaDanoSchema.nullable().optional(),
  presentadoAnte: z.string().max(200).nullable().optional(),
}).superRefine((data, ctx) => {
  const mensaje = validarInforme({
    cantidadItems: data.items.length,
    veredicto: data.veredicto,
    diagnosticoTecnico: data.diagnosticoTecnico,
    causaDano: data.causaDano,
  })
  if (mensaje) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: mensaje, path: ["items"] })
  }
})
```

- [ ] **Step 5: Escribir las columnas nuevas en el insert**

En el objeto del insert (líneas 424-447), agregar antes del cierre `})`, después de `checklist_snapshot:`:

```ts
        veredicto: data.veredicto || null,
        diagnostico_tecnico: data.diagnosticoTecnico?.trim() || null,
        causa_dano: data.causaDano || null,
        presentado_ante: data.presentadoAnte?.trim() || null,
```

- [ ] **Step 6: Correr el test y verificar que pasa**

```bash
npx vitest run __tests__/api/cotizaciones-informe-tecnico.test.ts
```

Esperado: PASS, 6 tests.

Si el test de "total cero" falla con `NaN`, el cálculo de totales asume al menos un ítem: buscar el `reduce` sobre `items` en el handler y darle el valor inicial `0`.

- [ ] **Step 7: Correr la suite de cotizaciones para verificar que no rompimos nada**

```bash
npx vitest run __tests__/api --reporter=dot
```

Esperado: PASS. Prestar atención a `cotizaciones-post-cost-provenance.test.ts` y `cotizaciones-servicio-item.test.ts`, que ejercitan el mismo POST.

- [ ] **Step 8: Commit**

```bash
git add app/api/cotizaciones/route.ts __tests__/api/cotizaciones-informe-tecnico.test.ts
git commit -m "feat(cotizaciones): POST acepta un informe tecnico sin items"
```

---

### Task 4: PUT acepta el dictamen y valida contra la fila existente

**Files:**
- Modify: `app/api/cotizaciones/[id]/route.ts` (imports, schema 74-88, assembly 370-384, la carga de `existing`)
- Test: `__tests__/api/cotizaciones-informe-put.test.ts`

**Interfaces:**
- Consumes: `validarInforme` de Task 2
- Produces: el PUT acepta los mismos cuatro campos y valida el estado **resultante**, no el payload

**Por qué acá no va un `superRefine`.** El PUT arma `updateData` campo por campo y un pedido puede traer `veredicto` sin traer `items`. Un refine solo ve el payload: con `{ veredicto: "REPARABLE" }` sobre una cotización que ya tiene cero ítems, el refine no vería ningún ítem y no podría distinguir "no mandó ítems" de "no tiene ítems". La validación va después de fusionar payload con fila existente.

- [ ] **Step 1: Escribir el test que falla**

Crear `__tests__/api/cotizaciones-informe-put.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createPostRequest,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn().mockResolvedValue(true),
}))

import { supabaseAdmin } from "@/lib/supabase"
import { PUT } from "@/app/api/cotizaciones/[id]/route"

const params = { params: Promise.resolve({ id: "cot-1" }) }

function mockCotizacionExistente(overrides: Record<string, any> = {}) {
  return createChainMock({
    id: "cot-1",
    estado: "BORRADOR",
    organization_id: "org-1",
    tipo: "ORDEN",
    orden_id: null,
    veredicto: null,
    diagnostico_tecnico: null,
    causa_dano: null,
    presentado_ante: null,
    items_cotizacion: [],
    ...overrides,
  })
}

describe("PUT /api/cotizaciones/[id] — informe tecnico", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: 1, error: null } as any)
  })

  it("guarda el dictamen completo dejando el documento sin items", async () => {
    mockAuthSuccess()
    const cotizaciones = mockCotizacionExistente()
    mockSupabaseFrom({ cotizaciones, items_cotizacion: createChainMock(null, null) })

    const res = await PUT(
      createPostRequest({
        items: [],
        veredicto: "IRREPARABLE",
        diagnosticoTecnico: "Corrosion generalizada en la placa.",
        causaDano: "LIQUIDO",
        presentadoAnte: "Provincia Seguros",
      }),
      params
    )

    expect(res.status).not.toBe(400)
    const update = cotizaciones.update.mock.calls[0][0]
    expect(update.veredicto).toBe("IRREPARABLE")
    expect(update.causa_dano).toBe("LIQUIDO")
    expect(update.presentado_ante).toBe("Provincia Seguros")
  })

  it("rechaza vaciar los items sin cargar veredicto", async () => {
    mockAuthSuccess()
    mockSupabaseFrom({
      cotizaciones: mockCotizacionExistente({
        items_cotizacion: [{ id: "it-1", descripcion: "Pantalla", cantidad: 1, precio_unitario: 1000, subtotal: 1000 }],
      }),
      items_cotizacion: createChainMock(null, null),
    })

    const res = await PUT(createPostRequest({ items: [] }), params)
    const body = await parseResponse(res)

    expect(res.status).toBe(400)
    expect(body.error).toContain("veredicto")
  })

  it("rechaza pasar a REPARABLE un documento que ya no tiene items", async () => {
    mockAuthSuccess()
    mockSupabaseFrom({
      cotizaciones: mockCotizacionExistente({
        veredicto: "IRREPARABLE",
        diagnostico_tecnico: "Sin reparacion.",
        causa_dano: "LIQUIDO",
        items_cotizacion: [],
      }),
      items_cotizacion: createChainMock(null, null),
    })

    // No manda `items`: la validacion tiene que mirar la fila existente.
    const res = await PUT(createPostRequest({ veredicto: "REPARABLE" }), params)
    const body = await parseResponse(res)

    expect(res.status).toBe(400)
    expect(body.error).toContain("al menos un ítem")
  })

  it("no toca las columnas del dictamen cuando el pedido no las menciona", async () => {
    mockAuthSuccess()
    const cotizaciones = mockCotizacionExistente({
      veredicto: "IRREPARABLE",
      diagnostico_tecnico: "Sin reparacion.",
      causa_dano: "LIQUIDO",
      items_cotizacion: [],
    })
    mockSupabaseFrom({ cotizaciones, items_cotizacion: createChainMock(null, null) })

    await PUT(createPostRequest({ notas: "Retira el martes" }), params)

    const update = cotizaciones.update.mock.calls[0][0]
    expect(update).not.toHaveProperty("veredicto")
    expect(update).not.toHaveProperty("causa_dano")
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

```bash
npx vitest run __tests__/api/cotizaciones-informe-put.test.ts
```

Esperado: FAIL — el primer test no encuentra `veredicto` en el `updateData`.

- [ ] **Step 3: Agregar el import y los campos al schema**

En `app/api/cotizaciones/[id]/route.ts`, agregar el import junto a los demás de `@/lib/...`:

```ts
import { validarInforme, veredictoSchema, causaDanoSchema } from "@/lib/cotizacion-informe"
```

Y agregar al final del `updateCotizacionSchema` (dentro del `z.object`, después de `checklist:` en la línea 87):

```ts
  veredicto: veredictoSchema.nullable().optional(),
  diagnosticoTecnico: z.string().max(4000).nullable().optional(),
  causaDano: causaDanoSchema.nullable().optional(),
  presentadoAnte: z.string().max(200).nullable().optional(),
```

- [ ] **Step 4: Incluir las columnas nuevas en la lectura de `existing`**

Buscar la consulta que carga la cotización actual:

```bash
rg -n "items_cotizacion \(|from\(\"cotizaciones\"\)" app/api/cotizaciones/\[id\]/route.ts | head -20
```

En el `.select(...)` de esa consulta, agregar `veredicto, diagnostico_tecnico, causa_dano, presentado_ante` a la lista de columnas. Si el select es `"*"`, no hace falta tocarlo.

- [ ] **Step 5: Validar el estado resultante**

En el bloque de armado de `updateData`, inmediatamente después de la línea 384 (`if (data.sectorId !== undefined) updateData.sector_id = data.sectorId`), insertar:

```ts
    if (data.veredicto !== undefined) updateData.veredicto = data.veredicto
    if (data.diagnosticoTecnico !== undefined) {
      updateData.diagnostico_tecnico = data.diagnosticoTecnico?.trim() || null
    }
    if (data.causaDano !== undefined) updateData.causa_dano = data.causaDano
    if (data.presentadoAnte !== undefined) {
      updateData.presentado_ante = data.presentadoAnte?.trim() || null
    }

    // La regla del informe mira el estado RESULTANTE, no el payload: un pedido
    // puede cambiar el veredicto sin mandar items, y viceversa. Por eso se
    // fusiona contra la fila existente en vez de vivir en un refine de Zod.
    const itemsResultantes = data.items !== undefined
      ? data.items
      : (existing.items_cotizacion || [])
    const mensajeInforme = validarInforme({
      cantidadItems: itemsResultantes.length,
      veredicto: data.veredicto !== undefined ? data.veredicto : existing.veredicto,
      diagnosticoTecnico: data.diagnosticoTecnico !== undefined
        ? data.diagnosticoTecnico
        : existing.diagnostico_tecnico,
      causaDano: data.causaDano !== undefined ? data.causaDano : existing.causa_dano,
    })
    if (mensajeInforme) {
      return NextResponse.json({ error: mensajeInforme }, { status: 400 })
    }
```

Si la variable con la fila existente no se llama `existing` en este archivo, usar el nombre real (el paso 4 lo deja a la vista).

- [ ] **Step 6: Correr el test y verificar que pasa**

```bash
npx vitest run __tests__/api/cotizaciones-informe-put.test.ts
```

Esperado: PASS, 4 tests.

- [ ] **Step 7: Correr la suite completa de la API**

```bash
npx vitest run __tests__/api --reporter=dot
```

Esperado: PASS.

- [ ] **Step 8: Commit**

```bash
git add app/api/cotizaciones/\[id\]/route.ts __tests__/api/cotizaciones-informe-put.test.ts
git commit -m "feat(cotizaciones): PUT valida el informe contra la fila existente"
```

---

### Task 5: Enviar un informe no mueve el estado de la orden

**Files:**
- Modify: `app/api/cotizaciones/[id]/enviar/route.ts:169-201`
- Modify: `app/api/cotizaciones/[id]/route.ts:798-837`
- Test: `__tests__/api/cotizaciones-informe-no-presupuestado.test.ts`

**Interfaces:**
- Consumes: `esInforme` de Task 2
- Produces: ningún export nuevo

**El bug que esto evita.** Hoy los dos caminos empujan la orden a `PRESUPUESTADO` de forma incondicional al pasar la cotización a `ENVIADA`. Con un informe irreparable, la orden quedaría "esperando la respuesta a un presupuesto" que no existe. Y son **dos** caminos, no uno: el botón "Enviar y compartir" de la lista saltea el envío de mail y va por el PUT.

Se **saltea** la transición, no se redirige a otro estado. El equipo sigue físicamente en el mostrador esperando que el cliente lo retire; marcarlo `SIN_REPARACION` adelantaría un hecho que no ocurrió. Ese estado lo pone el flujo de entrega que ya existe.

- [ ] **Step 1: Escribir el test que falla**

Crear `__tests__/api/cotizaciones-informe-no-presupuestado.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createPostRequest,
} from "./helpers"

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn().mockResolvedValue(true),
}))

import { supabaseAdmin } from "@/lib/supabase"
import { PUT } from "@/app/api/cotizaciones/[id]/route"

const params = { params: Promise.resolve({ id: "cot-1" }) }

describe("PUT /api/cotizaciones/[id] — enviar un informe no presupuesta la orden", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: 1, error: null } as any)
  })

  it("deja la orden en EN_DIAGNOSTICO al enviar un informe irreparable", async () => {
    mockAuthSuccess()
    const ordenes = createChainMock({ id: "ord-1", estado: "EN_DIAGNOSTICO" })
    mockSupabaseFrom({
      cotizaciones: createChainMock({
        id: "cot-1",
        estado: "BORRADOR",
        organization_id: "org-1",
        tipo: "ORDEN",
        orden_id: "ord-1",
        total: 0,
        veredicto: "IRREPARABLE",
        diagnostico_tecnico: "Sin reparacion posible.",
        causa_dano: "LIQUIDO",
        items_cotizacion: [],
      }),
      items_cotizacion: createChainMock(null, null),
      ordenes_servicio: ordenes,
      orden_eventos: createChainMock(null, null),
    })

    await PUT(createPostRequest({ estado: "ENVIADA" }), params)

    const paso = ordenes.update.mock.calls.some(
      (llamada) => llamada[0]?.estado === "PRESUPUESTADO"
    )
    expect(paso).toBe(false)
  })

  it("sigue presupuestando la orden cuando la cotizacion tiene items", async () => {
    mockAuthSuccess()
    const ordenes = createChainMock({ id: "ord-1", estado: "EN_DIAGNOSTICO" })
    mockSupabaseFrom({
      cotizaciones: createChainMock({
        id: "cot-1",
        estado: "BORRADOR",
        organization_id: "org-1",
        tipo: "ORDEN",
        orden_id: "ord-1",
        total: 50000,
        veredicto: null,
        items_cotizacion: [
          { id: "it-1", descripcion: "Pantalla", cantidad: 1, precio_unitario: 50000, subtotal: 50000 },
        ],
      }),
      items_cotizacion: createChainMock(null, null),
      ordenes_servicio: ordenes,
      orden_eventos: createChainMock(null, null),
    })

    await PUT(createPostRequest({ estado: "ENVIADA" }), params)

    const paso = ordenes.update.mock.calls.some(
      (llamada) => llamada[0]?.estado === "PRESUPUESTADO"
    )
    expect(paso).toBe(true)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

```bash
npx vitest run __tests__/api/cotizaciones-informe-no-presupuestado.test.ts
```

Esperado: el primer test FALLA (`expected true to be false`) — hoy la transición es incondicional. El segundo pasa.

- [ ] **Step 3: Saltear la transición en el PUT**

En `app/api/cotizaciones/[id]/route.ts`, reemplazar las líneas 798-806 (desde el comentario hasta el `if (cotWithOrder?.orden_id) {`) por:

```ts
    // Si cambió a ENVIADA y está vinculada a una orden, transicionar a PRESUPUESTADO.
    // Un informe tecnico es la excepcion: no hay presupuesto que esperar, asi que
    // la orden se queda donde esta hasta que el cliente retire el equipo.
    if (data.estado === "ENVIADA") {
      const { data: cotWithOrder } = await supabaseAdmin
        .from("cotizaciones")
        .select("orden_id, total, veredicto")
        .eq("id", id)
        .single()

      const { count: itemsCount } = await supabaseAdmin
        .from("items_cotizacion")
        .select("id", { count: "exact", head: true })
        .eq("cotizacion_id", id)

      const emiteInforme = esInforme({
        cantidadItems: itemsCount || 0,
        veredicto: cotWithOrder?.veredicto,
      })

      if (cotWithOrder?.orden_id && !emiteInforme) {
```

Agregar `esInforme` al import de `@/lib/cotizacion-informe` que se creó en Task 4:

```ts
import { validarInforme, esInforme, veredictoSchema, causaDanoSchema } from "@/lib/cotizacion-informe"
```

- [ ] **Step 4: Saltear la transición en `enviar`**

En `app/api/cotizaciones/[id]/enviar/route.ts`, agregar el import:

```ts
import { esInforme } from "@/lib/cotizacion-informe"
```

Verificar que la consulta que carga `cotizacion` traiga `veredicto`:

```bash
rg -n "from\(\"cotizaciones\"\)" -A 4 app/api/cotizaciones/\[id\]/enviar/route.ts
```

Si el `.select(...)` enumera columnas, agregar `veredicto`. Si es `"*"`, no tocar.

Reemplazar la línea 169-170 (el comentario y el `if (orden && orden.id) {`) por:

```ts
    // Si la cotización está vinculada a una orden, transicionar a PRESUPUESTADO
    // automáticamente. Un informe tecnico no: no hay presupuesto que esperar y
    // el equipo sigue en el mostrador hasta que el cliente lo retire.
    const { count: itemsCount } = await supabaseAdmin
      .from("items_cotizacion")
      .select("id", { count: "exact", head: true })
      .eq("cotizacion_id", id)

    const emiteInforme = esInforme({
      cantidadItems: itemsCount || 0,
      veredicto: (cotizacion as any).veredicto,
    })

    if (orden && orden.id && !emiteInforme) {
```

- [ ] **Step 5: Correr el test y verificar que pasa**

```bash
npx vitest run __tests__/api/cotizaciones-informe-no-presupuestado.test.ts
```

Esperado: PASS, 2 tests.

- [ ] **Step 6: Auditar quién más asume `ENVIADA ⇒ PRESUPUESTADO`**

```bash
rg -n "PRESUPUESTADO" app lib components --glob '!**/__tests__/**'
```

Revisar cada resultado. `revertirOrdenSinPresupuestoActivo` (`app/api/cotizaciones/[id]/route.ts:94-137`) queda cubierto solo: solo revierte **desde** `PRESUPUESTADO`, y como el informe nunca lleva la orden ahí, al borrarlo o rechazarlo no encuentra nada que revertir. El riesgo vivo son reportes o filtros que cuenten "órdenes presupuestadas" para medir trabajo del técnico. Anotar en el PR lo que se encuentre; no arreglarlo acá.

- [ ] **Step 7: Commit**

```bash
git add app/api/cotizaciones/\[id\]/route.ts app/api/cotizaciones/\[id\]/enviar/route.ts __tests__/api/cotizaciones-informe-no-presupuestado.test.ts
git commit -m "fix(cotizaciones): enviar un informe no presupuesta la orden"
```

---

### Task 6: Autocompletado de entidades destinatarias

**Files:**
- Create: `app/api/cotizaciones/entidades/route.ts`
- Test: `__tests__/api/cotizaciones-entidades.test.ts`

**Interfaces:**
- Consumes: `requireAuth` de `@/lib/auth-utils`
- Produces: `GET /api/cotizaciones/entidades` → `{ entidades: string[] }`

- [ ] **Step 1: Escribir el test que falla**

Crear `__tests__/api/cotizaciones-entidades.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, parseResponse } from "./helpers"
import { GET } from "@/app/api/cotizaciones/entidades/route"

describe("GET /api/cotizaciones/entidades", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("devuelve las entidades unicas y ordenadas de la organizacion", async () => {
    mockAuthSuccess()
    mockSupabaseFrom({
      cotizaciones: createChainMock([
        { presentado_ante: "Provincia Seguros" },
        { presentado_ante: "La Segunda ART" },
        { presentado_ante: "Provincia Seguros" },
        { presentado_ante: "  La Segunda ART  " },
      ]),
    })

    const res = await GET()
    const body = await parseResponse(res)

    expect(body.entidades).toEqual(["La Segunda ART", "Provincia Seguros"])
  })

  it("descarta strings vacios", async () => {
    mockAuthSuccess()
    mockSupabaseFrom({
      cotizaciones: createChainMock([
        { presentado_ante: "" },
        { presentado_ante: "   " },
        { presentado_ante: "Sancor" },
      ]),
    })

    const res = await GET()
    const body = await parseResponse(res)

    expect(body.entidades).toEqual(["Sancor"])
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

```bash
npx vitest run __tests__/api/cotizaciones-entidades.test.ts
```

Esperado: FAIL — `Failed to resolve import "@/app/api/cotizaciones/entidades/route"`.

- [ ] **Step 3: Escribir la ruta**

Crear `app/api/cotizaciones/entidades/route.ts`:

```ts
import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

/**
 * Alimenta el autocompletado de "Para ser presentado ante". No hay tabla de
 * entidades a proposito: el campo es texto libre y esto solo evita que la misma
 * aseguradora quede escrita de cinco formas distintas.
 */
export async function GET() {
  const { error, organizationId } = await requireAuth()
  if (error) return error

  const { data, error: dbError } = await supabaseAdmin
    .from("cotizaciones")
    .select("presentado_ante")
    .eq("organization_id", organizationId!)
    .not("presentado_ante", "is", null)
    .is("deleted_at", null)
    .limit(500)

  if (dbError) {
    console.error("Error listando entidades:", dbError)
    return NextResponse.json({ error: "Error al listar entidades" }, { status: 500 })
  }

  // PostgREST no expone SELECT DISTINCT, asi que se deduplica aca. El limite de
  // 500 filas acota el costo: un taller no trabaja con 500 aseguradoras, y si
  // alguna queda afuera el campo sigue siendo escribible a mano.
  const entidades = Array.from(
    new Set((data || []).map((fila) => (fila.presentado_ante || "").trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b, "es"))

  return NextResponse.json({ entidades })
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

```bash
npx vitest run __tests__/api/cotizaciones-entidades.test.ts
```

Esperado: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add app/api/cotizaciones/entidades/route.ts __tests__/api/cotizaciones-entidades.test.ts
git commit -m "feat(cotizaciones): autocompletado de entidades destinatarias"
```

---

### Task 7: El PDF dibuja el informe técnico

**Files:**
- Modify: `lib/cotizacion-pdf.ts:74` (el `return`)
- Modify: `lib/pdf.ts:133-197` (interface), `:335` (título), y una inserción antes de `:447`
- Test: `__tests__/lib/cotizacion-pdf.test.ts`

**Interfaces:**
- Consumes: la fila cruda de `cotizaciones` con las columnas de Task 1
- Produces: `buildCotizacionPdfExtras` devuelve además `veredicto`, `diagnosticoTecnico`, `causaDano`, `presentadoAnte`; `CotizacionPDFData` acepta esos cuatro campos

**Por qué el cambio va en `buildCotizacionPdfExtras`.** Las cuatro rutas que emiten el documento (PDF interno, envío por mail, PDF público, JSON público) hacen `generateCotizacionPDF({ ...pdfExtras, ... })`. Agregar los campos al `return` de esa función los propaga a los cuatro call sites de una sola vez, sin tocar ninguna ruta.

**Dato a tener presente:** `generateCotizacionPDF` **nunca lee `data.tipo`**, pese a que el campo existe en la interface. El título es el literal `"COTIZACIÓN"` en la línea 335, incluso para `tipo: "PRESUPUESTO"`. Este plan **no** cambia eso: el título solo pasa a "INFORME TÉCNICO" cuando no hay ítems.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `__tests__/lib/cotizacion-pdf.test.ts` (respetar el `// @vitest-environment node` que ya está en la primera línea del archivo):

```ts
describe("generateCotizacionPDF — informe tecnico", () => {
  const BASE_INFORME = {
    numeroCotizacion: "COT-0042",
    fecha: new Date("2026-09-04T12:00:00Z"),
    cliente: { nombre: "Ana Gomez", telefono: "1122334455" },
    items: [],
    subtotal: 0,
    iva: 0,
    total: 0,
    veredicto: "IRREPARABLE",
    diagnosticoTecnico: "Corrosion generalizada en la placa madre por contacto con liquido.",
    causaDano: "LIQUIDO",
    presentadoAnte: "La Segunda ART",
  }

  it("titula INFORME TECNICO y no dibuja la tabla de items", async () => {
    const buffer = await generateCotizacionPDF(BASE_INFORME as any)
    const text = await extraerTexto(buffer)

    expect(text).toContain("INFORME TÉCNICO")
    // "DETALLE DE ITEMS" y "SUBTOTAL" son rotulos que existen SOLO dentro del
    // bloque 447-569 que se saltea. No usar not.toContain("COTIZACIÓN"): el
    // banner de validez vive fuera del bloque y probablemente diga "Esta
    // cotización es válida hasta...". Tampoco not.toContain("TOTAL"), que
    // matchea de más.
    expect(text).not.toContain("DETALLE DE ITEMS")
    expect(text).not.toContain("SUBTOTAL")
  })

  it("imprime veredicto, causa, diagnostico y destinatario", async () => {
    const buffer = await generateCotizacionPDF(BASE_INFORME as any)
    const text = await extraerTexto(buffer)

    expect(text).toContain("Irreparable")
    expect(text).toContain("Contacto con líquido")
    expect(text).toContain("Corrosion generalizada")
    expect(text).toContain("La Segunda ART")
  })

  it("con items mantiene el titulo COTIZACION y dibuja la tabla", async () => {
    const buffer = await generateCotizacionPDF({
      ...BASE_INFORME,
      veredicto: "REPARABLE",
      items: [{ descripcion: "Cambio de pantalla", cantidad: 1, precioUnitario: 50000, subtotal: 50000 }],
      subtotal: 50000,
      total: 50000,
    } as any)
    const text = await extraerTexto(buffer)

    expect(text).toContain("COTIZACIÓN")
    expect(text).toContain("DETALLE DE ITEMS")
    expect(text).toContain("Reparable")
  })
})
```

Reutilizar el helper de extracción de texto que ya usa el archivo. Si el archivo no tiene uno con ese nombre, renombrar `extraerTexto` por el que exista (la primera lectura del archivo lo deja a la vista; las aserciones actuales del archivo hacen `expect(text).toContain("COTIZACIÓN")`, así que hay uno).

- [ ] **Step 2: Correr el test y verificar que falla**

```bash
npx vitest run __tests__/lib/cotizacion-pdf.test.ts
```

Esperado: FAIL — el primer test encuentra `"COTIZACIÓN"` en lugar de `"INFORME TÉCNICO"`.

- [ ] **Step 3: Propagar los campos desde `buildCotizacionPdfExtras`**

En `lib/cotizacion-pdf.ts`, reemplazar la línea 74:

```ts
  return { tipo, equipo, checklist, condiciones }
```

por:

```ts
  // Los cuatro campos del informe viajan por aca porque las cuatro rutas que
  // emiten el documento -PDF interno, envio por mail, PDF publico y JSON
  // publico- hacen spread de este objeto. Agregarlos en cada ruta seria
  // agregarlos cuatro veces y olvidarse en una.
  return {
    tipo,
    equipo,
    checklist,
    condiciones,
    veredicto: cotizacion?.veredicto ?? null,
    diagnosticoTecnico: cotizacion?.diagnostico_tecnico ?? null,
    causaDano: cotizacion?.causa_dano ?? null,
    presentadoAnte: cotizacion?.presentado_ante ?? null,
  }
```

- [ ] **Step 4: Extender la interface del PDF**

En `lib/pdf.ts`, dentro de `interface CotizacionPDFData`, agregar después de la línea 178 (el cierre de `condiciones`):

```ts
  // Dictamen tecnico. Con `items` vacio el documento se dibuja como informe:
  // sin tabla de items ni totales. Con items, el bloque se imprime igual, sobre
  // la tabla — es un presupuesto con dictamen.
  veredicto?: string | null
  diagnosticoTecnico?: string | null
  causaDano?: string | null
  presentadoAnte?: string | null
```

- [ ] **Step 5: Cambiar el título**

En `lib/pdf.ts`, reemplazar la línea 335:

```ts
  const docTitleText = "COTIZACIÓN"
```

por:

```ts
  // El titulo depende SOLO del conteo de items: cero items es un informe.
  // Un presupuesto con dictamen sigue siendo COTIZACIÓN.
  const esInformeTecnico = (Array.isArray(data.items) ? data.items.length : 0) === 0 && !!data.veredicto
  const docTitleText = esInformeTecnico ? "INFORME TÉCNICO" : "COTIZACIÓN"
```

- [ ] **Step 6: Dibujar el bloque de dictamen**

En `lib/pdf.ts`, insertar inmediatamente **antes** de la línea 447 (`// ====== ITEMS TABLE ======`):

```ts
  // ====== DICTAMEN TÉCNICO ======
  // Va antes de la tabla porque en un informe es el cuerpo del documento, y en
  // un presupuesto con dictamen es el encabezado del detalle.
  const tieneDictamen = !!data.veredicto
  if (tieneDictamen || data.presentadoAnte) {
    const VEREDICTO_LABEL: Record<string, string> = {
      REPARABLE: "Reparable",
      IRREPARABLE: "Irreparable",
      SIN_FALLA: "Sin falla detectada",
    }
    const CAUSA_LABEL: Record<string, string> = {
      CAIDA: "Caída",
      LIQUIDO: "Contacto con líquido",
      SOBRETENSION: "Sobretensión eléctrica",
      DESGASTE: "Desgaste por uso",
      USO_INDEBIDO: "Uso indebido",
      FALLA_FABRICA: "Falla de fábrica",
      DESCONOCIDA: "Desconocida",
    }

    // Corta el texto en lineas que entren en el ancho util. Si mas adelante se
    // factoriza un wrapper compartido en este archivo, reemplazar por ese.
    const wrap = (texto: string, maxW: number): string[] => {
      const salida: string[] = []
      let linea = ""
      for (const palabra of texto.split(/\s+/)) {
        const tentativa = linea ? `${linea} ${palabra}` : palabra
        if (helvetica.widthOfTextAtSize(tentativa, TYPE.body) > maxW && linea) {
          salida.push(linea)
          linea = palabra
        } else {
          linea = tentativa
        }
      }
      if (linea) salida.push(linea)
      return salida
    }

    const labelX = marginL + 10
    const valorX = marginL + 130

    drawSectionLabel(page, helveticaBold, tieneDictamen ? "DICTAMEN TÉCNICO" : "PRESENTACIÓN", marginL, cursor)
    cursor -= 4
    drawRule(page, marginL, pageW - marginR, cursor)
    cursor -= 20

    if (data.presentadoAnte) {
      page.drawText("Para ser presentado ante", { x: labelX, y: cursor, size: TYPE.small, font: helvetica, color: MONO.label })
      page.drawText(data.presentadoAnte, { x: valorX, y: cursor, size: TYPE.body, font: helveticaBold, color: MONO.ink })
      cursor -= 17
    }

    if (data.veredicto) {
      page.drawText("Veredicto", { x: labelX, y: cursor, size: TYPE.small, font: helvetica, color: MONO.label })
      page.drawText(VEREDICTO_LABEL[data.veredicto] || data.veredicto, { x: valorX, y: cursor, size: TYPE.body, font: helveticaBold, color: MONO.ink })
      cursor -= 17
    }

    if (data.causaDano) {
      page.drawText("Causa probable del daño", { x: labelX, y: cursor, size: TYPE.small, font: helvetica, color: MONO.label })
      page.drawText(CAUSA_LABEL[data.causaDano] || data.causaDano, { x: valorX, y: cursor, size: TYPE.body, font: helvetica, color: MONO.ink })
      cursor -= 17
    }

    if (data.diagnosticoTecnico) {
      page.drawText("Diagnóstico", { x: labelX, y: cursor, size: TYPE.small, font: helvetica, color: MONO.label })
      cursor -= 15
      for (const linea of wrap(data.diagnosticoTecnico, contentWidth - 20)) {
        page.drawText(linea, { x: labelX, y: cursor, size: TYPE.body, font: helvetica, color: MONO.ink })
        cursor -= 13
      }
    }

    cursor -= 14
  }
```

- [ ] **Step 7: Saltear la tabla de ítems y los totales**

En `lib/pdf.ts`, envolver el bloque que va desde la línea 447 (`// ====== ITEMS TABLE ======`) hasta la línea 569 inclusive (`cursor -= 35`) en:

```ts
  if (!esInformeTecnico) {
    // ... todo el bloque original de ITEMS TABLE + DETALLE/TOTALES, indentado ...
  }
```

Cuidado con `cursor`: todo lo que sigue (el banner de validez desde la línea 571) lo lee como punto de partida. Al saltear el bloque, `cursor` queda donde lo dejó el dictamen, que ya viene decrementado — no hace falta ajuste extra, pero verificarlo visualmente en el paso 9.

- [ ] **Step 8: Correr el test y verificar que pasa**

```bash
npx vitest run __tests__/lib/cotizacion-pdf.test.ts
```

Esperado: PASS. Los dos tests preexistentes que afirman `toContain("COTIZACIÓN")` para los fixtures `ORDEN` y `PRESUPUESTO` deben seguir pasando: esos fixtures tienen ítems y no tienen `veredicto`.

- [ ] **Step 9: Inspeccionar el PDF a ojo**

```bash
node -e "const {generateCotizacionPDF}=require('./lib/pdf.ts');" 2>/dev/null || echo "usar el test para volcar el buffer"
```

Si el import directo no funciona por TypeScript, agregar temporalmente al test un `fs.writeFileSync('/tmp/informe.pdf', buffer)` dentro del primer caso, correrlo, abrir el archivo y confirmar que el bloque de dictamen no pisa el banner de validez ni las notas. Borrar esa línea antes de commitear.

- [ ] **Step 10: Commit**

```bash
git add lib/pdf.ts lib/cotizacion-pdf.ts __tests__/lib/cotizacion-pdf.test.ts
git commit -m "feat(cotizaciones): el PDF dibuja el informe tecnico"
```

---

### Task 8: Los DTOs JSON exponen el dictamen

**Files:**
- Modify: `app/api/cotizaciones/[id]/route.ts` (el DTO del GET)
- Modify: `app/api/public/cotizaciones/[token]/route.ts` (el DTO público)
- Test: extender `__tests__/api/cotizaciones-informe-tecnico.test.ts`

**Interfaces:**
- Consumes: las columnas de Task 1
- Produces: los GET devuelven `veredicto`, `diagnosticoTecnico`, `causaDano`, `presentadoAnte` en camelCase

Sin esto el formulario de Task 10 no puede precargar lo guardado y la vista pública de Task 11 no sabe que es un informe.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `__tests__/api/cotizaciones-informe-tecnico.test.ts`:

```ts
import { GET as getCotizacion } from "@/app/api/cotizaciones/[id]/route"

describe("GET /api/cotizaciones/[id] — DTO del dictamen", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: 1, error: null } as any)
  })

  it("expone el dictamen en camelCase", async () => {
    mockAuthSuccess()
    mockSupabaseFrom({
      cotizaciones: createChainMock({
        id: "cot-1",
        organization_id: "org-1",
        estado: "ENVIADA",
        veredicto: "IRREPARABLE",
        diagnostico_tecnico: "Sin reparacion posible.",
        causa_dano: "LIQUIDO",
        presentado_ante: "La Segunda ART",
        items_cotizacion: [],
      }),
    })

    const res = await getCotizacion(
      new Request("http://localhost/api/cotizaciones/cot-1") as any,
      { params: Promise.resolve({ id: "cot-1" }) }
    )
    const body = await parseResponse(res)

    expect(body.veredicto).toBe("IRREPARABLE")
    expect(body.diagnosticoTecnico).toBe("Sin reparacion posible.")
    expect(body.causaDano).toBe("LIQUIDO")
    expect(body.presentadoAnte).toBe("La Segunda ART")
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

```bash
npx vitest run __tests__/api/cotizaciones-informe-tecnico.test.ts
```

Esperado: FAIL — `expected undefined to be "IRREPARABLE"`.

- [ ] **Step 3: Localizar los dos DTOs**

```bash
rg -n "numeroCotizacion:" app/api/cotizaciones/\[id\]/route.ts app/api/public/cotizaciones/\[token\]/route.ts
```

- [ ] **Step 4: Agregar los cuatro campos a cada DTO**

En cada uno de los objetos de respuesta encontrados, agregar:

```ts
      veredicto: cotizacion.veredicto ?? null,
      diagnosticoTecnico: cotizacion.diagnostico_tecnico ?? null,
      causaDano: cotizacion.causa_dano ?? null,
      presentadoAnte: cotizacion.presentado_ante ?? null,
```

Usar el nombre real de la variable de la fila en cada archivo (puede no ser `cotizacion`). Si el `.select()` de esa ruta enumera columnas, agregar las cuatro; si es `"*"`, no tocarlo.

- [ ] **Step 5: Correr el test y verificar que pasa**

```bash
npx vitest run __tests__/api/cotizaciones-informe-tecnico.test.ts
```

Esperado: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add app/api/cotizaciones/\[id\]/route.ts app/api/public/cotizaciones/\[token\]/route.ts __tests__/api/cotizaciones-informe-tecnico.test.ts
git commit -m "feat(cotizaciones): los DTOs exponen el dictamen tecnico"
```

---

### Task 9: Ningún camino permite aprobar un documento sin ítems

**Files:**
- Modify: `app/api/cotizaciones/[id]/aprobar/route.ts`
- Modify: `app/api/public/cotizaciones/[token]/aprobar/route.ts`
- Modify: `app/api/public/ordenes/[token]/approve-cotizacion/route.ts`
- Test: `__tests__/api/cotizaciones-informe-no-aprobable.test.ts`

**Interfaces:**
- Consumes: `esInforme` de Task 2
- Produces: los tres endpoints devuelven 400 ante un documento sin ítems

Un informe se emite; no se acepta ni se rechaza. Son **tres** caminos de aprobación distintos, y esconder el botón en la UI (Task 11) no cierra ninguno de los tres.

- [ ] **Step 1: Escribir el test que falla**

Crear `__tests__/api/cotizaciones-informe-no-aprobable.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createPostRequest,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn().mockResolvedValue(true),
}))

import { supabaseAdmin } from "@/lib/supabase"
import { POST as aprobarInterna } from "@/app/api/cotizaciones/[id]/aprobar/route"

const params = { params: Promise.resolve({ id: "cot-1" }) }

describe("aprobar un informe tecnico", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: 1, error: null } as any)
  })

  it("la ruta interna rechaza un documento sin items", async () => {
    mockAuthSuccess()
    mockSupabaseFrom({
      cotizaciones: createChainMock({
        id: "cot-1",
        estado: "ENVIADA",
        organization_id: "org-1",
        orden_id: null,
        veredicto: "IRREPARABLE",
        items_cotizacion: [],
      }),
      items_cotizacion: createChainMock([], null),
    })

    const res = await aprobarInterna(createPostRequest({}), params)
    const body = await parseResponse(res)

    expect(res.status).toBe(400)
    expect(body.error).toContain("informe")
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

```bash
npx vitest run __tests__/api/cotizaciones-informe-no-aprobable.test.ts
```

Esperado: FAIL — la ruta hoy aprueba sin chequear nada.

- [ ] **Step 3: Agregar el guard en las tres rutas**

En cada una de las tres rutas, después de cargar la cotización y antes de llamar al RPC de aprobación, insertar:

```ts
    const { count: itemsCount } = await supabaseAdmin
      .from("items_cotizacion")
      .select("id", { count: "exact", head: true })
      .eq("cotizacion_id", cotizacionId)

    // Un informe tecnico se emite, no se aprueba. Hay tres caminos de
    // aprobacion distintos y esconder el boton en la UI no cierra ninguno.
    if (esInforme({ cantidadItems: itemsCount || 0, veredicto: cotizacion.veredicto })) {
      return NextResponse.json(
        { error: "Un informe técnico no se aprueba: es un dictamen, no un presupuesto." },
        { status: 400 }
      )
    }
```

Agregar en cada archivo:

```ts
import { esInforme } from "@/lib/cotizacion-informe"
```

Usar en cada ruta el nombre real de la variable con el id de la cotización (en las públicas se resuelve desde el token, no viene por `params.id`) y el de la fila cargada. Verificar que el `.select()` de cada una traiga `veredicto`.

- [ ] **Step 4: Correr el test y verificar que pasa**

```bash
npx vitest run __tests__/api/cotizaciones-informe-no-aprobable.test.ts
```

Esperado: PASS.

- [ ] **Step 5: Verificar que no rompimos la aprobación normal**

```bash
npx vitest run __tests__/api/aprobar-cotizacion-atomica.test.ts __tests__/api/public-aprobar-cotizacion-atomica.test.ts
```

Esperado: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/cotizaciones/\[id\]/aprobar/route.ts app/api/public/cotizaciones/\[token\]/aprobar/route.ts app/api/public/ordenes/\[token\]/approve-cotizacion/route.ts __tests__/api/cotizaciones-informe-no-aprobable.test.ts
git commit -m "fix(cotizaciones): un informe tecnico no se puede aprobar"
```

---

### Task 10: Cerrar el PR 1

**Files:**
- Ninguno (verificación y entrega)

- [ ] **Step 1: Verificación completa**

```bash
npm run test:run
```

Esperado: PASS.

```bash
npx tsc --noEmit
```

Esperado: sin salida. El lint no chequea tipos, así que este paso no es opcional.

```bash
npx eslint app lib components
```

Esperado: sin errores. **No** usar `npm run lint`: recorre los ~17 worktrees y no termina.

- [ ] **Step 2: Reverificar el número de migración**

```bash
git fetch origin
git log --all --diff-filter=A --name-only --pretty=format: -- 'supabase/migrations/32*' | rg -v '^$' - | sort -u
```

Si apareció otro 324, renombrar los dos archivos al siguiente libre y volver al paso 1.

- [ ] **Step 3: Aplicar la migración en producción ANTES de mergear**

```bash
node scripts/db-run.mjs supabase/migrations/324_informe_tecnico_cotizacion.sql --apply
```

Confirmar el flag real con `node scripts/db-run.mjs --help` — el script corre en dry-run por default.

Verificar que quedó:

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'cotizaciones'
  AND column_name IN ('veredicto','diagnostico_tecnico','causa_dano','presentado_ante');
```

Esperado: cuatro filas.

**Este paso va antes del merge, no después.** Si el código llega a producción sin las columnas, PostgREST devuelve `PGRST204`, el deploy queda verde y las escrituras se pierden en silencio.

- [ ] **Step 4: Abrir el PR**

```bash
git push -u origin feat/informe-tecnico-cotizaciones
gh pr create --title "feat(cotizaciones): informe tecnico para seguros (dominio)" --body "..."
```

En el cuerpo: qué hace, que la migración 324 **ya está aplicada**, que no hay cambio visible todavía, y la lista de lo que encontró el barrido de `PRESUPUESTADO` del Task 5 Step 6.

- [ ] **Step 5: Confirmar que el CI arrancó**

```bash
gh pr checks
```

Deben aparecer Lint, Build, Unit y E2E. Si no aparece ninguno, chequear primero `gh pr view <n> --json mergeable`: un PR en conflicto **no dispara Actions y no avisa**. Si no está en conflicto, patear con close + reopen.

---

## PR 2 — Interfaz

Depende del PR 1 mergeado y de la migración aplicada. Rama hija: `feat/informe-tecnico-ui`, creada desde `feat/informe-tecnico-cotizaciones`.

**Nota sobre los tests de este PR.** En las tareas 11 a 13 el paso "escribir el test" describe los casos en vez de darlos escritos, a diferencia del PR 1. Es deliberado: son componentes de 600 a 1050 líneas cuyo idioma exacto de montaje (contextos `useCurrency`, `useModal`, `useTerminologia`, mocks de `fetch`) no está a la vista en este plan, y un test inventado contra props que no existen cuesta más de lo que ahorra. Cada tarea nombra el archivo de test existente del que hay que copiar el idioma. Leerlo **antes** de escribir el caso.

---

### Task 11: Sección "Informe técnico" en el formulario

**Files:**
- Modify: `components/cotizaciones/cotizacion-form.tsx` (estado ~133-210, payload 423-433, JSX entre 800 y 802)
- Test: `__tests__/components/cotizacion-form-informe.test.tsx`

**Interfaces:**
- Consumes: `VEREDICTOS`, `CAUSAS_DANO` de `lib/cotizacion-informe`; `GET /api/cotizaciones/entidades` de Task 6; los campos camelCase del DTO de Task 8
- Produces: el payload lleva `veredicto`, `diagnosticoTecnico`, `causaDano`, `presentadoAnte`

- [ ] **Step 1: Escribir el test que falla**

Crear `__tests__/components/cotizacion-form-informe.test.tsx`, siguiendo el idioma de mockeo de `__tests__/components/cotizacion-form-iva-pais.test.tsx` (leerlo primero: define cómo se montan los contextos `useCurrency`, `useModal` y `useTerminologia`).

Casos:
1. Elegir "Irreparable" colapsa la tabla de ítems y muestra un aviso.
2. El payload enviado incluye `veredicto`, `diagnosticoTecnico`, `causaDano` y `presentadoAnte`.
3. Con `initialData` que trae el dictamen, los campos aparecen precargados.
4. En un documento **nuevo** colgado de una orden, el diagnóstico se precarga desde la orden.
5. En un documento **en edición**, el diagnóstico guardado **no** se pisa con el de la orden. Este es el caso que protege la inmutabilidad del documento emitido.

- [ ] **Step 2: Correr el test y verificar que falla**

```bash
npx vitest run __tests__/components/cotizacion-form-informe.test.tsx
```

- [ ] **Step 3: Agregar el estado**

Después de la línea 205 (`const [checklistValue, setChecklistValue] = ...`):

```tsx
  const [veredicto, setVeredicto] = useState<string | null>(initialData?.veredicto ?? null)
  const [diagnosticoTecnico, setDiagnosticoTecnico] = useState(initialData?.diagnosticoTecnico ?? "")
  const [causaDano, setCausaDano] = useState<string | null>(initialData?.causaDano ?? null)
  const [presentadoAnte, setPresentadoAnte] = useState(initialData?.presentadoAnte ?? "")
  const [entidades, setEntidades] = useState<string[]>([])

  // Sin items no hay presupuesto: el documento se emite como informe tecnico.
  const sinPresupuesto = veredicto === "IRREPARABLE" || veredicto === "SIN_FALLA"

  // El diagnostico de la orden se PRECARGA una sola vez, en un documento nuevo
  // y solo si el campo esta vacio. Lo que se persiste es la copia congelada: la
  // orden sigue mutando despues, y un documento presentado ante una aseguradora
  // no puede cambiar solo. Por eso no es un efecto que sincronice, es un
  // arranque. Nunca pisar lo que el tecnico ya escribio.
  useEffect(() => {
    if (isEditing || !linkedOrdenId || diagnosticoTecnico) return
    let vivo = true
    fetch(`/api/ordenes/${linkedOrdenId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (vivo && d?.diagnostico) setDiagnosticoTecnico(d.diagnostico)
      })
      .catch(() => {})
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedOrdenId])

  useEffect(() => {
    let vivo = true
    fetch("/api/cotizaciones/entidades")
      .then((r) => (r.ok ? r.json() : { entidades: [] }))
      .then((d) => { if (vivo) setEntidades(d.entidades || []) })
      .catch(() => {})
    return () => { vivo = false }
  }, [])
```

- [ ] **Step 4: Agregar al payload**

En el objeto `payload` (líneas 423-433), agregar:

```tsx
        veredicto: veredicto || undefined,
        diagnosticoTecnico: diagnosticoTecnico.trim() || undefined,
        causaDano: causaDano || undefined,
        presentadoAnte: presentadoAnte.trim() || undefined,
```

Y donde se arma `validItems`, cuando `sinPresupuesto` es true, mandar `items: []`.

- [ ] **Step 5: Agregar la sección al JSX**

Entre la línea 800 (`)}`, cierre de "Condiciones técnicas") y la 802 (`{/* Ítems */}`), insertar un `<CollapsibleSection title="Informe técnico" icon={FileText}>` con:

- tres botones excluyentes para el veredicto (etiquetas: "Reparable", "Irreparable", "Sin falla detectada")
- un `<Textarea>` para el diagnóstico
- un `<Select>` de causa con las siete opciones y las etiquetas en castellano del Task 7 Step 6
- un `<Input list="entidades-informe">` para "Para ser presentado ante" más un `<datalist id="entidades-informe">` alimentado por `entidades`

Y envolver el `<CollapsibleSection title="Ítems">` de la línea 803 en `{!sinPresupuesto && ( ... )}`, mostrando en su lugar, cuando `sinPresupuesto` es true, un aviso:

```tsx
{sinPresupuesto && (
  <p className="text-sm text-muted-foreground border rounded-md p-3">
    Este documento se va a emitir como informe técnico, sin presupuesto ni ítems.
  </p>
)}
```

- [ ] **Step 6: Correr el test y verificar que pasa**

```bash
npx vitest run __tests__/components/cotizacion-form-informe.test.tsx
```

- [ ] **Step 7: Commit**

```bash
git add components/cotizaciones/cotizacion-form.tsx __tests__/components/cotizacion-form-informe.test.tsx
git commit -m "feat(cotizaciones): seccion de informe tecnico en el formulario"
```

---

### Task 12: La vista pública de un informe no ofrece aprobar ni rechazar

**Files:**
- Modify: `components/cotizaciones/cotizacion-publica.tsx`
- Test: `__tests__/components/cotizacion-publica-informe.test.tsx`

**Interfaces:**
- Consumes: `veredicto`, `diagnosticoTecnico`, `causaDano`, `presentadoAnte` del DTO público (Task 8)
- Produces: nada

- [ ] **Step 1: Localizar los controles**

```bash
rg -n "Aprobar|Rechazar|firma|Firma" components/cotizaciones/cotizacion-publica.tsx | head -30
```

- [ ] **Step 2: Escribir el test que falla**

Crear `__tests__/components/cotizacion-publica-informe.test.tsx`. Casos:
1. Con `items: []` y `veredicto: "IRREPARABLE"`, no se renderizan los botones de aprobar ni de rechazar ni el canvas de firma.
2. Con ítems, los tres siguen ahí.
3. El dictamen (veredicto, causa, diagnóstico) y la entidad se muestran.

- [ ] **Step 3: Correr el test y verificar que falla**

```bash
npx vitest run __tests__/components/cotizacion-publica-informe.test.tsx
```

- [ ] **Step 4: Implementar**

Derivar en el componente:

```tsx
const esInformeTecnico = (cotizacion.items?.length ?? 0) === 0 && !!cotizacion.veredicto
```

Envolver los controles de aprobación, rechazo y firma en `{!esInformeTecnico && ( ... )}`, y agregar un bloque de lectura con el dictamen y la línea "Para ser presentado ante".

- [ ] **Step 5: Correr el test y verificar que pasa**

```bash
npx vitest run __tests__/components/cotizacion-publica-informe.test.tsx
```

- [ ] **Step 6: Commit**

```bash
git add components/cotizaciones/cotizacion-publica.tsx __tests__/components/cotizacion-publica-informe.test.tsx
git commit -m "feat(cotizaciones): la vista publica de un informe no se aprueba"
```

---

### Task 13: Invertir el default del selector de ítems

**Files:**
- Modify: `components/cotizaciones/item-row.tsx:78-80` (estado), `:209-266` (móvil) y su gemelo de escritorio
- Test: `__tests__/components/cotizacion-item-row-default.test.tsx`

**Interfaces:**
- Consumes: nada nuevo
- Produces: nada

**El gap que esto cierra.** La búsqueda de los dos catálogos **ya existe** en `item-row.tsx:117-128` y es mejor que la de órdenes: consulta `/api/inventario/search` y `/api/servicios?buscar=` en paralelo y los fusiona en un único desplegable. El problema es que la fila nace como texto libre (`:255-262`) y el buscador vive detrás de un botón ícono `Package` sin etiqueta (`:264-266`), así que el taller nunca se entera de que puede traer del inventario.

- [ ] **Step 1: Escribir el test que falla**

Crear `__tests__/components/cotizacion-item-row-default.test.tsx`. Casos:
1. Una fila vacía (`descripcion: ""`, sin `inventarioId` ni `servicioId`) renderiza el input con placeholder "Buscar producto o servicio…".
2. Una fila con descripción cargada renderiza el input de descripción, **no** el buscador. Este es el caso que protege a las cotizaciones en `BORRADOR` que ya existen.
3. El enlace "Escribir a mano" cambia la fila vacía a texto libre.

- [ ] **Step 2: Correr el test y verificar que falla**

```bash
npx vitest run __tests__/components/cotizacion-item-row-default.test.tsx
```

Esperado: FAIL en el caso 1 — hoy la fila vacía muestra "Descripción del item".

- [ ] **Step 3: Implementar**

Reemplazar la línea 80:

```tsx
  const [showInvSearch, setShowInvSearch] = useState(false)
```

por:

```tsx
  // La fila nueva arranca en modo busqueda. La capacidad de traer del catalogo
  // ya existia, pero vivia detras de un boton icono sin etiqueta y el taller no
  // se enteraba. Una fila que ya tiene descripcion NO abre el buscador: las
  // cotizaciones en BORRADOR que ya existen se siguen editando como siempre.
  const [showInvSearch, setShowInvSearch] = useState(
    !item.descripcion && !item.inventarioId && !item.servicioId
  )
```

Y en los dos layouts (móvil `:209-266` y su gemelo de escritorio), agregar debajo del input de búsqueda, cuando `showInvSearch` es true y la fila no está vinculada:

```tsx
<button
  type="button"
  className="mt-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
  onClick={() => { setShowInvSearch(false); setInvSearch(""); setInvResults([]) }}
  disabled={disabled}
>
  Escribir a mano
</button>
```

- [ ] **Step 4: Correr el test y verificar que pasa**

```bash
npx vitest run __tests__/components/cotizacion-item-row-default.test.tsx
```

- [ ] **Step 5: Verificar que no rompimos los tests de ítems que ya existían**

```bash
npx vitest run __tests__/components --reporter=dot
```

Prestar atención a `cotizacion-item-payload.test.ts`, `cotizacion-list-prefill-repuestos.test.tsx` y `cotizacion-form-mostrar-costos.test.tsx`.

- [ ] **Step 6: Commit**

```bash
git add components/cotizaciones/item-row.tsx __tests__/components/cotizacion-item-row-default.test.tsx
git commit -m "feat(cotizaciones): la fila de item arranca en modo busqueda"
```

---

### Task 14: Cerrar el PR 2

- [ ] **Step 1: Verificación completa**

```bash
npm run test:run
npx tsc --noEmit
npx eslint app lib components
```

- [ ] **Step 2: Reproducir con un build real**

```bash
npx next build && npx next start
```

La suite verde no ve bugs de bundle. Abrir el formulario, emitir un informe irreparable de punta a punta y descargar el PDF.

- [ ] **Step 3: Abrir el PR contra `feat/informe-tecnico-cotizaciones`**

Si el PR 1 ya mergeó a `main`, rebasar y apuntar a `main`.

---

## Pruebas manuales antes de dar por cerrado

Ninguna de estas la cubre la suite:

1. **Editar una cotización `BORRADOR` preexistente.** Las filas ya cargadas muestran su descripción y no el buscador. Es la regresión más probable de Task 13.
2. **Emitir un informe irreparable de punta a punta** y verificar en la base que la orden vinculada **no** pasó a `PRESUPUESTADO`.
3. **Abrir el link público de un informe**: no deben aparecer Aprobar, Rechazar ni la firma.
4. **Imprimir el PDF del informe**: el bloque de dictamen no pisa el banner de validez, el diagnóstico largo corta bien en varias líneas, y no hay tabla de ítems ni fila de TOTAL.
5. **Un presupuesto con dictamen**: ítems + veredicto REPARABLE dibuja las dos cosas y el título sigue diciendo COTIZACIÓN.
6. **El autocompletado de entidades**: cargar dos informes con la misma aseguradora y confirmar que en el tercero aparece sugerida.
7. **La copia congelada del diagnóstico**: emitir un informe desde una orden, después editar el diagnóstico **de la orden**, y confirmar que el informe sigue mostrando el texto original.
