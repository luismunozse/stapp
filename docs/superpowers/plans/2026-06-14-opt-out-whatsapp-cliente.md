# Opt-out WhatsApp por cliente — Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development o executing-plans.

**Goal:** Flag `acepta_whatsapp` por cliente; el envío WhatsApp lo respeta (gate único en send-direct); editable en el form de cliente.

**Strict TDD:** ENABLED. `npm run test:run`.

**Spec:** `docs/superpowers/specs/2026-06-14-opt-out-whatsapp-cliente-design.md` (código exacto).

⚠️ **Migración 217 la aplica el usuario en prod** (SQL editor) antes del deploy.

---

## Task 1: Migración 217
**Files:** Create `supabase/migrations/217_clientes_acepta_whatsapp.sql`
- [ ] Crear:
```sql
-- 217: opt-out de WhatsApp por cliente. Default true (todos reciben salvo desmarcar).
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS acepta_whatsapp BOOLEAN NOT NULL DEFAULT true;
```
- [ ] Commit: `git commit -m "feat(db): clientes.acepta_whatsapp (opt-out WhatsApp) — migracion 217"`

## Task 2: Gate en send-direct (sin unit test — módulo no aislable)
**Files:** Modify `lib/notifications/send-direct.ts`
- [ ] En `sendNotificationDirect`, antes del bloque WhatsApp (`:139`), cargar el flag por `clienteId`:
```ts
  let aceptaWhatsapp = true
  if (clienteId) {
    const { data: cli } = await supabaseAdmin
      .from("clientes")
      .select("acepta_whatsapp")
      .eq("id", clienteId)
      .single()
    aceptaWhatsapp = cli?.acepta_whatsapp ?? true
  }
```
   (Ubicar el query fuera/antes del `if` de WhatsApp; `clienteId` es param de la función.)
- [ ] Cambiar el gate: `if (orgConfig.notificaciones_whatsapp && context.cliente.telefono && aceptaWhatsapp) {`
- [ ] `npx tsc --noEmit` limpio. **OJO BOM** (no introducir; `head -c3` ≠ efbbbf).
- [ ] Commit: `git commit -m "feat(notif): respeta acepta_whatsapp del cliente antes de enviar WhatsApp"`

## Task 3: Route de clientes (TDD)
**Files:** Modify `app/api/clientes/route.ts` (+ `[id]/route.ts` si el update está ahí); Test `__tests__/api/clientes.test.ts`
- [ ] **Test que falla**: POST cliente con `aceptaWhatsapp: false` → el insert recibe `acepta_whatsapp: false`. Sin el campo → `true`. Seguir el patrón del test existente (mock supabase insert, assertar el payload del `.insert`).
- [ ] Correr → FAIL.
- [ ] Implementar: en el schema Zod del body agregar `aceptaWhatsapp: z.boolean().optional()`; en el insert/update agregar `acepta_whatsapp: data.aceptaWhatsapp ?? true`. Si el GET/response mapea columnas (db-utils `formatCliente`), agregar `aceptaWhatsapp: row.acepta_whatsapp`.
- [ ] Correr → PASS.
- [ ] Commit: `git commit -m "feat(clientes): API acepta y persiste aceptaWhatsapp"`

## Task 4: Form de cliente + type
**Files:** Modify `components/clientes/cliente-form.tsx`, `types/index.ts` (+ `lib/db-utils.ts` si mapea Cliente)
- [ ] `types/index.ts`: agregar `aceptaWhatsapp?: boolean` al type Cliente. Si `lib/db-utils.ts` tiene `formatCliente`, mapear `acepta_whatsapp` → `aceptaWhatsapp`.
- [ ] `cliente-form.tsx`: schema `aceptaWhatsapp: z.boolean().default(true)`; defaultValues `aceptaWhatsapp: cliente?.aceptaWhatsapp ?? true` (y `true` en alta); agregar Checkbox/Switch "Acepta notificaciones por WhatsApp" (marcado por defecto), cerca del teléfono. Incluir el campo en el payload del submit.
- [ ] `npm run build` (o `npx tsc --noEmit`) → sin errores. **OJO BOM.**
- [ ] Commit: `git commit -m "feat(clientes): checkbox acepta WhatsApp en el form + type"`

## Task 5: Verificación
- [ ] `npm run test:run` completo → verde. `npx tsc --noEmit` limpio.
- [ ] Smoke prod (tras aplicar migración 217 + deploy): cliente con "Acepta WhatsApp" desmarcado → cambio de estado NO le manda WhatsApp (email sí si tiene); marcado → sí.
- [ ] PR (fresh review).

## Self-Review
- Cobertura spec: migración → T1; gate único → T2; persistencia → T3; UI+type → T4. Solo WhatsApp (email intacto). Default true (no rompe existentes).
- Riesgo: send-direct no unit-testeable (firebase) → gate cubierto por smoke; route + persistencia sí testeados.
