# Recordatorio WhatsApp (cron) — Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development o executing-plans.

**Goal:** El cron de recordatorio de retiro usa `queueNotification` (envío real multicanal) en vez de `NotificationService` (cuyo WhatsApp es un link muerto).

**Strict TDD:** ENABLED. `npm run test:run`.

**Spec:** `docs/superpowers/specs/2026-06-14-recordatorio-whatsapp-design.md` (tiene el código exacto del cambio).

---

## Task 1: Migrar el cron a queueNotification (TDD)

**Files:** Modify `app/api/cron/recordatorios/route.ts`; Test: el archivo de tests del cron (buscar `import { GET }` de `@/app/api/cron/recordatorios/route`; si no existe test, crear `__tests__/api/cron-recordatorios.test.ts`).

- [ ] **Step 1: Test que falla**
Mockear `@/lib/notifications/queue` (`queueNotification: vi.fn()`), `@/lib/cron-auth` (`requireCronAuth: () => null`), y supabaseAdmin (chain mocks: organizations activas con notificaciones_whatsapp true; una orden REPARADO elegible con clientes{id,nombre,email,telefono,public_token,numero_orden,dispositivo}; notification_logs count 0). Seguir el patrón de `__tests__/api/helpers.ts`. Test:
```ts
it("encola RECORDATORIO_RETIRO via queueNotification para orden elegible", async () => {
  // setup ... ejecutar GET(req con cron auth)
  const calls = vi.mocked(queueNotification).mock.calls
  expect(calls.length).toBeGreaterThan(0)
  expect(calls[0][0].tipo).toBe("RECORDATORIO_RETIRO")
  expect(calls[0][0].context.orden.publicToken).toBeTruthy()
})
it("no encola si el cliente no tiene email ni telefono", async () => {
  // orden con clientes email null + telefono null → no queue
  expect(vi.mocked(queueNotification)).not.toHaveBeenCalled()
})
```
Si mockear el cron es complejo (loop de orgs + dedup), seguir el patrón del test de cron existente o testear el happy path mínimo. Si BLOCKED por el setup, reportar.

- [ ] **Step 2: Correr** → FAIL (hoy usa NotificationService, no queueNotification).

- [ ] **Step 3: Implementar** — aplicar los cambios del spec (sección "Cambios"): imports, org select (+nombre, nombre_mostrar, slug, notificaciones_whatsapp), org guard (email||whatsapp), orden select (+numero_orden, dispositivo, public_token, clientes id/nombre/telefono), orden guard (email||telefono), y reemplazar el bloque NotificationService por el `await queueNotification({...})` del spec. Alinear el shape de `context` con la firma de `queueNotification` (igual que el PUT/orden-creada — abrir `app/api/ordenes/[id]/route.ts` si hace falta el shape exacto).
  - **OJO BOM:** no introducir BOM al inicio del archivo (verificar `head -c3` ≠ `efbbbf`; si aparece, `sed -i '1s/^\xEF\xBB\xBF//'`).

- [ ] **Step 4: Correr** test → PASS. `npx tsc --noEmit` → limpio (alinear context si TS se queja).

- [ ] **Step 5: Commit**
```bash
git add app/api/cron/recordatorios/route.ts <test>
git commit -m "feat(cron): recordatorio de retiro usa queueNotification (WhatsApp real + email)"
```

## Task 2: Verificación
- [ ] `npm run test:run` completo → verde. `npx tsc --noEmit` limpio.
- [ ] PR (fresh review).

## Self-Review
- Cobertura spec: migración a queueNotification → T1; guards email||whatsapp y email||telefono → T1; dedup intacto. Multicanal y plantilla configurable salen del path de send-direct.
