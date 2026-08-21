# Recepción Múltiple en Mostrador — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un cliente pueda dejar N equipos (mínimo 2) en una sola atención de mostrador, generando una orden por equipo, agrupadas bajo un comprobante de recepción con una sola firma.

**Architecture:** Tabla `recepciones` como dueña de la firma y del documento, más `ordenes_servicio.recepcion_id` nullable. La creación va por una RPC transaccional (`crear_recepcion_multiple`) que inserta la recepción y las N órdenes en un solo commit. `POST /api/ordenes` y la máquina de estados no se tocan: cada orden sigue siendo la unidad atómica del ciclo de vida. Feature gateada a los planes Profesional y Pro, con el flag efectivo resuelto en server components.

**Tech Stack:** Next.js App Router, TypeScript, Supabase (Postgres + plpgsql + Storage), NextAuth, react-hook-form + zod, Tailwind, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-07-25-recepcion-multiple-mostrador-design.md`

## Global Constraints

- **`POST /api/ordenes` y `PUT /api/ordenes/[id]` no se modifican.** Ni una línea. Cualquier tarea que necesite tocarlos está mal planteada.
- **No se toca la máquina de estados** (`lib/orden-state-machine.ts`) ni `lib/orden-transicion.ts`.
- **`recepciones` no lleva columna `estado`.** Es un documento, no una entidad con ciclo de vida. Si alguien siente la necesidad de agregarla, el diseño se rompió.
- **`ordenes_servicio.recepcion_id` es nullable y su índice es parcial** (`WHERE recepcion_id IS NOT NULL`). El flujo clásico deja `NULL` siempre.
- **Feature key exacta:** `recepcion_multiple`. Planes: `profesional` y `pro`.
- **Mínimo 2 equipos** por recepción, validado en Zod y en la RPC.
- **El flujo múltiple no captura** `presupuesto`, `sena`, `metodoPagoSena`, `fechaPrometida`, `tecnicoId`, `sectorId` ni `fromTurnoId`. Estado inicial siempre `RECIBIDO`.
- **`ordenes_servicio.tipo_dispositivo` es `TEXT`, no enum** (migración 033). No escribir casts a `::tipo_dispositivo`.
- **No usar `gen_random_bytes` en SQL** (depende de pgcrypto, no garantizado). Los `public_token` se generan en TypeScript con `randomBytes(16).toString("hex")` y entran a la RPC como dato.
- **No usar `useHasFeature` para gatear esta feature.** No aplica overrides por organización (ver Task 9).
- **Artefactos en castellano neutro** para strings de UI, siguiendo el resto del panel. Comentarios de código en castellano neutro, consistente con los archivos vecinos.
- **Verificar el número de migración libre contra `origin/main` recién fetcheado**, y volver a chequearlo justo antes de mergear — no solo al crear el archivo. Esto pasó de verdad en esta branch: se escribió como `277`, y mientras el trabajo avanzaba `origin/main` recibió `277_trigger_recalcular_estado_cobro.sql`. Git no marca la colisión (los nombres difieren), pero las migraciones acá se aplican a mano en orden numérico. Se renumeró a `278`/`279` al cerrar. Volvió a colisionar antes del merge final (`origin/main` ya tenía `281`/`284`/`285` aplicadas y otra branch reservaba `286`): se renumeró otra vez, a `287`/`288`.
- Comandos: `npm test` (Vitest, watch), `npx vitest run <path>` (una sola corrida), `npm run test:e2e` (Playwright), `npx tsc --noEmit` (typecheck), `npm run lint`.
- **Nunca agregar `Co-Authored-By` ni atribución de IA a los commits.** Conventional commits.

---

## File Structure

**Se crean:**

| Archivo | Responsabilidad |
|---|---|
| `supabase/migrations/287_recepcion_multiple.sql` | Tabla `recepciones`, FK + índice parcial en `ordenes_servicio`, RLS, feature flag en planes |
| `supabase/migrations/288_crear_recepcion_multiple.sql` | RPC transaccional |
| `app/api/recepciones/route.ts` | `POST`: gate de plan, validación, RPC, fotos, auditoría |
| `hooks/use-tipo-dispositivo-config.ts` | Resolución del `config` por tipo (compartido por ambos flujos) |
| `components/ordenes/fotos-ingreso.tsx` | Captura y preview de fotos, agnóstico de RHF |
| `components/ordenes/accesorios-picker.tsx` | Checkboxes de accesorios + "otro", agnóstico de RHF |
| `components/ordenes/tipo-dispositivo-picker.tsx` | Grilla de selección de tipo, controlado |
| `components/ordenes/campos-extra-fields.tsx` | Campos dinámicos del `config`, controlado |
| `app/(dashboard)/ordenes/recepcion/page.tsx` | Server component: gate + render del flujo |
| `components/ordenes/recepcion-form.tsx` | Formulario de N equipos (`useFieldArray`) |
| `components/ordenes/thermal-print-recepcion.tsx` | Comprobante térmico del lote |
| `components/ordenes/recepcion-creada-modal.tsx` | Éxito: comprobante, N etiquetas, WhatsApp agrupado |
| `lib/recepcion-whatsapp.ts` | Armado del mensaje agrupado con los N links |

**Se modifican:**

| Archivo | Cambio |
|---|---|
| `lib/tipos-dispositivo-defaults.ts` | Recibe `FALLBACK_CONFIG` (movido desde `orden-form.tsx:41`) |
| `components/ordenes/orden-form.tsx` | Sustituye 4 bloques de JSX por los componentes extraídos. Sin tocar el schema de RHF, `register` ni el submit |
| `app/(dashboard)/ordenes/page.tsx` | Pasa a `async`, resuelve el flag y lo baja como prop |
| `components/ordenes/ordenes-list.tsx` | Nueva prop `canRecepcionMultiple` + botón secundario |
| `app/api/ordenes/[id]/pdf/route.ts:163` | Fallback de firma al lote |
| `app/api/public/ordenes/[token]/pdf/route.ts:123` | Mismo fallback |

**Tests:**

| Archivo | Qué cubre |
|---|---|
| `__tests__/api/ordenes-recepcion-null.test.ts` | Regresión: el flujo clásico no escribe `recepcion_id` |
| `__tests__/hooks/use-tipo-dispositivo-config.test.ts` | Resolución de config y derivados |
| `__tests__/api/recepcion-multiple-gate.test.ts` | 403 sin feature, 200 con override |
| `__tests__/api/recepcion-multiple-atomica.test.ts` | Rollback total ante error de la RPC |
| `__tests__/api/recepcion-firma-unica.test.ts` | La firma va una sola vez a `recepciones` |
| `__tests__/lib/recepcion-whatsapp.test.ts` | Mensaje agrupado con N links |
| `e2e/recepcion-multiple.auth.spec.ts` | Flujo completo de mostrador |

---

## Task 1: Test de regresión del flujo clásico

Esta tarea es el guardarraíl de todo el plan. Va **primera** y su test tiene que seguir verde en cada tarea posterior. Prueba que el alta de una orden por el camino de siempre no escribe `recepcion_id`.

**Files:**
- Test: `__tests__/api/ordenes-recepcion-null.test.ts` (crear)

**Interfaces:**
- Consumes: helpers de `__tests__/api/helpers.ts` (`mockAuthSuccess`, `createChainMock`, `mockSupabaseFrom`, `createPostRequest`, `parseResponse`); `POST` de `app/api/ordenes/route.ts`
- Produces: nada. Es un test de regresión puro.

- [ ] **Step 1: Escribir el test que falla**

Crear `__tests__/api/ordenes-recepcion-null.test.ts`:

```ts
/**
 * Regresión: el alta clásica de órdenes NO debe escribir `recepcion_id`.
 *
 * La recepción múltiple agrega `ordenes_servicio.recepcion_id` como columna
 * nullable. Este test fija el contrato de que el flujo de siempre la deja
 * intacta, para que ningún taller que recibe un equipo por vez cambie de
 * comportamiento.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createPostRequest,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/plan-limits", () => ({
  enforcePlanLimit: vi.fn().mockResolvedValue(null),
  isPlanLimitError: vi.fn().mockReturnValue(false),
  planLimitErrorResponse: vi.fn(),
}))
vi.mock("@/lib/counters", () => ({
  getNextOrderNumberByType: vi.fn().mockResolvedValue({ codigo: "CEL001", numero: 1 }),
}))
vi.mock("@/lib/operadores", () => ({
  resolveOperador: vi.fn().mockResolvedValue("user-1"),
}))
vi.mock("@/lib/sucursal", () => ({
  sucursalParaEscritura: vi.fn().mockResolvedValue("suc-1"),
  sucursalParaLectura: vi.fn().mockResolvedValue({ verTodas: true, sucursalId: null }),
}))
vi.mock("@/lib/notifications/queue", () => ({
  queueNotification: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/audit", () => ({
  createAuditLogger: () => ({ create: vi.fn().mockResolvedValue(undefined) }),
}))
vi.mock("@/lib/tipos-dispositivo-config", () => ({
  tipoValidaImei: vi.fn().mockResolvedValue(false),
}))

import { supabaseAdmin } from "@/lib/supabase"
import { POST } from "@/app/api/ordenes/route"

const validBody = {
  clienteId: "cli-1",
  dispositivo: "iPhone 13",
  tipoDispositivo: "CELULAR",
  problemaReportado: "No enciende",
}

const ordenCreada = {
  id: "ord-1",
  numero_orden: 1,
  codigo_orden: "CEL001",
  cliente_id: "cli-1",
  organization_id: "org-1",
  dispositivo: "iPhone 13",
  tipo_dispositivo: "CELULAR",
  estado: "RECIBIDO",
  public_token: "tok-1",
  sucursal_id: "suc-1",
  clientes: { id: "cli-1", nombre: "Juan", email: null, telefono: "1122334455" },
}

describe("POST /api/ordenes — regresión recepcion_id", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess()
  })

  it("no incluye recepcion_id en el insert", async () => {
    const ordenesChain = createChainMock(ordenCreada, null)
    mockSupabaseFrom({
      ordenes_servicio: ordenesChain,
      organizations: createChainMock({ nombre: "Taller", slug: "taller" }, null),
      orden_eventos: createChainMock(null, null),
    })

    const res = await POST(createPostRequest(validBody))
    const { status } = await parseResponse(res)

    expect(status).toBe(201)
    expect(ordenesChain.insert).toHaveBeenCalledTimes(1)

    const payload = ordenesChain.insert.mock.calls[0][0] as Record<string, unknown>
    expect("recepcion_id" in payload).toBe(false)
  })

  it("crea la orden en estado RECIBIDO sin lote asociado", async () => {
    const ordenesChain = createChainMock(ordenCreada, null)
    mockSupabaseFrom({
      ordenes_servicio: ordenesChain,
      organizations: createChainMock({ nombre: "Taller", slug: "taller" }, null),
      orden_eventos: createChainMock(null, null),
    })

    await POST(createPostRequest(validBody))

    const payload = ordenesChain.insert.mock.calls[0][0] as Record<string, unknown>
    expect(payload.estado).toBe("RECIBIDO")
  })
})
```

- [ ] **Step 2: Correr el test y verificar que PASA**

Run: `npx vitest run __tests__/api/ordenes-recepcion-null.test.ts`
Expected: PASS (2 tests). Este test pasa desde el minuto cero a propósito: documenta el comportamiento actual para que las tareas siguientes no lo rompan. Si falla acá, el mock está mal armado y hay que arreglarlo antes de seguir.

- [ ] **Step 3: Commit**

```bash
git add __tests__/api/ordenes-recepcion-null.test.ts
git commit -m "test(ordenes): fijar que el alta clasica no escribe recepcion_id"
```

---

## Task 2: Extraer la resolución de config a un hook compartido

La lógica que deriva accesorios, marcas, campos extra y visibilidad de campos desde el `config` del tipo de dispositivo vive hoy inline en `orden-form.tsx:262-275`. Es exactamente lo que el flujo múltiple necesita **por equipo**. Se extrae a un hook con test propio.

**Files:**
- Create: `hooks/use-tipo-dispositivo-config.ts`
- Modify: `lib/tipos-dispositivo-defaults.ts` (agregar `FALLBACK_CONFIG`)
- Modify: `components/ordenes/orden-form.tsx:41-...` (borrar `FALLBACK_CONFIG` local) y `:255-275` (usar el hook)
- Test: `__tests__/hooks/use-tipo-dispositivo-config.test.ts`

**Interfaces:**
- Consumes: tipo `TipoDispositivoConfig` y `CampoExtra` de `@/types`
- Produces:
  ```ts
  function useTipoDispositivoConfig(
    tipos: Array<{ codigo: string; nombre: string; config?: TipoDispositivoConfig | null }>,
    codigoSeleccionado: string
  ): {
    config: TipoDispositivoConfig
    accesoriosDisponibles: Array<{ id: string; label: string }>
    problemasComunes: string[]
    marcasDisponibles: string[]
    camposExtra: CampoExtra[]
    showImei: boolean
    showPassword: boolean
    showColor: boolean
    showMarca: boolean
  }
  ```
  Lo usan Task 4 (`tipo-dispositivo-picker`, `campos-extra-fields`) y Task 10 (`recepcion-form`).

- [ ] **Step 1: Mover `FALLBACK_CONFIG` al archivo client-safe**

`lib/tipos-dispositivo-config.ts` importa `supabaseAdmin`, así que es **server-only** y no puede importarse desde un componente cliente. `lib/tipos-dispositivo-defaults.ts` no tiene ningún import, así que es el destino correcto.

Cortar el bloque `const FALLBACK_CONFIG: TipoDispositivoConfig = { ... }` que arranca en `components/ordenes/orden-form.tsx:41` y pegarlo al final de `lib/tipos-dispositivo-defaults.ts`, exportándolo:

```ts
import type { TipoDispositivoConfig } from "@/types"

/** Config por defecto para tipos sin `config` en la base. */
export const FALLBACK_CONFIG: TipoDispositivoConfig = {
  // ...contenido movido tal cual desde orden-form.tsx
}
```

- [ ] **Step 2: Escribir el test que falla**

Crear `__tests__/hooks/use-tipo-dispositivo-config.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { renderHook } from "@testing-library/react"
import { useTipoDispositivoConfig } from "@/hooks/use-tipo-dispositivo-config"
import { FALLBACK_CONFIG } from "@/lib/tipos-dispositivo-defaults"

const tipos = [
  {
    codigo: "CELULAR",
    nombre: "Celular",
    config: {
      campos: { imei: { visible: true }, password: { visible: true }, color: { visible: true }, marca: { visible: true } },
      accesorios: [{ id: "cargador", label: "Cargador" }],
      problemasComunes: ["No enciende"],
      marcas: ["Apple", "Samsung"],
      camposExtra: [],
    },
  },
  { codigo: "CONSOLA", nombre: "Consola", config: { campos: { imei: { visible: false }, marca: { visible: false } } } },
  { codigo: "SIN_CONFIG", nombre: "Sin config", config: {} },
]

describe("useTipoDispositivoConfig", () => {
  it("devuelve los derivados del config del tipo seleccionado", () => {
    const { result } = renderHook(() => useTipoDispositivoConfig(tipos as any, "CELULAR"))
    expect(result.current.marcasDisponibles).toEqual(["Apple", "Samsung"])
    expect(result.current.accesoriosDisponibles).toEqual([{ id: "cargador", label: "Cargador" }])
    expect(result.current.showImei).toBe(true)
  })

  it("respeta la visibilidad en false", () => {
    const { result } = renderHook(() => useTipoDispositivoConfig(tipos as any, "CONSOLA"))
    expect(result.current.showImei).toBe(false)
    expect(result.current.showMarca).toBe(false)
  })

  it("cae al FALLBACK_CONFIG cuando el tipo tiene config vacio", () => {
    const { result } = renderHook(() => useTipoDispositivoConfig(tipos as any, "SIN_CONFIG"))
    expect(result.current.config).toEqual(FALLBACK_CONFIG)
  })

  it("cae al FALLBACK_CONFIG cuando no hay tipo seleccionado", () => {
    const { result } = renderHook(() => useTipoDispositivoConfig(tipos as any, ""))
    expect(result.current.config).toEqual(FALLBACK_CONFIG)
  })
})
```

- [ ] **Step 3: Correr el test y verificar que FALLA**

Run: `npx vitest run __tests__/hooks/use-tipo-dispositivo-config.test.ts`
Expected: FAIL con "Failed to resolve import @/hooks/use-tipo-dispositivo-config"

- [ ] **Step 4: Implementar el hook**

Crear `hooks/use-tipo-dispositivo-config.ts`:

```ts
"use client"

import { useMemo } from "react"
import { FALLBACK_CONFIG } from "@/lib/tipos-dispositivo-defaults"
import type { TipoDispositivoConfig, CampoExtra } from "@/types"

interface TipoOption {
  codigo: string
  nombre: string
  config?: TipoDispositivoConfig | null
}

/**
 * Resuelve el config efectivo de un tipo de dispositivo y sus derivados.
 * Compartido por el alta de una orden y por la recepción múltiple, donde se
 * usa una vez por equipo.
 */
export function useTipoDispositivoConfig(tipos: TipoOption[], codigoSeleccionado: string) {
  return useMemo(() => {
    const tipoSeleccionado = tipos.find((t) => t.codigo === codigoSeleccionado)
    const config: TipoDispositivoConfig =
      tipoSeleccionado?.config && Object.keys(tipoSeleccionado.config).length > 0
        ? tipoSeleccionado.config
        : FALLBACK_CONFIG

    return {
      config,
      accesoriosDisponibles: config.accesorios || FALLBACK_CONFIG.accesorios!,
      problemasComunes: config.problemasComunes || FALLBACK_CONFIG.problemasComunes!,
      marcasDisponibles: config.marcas || [],
      camposExtra: (config.camposExtra || []) as CampoExtra[],
      showImei: config.campos?.imei?.visible !== false,
      showPassword: config.campos?.password?.visible !== false,
      showColor: config.campos?.color?.visible !== false,
      showMarca: config.campos?.marca?.visible !== false,
    }
  }, [tipos, codigoSeleccionado])
}
```

- [ ] **Step 5: Correr el test y verificar que PASA**

Run: `npx vitest run __tests__/hooks/use-tipo-dispositivo-config.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Cablear el hook en `orden-form.tsx`**

Reemplazar el bloque `components/ordenes/orden-form.tsx:255-275` (desde `const tipoSeleccionado = useMemo(...)` hasta la última línea de derivados `showMarca`) por:

```ts
const {
  config,
  accesoriosDisponibles,
  problemasComunes,
  marcasDisponibles,
  camposExtra,
  showImei,
  showPassword,
  showColor,
  showMarca,
} = useTipoDispositivoConfig(tiposDispositivo, tipoDispositivo)
```

Agregar el import `import { useTipoDispositivoConfig } from "@/hooks/use-tipo-dispositivo-config"` y borrar el import de `FALLBACK_CONFIG` si quedó sin uso. **No cambiar ningún nombre de variable** — el JSX de abajo los consume tal cual, así que la sustitución es transparente.

- [ ] **Step 7: Verificar que nada se rompió**

Run: `npx tsc --noEmit`
Expected: sin errores

Run: `npx vitest run`
Expected: PASS, incluido `__tests__/api/ordenes-recepcion-null.test.ts` de Task 1

- [ ] **Step 8: Commit**

```bash
git add hooks/use-tipo-dispositivo-config.ts __tests__/hooks/use-tipo-dispositivo-config.test.ts lib/tipos-dispositivo-defaults.ts components/ordenes/orden-form.tsx
git commit -m "refactor(ordenes): extraer resolucion de config de tipo a hook compartido"
```

---

## Task 3: Extraer `fotos-ingreso.tsx` y `accesorios-picker.tsx`

Los dos bloques con menos riesgo: se alimentan de estado local, sin nada de react-hook-form. La extracción es sustitución de JSX con las mismas props que ya estaban en scope.

**Files:**
- Create: `components/ordenes/fotos-ingreso.tsx`
- Create: `components/ordenes/accesorios-picker.tsx`
- Modify: `components/ordenes/orden-form.tsx:1462-1546` (fotos) y `:1285-1364` (accesorios)

**Interfaces:**
- Produces:
  ```ts
  export interface FotoPreview { id: string; preview: string; file?: File; descripcion: string }

  function FotosIngreso(props: {
    label: string
    fotos: FotoPreview[]
    comprimiendo: boolean
    onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void
    onRemove: (id: string) => void
    onDescripcionChange: (id: string, value: string) => void
  }): JSX.Element

  function AccesoriosPicker(props: {
    disponibles: Array<{ id: string; label: string }>
    seleccionados: string[]
    onToggle: (id: string) => void
    otro: string
    onOtroChange: (value: string) => void
    onOtroAdd: () => void
  }): JSX.Element
  ```
  Los usan Task 10 (`recepcion-form`) y el propio `orden-form.tsx`.

- [ ] **Step 1: Crear `fotos-ingreso.tsx`**

Mover el JSX de `components/ordenes/orden-form.tsx:1462-1546` **tal cual**, parametrizando solo lo que venía de scope. El `FotoPreview` que hoy está en `orden-form.tsx:33` pasa a exportarse desde acá.

```tsx
"use client"

import { useRef } from "react"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Upload, Camera, Trash2, Loader2 } from "lucide-react"

export interface FotoPreview {
  id: string
  preview: string
  file?: File
  descripcion: string
}

interface FotosIngresoProps {
  label: string
  fotos: FotoPreview[]
  comprimiendo: boolean
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onRemove: (id: string) => void
  onDescripcionChange: (id: string, value: string) => void
}

export function FotosIngreso({
  label,
  fotos,
  comprimiendo,
  onFileChange,
  onRemove,
  onDescripcionChange,
}: FotosIngresoProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-2 space-y-3">
        <div className="flex gap-2">
          <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={onFileChange} className="hidden" />
          <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={onFileChange} className="hidden" />
          <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()} className="flex-1" disabled={comprimiendo}>
            <Upload className="mr-2 h-4 w-4" />
            Seleccionar archivos
          </Button>
          <Button type="button" variant="outline" onClick={() => cameraInputRef.current?.click()} className="flex-1" disabled={comprimiendo}>
            <Camera className="mr-2 h-4 w-4" />
            Tomar foto
          </Button>
        </div>

        {comprimiendo && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Comprimiendo imagenes...
          </div>
        )}

        {fotos.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {fotos.map((foto) => (
              <div key={foto.id} className="relative group">
                <img src={foto.preview} alt="Preview" className="w-full h-24 object-cover rounded-lg border" />
                <button
                  type="button"
                  onClick={() => onRemove(foto.id)}
                  className="absolute top-1 right-1 p-1 bg-destructive text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
                <Input
                  value={foto.descripcion}
                  onChange={(e) => onDescripcionChange(foto.id, e.target.value)}
                  placeholder="Descripcion..."
                  className="mt-1 text-xs h-7"
                />
              </div>
            ))}
          </div>
        )}

        {fotos.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4 border-2 border-dashed rounded-lg">
            Agregar fotos del estado inicial del equipo
          </p>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Cablear `FotosIngreso` en `orden-form.tsx`**

Reemplazar el bloque `:1462-1546` por:

```tsx
<FotosIngreso
  label={`Fotos del ${term("equipo")} (Ingreso)`}
  fotos={fotos}
  comprimiendo={comprimiendo}
  onFileChange={handleFileChange}
  onRemove={removeFoto}
  onDescripcionChange={updateFotoDescripcion}
/>
```

Borrar de `orden-form.tsx` la interfaz local `FotoPreview` (`:33-38`), los `useRef` de `fileInputRef` y `cameraInputRef` (`:173-174`), e importar el tipo desde el componente nuevo: `import { FotosIngreso, type FotoPreview } from "./fotos-ingreso"`.

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit`
Expected: sin errores. Si aparece "Cannot find name 'fileInputRef'", quedó una referencia huérfana en otro bloque del form: buscarla con `rg -n "fileInputRef|cameraInputRef" components/ordenes/orden-form.tsx` y resolverla antes de seguir.

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add components/ordenes/fotos-ingreso.tsx components/ordenes/orden-form.tsx
git commit -m "refactor(ordenes): extraer FotosIngreso de orden-form"
```

- [ ] **Step 5: Crear `accesorios-picker.tsx`**

Mover el JSX de `:1285-1364` tal cual:

```tsx
"use client"

import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

interface AccesoriosPickerProps {
  disponibles: Array<{ id: string; label: string }>
  seleccionados: string[]
  onToggle: (id: string) => void
  otro: string
  onOtroChange: (value: string) => void
  onOtroAdd: () => void
}

export function AccesoriosPicker({
  disponibles,
  seleccionados,
  onToggle,
  otro,
  onOtroChange,
  onOtroAdd,
}: AccesoriosPickerProps) {
  return (
    <div>
      <Label>Accesorios Recibidos</Label>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
        {disponibles.map((acc) => (
          <label
            key={acc.id}
            className={`flex items-center gap-2 p-2 border rounded cursor-pointer transition-colors ${
              seleccionados.includes(acc.id) ? "bg-primary/10 border-primary" : "hover:bg-muted"
            }`}
          >
            <input type="checkbox" checked={seleccionados.includes(acc.id)} onChange={() => onToggle(acc.id)} className="sr-only" />
            <div
              className={`w-4 h-4 border rounded flex items-center justify-center ${
                seleccionados.includes(acc.id) ? "bg-primary border-primary text-white" : "border-gray-300"
              }`}
            >
              {seleccionados.includes(acc.id) && (
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
            </div>
            <span className="text-sm">{acc.label}</span>
          </label>
        ))}
      </div>
      <div className="flex gap-2 mt-2">
        <Input value={otro} onChange={(e) => onOtroChange(e.target.value)} placeholder="Otro accesorio..." className="flex-1" />
        <Button type="button" variant="outline" onClick={onOtroAdd}>
          Agregar
        </Button>
      </div>
    </div>
  )
}
```

**Importante:** el bloque original entre `:1330` y `:1364` puede tener detalles adicionales (chips de accesorios agregados a mano, botón de borrado). Copiarlos **literalmente**; no simplificar ni "mejorar" nada en esta tarea.

- [ ] **Step 6: Cablear `AccesoriosPicker` en `orden-form.tsx`**

```tsx
<AccesoriosPicker
  disponibles={accesoriosDisponibles}
  seleccionados={accesoriosSeleccionados}
  onToggle={toggleAccesorio}
  otro={otroAccesorio}
  onOtroChange={setOtroAccesorio}
  onOtroAdd={agregarOtroAccesorio}
/>
```

Si el handler de "Agregar" era inline en el JSX original, extraerlo a una función nombrada `agregarOtroAccesorio` dentro de `orden-form.tsx`, con el mismo cuerpo.

- [ ] **Step 7: Verificar**

Run: `npx tsc --noEmit && npx vitest run`
Expected: sin errores de tipos, tests PASS

- [ ] **Step 8: Probar a mano el alta de una orden**

Levantar el proyecto, abrir Órdenes → botón "+", cargar una orden con fotos y accesorios, y confirmar que se crea igual que antes. Los tests no cubren el render del form completo, así que este chequeo manual es parte de la tarea.

- [ ] **Step 9: Commit**

```bash
git add components/ordenes/accesorios-picker.tsx components/ordenes/orden-form.tsx
git commit -m "refactor(ordenes): extraer AccesoriosPicker de orden-form"
```

---

## Task 4: Extraer `tipo-dispositivo-picker.tsx` y `campos-extra-fields.tsx`

**Files:**
- Create: `components/ordenes/tipo-dispositivo-picker.tsx`
- Create: `components/ordenes/campos-extra-fields.tsx`
- Modify: `components/ordenes/orden-form.tsx:935-971` (tipo) y `:1044-1060` (campos extra)

**Interfaces:**
- Produces:
  ```ts
  function TipoDispositivoPicker(props: {
    tipos: Array<{ codigo: string; nombre: string }>
    value: string
    onChange: (codigo: string) => void
    loading: boolean
    error?: string
    label?: string
  }): JSX.Element

  function CamposExtraFields(props: {
    campos: CampoExtra[]
    values: Record<string, any>
    config: TipoDispositivoConfig
    onChange: (campo: CampoExtra, value: any) => void
  }): JSX.Element
  ```

  **`onChange` recibe el `campo` entero, no la key.** No es un detalle de estilo: `handleCampoExtraChange` (`orden-form.tsx:497` en adelante) usa `campo.usarComoDispositivo` para escribir el campo `dispositivo` del form y `campo.autoMarca` para escribir `marca`. Los nombres de esos campos son distintos en cada flujo (`dispositivo` vs `equipos.N.dispositivo`), así que la decisión tiene que quedar en el padre.

- [ ] **Step 1: Crear `tipo-dispositivo-picker.tsx`**

```tsx
"use client"

import { Label } from "@/components/ui/label"
import { Loader2 } from "lucide-react"

interface TipoDispositivoPickerProps {
  tipos: Array<{ codigo: string; nombre: string }>
  value: string
  onChange: (codigo: string) => void
  loading: boolean
  error?: string
  label?: string
}

export function TipoDispositivoPicker({
  tipos,
  value,
  onChange,
  loading,
  error,
  label = "Tipo de Dispositivo *",
}: TipoDispositivoPickerProps) {
  const gridCols =
    tipos.length <= 5
      ? "grid-cols-3 sm:grid-cols-5"
      : tipos.length <= 8
      ? "grid-cols-3 sm:grid-cols-4"
      : "grid-cols-3 sm:grid-cols-4 lg:grid-cols-5"

  return (
    <div>
      <Label>{label}</Label>
      {loading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className={`grid gap-2 mt-2 ${gridCols}`}>
          {tipos.map((tipo) => (
            <button
              key={tipo.codigo}
              type="button"
              onClick={() => onChange(tipo.codigo)}
              className={`flex flex-col items-center justify-center p-3 border rounded-lg transition-all ${
                value === tipo.codigo
                  ? "bg-primary text-primary-foreground border-primary shadow-md scale-105"
                  : "hover:bg-muted hover:border-primary/50"
              }`}
            >
              <span className="text-xs font-medium truncate w-full text-center">{tipo.nombre}</span>
            </button>
          ))}
        </div>
      )}
      {error && <p className="text-sm text-destructive mt-1">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 2: Cablear en `orden-form.tsx`**

Reemplazar `:935-971` por:

```tsx
<TipoDispositivoPicker
  tipos={tiposDispositivo}
  value={tipoDispositivo}
  onChange={handleTipoChange}
  loading={tiposLoading}
  error={errors.tipoDispositivo?.message}
/>
```

- [ ] **Step 3: Crear `campos-extra-fields.tsx`**

Se mueven dos cosas: el wrapper de sección de `:1044-1060` y la función `renderCampoExtra` de `:497-585`, con sus cuatro ramas (`text`, `select`, `buttons`, `counter`). El filtro `!c.usarComoDispositivo` viaja adentro del componente, igual que en el original.

```tsx
"use client"

import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { CampoExtra, TipoDispositivoConfig } from "@/types"

interface CamposExtraFieldsProps {
  campos: CampoExtra[]
  values: Record<string, any>
  config: TipoDispositivoConfig
  /** Recibe el campo completo: el padre necesita `usarComoDispositivo` y `autoMarca`. */
  onChange: (campo: CampoExtra, value: any) => void
}

export function CamposExtraFields({ campos, values, config, onChange }: CamposExtraFieldsProps) {
  const visibles = campos.filter((c) => !c.usarComoDispositivo)
  if (visibles.length === 0) return null

  const renderCampo = (campo: CampoExtra) => {
    const value = values[campo.key] ?? ""

    switch (campo.tipo) {
      case "text":
        return (
          <div key={campo.key}>
            <Label className="text-xs">{campo.label}</Label>
            <Input
              value={value}
              onChange={(e) => onChange(campo, e.target.value)}
              placeholder={campo.placeholder || ""}
              className="h-9"
            />
          </div>
        )

      case "select":
        return (
          <div key={campo.key}>
            <Label className="text-xs">{campo.label}</Label>
            <Select value={value || ""} onValueChange={(v) => onChange(campo, v)}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar..." />
              </SelectTrigger>
              <SelectContent>
                {(campo.opciones || []).map((op) => (
                  <SelectItem key={op} value={op}>{op}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )

      case "buttons":
        return (
          <div key={campo.key}>
            <Label className="text-xs">{campo.label}</Label>
            <div className="flex flex-wrap gap-1 mt-1">
              {(campo.opciones || []).map((op) => (
                <button
                  key={op}
                  type="button"
                  onClick={() => onChange(campo, op)}
                  className={`px-2 py-1 text-xs rounded border transition-colors ${
                    value === op ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"
                  }`}
                >
                  {op}
                </button>
              ))}
            </div>
          </div>
        )

      case "counter":
        return (
          <div key={campo.key}>
            <Label className="text-xs">{campo.label}</Label>
            <div className="flex gap-1 mt-1">
              {Array.from(
                { length: (campo.max ?? 4) - (campo.min ?? 0) + 1 },
                (_, i) => (campo.min ?? 0) + i,
              ).map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => onChange(campo, num)}
                  className={`w-10 h-10 rounded border font-medium transition-colors ${
                    value === num ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"
                  }`}
                >
                  {num}
                </button>
              ))}
            </div>
          </div>
        )

      default:
        return null
    }
  }

  return (
    <div
      className={`border rounded-lg p-4 space-y-4 ${
        config.infoSectionColor === "blue"
          ? "bg-blue-50/30 dark:bg-blue-950/20"
          : config.infoSectionColor === "purple"
          ? "bg-purple-50/30 dark:bg-purple-950/20"
          : "bg-muted/30"
      }`}
    >
      <h4 className="font-medium text-sm flex items-center gap-2">
        {config.infoSectionIcon && <span>{config.infoSectionIcon}</span>}
        {config.infoSectionTitle || "Informacion Adicional"}
      </h4>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">{visibles.map(renderCampo)}</div>
    </div>
  )
}
```

- [ ] **Step 4: Cablear en `orden-form.tsx`**

Reemplazar el bloque `:1044-1060` por:

```tsx
<CamposExtraFields
  campos={camposExtra}
  values={camposExtraValues}
  config={config}
  onChange={handleCampoExtraChange}
/>
```

`handleCampoExtraChange` (`:497` hacia arriba en el archivo) **ya tiene la firma correcta** `(campo: CampoExtra, value: any)`, así que se pasa tal cual. Borrar la función `renderCampoExtra` (`:497-585`) de `orden-form.tsx`, que quedó sin uso.

**Ojo con `usarComoDispositivo`:** los campos con ese flag se filtran del render (lo hacía el original y lo sigue haciendo el componente), pero el que **sí** lo usa es el picker de `dispositivo` en otra parte del form. Buscar con `rg -n "usarComoDispositivo" components/ordenes/orden-form.tsx` y confirmar que ese otro uso quedó intacto antes de dar la tarea por cerrada.

- [ ] **Step 5: Verificar**

Run: `npx tsc --noEmit && npx vitest run && npm run lint`
Expected: todo verde

- [ ] **Step 6: Probar a mano con dos tipos distintos**

Abrir el alta de orden y cambiar entre CELULAR (sin campos extra) y COMPUTADORA (con `tipoPc`, `procesador`, `ram`, `almacenamiento`, `sistemaOperativo`). Verificar que los campos extra aparecen, se completan y se guardan en `metadata`.

- [ ] **Step 7: Commit**

```bash
git add components/ordenes/tipo-dispositivo-picker.tsx components/ordenes/campos-extra-fields.tsx components/ordenes/orden-form.tsx
git commit -m "refactor(ordenes): extraer TipoDispositivoPicker y CamposExtraFields"
```

---

## Task 5: Migración — tabla `recepciones`, FK, RLS y feature flag

**Files:**
- Create: `supabase/migrations/287_recepcion_multiple.sql`

**Interfaces:**
- Produces: tabla `recepciones`; columna `ordenes_servicio.recepcion_id`; feature flag `recepcion_multiple` en los planes `profesional` y `pro`. Lo consumen Tasks 6, 7, 8 y 9.

- [ ] **Step 1: Confirmar el número de migración libre**

Run: `ls supabase/migrations/ | sort -t_ -k1 -n | tail -3`
Chequear contra `origin/main` recién fetcheado, no solo contra el estado local: en esta branch el número se tuvo que correr de `277` a `278` al cerrar, porque `origin/main` recibió un `277` mientras el trabajo estaba en curso, y de `278`/`279` a `287`/`288` al mergear finalmente, porque `origin/main` ya tenía `281`/`284`/`285` aplicadas y otra branch reservaba `286`.

- [ ] **Step 2: Escribir la migración**

Crear `supabase/migrations/287_recepcion_multiple.sql`:

```sql
-- ============================================================================
-- 287: recepción múltiple en mostrador
-- ============================================================================
-- Un cliente deja N equipos en una sola atención: se crea una orden por equipo
-- agrupadas bajo un comprobante de recepción con UNA firma.
--
-- `recepciones` es un DOCUMENTO, no una entidad con ciclo de vida: por eso no
-- tiene columna `estado`. El ciclo de vida sigue siendo 100% por orden.
--
-- `ordenes_servicio.recepcion_id` es nullable con índice PARCIAL: el flujo
-- clásico (una orden por equipo) deja NULL y no paga costo de índice.
-- ============================================================================

CREATE TABLE IF NOT EXISTS recepciones (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sucursal_id TEXT REFERENCES sucursales(id),
  cliente_id TEXT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  numero INTEGER NOT NULL,
  codigo TEXT NOT NULL,
  firma_cliente TEXT,
  firma_mime TEXT,
  terminos_aceptados BOOLEAN NOT NULL DEFAULT FALSE,
  recibido_por TEXT REFERENCES users(id),
  observaciones TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(organization_id, numero)
);

CREATE INDEX IF NOT EXISTS recepciones_org_created_idx
  ON recepciones(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS recepciones_cliente_idx
  ON recepciones(organization_id, cliente_id);

ALTER TABLE recepciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recepciones_select ON recepciones;
CREATE POLICY recepciones_select ON recepciones
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS recepciones_all_service ON recepciones;
CREATE POLICY recepciones_all_service ON recepciones
  FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE recepciones IS
  'Comprobante de recepción de N equipos del mismo cliente en una atención. Documento, no entidad con ciclo de vida: sin columna estado a propósito.';

-- Vínculo opcional desde la orden
ALTER TABLE ordenes_servicio
  ADD COLUMN IF NOT EXISTS recepcion_id TEXT REFERENCES recepciones(id) ON DELETE SET NULL;

-- Índice PARCIAL: cero costo para el flujo clásico
CREATE INDEX IF NOT EXISTS ordenes_recepcion_idx
  ON ordenes_servicio(recepcion_id)
  WHERE recepcion_id IS NOT NULL;

COMMENT ON COLUMN ordenes_servicio.recepcion_id IS
  'Lote de recepción múltiple, NULL en el alta clásica. Nunca asumir que existe.';

-- Feature flag: Profesional y Pro
UPDATE plans SET
  feature_flags = COALESCE(feature_flags, '{}'::jsonb) || '{"recepcion_multiple": true}'::jsonb,
  updated_at = NOW()
WHERE slug IN ('profesional', 'pro');
```

**Convención de RLS:** se sigue la de `274_asistente_panel.sql` (`current_setting('app.organization_id', true)` para SELECT más una policy de servicio) y no la de `067_cobros_orden_caja.sql` (`auth.uid()`), porque 274 es la vigente. Esto **supersede** el snippet de RLS del spec, que citaba el patrón viejo. La app accede con service role (`supabaseAdmin`), así que RLS es defensa en profundidad.

- [ ] **Step 3: Aplicar la migración en el entorno de desarrollo**

Aplicarla por el mismo mecanismo que se usa en este proyecto para las migraciones (editor SQL de Supabase o el flujo que ya esté en uso). **No** inventar un comando nuevo: si no está claro, preguntar antes de ejecutar.

- [ ] **Step 4: Verificar el estado en la base**

Correr en el editor SQL:

```sql
SELECT column_name, is_nullable, data_type
FROM information_schema.columns
WHERE table_name = 'ordenes_servicio' AND column_name = 'recepcion_id';
-- Esperado: 1 fila, is_nullable = YES

SELECT slug, feature_flags->>'recepcion_multiple' AS flag
FROM plans ORDER BY slug;
-- Esperado: profesional y pro en 'true'; free en NULL
```

- [ ] **Step 5: Confirmar que el test de regresión sigue verde**

Run: `npx vitest run __tests__/api/ordenes-recepcion-null.test.ts`
Expected: PASS. La columna ahora existe en la base, y el flujo clásico sigue sin escribirla.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/287_recepcion_multiple.sql
git commit -m "feat(ordenes): migracion de recepcion multiple (tabla, FK, RLS, flag)"
```

---

## Task 6: RPC `crear_recepcion_multiple`

**Files:**
- Create: `supabase/migrations/288_crear_recepcion_multiple.sql`

**Interfaces:**
- Consumes: tabla `recepciones` (Task 5), función `get_next_order_number(org_id TEXT)` (`048_fix_order_counter_resilient.sql:3`)
- Produces:
  ```
  crear_recepcion_multiple(
    p_organization_id TEXT, p_sucursal_id TEXT, p_cliente_id TEXT,
    p_equipos JSONB, p_firma_cliente TEXT, p_firma_mime TEXT,
    p_terminos BOOLEAN, p_recibido_por TEXT, p_created_by TEXT,
    p_telefono_contacto TEXT, p_observaciones TEXT
  ) RETURNS JSONB
  ```
  Devuelve `{ recepcion: { id, numero, codigo }, ordenes: [{ id, numeroOrden, codigoOrden, dispositivo, publicToken }] }`. La consume Task 7.

  Cada elemento de `p_equipos` debe traer: `dispositivo`, `tipoDispositivo`, `problemaReportado`, `publicToken` (obligatorios) y opcionalmente `marca`, `color`, `imei`, `accesorios`, `codigoAccesoDispositivo`, `metadata`.

- [ ] **Step 1: Escribir la RPC**

Crear `supabase/migrations/288_crear_recepcion_multiple.sql`:

```sql
-- ============================================================================
-- 288: RPC transaccional para la recepción múltiple
-- ============================================================================
-- Inserta la recepción y las N órdenes en UN commit. Si cualquier insert falla
-- (incluido el trigger update_ordenes_count cuando se excede el límite del
-- plan), rollbackea todo: nunca queda el cliente con 2 equipos cargados y 1 no.
--
-- Los public_token se generan en la app y llegan por p_equipos, para no
-- depender de pgcrypto (gen_random_bytes) en la base.
-- ============================================================================

CREATE OR REPLACE FUNCTION crear_recepcion_multiple(
  p_organization_id   TEXT,
  p_sucursal_id       TEXT,
  p_cliente_id        TEXT,
  p_equipos           JSONB,
  p_firma_cliente     TEXT,
  p_firma_mime        TEXT,
  p_terminos          BOOLEAN,
  p_recibido_por      TEXT,
  p_created_by        TEXT,
  p_telefono_contacto TEXT DEFAULT NULL,
  p_observaciones     TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_recepcion_id TEXT;
  v_numero       INTEGER;
  v_codigo       TEXT;
  v_equipo       JSONB;
  v_orden_id     TEXT;
  v_numero_orden INTEGER;
  v_codigo_orden TEXT;
  v_prefijo      TEXT;
  v_ordenes      JSONB := '[]'::JSONB;
BEGIN
  IF p_equipos IS NULL OR jsonb_array_length(p_equipos) < 2 THEN
    RAISE EXCEPTION 'recepcion_multiple: se requieren al menos 2 equipos';
  END IF;

  -- (1) Número propio, independiente del contador de órdenes
  SELECT COALESCE(MAX(numero), 0) + 1 INTO v_numero
  FROM recepciones
  WHERE organization_id = p_organization_id;

  v_codigo := 'REC' || LPAD(v_numero::TEXT, 3, '0');

  INSERT INTO recepciones (
    organization_id, sucursal_id, cliente_id, numero, codigo,
    firma_cliente, firma_mime, terminos_aceptados,
    recibido_por, observaciones, created_by
  ) VALUES (
    p_organization_id, p_sucursal_id, p_cliente_id, v_numero, v_codigo,
    p_firma_cliente, p_firma_mime, COALESCE(p_terminos, FALSE),
    p_recibido_por, p_observaciones, p_created_by
  ) RETURNING id INTO v_recepcion_id;

  -- (2) Una orden por equipo
  FOR v_equipo IN SELECT * FROM jsonb_array_elements(p_equipos)
  LOOP
    IF COALESCE(v_equipo->>'publicToken', '') = '' THEN
      RAISE EXCEPTION 'recepcion_multiple: publicToken faltante para el equipo %', v_equipo->>'dispositivo';
    END IF;

    SELECT prefijo_orden INTO v_prefijo
    FROM tipos_dispositivo
    WHERE organization_id = p_organization_id
      AND codigo = (v_equipo->>'tipoDispositivo')
      AND activo = TRUE
    LIMIT 1;

    v_prefijo := COALESCE(v_prefijo, 'ORD');
    v_numero_orden := get_next_order_number(p_organization_id);
    v_codigo_orden := v_prefijo || LPAD(v_numero_orden::TEXT, 3, '0');

    -- tipo_dispositivo es TEXT desde la migración 033: sin cast a enum
    INSERT INTO ordenes_servicio (
      numero_orden, codigo_orden, cliente_id, organization_id, sucursal_id,
      recepcion_id, dispositivo, tipo_dispositivo, marca, color, imei,
      problema_reportado, accesorios, password_dispositivo, metadata,
      estado, public_token, recibido_por, telefono_contacto
    ) VALUES (
      v_numero_orden,
      v_codigo_orden,
      p_cliente_id,
      p_organization_id,
      p_sucursal_id,
      v_recepcion_id,
      v_equipo->>'dispositivo',
      v_equipo->>'tipoDispositivo',
      NULLIF(v_equipo->>'marca', ''),
      NULLIF(v_equipo->>'color', ''),
      NULLIF(v_equipo->>'imei', ''),
      v_equipo->>'problemaReportado',
      NULLIF(v_equipo->>'accesorios', ''),
      NULLIF(v_equipo->>'codigoAccesoDispositivo', ''),
      COALESCE(v_equipo->'metadata', '{}'::JSONB),
      'RECIBIDO',
      v_equipo->>'publicToken',
      p_recibido_por,
      p_telefono_contacto
    ) RETURNING id INTO v_orden_id;

    v_ordenes := v_ordenes || jsonb_build_object(
      'id',          v_orden_id,
      'numeroOrden', v_numero_orden,
      'codigoOrden', v_codigo_orden,
      'dispositivo', v_equipo->>'dispositivo',
      'publicToken', v_equipo->>'publicToken'
    );
  END LOOP;

  RETURN jsonb_build_object(
    'recepcion', jsonb_build_object('id', v_recepcion_id, 'numero', v_numero, 'codigo', v_codigo),
    'ordenes',   v_ordenes
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION crear_recepcion_multiple IS
  'Crea una recepción y sus N órdenes en una sola transacción. Rollback total ante cualquier fallo, incluido el límite de órdenes del plan.';
```

- [ ] **Step 2: Aplicar la migración**

Aplicarla con el mismo mecanismo del proyecto, igual que en Task 5.

- [ ] **Step 3: Probar la RPC a mano, camino feliz**

En el editor SQL, con un `organization_id` y `cliente_id` reales de desarrollo:

```sql
SELECT crear_recepcion_multiple(
  '<org_id>', NULL, '<cliente_id>',
  '[
    {"dispositivo":"iPhone 13","tipoDispositivo":"CELULAR","problemaReportado":"No enciende","publicToken":"aaa111"},
    {"dispositivo":"Notebook HP","tipoDispositivo":"COMPUTADORA","problemaReportado":"Muy lenta","publicToken":"bbb222"}
  ]'::jsonb,
  'data:image/png;base64,xxx', 'image/png', TRUE, NULL, NULL, NULL, NULL
);
```

Esperado: JSON con `recepcion.codigo = 'REC001'` (si es la primera de esa org) y dos órdenes con códigos de prefijos distintos.

- [ ] **Step 4: Probar el rollback**

```sql
-- Un solo equipo: debe fallar y no insertar nada
SELECT crear_recepcion_multiple(
  '<org_id>', NULL, '<cliente_id>',
  '[{"dispositivo":"Solo uno","tipoDispositivo":"CELULAR","problemaReportado":"X","publicToken":"ccc333"}]'::jsonb,
  NULL, NULL, FALSE, NULL, NULL, NULL, NULL
);
-- Esperado: ERROR "se requieren al menos 2 equipos"

-- Verificar que no quedó basura
SELECT COUNT(*) FROM recepciones WHERE organization_id = '<org_id>';
-- Esperado: el mismo count que después del Step 3
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/288_crear_recepcion_multiple.sql
git commit -m "feat(ordenes): RPC transaccional crear_recepcion_multiple"
```

---

## Task 7: `POST /api/recepciones` con gate de plan

**Files:**
- Create: `app/api/recepciones/route.ts`
- Test: `__tests__/api/recepcion-multiple-gate.test.ts`
- Test: `__tests__/api/recepcion-multiple-atomica.test.ts`
- Test: `__tests__/api/recepcion-firma-unica.test.ts`

**Interfaces:**
- Consumes: `hasPlanFeature` (`lib/subscriptions.ts:360`), `requireAuth` (`lib/auth-utils.ts:20`), `resolveOperador` (`lib/operadores.ts:8`), `sucursalParaEscritura` (`lib/sucursal.ts`), `tipoValidaImei` + `isValidImei`, `uploadOrderPhoto` + `base64ToBuffer` (`lib/storage.ts`), `createAuditLogger` (`lib/audit.ts`), RPC de Task 6
- Produces: `POST /api/recepciones` → 201 con `{ recepcion, ordenes }`. La consume Task 10.

- [ ] **Step 1: Escribir el test de gate que falla**

Crear `__tests__/api/recepcion-multiple-gate.test.ts`:

```ts
/**
 * Gate de plan de POST /api/recepciones.
 *
 * Se usa hasPlanFeature (no useHasFeature) porque es el único que aplica los
 * overrides por organización de organization_feature_overrides.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createPostRequest, parseResponse } from "./helpers"

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn(),
}))

import { hasPlanFeature } from "@/lib/subscriptions"
import { POST } from "@/app/api/recepciones/route"

const bodyDosEquipos = {
  clienteId: "cli-1",
  terminosAceptados: true,
  equipos: [
    { dispositivo: "iPhone 13", tipoDispositivo: "CELULAR", problemaReportado: "No enciende" },
    { dispositivo: "Notebook HP", tipoDispositivo: "COMPUTADORA", problemaReportado: "Muy lenta" },
  ],
}

describe("POST /api/recepciones — gate de plan", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess()
  })

  it("devuelve 403 FEATURE_REQUIRED cuando el plan no tiene la feature", async () => {
    vi.mocked(hasPlanFeature).mockResolvedValue(false)

    const res = await POST(createPostRequest(bodyDosEquipos))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(403)
    expect(body.code).toBe("FEATURE_REQUIRED")
    expect(body.feature).toBe("recepcion_multiple")
  })

  it("consulta la feature con la key exacta recepcion_multiple", async () => {
    vi.mocked(hasPlanFeature).mockResolvedValue(false)

    await POST(createPostRequest(bodyDosEquipos))

    expect(hasPlanFeature).toHaveBeenCalledWith("org-1", "recepcion_multiple")
  })
})
```

- [ ] **Step 2: Correr y verificar que FALLA**

Run: `npx vitest run __tests__/api/recepcion-multiple-gate.test.ts`
Expected: FAIL con "Failed to resolve import @/app/api/recepciones/route"

- [ ] **Step 3: Escribir la ruta**

Crear `app/api/recepciones/route.ts`:

```ts
import { NextResponse } from "next/server"
import { randomBytes } from "crypto"
import { z } from "zod"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { hasPlanFeature } from "@/lib/subscriptions"
import { enforcePlanLimit, isPlanLimitError, planLimitErrorResponse } from "@/lib/plan-limits"
import { createAuditLogger } from "@/lib/audit"
import { uploadOrderPhoto, base64ToBuffer } from "@/lib/storage"
import { sucursalParaEscritura } from "@/lib/sucursal"
import { resolveOperador } from "@/lib/operadores"
import { tipoValidaImei } from "@/lib/tipos-dispositivo-config"
import { isValidImei } from "@/lib/imei"

const FEATURE_KEY = "recepcion_multiple"

const fotoSchema = z.object({
  data: z.string(),
  mime: z.string(),
  descripcion: z.string().optional(),
})

const equipoSchema = z.object({
  dispositivo: z.string().min(1, "El dispositivo es requerido"),
  tipoDispositivo: z.string().min(1, "El tipo de dispositivo es requerido"),
  marca: z.string().optional(),
  color: z.string().optional(),
  imei: z.string().optional(),
  problemaReportado: z.string().min(1, "El problema es requerido"),
  accesorios: z.string().optional(),
  codigoAccesoDispositivo: z.string().optional(),
  metadata: z.record(z.any()).optional(),
  fotos: z.array(fotoSchema).optional(),
})

const recepcionSchema = z.object({
  clienteId: z.string().min(1, "El cliente es requerido"),
  equipos: z.array(equipoSchema).min(2, "La recepcion multiple requiere al menos 2 equipos"),
  firmaCliente: z.string().optional(),
  firmaMime: z.string().optional(),
  terminosAceptados: z.boolean(),
  recibidoPorId: z.string().nullable().optional(),
  observaciones: z.string().optional(),
  telefonoContacto: z.string().optional(),
})

function generatePublicToken(): string {
  return randomBytes(16).toString("hex")
}

export async function POST(request: Request) {
  try {
    const { error, session, organizationId, userId, role } = await requireAuth()
    if (error) return error

    // Gate de plan. hasPlanFeature aplica los overrides por organizacion.
    const hasFeature = await hasPlanFeature(organizationId!, FEATURE_KEY)
    if (!hasFeature) {
      return NextResponse.json(
        {
          error: "La recepcion de varios equipos esta disponible en el plan Profesional",
          code: "FEATURE_REQUIRED",
          feature: FEATURE_KEY,
        },
        { status: 403 },
      )
    }

    const body = await request.json()
    const data = recepcionSchema.parse(body)

    // Pre-chequeo del limite del plan para el bloque completo. El trigger
    // update_ordenes_count vuelve a validarlo dentro de la transaccion.
    const limitError = await enforcePlanLimit(organizationId!, "ordenes")
    if (limitError) return limitError

    // Validacion de IMEI por tipo, igual que en el alta clasica
    for (const equipo of data.equipos) {
      if (equipo.imei && equipo.imei.trim()) {
        const validaImei = await tipoValidaImei(organizationId!, equipo.tipoDispositivo)
        if (validaImei && !isValidImei(equipo.imei)) {
          return NextResponse.json(
            { error: `El IMEI de ${equipo.dispositivo} debe tener exactamente 15 digitos` },
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
    const recibidoPor = await resolveOperador(organizationId!, data.recibidoPorId, userId!)

    // Los tokens se generan aca para no depender de pgcrypto en la base
    const equiposRpc = data.equipos.map((equipo) => ({
      dispositivo: equipo.dispositivo,
      tipoDispositivo: equipo.tipoDispositivo,
      marca: equipo.marca ?? null,
      color: equipo.color ?? null,
      imei: equipo.imei ?? null,
      problemaReportado: equipo.problemaReportado,
      accesorios: equipo.accesorios ?? null,
      codigoAccesoDispositivo: equipo.codigoAccesoDispositivo ?? null,
      metadata: equipo.metadata ?? {},
      publicToken: generatePublicToken(),
    }))

    const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc("crear_recepcion_multiple", {
      p_organization_id: organizationId!,
      p_sucursal_id: sucursalId,
      p_cliente_id: data.clienteId,
      p_equipos: equiposRpc,
      p_firma_cliente: data.firmaCliente ?? null,
      p_firma_mime: data.firmaMime ?? null,
      p_terminos: data.terminosAceptados,
      p_recibido_por: recibidoPor,
      p_created_by: userId!,
      p_telefono_contacto: data.telefonoContacto ?? null,
      p_observaciones: data.observaciones ?? null,
    })

    if (rpcError) {
      if (isPlanLimitError(rpcError)) return planLimitErrorResponse(rpcError)
      console.error("Error en crear_recepcion_multiple:", rpcError)
      return NextResponse.json({ error: "Error al crear la recepcion" }, { status: 500 })
    }

    const recepcion = rpcResult.recepcion as { id: string; numero: number; codigo: string }
    const ordenes = rpcResult.ordenes as Array<{
      id: string
      numeroOrden: number
      codigoOrden: string
      dispositivo: string
      publicToken: string
    }>

    // Fotos: fuera de la transaccion (son uploads a Storage). Best-effort, igual
    // que en el alta clasica: una foto que falla no invalida una recepcion firmada.
    for (let i = 0; i < data.equipos.length; i++) {
      const fotos = data.equipos[i].fotos
      const orden = ordenes[i]
      if (!fotos?.length || !orden) continue

      for (const foto of fotos) {
        try {
          const buffer = base64ToBuffer(foto.data)
          const { url, path } = await uploadOrderPhoto(organizationId!, orden.id, buffer, foto.mime)
          await supabaseAdmin.from("fotos_orden").insert({
            orden_id: orden.id,
            url,
            storage_path: path,
            mime: foto.mime,
            size: buffer.length,
            descripcion: foto.descripcion || null,
            tipo: "INGRESO",
          })
        } catch (fotoError) {
          console.error("Error uploading photo:", fotoError)
        }
      }
    }

    // Auditoria: el lote y cada orden
    const audit = createAuditLogger(organizationId!, userId!, request)
    await audit.create("recepciones", recepcion.id, {
      codigo: recepcion.codigo,
      cliente_id: data.clienteId,
      equipos: ordenes.length,
    })
    for (const orden of ordenes) {
      await audit.create("ordenes_servicio", orden.id, {
        numero_orden: orden.numeroOrden,
        dispositivo: orden.dispositivo,
        cliente_id: data.clienteId,
        recepcion_id: recepcion.id,
      })
    }

    // Timeline por orden, fire-and-forget
    void (async () => {
      try {
        await supabaseAdmin.from("orden_eventos").insert(
          ordenes.map((orden) => ({
            orden_id: orden.id,
            organization_id: organizationId!,
            tipo: "CAMBIO_ESTADO",
            estado_nuevo: "RECIBIDO",
            descripcion: `Orden creada en la recepcion ${recepcion.codigo}`,
            created_by: userId,
          })),
        )
      } catch (err) {
        console.error("Error inserting orden_eventos (recepcion):", err)
      }
    })()

    // Sin queueNotification a proposito: seria un mensaje por orden. El mensaje
    // agrupado lo dispara el modal de exito (ver el diseño, punto 8).
    return NextResponse.json({ recepcion, ordenes }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 })
    }
    console.error("Error creating recepcion:", error)
    return NextResponse.json({ error: "Error al crear la recepcion" }, { status: 500 })
  }
}
```

- [ ] **Step 4: Correr el test de gate y verificar que PASA**

Run: `npx vitest run __tests__/api/recepcion-multiple-gate.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Escribir el test de atomicidad y firma única**

Crear `__tests__/api/recepcion-multiple-atomica.test.ts`:

```ts
/**
 * Atomicidad de POST /api/recepciones.
 *
 * Toda la creacion pasa por la RPC crear_recepcion_multiple, asi que un fallo
 * (incluido el limite del plan via trigger) rollbackea el lote completo. Estos
 * tests fijan que la ruta NO hace inserts sueltos en ordenes_servicio.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, createPostRequest, parseResponse } from "./helpers"

vi.mock("@/lib/subscriptions", () => ({ hasPlanFeature: vi.fn().mockResolvedValue(true) }))
vi.mock("@/lib/plan-limits", () => ({
  enforcePlanLimit: vi.fn().mockResolvedValue(null),
  isPlanLimitError: vi.fn().mockReturnValue(false),
  planLimitErrorResponse: vi.fn(),
}))
vi.mock("@/lib/sucursal", () => ({ sucursalParaEscritura: vi.fn().mockResolvedValue("suc-1") }))
vi.mock("@/lib/operadores", () => ({ resolveOperador: vi.fn().mockResolvedValue("user-1") }))
vi.mock("@/lib/tipos-dispositivo-config", () => ({ tipoValidaImei: vi.fn().mockResolvedValue(false) }))
vi.mock("@/lib/audit", () => ({ createAuditLogger: () => ({ create: vi.fn().mockResolvedValue(undefined) }) }))

import { supabaseAdmin } from "@/lib/supabase"
import { POST } from "@/app/api/recepciones/route"

const body = {
  clienteId: "cli-1",
  terminosAceptados: true,
  firmaCliente: "data:image/png;base64,abc",
  firmaMime: "image/png",
  equipos: [
    { dispositivo: "iPhone 13", tipoDispositivo: "CELULAR", problemaReportado: "No enciende" },
    { dispositivo: "Notebook HP", tipoDispositivo: "COMPUTADORA", problemaReportado: "Muy lenta" },
  ],
}

const rpcOk = {
  recepcion: { id: "rec-1", numero: 1, codigo: "REC001" },
  ordenes: [
    { id: "ord-1", numeroOrden: 1, codigoOrden: "CEL001", dispositivo: "iPhone 13", publicToken: "aaa" },
    { id: "ord-2", numeroOrden: 2, codigoOrden: "PC002", dispositivo: "Notebook HP", publicToken: "bbb" },
  ],
}

describe("POST /api/recepciones — atomicidad", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess()
    mockSupabaseFrom({
      orden_eventos: createChainMock(null, null),
      fotos_orden: createChainMock(null, null),
    })
  })

  it("crea todo por la RPC y no inserta ordenes por separado", async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: rpcOk, error: null } as any)
    const ordenesChain = createChainMock(null, null)
    mockSupabaseFrom({
      ordenes_servicio: ordenesChain,
      orden_eventos: createChainMock(null, null),
      fotos_orden: createChainMock(null, null),
    })

    const res = await POST(createPostRequest(body))
    const { status, body: json } = await parseResponse(res)

    expect(status).toBe(201)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("crear_recepcion_multiple", expect.any(Object))
    expect(ordenesChain.insert).not.toHaveBeenCalled()
    expect(json.ordenes).toHaveLength(2)
  })

  it("devuelve 500 y no crea nada cuando la RPC falla", async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null,
      error: { message: "límite de órdenes alcanzado" },
    } as any)

    const res = await POST(createPostRequest(body))
    const { status } = await parseResponse(res)

    expect(status).toBe(500)
  })

  it("rechaza con 400 cuando viene un solo equipo", async () => {
    const res = await POST(createPostRequest({ ...body, equipos: [body.equipos[0]] }))
    const { status, body: json } = await parseResponse(res)

    expect(status).toBe(400)
    expect(json.error).toContain("al menos 2 equipos")
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })
})
```

Crear `__tests__/api/recepcion-firma-unica.test.ts`, con los mismos mocks del archivo anterior y este caso:

```ts
  it("manda la firma una sola vez, al lote y no por orden", async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: rpcOk, error: null } as any)

    await POST(createPostRequest(body))

    const params = vi.mocked(supabaseAdmin.rpc).mock.calls[0][1] as Record<string, any>
    expect(params.p_firma_cliente).toBe("data:image/png;base64,abc")
    expect(params.p_firma_mime).toBe("image/png")

    // Ningun equipo lleva firma propia
    for (const equipo of params.p_equipos) {
      expect("firmaCliente" in equipo).toBe(false)
    }
  })
```

- [ ] **Step 6: Correr todos los tests de la ruta**

Run: `npx vitest run __tests__/api/recepcion-multiple-atomica.test.ts __tests__/api/recepcion-firma-unica.test.ts __tests__/api/recepcion-multiple-gate.test.ts`
Expected: PASS

- [ ] **Step 7: Confirmar que el guardarraíl de Task 1 sigue verde**

Run: `npx vitest run && npx tsc --noEmit`
Expected: todo PASS

- [ ] **Step 8: Commit**

```bash
git add app/api/recepciones/route.ts __tests__/api/recepcion-multiple-gate.test.ts __tests__/api/recepcion-multiple-atomica.test.ts __tests__/api/recepcion-firma-unica.test.ts
git commit -m "feat(ordenes): POST /api/recepciones con gate de plan y creacion atomica"
```

---

## Task 8: Fallback de firma en los PDFs

Hoy el PDF de una orden lee la firma de recepción del checklist. Las órdenes creadas en un lote no tienen checklist: su firma vive en `recepciones`. Se agrega el fallback en las dos rutas de PDF.

**Files:**
- Modify: `app/api/ordenes/[id]/pdf/route.ts:163`
- Modify: `app/api/public/ordenes/[token]/pdf/route.ts:123`

**Interfaces:**
- Consumes: `recepciones.firma_cliente` (Task 5), `ordenes_servicio.recepcion_id`
- Produces: nada nuevo hacia afuera.

- [ ] **Step 1: Agregar el fallback en la ruta autenticada**

En `app/api/ordenes/[id]/pdf/route.ts`, incluir `recepcion_id` en el select de la orden y, cuando exista, traer la firma del lote:

```ts
// Firma del lote solo cuando la orden vino de una recepcion multiple.
// Con recepcion_id en NULL (flujo clasico) no se hace ninguna query extra.
let firmaRecepcionLote: string | null = null
if (orden.recepcion_id) {
  const { data: recepcion } = await supabaseAdmin
    .from("recepciones")
    .select("firma_cliente")
    .eq("id", orden.recepcion_id)
    .maybeSingle()
  firmaRecepcionLote = recepcion?.firma_cliente ?? null
}
```

Y cambiar la línea 163 de:

```ts
firmaRecepcion: checklistData?.firma_cliente || null,
```

a:

```ts
firmaRecepcion: checklistData?.firma_cliente ?? firmaRecepcionLote,
```

- [ ] **Step 2: Repetir en la ruta pública**

Aplicar el mismo cambio en `app/api/public/ordenes/[token]/pdf/route.ts`, reemplazando la línea 123. El código es idéntico al del Step 1: copiarlo, no factorizarlo en un helper todavía (dos usos no justifican la indirección, y estas rutas ya divergen en cómo resuelven la orden).

- [ ] **Step 3: Escribir el test de que el flujo clásico no paga el fallback**

La aserción testeable de "el PDF del flujo clásico no cambia" es que **no se consulta `recepciones`** cuando `recepcion_id` es `NULL`. Agregar a `__tests__/api/ordenes-recepcion-null.test.ts`:

```ts
import { GET as GET_PDF } from "@/app/api/ordenes/[id]/pdf/route"

describe("GET /api/ordenes/[id]/pdf — sin lote no consulta recepciones", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess()
  })

  it("no toca la tabla recepciones cuando recepcion_id es null", async () => {
    const recepcionesChain = createChainMock(null, null)
    mockSupabaseFrom({
      ordenes_servicio: createChainMock({ ...ordenCreada, recepcion_id: null }, null),
      checklist_recepcion: createChainMock(null, null),
      organizations: createChainMock({ nombre: "Taller" }, null),
      recepciones: recepcionesChain,
    })

    await GET_PDF(createGetRequest(), { params: Promise.resolve({ id: "ord-1" }) })

    expect(recepcionesChain.select).not.toHaveBeenCalled()
  })
})
```

Importar `createGetRequest` desde `./helpers`. Ajustar la firma de la llamada a `GET_PDF` y los mocks de tablas a lo que la ruta realmente consulta: leer `app/api/ordenes/[id]/pdf/route.ts` completo antes de escribir el test, porque hace varias queries y si falta un mock el test falla por el motivo equivocado.

- [ ] **Step 4: Correr los tests**

Run: `npx vitest run __tests__/api/ordenes-recepcion-null.test.ts && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Verificar a mano las dos variantes**

Abrir el PDF de una orden creada por el flujo clásico **con** checklist firmado y confirmar que la firma sigue apareciendo. Después el de una orden clásica **sin** checklist: no debe aparecer firma ni haber error. Por último, el de una orden creada en un lote: debe mostrar la firma del comprobante.

- [ ] **Step 6: Commit**

```bash
git add app/api/ordenes/[id]/pdf/route.ts app/api/public/ordenes/[token]/pdf/route.ts __tests__/api/ordenes-recepcion-null.test.ts
git commit -m "feat(ordenes): PDF resuelve la firma del lote cuando la orden es de una recepcion"
```

---

## Task 9: Gate en server components y botón de entrada

**Files:**
- Modify: `app/(dashboard)/ordenes/page.tsx`
- Modify: `components/ordenes/ordenes-list.tsx:605` y `:1013` (botones) + firma del componente
- Create: `app/(dashboard)/ordenes/recepcion/page.tsx`

**Interfaces:**
- Consumes: `auth()` de `@/lib/auth`, `hasPlanFeature`, `FeatureLockedView` (`components/billing/feature-locked-view.tsx`, props `featureName`, `description`, `benefits`)
- Produces: prop `canRecepcionMultiple?: boolean` en `OrdenesList`; ruta `/ordenes/recepcion`

**Por qué no `useHasFeature`:** ese hook lee `featureFlags` de `/api/subscription/status`, que expone **solo los flags del plan** (`app/api/subscription/status/route.ts:29`) y no aplica los overrides de `organization_feature_overrides`. Usarlo dejaría al superadmin sin la escotilla: la API contestaría 200 para un taller con override y el botón seguiría escondido. El patrón correcto está en `app/(dashboard)/configuracion/importaciones/page.tsx:9-22`.

- [ ] **Step 1: Resolver el flag en la página de órdenes**

Reemplazar `app/(dashboard)/ordenes/page.tsx` completo por:

```tsx
import { auth } from "@/lib/auth"
import { OrdenesList } from "@/components/ordenes/ordenes-list"
import { PageShell } from "@/components/ui/page-shell"
import { hasPlanFeature } from "@/lib/subscriptions"

export default async function OrdenesPage() {
  const session = await auth()
  const canRecepcionMultiple = session?.user?.organizationId
    ? await hasPlanFeature(session.user.organizationId, "recepcion_multiple")
    : false

  return (
    <PageShell
      title="Órdenes de Servicio"
      description="Gestiona las órdenes de servicio y su estado"
    >
      <OrdenesList canRecepcionMultiple={canRecepcionMultiple} />
    </PageShell>
  )
}
```

- [ ] **Step 2: Agregar la prop y el botón en `ordenes-list.tsx`**

En la firma del componente, agregar la prop con default `false` para no romper ningún otro uso:

```tsx
export function OrdenesList({ canRecepcionMultiple = false }: { canRecepcionMultiple?: boolean }) {
```

Si `OrdenesList` ya recibe props, agregar `canRecepcionMultiple` a la interfaz existente en lugar de reemplazarla.

Junto al botón `Plus` de `:605` (desktop) y al de `:1013` (mobile), agregar:

```tsx
{canRecepcionMultiple && (
  <Button asChild variant="outline" size="sm" className="gap-1.5">
    <Link href="/dashboard/ordenes/recepcion">
      <Layers className="h-4 w-4" />
      Recibir varios equipos
    </Link>
  </Button>
)}
```

Importar `Link` de `next/link` y `Layers` de `lucide-react` si no están. Verificar la ruta real del panel con `rg -n "dashboard/ordenes" components/ | head` antes de hardcodear el href.

- [ ] **Step 3: Crear la página de recepción con su propio gate**

Crear `app/(dashboard)/ordenes/recepcion/page.tsx`:

```tsx
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { hasPlanFeature } from "@/lib/subscriptions"
import { FeatureLockedView } from "@/components/billing/feature-locked-view"
import { PageShell } from "@/components/ui/page-shell"
import { RecepcionForm } from "@/components/ordenes/recepcion-form"

export default async function RecepcionMultiplePage() {
  const session = await auth()
  if (!session) redirect("/login")

  const canRecepcionMultiple = await hasPlanFeature(
    session.user.organizationId,
    "recepcion_multiple",
  )

  if (!canRecepcionMultiple) {
    return (
      <div className="py-8 px-4">
        <FeatureLockedView
          featureName="Recepción de varios equipos"
          description="Recibí todos los equipos que trae un cliente en una sola atención, con un comprobante y una firma."
          benefits={[
            "Cargar varios equipos sin volver a tipear los datos del cliente",
            "Un comprobante con todos los equipos y una sola firma",
            "Una orden por equipo, cada una con su seguimiento y su etiqueta",
          ]}
        />
      </div>
    )
  }

  return (
    <PageShell
      title="Recibir varios equipos"
      description="Cargá todos los equipos que trae el cliente en una sola atención"
    >
      <RecepcionForm />
    </PageShell>
  )
}
```

Esto hace que entrar por URL directa **no** sea un bypass del gate.

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit`
Expected: falla con "Cannot find module '@/components/ordenes/recepcion-form'". Es lo esperado: ese componente lo crea Task 10. Para cerrar esta tarea, crear el stub mínimo:

```tsx
// components/ordenes/recepcion-form.tsx
"use client"

export function RecepcionForm() {
  return null
}
```

Volver a correr `npx tsc --noEmit` y `npx vitest run`: todo verde.

- [ ] **Step 5: Probar el gate a mano**

Con una organización en plan Free, entrar a `/dashboard/ordenes`: el botón no debe aparecer. Entrar directo a `/dashboard/ordenes/recepcion`: debe mostrar `FeatureLockedView`. Después, habilitar el override desde el superadmin para esa organización y confirmar que aparecen las dos cosas — esto es lo que valida que no usar `useHasFeature` fue la decisión correcta.

- [ ] **Step 6: Commit**

```bash
git add "app/(dashboard)/ordenes/page.tsx" "app/(dashboard)/ordenes/recepcion/page.tsx" components/ordenes/ordenes-list.tsx components/ordenes/recepcion-form.tsx
git commit -m "feat(ordenes): gate de recepcion multiple en server components y boton de entrada"
```

---

## Task 10: Formulario de recepción múltiple

**Files:**
- Modify: `components/ordenes/recepcion-form.tsx` (reemplazar el stub de Task 9)

**Interfaces:**
- Consumes: `useTipoDispositivoConfig` (Task 2), `FotosIngreso` + `FotoPreview` y `AccesoriosPicker` (Task 3), `TipoDispositivoPicker` y `CamposExtraFields` (Task 4), `SignaturePad` (`components/firma/signature-pad.tsx`), `POST /api/recepciones` (Task 7), `useTiposDispositivo`, `useOffline`, `useModal`, `useTerminologia`
- Produces: al crear con éxito, abre `RecepcionCreadaModal` (Task 11) con `{ recepcion, ordenes }`

- [ ] **Step 1: Definir el schema y el estado del formulario**

Con `useFieldArray` de react-hook-form para el array de equipos. Los nombres de campo son `equipos.N.<campo>`, que es exactamente la razón por la que los inputs de texto no se comparten con `orden-form.tsx`.

```tsx
"use client"

import { useState } from "react"
import { useForm, useFieldArray } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"

const equipoFormSchema = z.object({
  dispositivo: z.string().min(1, "Requerido"),
  tipoDispositivo: z.string().min(1, "Elegí el tipo"),
  marca: z.string().optional(),
  color: z.string().optional(),
  imei: z.string().optional(),
  problemaReportado: z.string().min(1, "Requerido"),
  codigoAccesoDispositivo: z.string().optional(),
})

const recepcionFormSchema = z.object({
  clienteId: z.string().min(1, "Elegí el cliente"),
  telefonoContacto: z.string().optional(),
  observaciones: z.string().optional(),
  equipos: z.array(equipoFormSchema).min(2, "Cargá al menos 2 equipos"),
})

type RecepcionFormData = z.infer<typeof recepcionFormSchema>

/** Estado por equipo que no vive en react-hook-form. */
interface EquipoSideState {
  accesoriosSeleccionados: string[]
  otroAccesorio: string
  camposExtraValues: Record<string, any>
  fotos: FotoPreview[]
}

const equipoSideStateVacio = (): EquipoSideState => ({
  accesoriosSeleccionados: [],
  otroAccesorio: "",
  camposExtraValues: {},
  fotos: [],
})
```

En el componente:

```tsx
const { control, register, handleSubmit, watch, setValue, formState: { errors } } =
  useForm<RecepcionFormData>({
    resolver: zodResolver(recepcionFormSchema),
    defaultValues: {
      clienteId: "",
      equipos: [
        { dispositivo: "", tipoDispositivo: "", problemaReportado: "" },
        { dispositivo: "", tipoDispositivo: "", problemaReportado: "" },
      ],
    },
  })

const { fields, append, remove } = useFieldArray({ control, name: "equipos" })
const [sideState, setSideState] = useState<EquipoSideState[]>([
  equipoSideStateVacio(),
  equipoSideStateVacio(),
])
const [firma, setFirma] = useState<string | null>(null)
const [firmaMime, setFirmaMime] = useState<string | null>(null)
const [terminosAceptados, setTerminosAceptados] = useState(false)
const [submitting, setSubmitting] = useState(false)
const [comprimiendo, setComprimiendo] = useState(false)

/** Resultado de la creación: al tener valor, se abre RecepcionCreadaModal (Task 11). */
const [resultado, setResultado] = useState<{
  recepcion: { id: string; numero: number; codigo: string }
  ordenes: Array<{ id: string; numeroOrden: number; codigoOrden: string; dispositivo: string; publicToken: string }>
} | null>(null)

const term = useTerminologia()
const { offlineFetch } = useOffline()
const { showError } = useModal()
const { tipos: tiposDispositivo, loading: tiposLoading } = useTiposDispositivo()
```

El handler de fotos por equipo (`onFileChange`) replica el de `orden-form.tsx:413-471` — compresión incluida — pero escribe en `sideState[index].fotos` en lugar de un único `fotos`. Leer ese bloque y trasladarlo a una función que reciba el índice del equipo.

Arranca con **dos** equipos porque el mínimo es 2: que el mostrador no tenga que hacer un click extra para llegar al caso mínimo.

- [ ] **Step 2: Mantener sincronizados `fields` y `sideState`**

Cada vez que se agrega o quita un equipo hay que mover el estado paralelo. Un desalineado acá manda las fotos del equipo 2 a la orden del equipo 3.

```tsx
const agregarEquipo = () => {
  append({ dispositivo: "", tipoDispositivo: "", problemaReportado: "" })
  setSideState((prev) => [...prev, equipoSideStateVacio()])
}

const quitarEquipo = (index: number) => {
  if (fields.length <= 2) return   // el minimo es 2
  remove(index)
  setSideState((prev) => prev.filter((_, i) => i !== index))
}

const actualizarSide = (index: number, patch: Partial<EquipoSideState>) => {
  setSideState((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)))
}
```

- [ ] **Step 3: Renderizar una card por equipo**

Cada card usa los componentes extraídos. El `config` se resuelve por equipo con el hook de Task 2:

```tsx
{fields.map((field, index) => {
  const tipoEquipo = watch(`equipos.${index}.tipoDispositivo`)
  const cfg = useTipoDispositivoConfig(tiposDispositivo, tipoEquipo)
  // NOTA: no llamar hooks dentro de un map. Ver Step 4.
})}
```

- [ ] **Step 4: Extraer la card a su propio componente (obligatorio)**

El Step 3 muestra el error a evitar: **no se pueden llamar hooks dentro de un `.map()`**, porque la cantidad de hooks cambiaría al agregar o quitar equipos y React rompe. La card tiene que ser su propio componente para que cada instancia tenga sus hooks.

Crear `components/ordenes/recepcion-equipo-card.tsx`:

```tsx
"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Trash2 } from "lucide-react"
import { useTipoDispositivoConfig } from "@/hooks/use-tipo-dispositivo-config"
import { TipoDispositivoPicker } from "./tipo-dispositivo-picker"
import { CamposExtraFields } from "./campos-extra-fields"
import { AccesoriosPicker } from "./accesorios-picker"
import { FotosIngreso, type FotoPreview } from "./fotos-ingreso"

interface RecepcionEquipoCardProps {
  index: number
  tipos: Array<{ codigo: string; nombre: string; config?: any }>
  tiposLoading: boolean
  tipoSeleccionado: string
  onTipoChange: (codigo: string) => void
  register: any
  errors: any
  puedeQuitar: boolean
  onQuitar: () => void
  accesoriosSeleccionados: string[]
  onToggleAccesorio: (id: string) => void
  otroAccesorio: string
  onOtroAccesorioChange: (v: string) => void
  onOtroAccesorioAdd: () => void
  camposExtraValues: Record<string, any>
  onCampoExtraChange: (campo: CampoExtra, value: any) => void
  onProblemaQuickSelect: (texto: string) => void
  fotos: FotoPreview[]
  comprimiendo: boolean
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onRemoveFoto: (id: string) => void
  onFotoDescripcionChange: (id: string, v: string) => void
  labelFotos: string
}

export function RecepcionEquipoCard(props: RecepcionEquipoCardProps) {
  const cfg = useTipoDispositivoConfig(props.tipos, props.tipoSeleccionado)

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Equipo {props.index + 1}</CardTitle>
        {props.puedeQuitar && (
          <Button type="button" variant="ghost" size="sm" onClick={props.onQuitar}>
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <TipoDispositivoPicker
          tipos={props.tipos}
          value={props.tipoSeleccionado}
          onChange={props.onTipoChange}
          loading={props.tiposLoading}
          error={props.errors?.tipoDispositivo?.message}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label>Equipo *</Label>
            <Input {...props.register(`equipos.${props.index}.dispositivo`)} placeholder="Ej: iPhone 13" />
            {props.errors?.dispositivo && (
              <p className="text-sm text-destructive mt-1">{props.errors.dispositivo.message}</p>
            )}
          </div>
          {cfg.showMarca && (
            <div>
              <Label>Marca</Label>
              <Input {...props.register(`equipos.${props.index}.marca`)} placeholder="Ej: Apple" />
            </div>
          )}
          {cfg.showColor && (
            <div>
              <Label>Color</Label>
              <Input {...props.register(`equipos.${props.index}.color`)} />
            </div>
          )}
          {cfg.showImei && (
            <div>
              <Label>{cfg.config.campos?.imei?.label || "IMEI / Serie"}</Label>
              <Input
                {...props.register(`equipos.${props.index}.imei`)}
                placeholder={cfg.config.campos?.imei?.placeholder}
              />
            </div>
          )}
          {cfg.showPassword && (
            <div>
              <Label>Código de acceso</Label>
              <Input {...props.register(`equipos.${props.index}.codigoAccesoDispositivo`)} />
            </div>
          )}
        </div>

        <CamposExtraFields
          campos={cfg.camposExtra}
          values={props.camposExtraValues}
          config={cfg.config}
          onChange={props.onCampoExtraChange}
        />

        <div>
          <Label>Falla reportada *</Label>
          <Textarea {...props.register(`equipos.${props.index}.problemaReportado`)} rows={2} />
          {props.errors?.problemaReportado && (
            <p className="text-sm text-destructive mt-1">{props.errors.problemaReportado.message}</p>
          )}
          {cfg.problemasComunes.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {cfg.problemasComunes.slice(0, 6).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => props.onProblemaQuickSelect(p)}
                  className="px-2 py-0.5 text-xs rounded border hover:bg-muted"
                >
                  {p}
                </button>
              ))}
            </div>
          )}
        </div>

        <AccesoriosPicker
          disponibles={cfg.accesoriosDisponibles}
          seleccionados={props.accesoriosSeleccionados}
          onToggle={props.onToggleAccesorio}
          otro={props.otroAccesorio}
          onOtroChange={props.onOtroAccesorioChange}
          onOtroAdd={props.onOtroAccesorioAdd}
        />

        <FotosIngreso
          label={props.labelFotos}
          fotos={props.fotos}
          comprimiendo={props.comprimiendo}
          onFileChange={props.onFileChange}
          onRemove={props.onRemoveFoto}
          onDescripcionChange={props.onFotoDescripcionChange}
        />
      </CardContent>
    </Card>
  )
}
```

Importar `CampoExtra` de `@/types` en este archivo (lo usa la interfaz de props).

Los dos handlers que el padre cablea por índice, y que son la razón por la que estas props reciben el campo completo:

```tsx
// En recepcion-form.tsx, dentro del map de fields:
onProblemaQuickSelect={(texto) =>
  setValue(`equipos.${index}.problemaReportado`, texto, { shouldValidate: true })
}
onCampoExtraChange={(campo, value) => {
  actualizarSide(index, {
    camposExtraValues: { ...sideState[index].camposExtraValues, [campo.key]: value },
  })
  // Mismos efectos que handleCampoExtraChange del flujo clasico, pero sobre los
  // nombres de campo de este equipo.
  if (campo.usarComoDispositivo && typeof value === "string") {
    setValue(`equipos.${index}.dispositivo`, value, { shouldValidate: true })
  }
  if (campo.autoMarca && typeof value === "string") {
    for (const [keyword, brand] of Object.entries(campo.autoMarca)) {
      if (value.includes(keyword)) {
        setValue(`equipos.${index}.marca`, brand)
        break
      }
    }
  }
}}
```

- [ ] **Step 5: Armar el submit**

```tsx
const onSubmit = async (data: RecepcionFormData) => {
  if (!terminosAceptados) {
    await showError("El cliente tiene que aceptar los términos de recepción")
    return
  }
  setSubmitting(true)
  try {
    const payload = {
      clienteId: data.clienteId,
      telefonoContacto: data.telefonoContacto || undefined,
      observaciones: data.observaciones || undefined,
      firmaCliente: firma || undefined,
      firmaMime: firmaMime || undefined,
      terminosAceptados,
      equipos: data.equipos.map((equipo, i) => ({
        ...equipo,
        accesorios: [
          ...sideState[i].accesoriosSeleccionados,
          ...(sideState[i].otroAccesorio ? [sideState[i].otroAccesorio] : []),
        ].join(", ") || undefined,
        metadata: sideState[i].camposExtraValues,
        fotos: sideState[i].fotos
          .filter((f) => f.file)
          .map((f) => ({ data: f.preview, mime: f.file!.type, descripcion: f.descripcion || undefined })),
      })),
    }

    const res = await offlineFetch("/api/recepciones", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }, { store: STORES.ORDERS, description: `Recepcion de ${data.equipos.length} equipos` })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      await showError(err.error || "Error al crear la recepción")
      return
    }

    setResultado(await res.json())
  } finally {
    setSubmitting(false)
  }
}
```

**Sobre las accesorios y el serializado:** verificar cómo `orden-form.tsx` serializa `accesoriosSeleccionados` en el campo `accesorios` (leer su `onSubmit`) y usar **exactamente el mismo formato**, para que el comprobante y el detalle de orden los muestren igual en los dos flujos.

- [ ] **Step 6: Firma y términos al pie**

Una sola vez para todo el lote, después de las cards:

```tsx
<Card>
  <CardHeader><CardTitle className="text-base">Conformidad del cliente</CardTitle></CardHeader>
  <CardContent className="space-y-4">
    <p className="text-sm text-muted-foreground">
      Una sola firma cubre los {fields.length} equipos de esta recepción.
    </p>
    <SignaturePad
      label="Firma del cliente (conformidad de recepción)"
      onSave={(data, mime) => { setFirma(data); setFirmaMime(mime) }}
    />
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" checked={terminosAceptados} onChange={(e) => setTerminosAceptados(e.target.checked)} />
      <span>El cliente acepta los términos de recepción</span>
    </label>
  </CardContent>
</Card>
```

Verificar la firma real de `SignaturePad` en `components/firma/signature-pad.tsx` antes de escribir esto y ajustar las props a las que el componente expone.

- [ ] **Step 7: Verificar**

Run: `npx tsc --noEmit && npx vitest run && npm run lint`
Expected: todo verde

- [ ] **Step 8: Probar el flujo completo a mano**

Cargar 3 equipos de tipos distintos (celular, computadora, otro), con fotos en al menos dos, firmar y confirmar. Verificar en la base: una fila en `recepciones` con la firma, tres en `ordenes_servicio` con el mismo `recepcion_id`, códigos con prefijos distintos y `estado = 'RECIBIDO'`.

- [ ] **Step 9: Commit**

```bash
git add components/ordenes/recepcion-form.tsx components/ordenes/recepcion-equipo-card.tsx
git commit -m "feat(ordenes): formulario de recepcion multiple con N equipos"
```

---

## Task 11: Comprobante, etiquetas y WhatsApp agrupado

**Files:**
- Create: `components/ordenes/thermal-print-recepcion.tsx`
- Create: `components/ordenes/recepcion-creada-modal.tsx`
- Create: `lib/recepcion-whatsapp.ts`
- Test: `__tests__/lib/recepcion-whatsapp.test.ts`
- Modify: `components/ordenes/recepcion-form.tsx` (abrir el modal al crear)

**Interfaces:**
- Consumes: `printDeviceLabel` (`components/ordenes/print-label.ts`), patrón de `thermal-print-orden.tsx`, `generateWhatsAppUrl` + `formatPhoneForWhatsApp` (`lib/notifications/whatsapp-templates.ts`)
- Produces:
  ```ts
  function construirMensajeRecepcion(params: {
    organizationName: string
    clienteNombre: string
    codigoRecepcion: string
    ordenes: Array<{ codigoOrden: string; dispositivo: string; publicToken: string }>
    baseUrl: string
  }): string
  ```

- [ ] **Step 1: Escribir el test del mensaje agrupado**

Crear `__tests__/lib/recepcion-whatsapp.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { construirMensajeRecepcion } from "@/lib/recepcion-whatsapp"

const params = {
  organizationName: "Taller Central",
  clienteNombre: "Juan",
  codigoRecepcion: "REC001",
  baseUrl: "https://taller.stapp.com",
  ordenes: [
    { codigoOrden: "CEL001", dispositivo: "iPhone 13", publicToken: "aaa111" },
    { codigoOrden: "PC002", dispositivo: "Notebook HP", publicToken: "bbb222" },
  ],
}

describe("construirMensajeRecepcion", () => {
  it("incluye un link de seguimiento por orden", () => {
    const msg = construirMensajeRecepcion(params)
    expect(msg).toContain("https://taller.stapp.com/seguimiento/aaa111")
    expect(msg).toContain("https://taller.stapp.com/seguimiento/bbb222")
  })

  it("nombra cada equipo con su codigo de orden", () => {
    const msg = construirMensajeRecepcion(params)
    expect(msg).toContain("CEL001")
    expect(msg).toContain("iPhone 13")
    expect(msg).toContain("PC002")
    expect(msg).toContain("Notebook HP")
  })

  it("referencia el comprobante del lote y la cantidad de equipos", () => {
    const msg = construirMensajeRecepcion(params)
    expect(msg).toContain("REC001")
    expect(msg).toContain("2")
  })

  it("no genera un mensaje por orden: es uno solo", () => {
    const msg = construirMensajeRecepcion(params)
    expect(msg.split("REC001").length - 1).toBe(1)
  })
})
```

- [ ] **Step 2: Correr y verificar que FALLA**

Run: `npx vitest run __tests__/lib/recepcion-whatsapp.test.ts`
Expected: FAIL con "Failed to resolve import @/lib/recepcion-whatsapp"

- [ ] **Step 3: Implementar el builder**

Crear `lib/recepcion-whatsapp.ts`:

```ts
interface OrdenDelLote {
  codigoOrden: string
  dispositivo: string
  publicToken: string
}

/**
 * Arma UN mensaje con los links de seguimiento de todas las órdenes del lote.
 *
 * La recepción múltiple no dispara notificación automática a propósito: sería
 * un mensaje por orden. El operador manda este único mensaje desde el modal.
 */
export function construirMensajeRecepcion(params: {
  organizationName: string
  clienteNombre: string
  codigoRecepcion: string
  ordenes: OrdenDelLote[]
  baseUrl: string
}): string {
  const { organizationName, clienteNombre, codigoRecepcion, ordenes, baseUrl } = params

  const lineas = ordenes.map(
    (o) => `• ${o.codigoOrden} — ${o.dispositivo}\n  ${baseUrl}/seguimiento/${o.publicToken}`,
  )

  return [
    `Hola ${clienteNombre}, recibimos tus ${ordenes.length} equipos en ${organizationName}.`,
    ``,
    `Comprobante: ${codigoRecepcion}`,
    ``,
    `Podés seguir el estado de cada uno acá:`,
    ...lineas,
    ``,
    `Cualquier novedad te avisamos.`,
  ].join("\n")
}
```

- [ ] **Step 4: Correr y verificar que PASA**

Run: `npx vitest run __tests__/lib/recepcion-whatsapp.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Crear el comprobante térmico**

Crear `components/ordenes/thermal-print-recepcion.tsx` siguiendo el patrón de `components/ordenes/thermal-print-orden.tsx`: leerlo primero y reusar su estructura de `@page`, sus tamaños y su manejo de impresión, cambiando solo el contenido.

El comprobante lleva: encabezado con nombre y datos de la organización, `codigo` de la recepción bien visible, nombre y teléfono del cliente, fecha, **una tabla con los N equipos** (código de orden, tipo/marca/modelo, falla reportada, accesorios), el bloque de términos de la organización (`organizations.comprobante_terminos`) y **una sola** firma al pie.

Igual que el comprobante de una orden, el `@page` se ajusta al contenido: con N equipos el papel es más largo, así que no fijar altura.

- [ ] **Step 6: Crear el modal de éxito**

Crear `components/ordenes/recepcion-creada-modal.tsx`, tomando `components/ordenes/orden-creada-modal.tsx` como referencia. Tres acciones:

1. **Imprimir comprobante** → `ThermalPrintRecepcion`
2. **Imprimir etiquetas** → loop sobre `printDeviceLabel`, una por orden. Verificar la firma real de `printDeviceLabel` en `components/ordenes/print-label.ts` y respetar el tamaño guardado en `localStorage` que ya usa el flujo de etiquetas.
3. **Enviar WhatsApp** → `construirMensajeRecepcion` + `generateWhatsAppUrl` + `formatPhoneForWhatsApp`

Entre etiqueta y etiqueta, esperar a que la anterior termine antes de disparar la siguiente: encadenar los `await` en lugar de un `Promise.all`, porque son diálogos de impresión del sistema operativo y en paralelo se pisan.

- [ ] **Step 7: Cablear el modal en el formulario**

En `recepcion-form.tsx`, cuando `resultado` tiene valor, abrir `RecepcionCreadaModal` con `{ recepcion, ordenes }`, el cliente seleccionado y los datos de la organización. Al cerrarlo, navegar a `/dashboard/ordenes`.

- [ ] **Step 8: Verificar**

Run: `npx tsc --noEmit && npx vitest run && npm run lint`
Expected: todo verde

- [ ] **Step 9: Probar impresión y WhatsApp a mano**

Crear una recepción de 3 equipos e imprimir el comprobante (verificar que los 3 aparecen con una sola firma) y las 3 etiquetas (una por equipo, con su código). Abrir el WhatsApp y confirmar que es **un** mensaje con los 3 links.

- [ ] **Step 10: Commit**

```bash
git add components/ordenes/thermal-print-recepcion.tsx components/ordenes/recepcion-creada-modal.tsx lib/recepcion-whatsapp.ts __tests__/lib/recepcion-whatsapp.test.ts components/ordenes/recepcion-form.tsx
git commit -m "feat(ordenes): comprobante del lote, etiquetas por equipo y WhatsApp agrupado"
```

---

## Task 12: Test end-to-end del flujo de mostrador

**Files:**
- Create: `e2e/recepcion-multiple.auth.spec.ts`

**Interfaces:**
- Consumes: la convención de la suite autenticada (`storageState`) — leer `playwright.config.ts` y un spec `*.auth.spec.ts` existente antes de escribir

- [ ] **Step 1: Leer la convención de la suite**

Run: `ls e2e/ && rg -n "storageState|projects" playwright.config.ts`
Identificar cómo se autentica la suite y cómo se saltea un test cuando el entorno no tiene los datos necesarios (hay specs que usan `skip`).

- [ ] **Step 2: Escribir el spec**

Crear `e2e/recepcion-multiple.auth.spec.ts`:

```ts
import { test, expect } from "@playwright/test"

test.describe("Recepción múltiple en mostrador", () => {
  test("carga dos equipos del mismo cliente y crea dos órdenes", async ({ page }) => {
    await page.goto("/dashboard/ordenes")

    const botonRecepcion = page.getByRole("link", { name: /recibir varios equipos/i })
    if (!(await botonRecepcion.isVisible().catch(() => false))) {
      test.skip(true, "La organización de prueba no tiene la feature recepcion_multiple habilitada")
    }
    await botonRecepcion.click()

    await expect(page.getByRole("heading", { name: /recibir varios equipos/i })).toBeVisible()

    // El formulario arranca con dos equipos: el mínimo
    await expect(page.getByText(/equipo 1/i)).toBeVisible()
    await expect(page.getByText(/equipo 2/i)).toBeVisible()

    // Una sola firma para todo el lote
    await expect(page.getByText(/una sola firma cubre los 2 equipos/i)).toBeVisible()
  })

  test("no permite quedarse con menos de dos equipos", async ({ page }) => {
    await page.goto("/dashboard/ordenes/recepcion")

    const heading = page.getByRole("heading", { name: /recibir varios equipos/i })
    if (!(await heading.isVisible().catch(() => false))) {
      test.skip(true, "Feature no habilitada en el entorno de prueba")
    }

    // Con exactamente 2 equipos no hay botón de borrar en ninguna card
    await expect(page.getByRole("button", { name: /quitar equipo/i })).toHaveCount(0)
  })
})
```

Agregar `aria-label="Quitar equipo"` al botón de borrar de `recepcion-equipo-card.tsx` para que el selector del segundo test sea estable (hoy es un botón con solo un ícono).

- [ ] **Step 3: Correr el e2e**

Run: `npm run test:e2e -- e2e/recepcion-multiple.auth.spec.ts`
Expected: PASS o SKIP con el motivo explícito. Un skip silencioso no cuenta como verde: si saltea, dejar anotado en el commit por qué.

- [ ] **Step 4: Correr la suite completa**

Run: `npx vitest run && npx tsc --noEmit && npm run lint`
Expected: todo verde, incluido el guardarraíl `ordenes-recepcion-null` de Task 1

- [ ] **Step 5: Commit**

```bash
git add e2e/recepcion-multiple.auth.spec.ts components/ordenes/recepcion-equipo-card.tsx
git commit -m "test(ordenes): e2e del flujo de recepcion multiple"
```

---

## Cierre

Antes de abrir el PR:

- [ ] `npx vitest run` en verde, con `__tests__/api/ordenes-recepcion-null.test.ts` incluido
- [ ] `npx tsc --noEmit` sin errores
- [ ] `npm run lint` sin errores
- [ ] Alta de una orden por el flujo clásico probada a mano, con fotos, accesorios y checklist firmado
- [ ] PDF de una orden clásica con checklist: la firma sigue apareciendo
- [ ] Recepción de 3 equipos probada a mano de punta a punta
- [ ] Gate probado en Free (botón oculto + `FeatureLockedView`) y con override habilitado (ambos visibles)
- [ ] Migraciones aplicadas y verificadas en desarrollo

El plan toca 12 tareas y bastante superficie, así que conviene revisar el forecast de tamaño del PR antes de mergear todo junto: las Tasks 1 a 4 (extracciones) son un PR natural por su cuenta, las 5 a 8 (backend) otro, y las 9 a 12 (frontend) un tercero. Cada uno deja el árbol funcionando.
