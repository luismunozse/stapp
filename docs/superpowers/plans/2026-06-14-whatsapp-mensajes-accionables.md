# WhatsApp mensajes accionables — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development o superpowers:executing-plans. Steps con checkbox.

**Goal:** Copy por estado específico y accionable + un solo mensaje al presupuestar.

**Architecture:** Cambian strings en `generateEstadoMessage`/`generatePresupuestoMessage` (templates) y una guarda de dedup + campo `presupuesto` en el context de CAMBIO_ESTADO (route PUT). Sin cambios de firma ni estructura.

**Tech Stack:** Next.js, TypeScript, Vitest.

**Strict TDD:** ENABLED. `npm run test:run`. Rojo → mínimo → verde → commit.

**Spec:** `docs/superpowers/specs/2026-06-14-whatsapp-mensajes-accionables-design.md`

---

## File Structure
- `lib/notifications/whatsapp-templates.ts` — MODIFY. Strings de `generateEstadoMessage` (switch, líneas ~376-419) y `generatePresupuestoMessage` (~428-442).
- `app/api/ordenes/[id]/route.ts` — MODIFY. Dedup CAMBIO_ESTADO + `presupuesto` en context (~386-415).
- Test: `__tests__/lib/whatsapp-templates.test.ts` (extend), `__tests__/api/ordenes.test.ts` (extend).

---

## Task 1: Copy nuevo por estado + presupuesto

**Files:** Modify `lib/notifications/whatsapp-templates.ts`; Test `__tests__/lib/whatsapp-templates.test.ts`

- [ ] **Step 1: Tests que fallan** — append en `__tests__/lib/whatsapp-templates.test.ts` dentro del describe existente (usa el helper `ctxOrden` ya definido):

```ts
  const estadoMsg = (estado: any, extra = {}) =>
    getWhatsAppTemplates(ctxOrden({ estado, ...extra })).find((t) => t.id === "estado_actual")!.mensaje

  it("copy PRESUPUESTADO es accionable (aprobar/rechazar)", () => {
    expect(estadoMsg("PRESUPUESTADO")).toMatch(/apruebe o rechace/i)
  })
  it("copy REPARADO dice listo para retirar", () => {
    expect(estadoMsg("REPARADO")).toMatch(/listo para retirar/i)
  })
  it("copy APROBADO agradece y anuncia cola de reparacion", () => {
    expect(estadoMsg("APROBADO")).toMatch(/cola de reparaci/i)
  })
  it("mensaje de presupuesto incluye monto y CTA aprobar/rechazar", () => {
    const t = getWhatsAppTemplates(ctxOrden({ presupuesto: 1000 })).find((x) => x.id === "presupuesto")!.mensaje
    expect(t).toMatch(/apruebe o rechace/i)
    expect(t).toMatch(/Presupuesto:/i)
  })
```

- [ ] **Step 2: Correr** `npm run test:run -- __tests__/lib/whatsapp-templates.test.ts` → FAIL (copy viejo no matchea).

- [ ] **Step 3: Implementar** — en `generateEstadoMessage`, reemplazar el texto de cada `case` del switch por (mantener la estructura `mensaje += "\n\n" + ...`):

```ts
    case "RECIBIDO":
      mensaje += "\n\nRecibimos su equipo y ya esta en cola de diagnostico. Le avisaremos apenas tengamos novedades."
      break
    case "EN_DIAGNOSTICO":
      mensaje += "\n\nEstamos revisando su equipo para detectar la falla. En breve le enviamos el presupuesto."
      break
    case "PRESUPUESTADO":
      mensaje += "\n\nPara avanzar, *apruebe o rechace el presupuesto* desde el link de seguimiento de abajo. Cualquier duda, escribanos."
      break
    case "APROBADO":
      mensaje += "\n\nGracias por aprobar el presupuesto! Su equipo entra en cola de reparacion. Le avisamos cuando este listo."
      break
    case "EN_REPARACION":
      mensaje += "\n\nYa estamos reparando su equipo. Le avisamos en cuanto este terminado."
      break
    case "ESPERANDO_REPUESTO":
      mensaje += "\n\nSu reparacion esta en pausa esperando un repuesto. Apenas llegue, retomamos y le avisamos."
      break
    case "REPARADO":
      mensaje += "\n\nSu equipo esta reparado y *listo para retirar*. Lo esperamos en horario de atencion. Comprobante en el link."
      break
    case "ENTREGADO":
      mensaje += "\n\nSu equipo fue entregado. Gracias por confiar en nosotros! Si necesita algo mas, escribanos."
      break
    case "ENTREGADO_SIN_REPARACION":
      mensaje += "\n\nSu equipo fue retirado sin reparacion. Gracias por consultarnos; quedamos a disposicion."
      break
    case "CANCELADO":
      mensaje += "\n\nLa orden fue cancelada. Si desea retomar o ingresar un nuevo servicio, escribanos."
      break
    case "SIN_REPARACION":
      mensaje += "\n\nNo fue posible reparar su equipo. Puede pasar a retirarlo en horario de atencion. Quedamos a disposicion."
      break
```

Y reemplazar `generatePresupuestoMessage` por:

```ts
function generatePresupuestoMessage(ctx: NotificationContext): string {
  const formatCurrency = (amount: number) =>
    formatCurrencyValue(amount, (ctx.moneda as CurrencyCode) || DEFAULT_CURRENCY)

  const links = getOrdenLinks(ctx)

  return `Hola ${ctx.cliente.nombre}, ya tenemos el presupuesto para la reparacion de su ${ctx.orden!.dispositivo}:

*Presupuesto: ${formatCurrency(ctx.orden!.presupuesto || 0)}*

Orden #${ctx.orden!.numeroOrden}

Para avanzar, *apruebe o rechace el presupuesto* desde el link de abajo.${appendOrdenLinks(links)}

${ctx.organizationName}`
}
```

- [ ] **Step 4: Correr** → PASS. Correr también `npm run test:run -- __tests__/lib/whatsapp-templates.test.ts` completo (no romper los 19 existentes; si alguno assertaba texto viejo, actualizarlo al nuevo).

- [ ] **Step 5: Commit**
```bash
git add lib/notifications/whatsapp-templates.ts __tests__/lib/whatsapp-templates.test.ts
git commit -m "feat(whatsapp): copy por estado especifico y accionable + presupuesto con CTA"
```

---

## Task 2: Dedup — un solo mensaje al presupuestar

**Files:** Modify `app/api/ordenes/[id]/route.ts`; Test `__tests__/api/ordenes.test.ts`

- [ ] **Step 1: Test que falla** — en `__tests__/api/ordenes.test.ts`, asegurar el mock de la cola arriba del archivo (si no existe ya):
```ts
vi.mock("@/lib/notifications/queue", () => ({ queueNotification: vi.fn().mockResolvedValue(undefined) }))
```
e importar `import { queueNotification } from "@/lib/notifications/queue"`. Agregar test (seguir el patrón de PUT existente en el archivo para construir request/params y mocks de supabase; la orden base debe estar en estado EN_DIAGNOSTICO):
```ts
it("al presupuestar (auto-PRESUPUESTADO) encola PRESUPUESTO_DEFINIDO y NO CAMBIO_ESTADO", async () => {
  // ... setup PUT con body { presupuesto: 5000 } sobre orden EN_DIAGNOSTICO (reusar helpers del archivo)
  // ejecutar el PUT
  const tipos = vi.mocked(queueNotification).mock.calls.map((c) => c[0].tipo)
  expect(tipos).toContain("PRESUPUESTO_DEFINIDO")
  expect(tipos).not.toContain("CAMBIO_ESTADO")
})
```
> Si el archivo ya tiene un test de PUT con presupuesto, extender ese setup. El objetivo es verificar la guarda de dedup. Si mockear la cola rompe otros tests de PUT, ajustar (la mayoría no assertan la cola).

- [ ] **Step 2: Correr** `npm run test:run -- __tests__/api/ordenes.test.ts` → el test nuevo FALLA (hoy se encolan ambos).

- [ ] **Step 3: Implementar** — en `app/api/ordenes/[id]/route.ts`, antes de los dos bloques de notificación, computar:
```ts
    const presupuestoCambio =
      data.presupuesto !== undefined &&
      data.presupuesto !== null &&
      data.presupuesto !== orden.presupuesto
```
Cambiar la condición del bloque CAMBIO_ESTADO a:
```ts
    if (estadoFinal && estadoFinal !== orden.estado && !(estadoFinal === "PRESUPUESTADO" && presupuestoCambio)) {
```
Agregar `presupuesto: orden.presupuesto,` dentro de `context.orden` del bloque CAMBIO_ESTADO (junto a `estado`, `estadoAnterior`).
Cambiar la condición del bloque PRESUPUESTO_DEFINIDO a usar la variable: `if (presupuestoCambio) {`.

- [ ] **Step 4: Correr** → PASS. Correr `npm run test:run -- __tests__/api/ordenes.test.ts` completo (sin regresiones).

- [ ] **Step 5: Commit**
```bash
git add app/api/ordenes/[id]/route.ts __tests__/api/ordenes.test.ts
git commit -m "feat(ordenes): un solo WhatsApp al presupuestar (suprime CAMBIO_ESTADO redundante)"
```

---

## Task 3: Verificación
- [ ] `npm run test:run` completo → verde.
- [ ] `npx tsc --noEmit` → limpio.
- [ ] Smoke prod: cambiar estados de una orden de prueba y verificar el copy nuevo; cargar presupuesto y confirmar un solo WhatsApp con monto + CTA.
- [ ] PR (fresh review antes del merge).

## Self-Review
- Cobertura spec: copy por estado → T1; presupuesto consolidado → T1+T2; dedup → T2; override intacto (no se toca el lookup). 
- Tipos: `presupuestoCambio: boolean` usado en ambos bloques. `presupuesto` agregado al context.orden de CAMBIO_ESTADO (tolerado ausente por el generador).
- Sin placeholders salvo el setup del test T2 que reusa helpers del archivo (el implementer debe leer el patrón de PUT existente).
