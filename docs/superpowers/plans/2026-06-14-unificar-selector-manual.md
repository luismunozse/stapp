# Unificar selector manual — Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development o executing-plans.

**Goal:** El selector manual de plantillas usa el `defaultText` del catálogo (sin override) en vez de sus generadores propios → mismo copy que el envío automático.

**Strict TDD:** ENABLED. `npm run test:run`.

**Spec:** `docs/superpowers/specs/2026-06-14-unificar-selector-manual-design.md` (código exacto de `applyOverride`).

---

## Task 1: applyOverride consulta el catálogo (TDD)

**Files:** Modify `lib/notifications/whatsapp-templates.ts`; Test `__tests__/lib/whatsapp-templates.test.ts`

- [ ] **Step 1: Test que falla** — extender el describe existente (usa el helper `ctxOrden`):
```ts
  const estadoMsg = (estado: any, extra = {}) =>
    getWhatsAppTemplates(ctxOrden({ estado, ...extra }))
      .find((t) => t.id === "estado_actual")!.mensaje

  it("sin override usa el defaultText del catálogo (PRESUPUESTADO accionable)", () => {
    expect(estadoMsg("PRESUPUESTADO")).toMatch(/apruebe o rechace/i)
  })
  it("override per-estado gana sobre el catálogo", () => {
    const m = getWhatsAppTemplates(ctxOrden({ estado: "RECIBIDO" }), {
      orden_estado_recibido: "Custom {numero_orden}",
    }).find((t) => t.id === "estado_actual")!.mensaje
    expect(m).toBe("Custom 42")
  })
```
(El helper `ctxOrden` ya existe en el archivo; `numeroOrden` es 42 ahí. Ajustar el valor esperado al `numeroOrden` real del helper.)

- [ ] **Step 2: Correr** `npm run test:run -- __tests__/lib/whatsapp-templates.test.ts` → el test del catálogo FALLA si el copy del generador difiere del catálogo (o PASA si coinciden — en ese caso reforzar el assert con una frase exclusiva del catálogo, ej. parte del footer del catálogo `Seguimiento:`).

- [ ] **Step 3: Implementar** — en `lib/notifications/whatsapp-templates.ts`:
  - Import: `import { renderTemplate, getPlantilla } from "@/lib/whatsapp/plantillas-catalog"` (agregar `getPlantilla`).
  - Reemplazar `applyOverride` por la versión del spec (keys per-estado + catálogo → fallback `defaultMessage`).

- [ ] **Step 4: Correr** → PASS. Correr `npm run test:run -- __tests__/lib/whatsapp-templates.test.ts` completo: actualizar cualquier aserción vieja que dependiera del texto del generador si ahora viene del catálogo (deberían coincidir en las frases clave; si un test assertaba texto exacto del generador, ajustarlo al del catálogo).

- [ ] **Step 5: Commit**
```bash
git add lib/notifications/whatsapp-templates.ts __tests__/lib/whatsapp-templates.test.ts
git commit -m "feat(whatsapp): selector manual usa defaultText del catalogo (single source)"
```

## Task 2: Verificación
- [ ] `npm run test:run` completo → verde. `npx tsc --noEmit` limpio.
- [ ] PR (fresh review). **OJO BOM** (no introducir).

## Self-Review
- Cobertura spec: applyOverride consulta catálogo → T1; override sigue ganando → T1. Generadores quedan como fallback. Una sola fuente (catálogo) para selector manual + envío automático.
