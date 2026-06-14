# WhatsApp al crear orden — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development o superpowers:executing-plans. Steps con checkbox.

**Goal:** Al crear una orden, disparar la notificación automática al cliente (reusa CAMBIO_ESTADO con el estado inicial).

**Architecture:** En `POST /api/ordenes`, tras el insert, extender el select de `organizations` (+slug/moneda/zona_horaria) y encolar `queueNotification` tipo CAMBIO_ESTADO fire-and-forget. Reusa plantillas/resolución/envío existentes.

**Tech Stack:** Next.js, TypeScript, Vitest.

**Strict TDD:** ENABLED. `npm run test:run`.

**Spec:** `docs/superpowers/specs/2026-06-14-whatsapp-orden-creada-design.md`

---

## File Structure
- `app/api/ordenes/route.ts` — MODIFY (POST): extender select de org + `queueNotification`.
- Test: `__tests__/api/ordenes.test.ts` (POST tests) — extender. (Si los POST tests viven en otro archivo, usar ese; verificar dónde está el test del POST y su patrón de mocks.)

---

## Task 1: Notificar al crear orden (TDD)

**Files:** Modify `app/api/ordenes/route.ts`; Test el archivo de tests del POST de ordenes.

- [ ] **Step 1: Test que falla**

Ubicar el archivo de tests que cubre `POST /api/ordenes` (buscar `import { POST }` desde `@/app/api/ordenes/route`; probablemente `__tests__/api/ordenes.test.ts`). Seguir su patrón EXACTO (auth mock, supabase chain mocks, request builder). Asegurar el mock de la cola arriba del archivo (si no existe ya):
```ts
vi.mock("@/lib/notifications/queue", () => ({ queueNotification: vi.fn().mockResolvedValue(undefined) }))
```
e importar `import { queueNotification } from "@/lib/notifications/queue"`.

Agregar test (adaptando el setup al patrón del archivo — la orden creada debe traer `clientes`, `public_token`, `numero_orden`, `estado`):
```ts
it("al crear una orden encola CAMBIO_ESTADO con el estado inicial", async () => {
  // ... setup POST con body válido (cliente con telefono), mocks de insert que
  // devuelven la orden creada con estado RECIBIDO, public_token y clientes.
  // ejecutar POST
  const calls = vi.mocked(queueNotification).mock.calls
  expect(calls.length).toBeGreaterThan(0)
  const arg = calls[0][0]
  expect(arg.tipo).toBe("CAMBIO_ESTADO")
  expect(arg.context.orden.estado).toBe("RECIBIDO")
  expect(arg.context.orden.publicToken).toBeTruthy()
})
```
(Opcional, si el setup lo permite fácil: un segundo test con `presupuestoAceptado: true` → `context.orden.estado === "EN_REPARACION"`.)

- [ ] **Step 2: Correr** el archivo de tests del POST → FAIL (no se encola nada hoy).

- [ ] **Step 3: Implementar en `app/api/ordenes/route.ts` (POST)**

a) Extender el select de `organizations` (línea ~433):
```ts
.select("nombre, nombre_mostrar, slug, moneda, zona_horaria, logo_url, telefono, direccion, comprobante_terminos")
```

b) Asegurar el import de la cola arriba del archivo (si no está):
```ts
import { queueNotification } from "@/lib/notifications/queue"
```

c) Tras tener `org` y `orden` (después del fetch de org, antes del `return` de la respuesta), agregar:
```ts
    // Notificar al cliente que la orden fue creada (reusa CAMBIO_ESTADO con el
    // estado inicial → plantilla por estado configurable). fire-and-forget.
    const clienteOrden = orden.clientes as { id: string; nombre: string; email: string | null; telefono: string | null } | null
    if (clienteOrden) {
      queueNotification({
        organizationId: organizationId!,
        ordenId: orden.id,
        clienteId: clienteOrden.id,
        tipo: "CAMBIO_ESTADO",
        context: {
          organizationName: org?.nombre_mostrar || org?.nombre,
          organizationSlug: org?.slug,
          moneda: org?.moneda || "ARS",
          zonaHoraria: org?.zona_horaria || "America/Argentina/Buenos_Aires",
          cliente: {
            id: clienteOrden.id,
            nombre: clienteOrden.nombre,
            email: clienteOrden.email,
            telefono: clienteOrden.telefono,
          },
          orden: {
            id: orden.id,
            numeroOrden: orden.numero_orden,
            dispositivo: orden.dispositivo,
            estado: estadoInicial,
            estadoAnterior: null,
            publicToken: orden.public_token,
          },
        },
      }).catch((err) => console.error("Error queueing notification (orden creada):", err))
    }
```
Notas:
- `estadoInicial` ya está calculado arriba (línea ~310). Si no está en scope en ese punto, usar `orden.estado`.
- `org` puede ser null si el fetch falla — usar optional chaining como arriba.
- Verificar que el tipo de `context` matchee la firma de `queueNotification` (mismo shape que el PUT en `[id]/route.ts`). Si TS se queja por el shape, alinear con el del PUT.

- [ ] **Step 4: Correr** el test → PASS. Y `npm run test:run -- <archivo del POST>` completo → sin regresiones.

- [ ] **Step 5: Commit**
```bash
git add app/api/ordenes/route.ts <archivo de test>
git commit -m "feat(ordenes): notifica al cliente al crear la orden (reusa CAMBIO_ESTADO)"
```

---

## Task 2: Verificación
- [ ] `npm run test:run` completo → verde.
- [ ] `npx tsc --noEmit` → limpio (alinear el shape del context si hace falta).
- [ ] Smoke prod: crear una orden de prueba (cliente con teléfono, org con WhatsApp conectado + toggle on) → llega el WhatsApp "recibimos su equipo" (plantilla orden_estado_recibido). Editar esa plantilla en Configuración y crear otra orden → llega el texto custom.
- [ ] PR (fresh review antes del merge).

## Self-Review
- Cobertura spec: notify al crear → T1; select extendido → T1 Step 3a; reusa CAMBIO_ESTADO/estado-inicial → T1; configurable (override) ya existe (#32). Multicanal y gating los maneja send-direct.
- Riesgo: el shape de `context` debe matchear la firma de `queueNotification` (copiar del PUT). Estado inicial puede ser EN_REPARACION (presupuestoAceptado) — cubierto.
