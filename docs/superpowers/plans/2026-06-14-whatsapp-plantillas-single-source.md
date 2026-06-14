# WhatsApp catálogo single-source — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development o superpowers:executing-plans. Steps con checkbox.

**Goal:** El envío automático de WhatsApp usa el `defaultText` del catálogo como única fuente de verdad por estado (editor = enviado), con copy accionable refrescado.

**Architecture:** Mover `resolvePlantillaForTipo` + `buildVarsForContext` + `TIPO_TO_CATALOG_KEY` a `whatsapp-message.ts` (puro, testeable) y extender `resolvePlantillaForTipo` para caer al `defaultText` del catálogo cuando no hay override. Refrescar los `defaultText` por estado. Reducir `generateWhatsAppMessage` a fallback genérico.

**Tech Stack:** Next.js, TypeScript, Vitest.

**Strict TDD:** ENABLED. `npm run test:run`. Rojo → mínimo → verde → commit.

**Spec:** `docs/superpowers/specs/2026-06-14-whatsapp-plantillas-single-source-design.md`

---

## File Structure
- `lib/notifications/whatsapp-message.ts` — MODIFY. Agrega `TIPO_TO_CATALOG_KEY`, `buildVarsForContext`, `resolvePlantillaForTipo` (con fallback a catálogo); reduce `generateWhatsAppMessage`.
- `lib/notifications/send-direct.ts` — MODIFY. Borra esas defs locales; importa de whatsapp-message; renombra `overrideText`→`resolvedText`.
- `lib/whatsapp/plantillas-catalog.ts` — MODIFY. Refresca `defaultText` de los 13 `orden_estado_*` + `orden_presupuesto` + `orden_estado_actual`.
- Test: `__tests__/lib/whatsapp-resolver.test.ts` (CREATE).

---

## Task 1: Mover + extender la resolución a whatsapp-message.ts (TDD)

**Files:** Modify `lib/notifications/whatsapp-message.ts`; Test `__tests__/lib/whatsapp-resolver.test.ts`

- [ ] **Step 1: Test que falla** — `__tests__/lib/whatsapp-resolver.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { resolvePlantillaForTipo } from "@/lib/notifications/whatsapp-message"

const ctx = (orden: Record<string, unknown> = {}) => ({
  organizationName: "GuruTech",
  organizationSlug: "gurutech",
  moneda: "ARS",
  cliente: { id: "c1", nombre: "Juan", telefono: "1100000000" },
  orden: { id: "o1", numeroOrden: 50, dispositivo: "iPhone 12", estado: "PRESUPUESTADO", presupuesto: 15000, publicToken: "tok", ...orden },
})

describe("resolvePlantillaForTipo (catálogo como fuente de verdad)", () => {
  it("CAMBIO_ESTADO sin override → default del catálogo per-estado (accionable + link)", () => {
    const m = resolvePlantillaForTipo("CAMBIO_ESTADO", ctx({ estado: "PRESUPUESTADO" }), null)!
    expect(m).toMatch(/apruebe o rechace/i)
    expect(m).toMatch(/seguimiento\/tok/)
  })

  it("override per-estado gana sobre el default", () => {
    const m = resolvePlantillaForTipo("CAMBIO_ESTADO", ctx({ estado: "RECIBIDO" }), {
      orden_estado_recibido: "Custom recibido {numero_orden}",
    })!
    expect(m).toBe("Custom recibido 50")
  })

  it("PRESUPUESTO_DEFINIDO sin override → default orden_presupuesto con monto + CTA", () => {
    const m = resolvePlantillaForTipo("PRESUPUESTO_DEFINIDO", ctx({ presupuesto: 20000 }), null)!
    expect(m).toMatch(/apruebe o rechace/i)
    expect(m).toMatch(/seguimiento\/tok/)
  })

  it("tipo desconocido sin catálogo → null", () => {
    expect(resolvePlantillaForTipo("NO_EXISTE", ctx(), null)).toBeNull()
  })
})
```

- [ ] **Step 2: Correr** `npm run test:run -- __tests__/lib/whatsapp-resolver.test.ts` → FAIL (resolvePlantillaForTipo no exportado / no cae al catálogo).

- [ ] **Step 3: Implementar en `lib/notifications/whatsapp-message.ts`**

Agregar imports arriba:
```ts
import { formatDateValue } from "@/lib/timezone"
import { renderTemplate, getPlantilla } from "@/lib/whatsapp/plantillas-catalog"
```

Agregar el mapa (copiar las entries EXACTAS desde send-direct.ts `TIPO_TO_CATALOG_KEY`, son ~20 — incluí al menos las de órdenes/garantía/cobranza/marketing que ya están; pegar el objeto completo tal cual está en send-direct):
```ts
const TIPO_TO_CATALOG_KEY: Record<string, string> = {
  CAMBIO_ESTADO: "orden_estado_actual",
  PRESUPUESTO_DEFINIDO: "orden_presupuesto",
  GARANTIA_CREADA: "garantia_creada",
  RECORDATORIO_RETIRO: "orden_listo_retirar",
  BIENVENIDA_CLIENTE: "bienvenida_cliente",
  RESPUESTA_CONSULTA: "respuesta_consulta",
  RECORDATORIO_PAGO: "cobranza_recordatorio_pago",
  CONFIRMACION_PAGO: "cobranza_confirmacion_pago",
  LINK_PAGO: "cobranza_link_pago",
  MANTENIMIENTO_PREVENTIVO: "mantenimiento_preventivo",
  PROMOCION: "promocion",
  ENCUESTA_SATISFACCION: "encuesta_satisfaccion",
  FELICITACION: "felicitacion",
  SOLICITUD_INFO: "orden_solicitud_info",
  REPUESTO_DISPONIBLE: "orden_repuesto_disponible",
  REPUESTO_NO_DISPONIBLE: "orden_repuesto_no_disponible",
  AVISO_DEMORA: "orden_aviso_demora",
  REINGRESO_GARANTIA: "garantia_reingreso",
  CLIENTE_INACTIVO: "cliente_inactivo",
  SEGUIMIENTO_PRESUPUESTO_RECHAZADO: "orden_seguimiento_rechazado",
}
```

Agregar `buildVarsForContext` (copiar EXACTO desde send-direct.ts líneas 36-90 — usa `getBaseUrl`, `formatEstado`, `formatCurrencyValue`, `formatDateValue`, todos disponibles en este módulo tras los imports). Mantener firma `function buildVarsForContext(context: any): Record<string, string | number>`.

Agregar `resolvePlantillaForTipo` extendido (exportado):
```ts
export function resolvePlantillaForTipo(
  tipo: string,
  context: any,
  plantillasOverride: Record<string, string> | null | undefined,
): string | null {
  const keys: string[] =
    tipo === "CAMBIO_ESTADO" && context.orden?.estado
      ? [`orden_estado_${String(context.orden.estado).toLowerCase()}`, "orden_estado_actual"]
      : [TIPO_TO_CATALOG_KEY[tipo]].filter(Boolean) as string[]

  if (keys.length === 0) return null
  const vars = buildVarsForContext(context)

  // 1) Override de la org (en orden de prioridad de keys)
  if (plantillasOverride) {
    for (const key of keys) {
      const tpl = plantillasOverride[key]
      if (tpl && tpl.trim()) return renderTemplate(tpl, vars)
    }
  }
  // 2) Default del catálogo (única fuente de verdad)
  for (const key of keys) {
    const def = getPlantilla(key)?.defaultText
    if (def && def.trim()) return renderTemplate(def, vars)
  }
  return null
}
```

Reducir `generateWhatsAppMessage` (quitar el switch por estado, dejar fallback genérico — el copy por estado vive en el catálogo):
```ts
export function generateWhatsAppMessage(tipo: string, context: WaMessageContext): string {
  const nombre = context.cliente.nombre
  const empresa = context.organizationName
  const o = context.orden
  const baseUrl = getBaseUrl(context.organizationSlug)
  const link = o?.publicToken ? `\n\nSeguimiento: ${baseUrl}/seguimiento/${o.publicToken}` : ""
  const ref = o?.numeroOrden ? ` (Orden #${o.numeroOrden})` : ""
  return `Hola ${nombre}, tiene una actualización${ref} de ${empresa}.${link}\n\n${empresa}`
}
```

- [ ] **Step 4: Correr** → PASS (4 tests). Y `npm run test:run -- __tests__/lib/send-direct-messages.test.ts` (el de #26): algunos asserts del copy por estado ahora viven en el catálogo, no en generateWhatsAppMessage. **Actualizar ese test**: o re-apuntar las aserciones de copy por estado a `resolvePlantillaForTipo` (CAMBIO_ESTADO sin override), o eliminarlas dejando solo el fallback genérico. Mantener verde.

- [ ] **Step 5: Commit**
```bash
git add lib/notifications/whatsapp-message.ts __tests__/lib/whatsapp-resolver.test.ts __tests__/lib/send-direct-messages.test.ts
git commit -m "feat(whatsapp): resolvePlantillaForTipo cae al default del catalogo (single source)"
```

---

## Task 2: send-direct usa la resolución del módulo

**Files:** Modify `lib/notifications/send-direct.ts`

- [ ] **Step 1: Editar**
1. Borrar de send-direct las defs locales de `TIPO_TO_CATALOG_KEY` (~13-33), `buildVarsForContext` (~36-90) y `resolvePlantillaForTipo` (~92-115).
2. Extender el import existente de whatsapp-message:
```ts
import { generateWhatsAppMessage, getBaseUrl, formatEstado, resolvePlantillaForTipo } from "@/lib/notifications/whatsapp-message"
```
   (Si `getBaseUrl`/`formatEstado` quedan sin uso en send-direct tras borrar buildVarsForContext, quitarlos del import — verificar usos: `formatEstado` se usa en el path EMAIL ~407/455; `getBaseUrl` puede quedar sin uso → quitarlo si es así.)
3. Renombrar en ambos call sites `overrideText`/`overrideTextWa` → `resolvedText` (claridad; ahora incluye el default del catálogo). La línea sigue: `const resolvedText = resolvePlantillaForTipo(...); const fallbackText = resolvedText ?? generateWhatsAppMessage(tipo, context)`.

- [ ] **Step 2: Typecheck + tests** — `npx tsc --noEmit` (arreglar imports sin uso) y `npm run test:run -- __tests__/api/ordenes-update.test.ts __tests__/lib/whatsapp-resolver.test.ts` → verde.

- [ ] **Step 3: Commit**
```bash
git add lib/notifications/send-direct.ts
git commit -m "refactor(whatsapp): send-direct usa resolvePlantillaForTipo del modulo puro"
```

---

## Task 3: Refrescar defaultText del catálogo

**Files:** Modify `lib/whatsapp/plantillas-catalog.ts`

- [ ] **Step 1: Actualizar los `defaultText`** de las entries `orden_estado_*` (13) + `orden_presupuesto` + `orden_estado_actual`, conservando el footer `\n\nSeguimiento: {link_seguimiento}\n\n{empresa}` y las `variables`. Usar el copy del spec (tabla "Copy aprobado"). Forma de cada estado:
```
Hola {cliente}, le informamos que su {dispositivo} (Orden #{numero_orden}) se encuentra <label>.

<cuerpo del spec>

Seguimiento: {link_seguimiento}

{empresa}
```
Para `orden_presupuesto`, usar el bloque del spec (monto + "apruebe o rechace"). No cambiar `key`, `label`, `category`, `variables`.

- [ ] **Step 2: Tests** — `npm run test:run -- __tests__/lib/whatsapp-resolver.test.ts __tests__/lib/plantillas-catalog.test.ts` → verde (si `plantillas-catalog.test.ts` assertaba texto viejo de estos defaults, actualizarlo). El test del resolver ya valida que presupuestado contiene "apruebe o rechace".

- [ ] **Step 3: Commit**
```bash
git add lib/whatsapp/plantillas-catalog.ts
git commit -m "feat(whatsapp): refresca defaults por estado del catalogo (copy accionable + link)"
```

---

## Task 4: Verificación
- [ ] `npm run test:run` completo → verde.
- [ ] `npx tsc --noEmit` → limpio.
- [ ] Smoke prod: con org SIN override → cambiar estado/cargar presupuesto y verificar que llega el copy nuevo (= el que muestra el editor). Con org CON override de un estado → verificar que gana el override.
- [ ] PR (fresh review antes del merge).

## Self-Review
- Cobertura spec: A (fallback a catálogo) → T1; mover a módulo puro → T1+T2; reducir generateWhatsAppMessage → T1; B (refrescar defaults) → T3. Override sigue ganando (T1 test). Editor=enviado (ambos del catálogo).
- Tipos: `resolvePlantillaForTipo(tipo, context, override): string|null` igual en módulo y call sites. `buildVarsForContext` firma intacta.
- Riesgo: el test de #26 (`send-direct-messages.test.ts`) assertaba copy por estado que ahora migró al catálogo → T1 Step 4 lo actualiza.
