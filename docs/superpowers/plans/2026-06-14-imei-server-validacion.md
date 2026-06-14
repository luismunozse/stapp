# IMEI server-side — Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development o executing-plans.

**Goal:** `POST /api/ordenes` rechaza IMEI inválido cuando el tipo marca el campo como IMEI. Defensa server (el form ya valida client-side).

**Strict TDD:** ENABLED. `npm run test:run`.

**Spec:** `docs/superpowers/specs/2026-06-14-imei-server-validacion-design.md` (código exacto). Scope: solo POST (el PUT no acepta imei).

---

## Task 1: Helper `tipoValidaImei` (TDD)

**Files:** Create `lib/tipos-dispositivo-config.ts`; Test `__tests__/lib/tipos-dispositivo-config.test.ts`

- [ ] **Test que falla** — mockear supabaseAdmin (`vi.mock("@/lib/supabase")`) y `TIPOS_BASE_CONFIG`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const single = vi.fn()
vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: single }) }) }) }) },
}))
import { tipoValidaImei } from "@/lib/tipos-dispositivo-config"

beforeEach(() => single.mockReset())

describe("tipoValidaImei", () => {
  it("true cuando la config de la org marca imei.validacion='imei'", async () => {
    single.mockResolvedValue({ data: { config: { campos: { imei: { validacion: "imei" } } } } })
    expect(await tipoValidaImei("org1", "celular")).toBe(true)
  })
  it("false cuando el tipo no marca imei", async () => {
    single.mockResolvedValue({ data: { config: { campos: { imei: { visible: true } } } } })
    expect(await tipoValidaImei("org1", "consola")).toBe(false)
  })
  it("cae a TIPOS_BASE_CONFIG si no hay row (celular default valida)", async () => {
    single.mockResolvedValue({ data: null })
    expect(await tipoValidaImei("org1", "celular")).toBe(true)
  })
})
```
(Ajustar el mock del chain si el patrón del repo difiere — lo importante: `maybeSingle` resuelve `{data}`.)

- [ ] **Correr** → FAIL.

- [ ] **Implementar** `lib/tipos-dispositivo-config.ts` (del spec):
```ts
import { supabaseAdmin } from "@/lib/supabase"
import { TIPOS_BASE_CONFIG } from "@/lib/tipos-dispositivo-defaults"

export async function tipoValidaImei(organizationId: string, tipoCodigo: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("tipos_dispositivo")
    .select("config")
    .eq("organization_id", organizationId)
    .eq("codigo", tipoCodigo)
    .maybeSingle()
  const config = (data?.config as any) ?? (TIPOS_BASE_CONFIG as any)[tipoCodigo] ?? null
  return config?.campos?.imei?.validacion === "imei"
}
```
Verificar el nombre de export real de `TIPOS_BASE_CONFIG` en `lib/tipos-dispositivo-defaults.ts` (el codebase lo importa así en `app/api/tipos-dispositivo/route.ts`). **OJO BOM.**

- [ ] **Correr** → PASS.
- [ ] **Commit** `feat(ordenes): helper tipoValidaImei (config por tipo)`

## Task 2: Validación en POST /api/ordenes (TDD)

**Files:** Modify `app/api/ordenes/route.ts`; Test `__tests__/api/ordenes.test.ts`

- [ ] **Test que falla** — `vi.mock("@/lib/tipos-dispositivo-config", () => ({ tipoValidaImei: vi.fn() }))`. Seguir el patrón del POST test existente:
```ts
it("rechaza IMEI invalido cuando el tipo valida IMEI (400)", async () => {
  vi.mocked(tipoValidaImei).mockResolvedValue(true)
  // POST body válido con tipoDispositivo "celular" + imei "123"
  expect(res.status).toBe(400)
})
it("acepta IMEI de 15 digitos", async () => {
  vi.mocked(tipoValidaImei).mockResolvedValue(true)
  // imei "123456789012345" → 201
})
it("no valida IMEI si el tipo no lo marca", async () => {
  vi.mocked(tipoValidaImei).mockResolvedValue(false)
  // imei "123" → 201 (no bloquea)
})
```
- [ ] **Correr** → FAIL.

- [ ] **Implementar** — en `app/api/ordenes/route.ts` POST, importar `import { tipoValidaImei } from "@/lib/tipos-dispositivo-config"` y `import { isValidImei } from "@/lib/imei"`. Tras parsear el body, antes del insert:
```ts
    if (data.imei && data.imei.trim() && data.tipoDispositivo) {
      const validaImei = await tipoValidaImei(organizationId!, data.tipoDispositivo)
      if (validaImei && !isValidImei(data.imei)) {
        return NextResponse.json({ error: "El IMEI debe tener exactamente 15 dígitos" }, { status: 400 })
      }
    }
```
   **OJO BOM** (no introducir al inicio del archivo).

- [ ] **Correr** → PASS. `npx tsc --noEmit` limpio.
- [ ] **Commit** `feat(ordenes): valida IMEI server-side en creacion (defensa)`

## Task 3: Verificación
- [ ] `npm run test:run` completo → verde. `npx tsc --noEmit` limpio.
- [ ] PR (fresh review).

## Self-Review
- Cobertura spec: helper → T1; validación POST → T2. Solo POST (PUT no acepta imei). Reusa isValidImei. Contextual (solo si el tipo marca imei).
