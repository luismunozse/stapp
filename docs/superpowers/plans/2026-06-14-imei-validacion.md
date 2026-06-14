# Validación IMEI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development o superpowers:executing-plans. Steps con checkbox.

**Goal:** Validar el campo `imei` como 15 dígitos numéricos exactos solo cuando el tipo de dispositivo lo marca como IMEI; opcional (vacío OK).

**Architecture:** Flag `validacion?: "imei"` en `CampoConfig`. Helper puro `isValidImei`. El form valida con el helper + restringe input. Toggle en el editor de tipos.

**Tech Stack:** Next.js, TypeScript, Vitest, react-hook-form + zod.

**Strict TDD:** ENABLED. `npm run test:run`.

**Spec:** `docs/superpowers/specs/2026-06-14-imei-validacion-design.md`

---

## File Structure
- `types/index.ts` — MODIFY: `CampoConfig.validacion?: "imei"`.
- `lib/imei.ts` — CREATE: helper puro `isValidImei`.
- `lib/tipos-dispositivo-defaults.ts` — MODIFY: preset celular `imei.validacion = "imei"`.
- `components/ordenes/orden-form.tsx` — MODIFY: input restringido + validación.
- `components/configuracion/tipo-config-editor.tsx` — MODIFY: toggle "Validar como IMEI".
- Test: `__tests__/lib/imei.test.ts` — CREATE.

---

## Task 1: Helper `isValidImei` (TDD)

**Files:** Create `lib/imei.ts`; Test `__tests__/lib/imei.test.ts`

- [ ] **Step 1: Test que falla** — `__tests__/lib/imei.test.ts`:
```ts
import { describe, it, expect } from "vitest"
import { isValidImei } from "@/lib/imei"

describe("isValidImei", () => {
  it("acepta exactamente 15 dígitos", () => {
    expect(isValidImei("123456789012345")).toBe(true)
  })
  it("rechaza menos de 15", () => {
    expect(isValidImei("12345")).toBe(false)
  })
  it("rechaza más de 15", () => {
    expect(isValidImei("1234567890123456")).toBe(false)
  })
  it("rechaza con letras", () => {
    expect(isValidImei("12345678901234a")).toBe(false)
  })
  it("vacío es válido (opcional)", () => {
    expect(isValidImei("")).toBe(true)
    expect(isValidImei(null)).toBe(true)
    expect(isValidImei(undefined)).toBe(true)
  })
})
```

- [ ] **Step 2: Correr** `npm run test:run -- __tests__/lib/imei.test.ts` → FAIL.

- [ ] **Step 3: Implementar** `lib/imei.ts`:
```ts
/**
 * Valida un IMEI: exactamente 15 dígitos numéricos.
 * Vacío/null/undefined = válido (el IMEI es opcional; se valida solo si se carga).
 */
export function isValidImei(value: string | null | undefined): boolean {
  if (value == null || value === "") return true
  return /^\d{15}$/.test(value)
}

/** Quita todo lo que no sea dígito y trunca a 15 (para sanear input/paste). */
export function sanitizeImei(value: string): string {
  return value.replace(/\D/g, "").slice(0, 15)
}
```

- [ ] **Step 4: Correr** → PASS (5 tests).

- [ ] **Step 5: Commit**
```bash
git add lib/imei.ts __tests__/lib/imei.test.ts
git commit -m "feat(ordenes): helper isValidImei (15 digitos, opcional)"
```

---

## Task 2: Flag en el tipo + preset celular

**Files:** Modify `types/index.ts`, `lib/tipos-dispositivo-defaults.ts`

- [ ] **Step 1: Tipo** — en `types/index.ts`, en `interface CampoConfig` (línea ~6) agregar:
```ts
  validacion?: "imei"
```

- [ ] **Step 2: Preset celular** — en `lib/tipos-dispositivo-defaults.ts`, la entrada del tipo celular (la que tiene `imei: { visible: true, label: "IMEI", placeholder: "123456789012345", maxLength: 15 }`) agregar `validacion: "imei"`:
```ts
      imei: { visible: true, label: "IMEI", placeholder: "123456789012345", maxLength: 15, validacion: "imei" },
```
NO tocar tablet/consola/otros (quedan sin flag → serial libre).

- [ ] **Step 3: Typecheck** — `npx tsc --noEmit` → limpio.

- [ ] **Step 4: Commit**
```bash
git add types/index.ts lib/tipos-dispositivo-defaults.ts
git commit -m "feat(ordenes): flag validacion imei en CampoConfig + preset celular"
```

---

## Task 3: Validación en el formulario

**Files:** Modify `components/ordenes/orden-form.tsx`

- [ ] **Step 1: Leer el form** — entender el patrón RHF + zod (`schema` ~línea 67, `register("imei")` ~1021, `errors.imei` ~1025, `imeiMaxLength` ~246). Determinar `imeiEsImei` desde la config:
```ts
const imeiEsImei = config.campos?.imei?.validacion === "imei"
```

- [ ] **Step 2: Restringir input** — en el `<Input id="imei">` (~1020): cuando `imeiEsImei`, `inputMode="numeric"` y sanear en onChange con `sanitizeImei` (o `onInput`), `maxLength={imeiEsImei ? 15 : imeiMaxLength}`. Mantener `register("imei")` (combinar con un onChange que limpie no-dígitos si es IMEI).

- [ ] **Step 3: Validación** — hacer que el submit falle si el IMEI es inválido. Opción A (refine en el zod schema del form): el schema no conoce el tipo en runtime; usar un `superRefine` que reciba el valor de `imei` y validar solo el formato `^\d{15}$` cuando no esté vacío — pero condicionar al tipo requiere el tipo en el schema. Opción B (recomendada, simple): en el handler de submit, antes de enviar, si `imeiEsImei && !isValidImei(values.imei)` → `setError("imei", { message: "El IMEI debe tener exactamente 15 dígitos" })` y abortar. Implementar la que encaje; resultado: error visible bajo el campo + submit bloqueado. Importar `isValidImei` de `@/lib/imei`.

- [ ] **Step 4: Build/typecheck** — `npm run build` (o `npx tsc --noEmit`) → sin errores en orden-form.

- [ ] **Step 5: Commit**
```bash
git add components/ordenes/orden-form.tsx
git commit -m "feat(ordenes): valida IMEI 15 digitos en el form (solo si el campo es IMEI)"
```

---

## Task 4: Toggle en el editor de tipos

**Files:** Modify `components/configuracion/tipo-config-editor.tsx`

- [ ] **Step 1: Leer el editor** — ubicar dónde edita la config del campo `imei` (visible/label/placeholder/maxLength). Agregar un checkbox/switch "Validar como IMEI (15 dígitos)" que setea `campos.imei.validacion = "imei"` cuando está on, y lo borra (o `undefined`) cuando off. Persistir con el flujo existente de guardado de la config del tipo.

- [ ] **Step 2: Build** — `npm run build` → sin errores.

- [ ] **Step 3: Commit**
```bash
git add components/configuracion/tipo-config-editor.tsx
git commit -m "feat(configuracion): toggle validar IMEI en el editor de tipos"
```

---

## Task 5: Verificación
- [ ] `npm run test:run` completo → verde.
- [ ] `npx tsc --noEmit` → limpio.
- [ ] Smoke prod: crear orden de celular → IMEI vacío permite guardar; IMEI "123" o con letra bloquea con error; 15 dígitos guarda. Tipo consola/serial → sin restricción. Editor de tipos → toggle persiste.
- [ ] PR (fresh review antes del merge).

## Self-Review
- Cobertura spec: helper → T1; flag tipo+preset → T2; form (input+validación opcional) → T3; toggle editor → T4. Server-side y Luhn fuera de alcance (documentado).
- Tipos: `isValidImei(string|null|undefined): boolean`, `CampoConfig.validacion?: "imei"`.
- Riesgo: integración RHF en T3 — el implementador elige refine vs setError según el patrón del archivo; el invariante es submit bloqueado + error visible, y opcional respetado.
