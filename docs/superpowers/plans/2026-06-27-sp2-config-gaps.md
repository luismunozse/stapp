# SP-2: Cerrar huecos de config — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Categorías de inventario de los tipos base sembradas en su config (editables, sin romper nada) + validación de serie configurable por tipo (IMEI / patrón custom / ninguna).

**Architecture:** Hueco 1 = migración de seeding (los tipos base reciben `config.categoriasInventario` con los valores hoy hardcodeados; el fallback se mantiene). Hueco 2 = extender `config.campos.imei` con `validacion: "none"|"imei"|"pattern"` + `pattern`/`mensajeError`; un `validarSerie` en `lib/imei.ts`; orden-form lo usa; el editor de tipos gana un selector de modo. Todo sobre `tipos_dispositivo.config` JSONB (la migración es solo data).

**Tech Stack:** Next.js + TypeScript, Supabase (Postgres JSONB), Vitest (entorno node), React.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-27-sp2-config-gaps-design.md`.
- **Versión segura:** sembrar tipos base + **mantener el fallback hardcodeado** (`categoriasPorTipo` en `inventario-form.tsx`). NO removerlo. `inventario-form.tsx` NO se toca.
- **Hueco 2 aditivo/retrocompatible:** `validacion` ausente o `"imei"` se comporta EXACTAMENTE como hoy; solo se agrega `"pattern"`. Sin migración de data para el Hueco 2.
- **La ETIQUETA del identificador ya es config-driven** (`config.campos.imei.label`) — NO es trabajo de este plan.
- **Fail-safe:** regex inválido en modo "pattern" → tratar como válido (no bloquear la carga de orden).
- Commits convencionales, SIN atribución AI. Vitest Windows: `node node_modules/vitest/vitest.mjs run <archivo>` (tests node: `// @vitest-environment node`). TDD. `npx tsc --noEmit` exit 0 antes de cada commit de código.
- Migración: próximo número libre (al escribir: `264`; verificar `ls supabase/migrations | grep -oE '^[0-9]+' | sort -n | tail -1`).

---

### Task 1: Migración — sembrar `categoriasInventario` en tipos base

**Files:**
- Create: `supabase/migrations/264_seed_categorias_inventario_tipos_base.sql` (verificar número)

**Interfaces:**
- Produces: tipos base (`es_base=true`) con `config.categoriasInventario` poblado (idempotente; no pisa configs custom).

- [ ] **Step 1: Escribir la migración (un solo UPDATE con VALUES)**

```sql
-- ========================================
-- Migration 264: seed categoriasInventario en tipos base (SP-2 multipropósito)
-- ========================================
-- Los tipos base no tenían categoriasInventario en su config (la 049 sembró
-- otros campos). Las sembramos con los valores que estaban hardcodeados en
-- inventario-form.tsx, para que sean editables desde la UI de config. El
-- fallback hardcodeado se mantiene en el front (versión segura). Idempotente:
-- solo donde aún no existe la clave (no pisa configs custom).
UPDATE tipos_dispositivo td
SET config = COALESCE(td.config, '{}'::jsonb)
  || jsonb_build_object('categoriasInventario', v.cats)
FROM (VALUES
  ('CELULAR',            '["Pantallas","Protectores","Baterías","Fundas","Cargadores","Flex","Módulos","Otros"]'::jsonb),
  ('COMPUTADORA',        '["Pantallas","Teclados","Baterías","Memorias","Discos","Cargadores","Otros"]'::jsonb),
  ('TABLET',             '["Pantallas","Protectores","Baterías","Fundas","Cargadores","Flex","Otros"]'::jsonb),
  ('CONSOLA',            '["Joysticks","Fuentes","Flex","Lectoras","Coolers","Otros"]'::jsonb),
  ('SMARTWATCH',         '["Mallas","Pantallas","Baterías","Cargadores","Otros"]'::jsonb),
  ('IMPRESORA',          '["Cartuchos","Tóners","Cabezales","Rodillos","Fuentes","Placas","Otros"]'::jsonb),
  ('NOTEBOOK',           '["Pantallas","Teclados","Baterías","Memorias","Discos","Cargadores","Bisagras","Otros"]'::jsonb),
  ('LAPTOP',             '["Pantallas","Teclados","Baterías","Memorias","Discos","Cargadores","Bisagras","Otros"]'::jsonb),
  ('TELEVISION',         '["Pantallas","Fuentes","Placas","LED","Cables","Controles","Otros"]'::jsonb),
  ('TV',                 '["Pantallas","Fuentes","Placas","LED","Cables","Controles","Otros"]'::jsonb),
  ('HELADERA',           '["Compresores","Termostatos","Motores","Válvulas","Resistencias","Otros"]'::jsonb),
  ('MICROONDAS',         '["Magnetrones","Fusibles","Motores","Placas","Otros"]'::jsonb),
  ('LAVARROPAS',         '["Motores","Bombas","Correas","Electrválvulas","Placas","Otros"]'::jsonb),
  ('AIRE_ACONDICIONADO', '["Compresores","Filtros","Motores","Placas","Gas refrigerante","Otros"]'::jsonb),
  ('ACCESORIOS',         '["Auriculares","Parlantes","Cables","Adaptadores","Cargadores","Soportes","Otros"]'::jsonb),
  ('TODOS',              '["Pantallas","Baterías","Fundas","Teclados","Memorias","Cargadores","Otros"]'::jsonb)
) AS v(codigo, cats)
WHERE td.codigo = v.codigo
  AND td.es_base = true
  AND NOT (td.config ? 'categoriasInventario');
```

- [ ] **Step 2: Verificar número libre**

Run: `ls supabase/migrations | grep -oE '^[0-9]+' | sort -n | tail -1`
Expected: el mayor < 264 (si es ≥ 264, renombrar a mayor+1).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/264_seed_categorias_inventario_tipos_base.sql
git commit -m "feat(db): sembrar categoriasInventario en tipos base (editable desde config)"
```

Nota: aplicar en Supabase manualmente post-merge. El fallback del front cubre el período previo.

---

### Task 2: Tipo + `validarSerie` en `lib/imei.ts`

**Files:**
- Modify: `types/index.ts` (`CampoConfig`)
- Modify: `lib/imei.ts`
- Test: `__tests__/lib/validar-serie.test.ts` (nuevo)

**Interfaces:**
- Produces:
  - `CampoConfig.validacion?: "imei" | "pattern" | "none"`, `CampoConfig.pattern?: string`, `CampoConfig.mensajeError?: string`.
  - `validarSerie(value: string | null | undefined, cfg?: { validacion?: "imei" | "pattern" | "none"; pattern?: string }): boolean`.

- [ ] **Step 1: Extender el tipo `CampoConfig`**

En `types/index.ts`, cambiar:
```ts
export interface CampoConfig {
  visible: boolean
  label?: string
  placeholder?: string
  maxLength?: number
  validacion?: "imei"
}
```
por:
```ts
export interface CampoConfig {
  visible: boolean
  label?: string
  placeholder?: string
  maxLength?: number
  validacion?: "imei" | "pattern" | "none"
  pattern?: string
  mensajeError?: string
}
```

- [ ] **Step 2: Escribir el test que falla**

Crear `__tests__/lib/validar-serie.test.ts`:
```ts
// @vitest-environment node
import { describe, it, expect } from "vitest"
import { validarSerie } from "@/lib/imei"

describe("validarSerie", () => {
  it("vacío/null => válido en todos los modos", () => {
    expect(validarSerie("", { validacion: "imei" })).toBe(true)
    expect(validarSerie(null, { validacion: "pattern", pattern: "^X$" })).toBe(true)
    expect(validarSerie(undefined)).toBe(true)
  })
  it("none / sin config => válido", () => {
    expect(validarSerie("cualquier-cosa", { validacion: "none" })).toBe(true)
    expect(validarSerie("cualquier-cosa")).toBe(true)
  })
  it("imei => 15 dígitos", () => {
    expect(validarSerie("123456789012345", { validacion: "imei" })).toBe(true)
    expect(validarSerie("12345", { validacion: "imei" })).toBe(false)
  })
  it("pattern => matchea el regex", () => {
    expect(validarSerie("AB-1234", { validacion: "pattern", pattern: "^[A-Z]{2}-\\d{4}$" })).toBe(true)
    expect(validarSerie("xx", { validacion: "pattern", pattern: "^[A-Z]{2}-\\d{4}$" })).toBe(false)
  })
  it("pattern sin pattern definido => válido", () => {
    expect(validarSerie("lo-que-sea", { validacion: "pattern" })).toBe(true)
  })
  it("regex inválido => fail-safe (válido, no bloquea)", () => {
    expect(validarSerie("algo", { validacion: "pattern", pattern: "[" })).toBe(true)
  })
})
```

- [ ] **Step 3: Correr y verificar que falla**

Run: `node node_modules/vitest/vitest.mjs run __tests__/lib/validar-serie.test.ts`
Expected: FAIL — `validarSerie` no existe.

- [ ] **Step 4: Implementar en `lib/imei.ts`**

Agregar (manteniendo `isValidImei`/`sanitizeImei` intactos):
```ts
/**
 * Valida el identificador del equipo según el modo configurado por tipo.
 * Vacío = válido (campo opcional). "imei" = 15 dígitos. "pattern" = matchea el
 * regex (regex inválido => válido, fail-safe). "none"/ausente = sin validar.
 */
export function validarSerie(
  value: string | null | undefined,
  cfg?: { validacion?: "imei" | "pattern" | "none"; pattern?: string }
): boolean {
  if (value == null || value === "") return true
  const modo = cfg?.validacion ?? "none"
  if (modo === "imei") return isValidImei(value)
  if (modo === "pattern") {
    if (!cfg?.pattern) return true
    try {
      return new RegExp(cfg.pattern).test(value)
    } catch {
      return true
    }
  }
  return true
}
```

- [ ] **Step 5: Correr y verificar que pasa**

Run: `node node_modules/vitest/vitest.mjs run __tests__/lib/validar-serie.test.ts`
Expected: PASS (6 tests)
Run: `npx tsc --noEmit` → exit 0

- [ ] **Step 6: Commit**

```bash
git add types/index.ts lib/imei.ts __tests__/lib/validar-serie.test.ts
git commit -m "feat(imei): validarSerie configurable por tipo (none/imei/pattern)"
```

---

### Task 3: orden-form usa `validarSerie`

**Files:**
- Modify: `components/ordenes/orden-form.tsx`

**Interfaces:**
- Consumes: `validarSerie` (Task 2); `config.campos.imei` (existente).

- [ ] **Step 1: Reemplazar el check hardcodeado**

En `components/ordenes/orden-form.tsx`:
1. Import (línea 30): cambiar `import { isValidImei, sanitizeImei } from "@/lib/imei"` por `import { sanitizeImei, validarSerie } from "@/lib/imei"`. (Verificar que `isValidImei` no se use en otro lado del archivo; si se usa, dejarlo en el import.)
2. En `onSubmit` (~línea 611-615), reemplazar:
```ts
    // Validate IMEI only when the field is configured as IMEI (15 digits)
    if (imeiEsImei && !isValidImei(data.imei)) {
      setError("imei", { message: "El IMEI debe tener exactamente 15 dígitos" })
      return
    }
```
por:
```ts
    // Validar el identificador según el modo configurado por tipo.
    const imeiCfg = config.campos?.imei
    if (!validarSerie(data.imei, imeiCfg)) {
      setError("imei", {
        message:
          imeiCfg?.mensajeError ||
          (imeiCfg?.validacion === "imei"
            ? "El IMEI debe tener exactamente 15 dígitos"
            : "Formato inválido"),
      })
      return
    }
```
`imeiEsImei` (línea 275) se mantiene si se usa para el `maxLength` del input (`maxLength={imeiEsImei ? 15 : imeiMaxLength}`); no lo elimines si sigue en uso.

- [ ] **Step 2: Verificar**

Run: `npx tsc --noEmit` → exit 0
Verificación manual: un tipo con `validacion:"imei"` sigue exigiendo 15 díg; un tipo con `validacion:"pattern"` exige el regex; un tipo sin validación acepta cualquier serie.

- [ ] **Step 3: Commit**

```bash
git add components/ordenes/orden-form.tsx
git commit -m "feat(ordenes): validar identificador con validarSerie (modo por tipo)"
```

---

### Task 4: Editor de tipos — selector de modo de validación

**Files:**
- Modify: `components/configuracion/tipo-config-editor.tsx`

**Interfaces:**
- Consumes: `CampoConfig` extendido (Task 2). Produce config con `validacion`/`pattern`/`mensajeError`.

- [ ] **Step 1: Reemplazar el checkbox por un selector de modo**

En `components/configuracion/tipo-config-editor.tsx`:
1. Estado: reemplazar `const [imeiValidacionImei, setImeiValidacionImei] = useState(config.campos?.imei?.validacion === "imei")` por:
```ts
  const [imeiValidacion, setImeiValidacion] = useState<"none" | "imei" | "pattern">(
    config.campos?.imei?.validacion ?? "none"
  )
  const [imeiPattern, setImeiPattern] = useState(config.campos?.imei?.pattern || "")
  const [imeiMensajeError, setImeiMensajeError] = useState(config.campos?.imei?.mensajeError || "")
```
2. Guardado (la línea que arma `imei: { ... }` dentro de `newConfig.campos`): reemplazar `...(imeiValidacionImei ? { validacion: "imei" as const } : {})` por:
```ts
            ...(imeiValidacion !== "none" ? { validacion: imeiValidacion } : {}),
            ...(imeiValidacion === "pattern" && imeiPattern ? { pattern: imeiPattern } : {}),
            ...(imeiValidacion === "pattern" && imeiMensajeError ? { mensajeError: imeiMensajeError } : {}),
```
3. UI: reemplazar el `<label><input type="checkbox" .../> Validar como IMEI (15 dígitos)</label>` (~líneas 202-210) por un selector + inputs condicionales:
```tsx
                  <select
                    value={imeiValidacion}
                    onChange={(e) => setImeiValidacion(e.target.value as "none" | "imei" | "pattern")}
                    className="h-7 text-xs rounded border px-1"
                  >
                    <option value="none">Sin validación</option>
                    <option value="imei">IMEI (15 dígitos)</option>
                    <option value="pattern">Patrón personalizado</option>
                  </select>
                  {imeiValidacion === "pattern" && (
                    <>
                      <Input
                        value={imeiPattern}
                        onChange={(e) => setImeiPattern(e.target.value)}
                        placeholder="Regex, ej: ^[A-Z]{2}-\d{4}$"
                        className="h-7 text-xs"
                      />
                      <Input
                        value={imeiMensajeError}
                        onChange={(e) => setImeiMensajeError(e.target.value)}
                        placeholder="Mensaje de error (opcional)"
                        className="h-7 text-xs"
                      />
                    </>
                  )}
```

- [ ] **Step 2: Verificar**

Run: `npx tsc --noEmit` → exit 0
Run: `npx eslint components/configuracion/tipo-config-editor.tsx` → exit 0
Verificación manual: editar un tipo, elegir "Patrón personalizado", guardar; reabrir → el modo y el patrón persisten. Un tipo en "IMEI" sigue exigiendo 15 díg.

- [ ] **Step 3: Commit**

```bash
git add components/configuracion/tipo-config-editor.tsx
git commit -m "feat(config): selector de modo de validación de serie por tipo (none/imei/pattern)"
```

---

## Self-Review (cobertura del spec)

- **Hueco 1: seeding tipos base, fallback mantenido, inventario-form sin tocar** → Task 1. ✅
- **Hueco 2: tipo extendido + `validarSerie` + orden-form + editor** → Tasks 2-4. ✅
- **Retrocompatibilidad ("imei"/none idénticos a hoy)** → Task 2 (`validarSerie` reusa `isValidImei`; "none"/ausente = válido) + Task 3 (mantiene el mensaje IMEI). ✅
- **Fail-safe regex inválido** → Task 2 (try/catch → true). ✅
- **Label ya config-driven (no se toca)** → respetado; ninguna task cambia `config.campos.imei.label`. ✅
- **No-goals:** sin recibo por tipo, sin remover fallback, sin cambios de schema. ✅

## Sugerencia de PRs (entrega)

- **PR único:** Tasks 1-4 (cohesivo y chico). La migración 264 se aplica a Supabase al mergear.
