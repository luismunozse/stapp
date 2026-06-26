# SP-1: Vocabulario configurable — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Una capa de terminología configurable por organización (defaults neutrales + overrides editables por ADMIN) que reemplaza el vocabulario hardcodeado de celulares en las superficies de alto impacto.

**Architecture:** `organizations.terminologia JSONB` guarda overrides. `lib/terminologia.ts` (puro) define el catálogo `TERMINOS` + `resolveTerminologia`/`t`. El cliente recibe el mapa resuelto vía `/api/configuracion` y lo expone con `useTerminologia()` (extendiendo el provider de config existente). El servidor (PDF/térmico/emails) usa `getTerminologia(orgId)`. Una pantalla en Configuración edita los overrides.

**Tech Stack:** Next.js (App Router) + TypeScript, Supabase (Postgres JSONB), Zod, Vitest (entorno node para lógica/API), React Context, shadcn.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-26-sp1-vocabulario-configurable-design.md`.
- **Set acotado de términos** (los 8 del catálogo), no todos los strings.
- **Solo overrides en DB**; lo no-seteado cae al default neutral en runtime.
- **`lib/terminologia.ts` es PURO** (sin imports de supabase) — lo importa el cliente. El fetch server vive en un archivo aparte.
- **Fail-safe server:** si falla el fetch de terminología, usar defaults (nunca romper PDF/recibo).
- **No pisar** los labels de campo por tipo (`config.campos.*.label`) — son ortogonales.
- Commits convencionales, SIN atribución AI. UI en español neutro.
- Vitest Windows: `node node_modules/vitest/vitest.mjs run <archivo>`. Tests lógica/API: `// @vitest-environment node`.
- Migración: próximo número libre (al escribir: `263`; verificar con `ls supabase/migrations | grep -oE '^[0-9]+' | sort -n | tail -1`).
- Helpers de test API: `__tests__/api/helpers.ts`. Patrón auth+config: `app/api/configuracion/route.ts` (usa `requireAdmin`).

---

### Task 1: Migración — `organizations.terminologia`

**Files:**
- Create: `supabase/migrations/263_organizations_terminologia.sql` (verificar número)

**Interfaces:**
- Produces: columna `organizations.terminologia JSONB NOT NULL DEFAULT '{}'`.

- [ ] **Step 1: Escribir la migración**

```sql
-- ========================================
-- Migration 263: organizations.terminologia
-- ========================================
-- Vocabulario configurable por organización (SP-1 multipropósito). Guarda solo
-- overrides de términos conocidos; lo no-seteado cae al default neutral.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS terminologia JSONB NOT NULL DEFAULT '{}'::jsonb;
```

- [ ] **Step 2: Verificar número libre**

Run: `ls supabase/migrations | grep -oE '^[0-9]+' | sort -n | tail -1`
Expected: el mayor < 263 (si es ≥ 263, usar mayor+1).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/263_organizations_terminologia.sql
git commit -m "feat(db): organizations.terminologia (vocabulario configurable)"
```

Nota: aplicar en Supabase manualmente post-merge.

---

### Task 2: Catálogo + resolver (`lib/terminologia.ts`)

**Files:**
- Create: `lib/terminologia.ts`
- Test: `__tests__/lib/terminologia.test.ts`

**Interfaces:**
- Produces:
  - `interface TerminoDef { key: string; default: string; label: string; help?: string }`
  - `TERMINOS: TerminoDef[]`
  - `type Terminologia = Record<string, string>`
  - `resolveTerminologia(overrides?: Terminologia | null): Terminologia` — mapa completo (todas las keys → override-no-vacío o default).
  - `t(map: Terminologia, key: string): string` — `map[key] ?? key`.

- [ ] **Step 1: Escribir el test que falla**

Crear `__tests__/lib/terminologia.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest"
import { TERMINOS, resolveTerminologia, t } from "@/lib/terminologia"

describe("resolveTerminologia", () => {
  it("sin overrides => todos los defaults", () => {
    const map = resolveTerminologia(null)
    expect(map.equipo).toBe("Equipo")
    expect(map.orden).toBe("Orden de trabajo")
    expect(map.serie).toBe("Número de serie")
    // todas las keys del catálogo presentes
    for (const def of TERMINOS) expect(map[def.key]).toBeTruthy()
  })

  it("override válido pisa el default; vacío/whitespace cae al default", () => {
    const map = resolveTerminologia({ equipo: "Vehículo", serie: "   ", modelo: "" })
    expect(map.equipo).toBe("Vehículo")
    expect(map.serie).toBe("Número de serie")
    expect(map.modelo).toBe("Modelo")
  })

  it("ignora claves desconocidas del JSON de la DB", () => {
    const map = resolveTerminologia({ hackeo: "x", equipo: "Bici" } as any)
    expect(map.equipo).toBe("Bici")
    expect((map as any).hackeo).toBeUndefined()
  })
})

describe("t", () => {
  it("devuelve el valor o la propia key si no existe", () => {
    const map = resolveTerminologia(null)
    expect(t(map, "equipo")).toBe("Equipo")
    expect(t(map, "inexistente")).toBe("inexistente")
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `node node_modules/vitest/vitest.mjs run __tests__/lib/terminologia.test.ts`
Expected: FAIL — `lib/terminologia` no existe.

- [ ] **Step 3: Implementar**

Crear `lib/terminologia.ts`:

```ts
export interface TerminoDef {
  key: string
  default: string
  label: string
  help?: string
}

export const TERMINOS: TerminoDef[] = [
  { key: "equipo", default: "Equipo", label: "Equipo (singular)", help: "Lo que se repara. Ej: Vehículo, Electrodoméstico, Reloj." },
  { key: "equipoPlural", default: "Equipos", label: "Equipo (plural)" },
  { key: "orden", default: "Orden de trabajo", label: "Orden" },
  { key: "serie", default: "Número de serie", label: "Identificador del equipo", help: "Ej: IMEI, Patente, N° de chasis." },
  { key: "tecnico", default: "Técnico", label: "Responsable del trabajo" },
  { key: "reparacion", default: "Reparación", label: "Trabajo / Reparación" },
  { key: "marca", default: "Marca", label: "Marca" },
  { key: "modelo", default: "Modelo", label: "Modelo" },
]

export type Terminologia = Record<string, string>

/** Mapa completo: cada key del catálogo → override no-vacío o default. */
export function resolveTerminologia(overrides?: Terminologia | null): Terminologia {
  const out: Terminologia = {}
  for (const def of TERMINOS) {
    const ov = overrides?.[def.key]
    out[def.key] = ov && ov.trim() !== "" ? ov : def.default
  }
  return out
}

/** Lookup de una clave en un mapa ya resuelto. */
export function t(map: Terminologia, key: string): string {
  return map[key] ?? key
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `node node_modules/vitest/vitest.mjs run __tests__/lib/terminologia.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/terminologia.ts __tests__/lib/terminologia.test.ts
git commit -m "feat(terminologia): catálogo de términos + resolveTerminologia/t"
```

---

### Task 3: Helper server `getTerminologia`

**Files:**
- Create: `lib/terminologia-server.ts`
- Test: `__tests__/lib/terminologia-server.test.ts`

**Interfaces:**
- Consumes: `supabaseAdmin`, `resolveTerminologia` (Task 2).
- Produces: `getTerminologia(organizationId: string): Promise<Terminologia>` — mapa resuelto de la org; fail-safe a defaults ante error.

- [ ] **Step 1: Escribir el test que falla**

Crear `__tests__/lib/terminologia-server.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { getTerminologia } from "@/lib/terminologia-server"

function mockOrg(row: any, error: any = null) {
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: row, error }),
  }
  vi.mocked(supabaseAdmin.from).mockReturnValue(chain as any)
}

describe("getTerminologia", () => {
  beforeEach(() => vi.clearAllMocks())

  it("aplica overrides de la org", async () => {
    mockOrg({ terminologia: { equipo: "Vehículo" } })
    const map = await getTerminologia("org-1")
    expect(map.equipo).toBe("Vehículo")
    expect(map.orden).toBe("Orden de trabajo") // default
  })

  it("fail-safe a defaults ante error de DB", async () => {
    mockOrg(null, { message: "boom" })
    const map = await getTerminologia("org-1")
    expect(map.equipo).toBe("Equipo")
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `node node_modules/vitest/vitest.mjs run __tests__/lib/terminologia-server.test.ts`
Expected: FAIL — `lib/terminologia-server` no existe.

- [ ] **Step 3: Implementar**

Crear `lib/terminologia-server.ts`:

```ts
import { supabaseAdmin } from "@/lib/supabase"
import { resolveTerminologia, type Terminologia } from "@/lib/terminologia"

/** Mapa de terminología resuelto de la org. Fail-safe: ante error => defaults. */
export async function getTerminologia(organizationId: string): Promise<Terminologia> {
  try {
    const { data, error } = await supabaseAdmin
      .from("organizations")
      .select("terminologia")
      .eq("id", organizationId)
      .single()
    if (error || !data) return resolveTerminologia(null)
    return resolveTerminologia(data.terminologia as Terminologia | null)
  } catch {
    return resolveTerminologia(null)
  }
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `node node_modules/vitest/vitest.mjs run __tests__/lib/terminologia-server.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/terminologia-server.ts __tests__/lib/terminologia-server.test.ts
git commit -m "feat(terminologia): helper server getTerminologia (fail-safe)"
```

---

### Task 4: API `/api/configuracion` — GET devuelve + PUT acepta `terminologia`

**Files:**
- Modify: `app/api/configuracion/route.ts`
- Test: `__tests__/api/configuracion-terminologia.test.ts` (nuevo)

**Interfaces:**
- Consumes: `resolveTerminologia`, `TERMINOS` (Task 2).
- Produces: GET response incluye `terminologia` (mapa resuelto). PUT acepta `terminologia` (overrides), valida claves, persiste en `organizations.terminologia`.

- [ ] **Step 1: Escribir el test que falla**

Crear `__tests__/api/configuracion-terminologia.test.ts`. Mockear auth (ADMIN) y `supabaseAdmin`. Verificar: (a) GET incluye `terminologia` con defaults; (b) PUT con `terminologia: { equipo: "Vehículo", hackeo: "x" }` persiste solo claves conocidas. Leer `__tests__/api/helpers.ts` para firmas reales y adaptar.

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, parseResponse } from "./helpers"

describe("/api/configuracion — terminologia", () => {
  beforeEach(() => vi.clearAllMocks())

  it("GET incluye terminologia resuelta (defaults)", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    mockSupabaseFrom({ organizations: createChainMock({ id: "org-1", moneda: "ARS", terminologia: {} }) })
    const { GET } = await import("@/app/api/configuracion/route")
    const res = await GET()
    const { status, body } = await parseResponse(res)
    expect(status).toBe(200)
    expect(body.terminologia.equipo).toBe("Equipo")
  })
})
```

Nota: si el GET de configuración hace múltiples queries (fiscal fallback), agregar los mocks necesarios para que llegue a responder. El objetivo mínimo es asertar que `terminologia` está en la respuesta. Si testear el PUT completo es desproporcionado por la complejidad de la ruta, cubrir al menos el GET y validar el filtrado de claves con un test de unidad sobre la función de saneo (ver Step 3) — documentar el enfoque en el reporte.

- [ ] **Step 2: Correr y verificar que falla**

Run: `node node_modules/vitest/vitest.mjs run __tests__/api/configuracion-terminologia.test.ts`
Expected: FAIL — la respuesta no tiene `terminologia`.

- [ ] **Step 3: Implementar**

En `app/api/configuracion/route.ts`:
1. Import: `import { resolveTerminologia, TERMINOS } from "@/lib/terminologia"`.
2. **GET:** agregar `terminologia` al `.select(...)` de organizations, y al objeto de respuesta (línea ~75): `terminologia: resolveTerminologia(organization.terminologia),`.
3. **PUT:** 
   - Agregar `terminologia` al destructuring del body (línea ~128).
   - Sanear y persistir: solo claves conocidas, descartar vacías:
   ```ts
   if (terminologia !== undefined && terminologia !== null && typeof terminologia === "object") {
     const known = new Set(TERMINOS.map((d) => d.key))
     const clean: Record<string, string> = {}
     for (const [k, v] of Object.entries(terminologia as Record<string, unknown>)) {
       if (known.has(k) && typeof v === "string" && v.trim() !== "") clean[k] = v.trim()
     }
     updateData.terminologia = clean
   }
   ```
   - Agregar `terminologia` a las `selectCols`/`selectColsFull` del UPDATE y a la respuesta del PUT (mismo `resolveTerminologia(organization.terminologia)`).

- [ ] **Step 4: Correr y verificar que pasa**

Run: `node node_modules/vitest/vitest.mjs run __tests__/api/configuracion-terminologia.test.ts`
Expected: PASS
Run: `npx tsc --noEmit` → exit 0

- [ ] **Step 5: Commit**

```bash
git add app/api/configuracion/route.ts __tests__/api/configuracion-terminologia.test.ts
git commit -m "feat(config): API expone y persiste terminologia (ADMIN, claves saneadas)"
```

---

### Task 5: Context — exponer `useTerminologia()`

**Files:**
- Modify: `contexts/currency-context.tsx`

**Interfaces:**
- Consumes: `terminologia` del GET `/api/configuracion` (Task 4); `resolveTerminologia`, `t`, `Terminologia` (Task 2).
- Produces: `useTerminologia(): (key: string) => string`.

- [ ] **Step 1: Implementar**

En `contexts/currency-context.tsx`:
1. Import: `import { resolveTerminologia, t as tLookup, type Terminologia } from "@/lib/terminologia"`.
2. Agregar al `CurrencyContextType`: `terminologia: Terminologia`.
3. Default del context: `terminologia: resolveTerminologia(null)`.
4. Estado: `const [terminologia, setTerminologia] = useState<Terminologia>(resolveTerminologia(null))`.
5. En `fetchConfig`, tras parsear `data`: `if (data.terminologia) setTerminologia(data.terminologia as Terminologia)`.
6. Agregar `terminologia` al `value` del provider.
7. Al final del archivo, exportar:
```ts
export function useTerminologia() {
  const { terminologia } = useContext(CurrencyContext)
  return (key: string) => tLookup(terminologia, key)
}
```

- [ ] **Step 2: Verificar**

Run: `npx tsc --noEmit` → exit 0

- [ ] **Step 3: Commit**

```bash
git add contexts/currency-context.tsx
git commit -m "feat(terminologia): exponer useTerminologia() desde el context de config"
```

---

### Task 6: UI de edición — Configuración → Vocabulario

**Files:**
- Create: `app/(dashboard)/configuracion/vocabulario/page.tsx`
- Create: `components/configuracion/vocabulario-form.tsx`
- Modify: `app/(dashboard)/configuracion/page.tsx` (card)

**Interfaces:**
- Consumes: GET/PUT `/api/configuracion` con `terminologia` (Task 4); `TERMINOS` (Task 2).

- [ ] **Step 1: Página server (guard ADMIN)**

Crear `app/(dashboard)/configuracion/vocabulario/page.tsx` (espejar el guard de `app/(dashboard)/configuracion/recargos-metodo/page.tsx` si existe, o el de la página de configuración: `auth()` + `canEditConfiguration()`):

```tsx
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { canEditConfiguration } from "@/lib/auth-utils"
import { PageShell } from "@/components/ui/page-shell"
import { VocabularioForm } from "@/components/configuracion/vocabulario-form"

export default async function VocabularioPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (session.user.role !== "ADMIN" || !(await canEditConfiguration())) redirect("/configuracion")
  return (
    <PageShell title="Vocabulario" description="Personalizá los términos según tu rubro">
      <VocabularioForm />
    </PageShell>
  )
}
```

- [ ] **Step 2: Form cliente**

Crear `components/configuracion/vocabulario-form.tsx` (`"use client"`): fetch `GET /api/configuracion` al montar, listar cada `TERMINO` con su `label`/`help` y un `Input` (placeholder = default, value = override actual o ""), guardar con `PUT` enviando `{ terminologia: <overrides no vacíos> }`. Usar `Input`/`Button`/`Label` del repo (patrón de `components/configuracion/recargos-metodo-form.tsx` si existe, o cualquier form de configuración).

```tsx
"use client"
import { useEffect, useState } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { TERMINOS } from "@/lib/terminologia"

export function VocabularioForm() {
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [resuelto, setResuelto] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/configuracion").then(r => r.json()).then(d => {
      // El GET devuelve el mapa resuelto; para los inputs mostramos vacío si
      // coincide con el default (así el placeholder guía), y el valor si difiere.
      setResuelto(d.terminologia || {})
    })
  }, [])

  const setVal = (key: string, val: string) =>
    setOverrides(prev => ({ ...prev, [key]: val }))

  const guardar = async () => {
    setSaving(true); setMsg(null)
    const clean: Record<string, string> = {}
    for (const [k, v] of Object.entries(overrides)) if (v.trim() !== "") clean[k] = v.trim()
    const res = await fetch("/api/configuracion", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ terminologia: clean }),
    })
    setSaving(false)
    setMsg(res.ok ? "Guardado" : "Error al guardar")
  }

  return (
    <div className="space-y-4 max-w-lg">
      <p className="text-sm text-muted-foreground">
        Dejá un campo vacío para usar el término por defecto.
      </p>
      {TERMINOS.map((term) => (
        <div key={term.key} className="space-y-1">
          <Label htmlFor={term.key} className="text-sm">{term.label}</Label>
          {term.help && <p className="text-xs text-muted-foreground">{term.help}</p>}
          <Input
            id={term.key}
            placeholder={resuelto[term.key] ?? term.default}
            value={overrides[term.key] ?? ""}
            onChange={(e) => setVal(term.key, e.target.value)}
          />
        </div>
      ))}
      <Button onClick={guardar} disabled={saving}>{saving ? "Guardando…" : "Guardar"}</Button>
      {msg && <p className="text-sm">{msg}</p>}
    </div>
  )
}
```

- [ ] **Step 3: Card en Configuración**

En `app/(dashboard)/configuracion/page.tsx`, sección apropiada (ej. la de operación/general), agregar una card:
```tsx
{
  href: "/configuracion/vocabulario",
  icon: Type,
  label: "Vocabulario",
  labelShort: "Vocabulario",
  desc: "Personalizá los términos según tu rubro",
  descShort: "Términos por rubro",
},
```
Agregar `Type` al import de lucide-react en ese archivo.

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit` → exit 0
Run: `npx eslint "app/(dashboard)/configuracion/page.tsx"` → exit 0

- [ ] **Step 5: Commit**

```bash
git add "app/(dashboard)/configuracion/vocabulario/page.tsx" components/configuracion/vocabulario-form.tsx "app/(dashboard)/configuracion/page.tsx"
git commit -m "feat(config): pantalla Vocabulario para editar términos"
```

---

### Task 7: Aplicar términos — superficies CLIENTE (Tanda 1)

**Files:**
- Modify: `components/ordenes/orden-form.tsx`, `components/ordenes/orden-detail.tsx`, `components/seguimiento/seguimiento-content.tsx`

**Interfaces:**
- Consumes: `useTerminologia()` (Task 5).

- [ ] **Step 1: Reemplazar términos hardcodeados de alto impacto**

En cada componente cliente, traer el helper: `const term = useTerminologia()` y reemplazar los textos de alto impacto que hoy dicen el vocabulario de celulares:
- "Dispositivo" / "Equipo" (encabezados, labels de paso) → `term("equipo")`
- "Orden de servicio" / "Orden" (títulos) → `term("orden")`
- "IMEI" (texto suelto, no el label de campo que viene de `config`) → `term("serie")`
- "Técnico" (encabezados, no nombres propios) → `term("tecnico")`
- "Reparación" (textos generales) → `term("reparacion")`

REGLAS:
- **NO** tocar: labels de campo que ya salen de `config.campos.*.label` (esos mandan para el campo), claves de DB, identificadores de código, ni nombres de estado del enum.
- **NO** cambiar el texto visible cuando no hay override (los defaults neutrales son el cambio buscado).
- Buscar las ocurrencias con `rg -n "Dispositivo|IMEI|Orden de servicio|Técnico|Reparación" <archivo>` y convertir las de UI general. Documentar en el reporte qué se convirtió y qué se dejó (y por qué).

- [ ] **Step 2: Verificar**

Run: `npx tsc --noEmit` → exit 0
Verificación manual: con un override `equipo="Vehículo"` la ficha/seguimiento muestran "Vehículo"; sin override, "Equipo".

- [ ] **Step 3: Commit**

```bash
git add components/ordenes/orden-form.tsx components/ordenes/orden-detail.tsx components/seguimiento/seguimiento-content.tsx
git commit -m "feat(terminologia): aplicar términos configurables en órdenes y seguimiento"
```

---

### Task 8: Aplicar términos — superficies SERVIDOR (Tanda 1)

**Files:**
- Modify: `lib/escpos.ts`, `lib/pdf.ts`, y las plantillas de WhatsApp/email de órdenes (`lib/notifications/whatsapp-templates.ts` y/o `lib/notifications/whatsapp-message.ts`, `lib/email.ts`)

**Interfaces:**
- Consumes: `getTerminologia(orgId)` (Task 3), `t` (Task 2).

- [ ] **Step 1: Pasar la terminología a los generadores y reemplazar labels**

- Identificar quién llama a `generarComprobante`/`escpos`/`pdf` y a las plantillas de notificación, y resolver `const term = await getTerminologia(organizationId)` en el caller (o aceptar `terminologia` como parámetro de la función generadora, default `resolveTerminologia(null)` para no romper firmas).
- En `lib/escpos.ts`: reemplazar labels hardcodeados de alto impacto: `"ORDEN DE SERVICIO"` → usar `term.orden` en mayúscula; `"DISPOSITIVO"` → `term.equipo`; `"IMEI:"` → `t(term, "serie") + ":"`. Mantener el resto.
- En `lib/pdf.ts`: ídem para los encabezados equivalentes.
- En plantillas WhatsApp/email de órdenes: reemplazar menciones de "dispositivo"/"equipo"/"orden de servicio" por el término correspondiente.

REGLAS:
- **Fail-safe:** si no hay `organizationId` o el fetch falla, `getTerminologia` ya devuelve defaults — el comprobante nunca se rompe.
- NO tocar el contenido de `recepcion_terminos` (es texto del usuario), ni los labels de campo por tipo.
- Preservar formato/mayúsculas del recibo (si el label iba en MAYÚSCULA, aplicar `.toUpperCase()` al término).
- Buscar ocurrencias con `rg -n "ORDEN DE SERVICIO|DISPOSITIVO|IMEI|dispositivo|equipo" lib/escpos.ts lib/pdf.ts` y convertir las de alto impacto. Documentar en el reporte.

- [ ] **Step 2: Verificar**

Run: `npx tsc --noEmit` → exit 0
Run (regresión de comprobantes si hay tests): `node node_modules/vitest/vitest.mjs run __tests__/lib/terminos.test.ts` (y cualquier test de pdf/escpos existente) → PASS

- [ ] **Step 3: Commit**

```bash
git add lib/escpos.ts lib/pdf.ts lib/notifications/ lib/email.ts
git commit -m "feat(terminologia): aplicar términos configurables en recibo/PDF/notificaciones"
```

---

## Self-Review (cobertura del spec)

- **Migración `terminologia`** → Task 1. ✅
- **Catálogo + resolver (puro)** → Task 2. ✅
- **Helper server fail-safe** → Task 3. ✅
- **API GET/PUT (ADMIN, claves saneadas)** → Task 4. ✅
- **Context `useTerminologia()`** → Task 5. ✅
- **UI de edición (Configuración → Vocabulario)** → Task 6. ✅
- **Aplicación Tanda 1 (cliente + servidor)** → Tasks 7-8. ✅
- **No-goals respetados:** sin plantillas por rubro (SP-3), sin categorías inventario/serie/térmico-por-tipo (SP-2), sin i18n. ✅
- **No pisar `config.campos.*.label`** → regla explícita en Tasks 7-8. ✅

## Sugerencia de PRs (entrega)

- **PR 1 (mecanismo):** Tasks 1-6 (migración, lib, helper, API, context, UI). Desplegable: ya se pueden editar términos aunque todavía no se apliquen en todas las superficies.
- **PR 2 (aplicación):** Tasks 7-8 (aplicar en órdenes/seguimiento/recibo/PDF/notificaciones).

La migración 263 se aplica a Supabase al mergear PR 1.
