# Venta sin cobro → deuda CC — Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development o executing-plans.

**Goal:** Venta con cliente y saldo pendiente registra deuda (saldo negativo) en la CC; anulación la revierte. Requiere cliente para ventas con pendiente.

**Strict TDD:** ENABLED (donde aplica; el SQL se valida por review + smoke). `npm run test:run`.

**Spec:** `docs/superpowers/specs/2026-06-15-venta-sin-cobro-cuenta-corriente-design.md`

⚠️ **Migración 223 la aplica el usuario en prod.** Sin riesgo de overload (no se cambia la firma de `crear_venta_atomica`; `CREATE OR REPLACE` con misma firma reemplaza).

---

## Task 1: Migración 223 (SQL)
**Files:** Create `supabase/migrations/223_venta_sin_cobro_cuenta_corriente.sql`

- [ ] **Paso A — RPC nuevo `cargar_deuda_cuenta_corriente`** (del spec, sección 1): espeja `usar_cuenta_corriente` (mig 066:102-150) SIN la validación de saldo (permite negativo), tipo USO, monto negativo, referencia VENTA.

- [ ] **Paso B — `crear_venta_atomica` (CREATE OR REPLACE, firma IDÉNTICA a mig 222)**:
  - LEER `supabase/migrations/222_auto_resolver_deposito_por_sucursal.sql` COMPLETO (la def de crear_venta_atomica, 21 params terminando en `p_deposito_id, p_sucursal_id`).
  - Copiar el cuerpo **VERBATIM** (es la def LIVE en prod). NO cambiar la firma. NO usar DROP.
  - Identificar la variable real del **monto abonado** (ej. `v_monto_abonado`) y del **venta_id** (ej. `v_venta_id`) en ese cuerpo.
  - Insertar, antes del `RETURN` final (después de que la venta ya está insertada y los pagos procesados):
    ```sql
      IF p_cliente_id IS NOT NULL AND (p_total - v_monto_abonado) > 0 THEN
        PERFORM cargar_deuda_cuenta_corriente(
          p_org_id, p_cliente_id, (p_total - v_monto_abonado),
          'VENTA', v_venta_id, p_vendedor_id);
      END IF;
    ```
  - Verificar que `v_monto_abonado` y `v_venta_id` sean los nombres reales; si difieren, usar los reales.

- [ ] **Paso C — `restore_stock_on_cancel` (CREATE OR REPLACE trigger)**:
  - LEER `supabase/migrations/206_multi_deposito_fase2.sql` (la def del trigger). Copiar verbatim.
  - Agregar la reversa de deuda (spec sección 3): si la venta anulada tenía cliente y `(total - monto_abonado) > 0` → movimiento AJUSTE +pendiente, `saldo_cuenta += pendiente`. Usar los alias reales del trigger (NEW/OLD según cómo detecta ANULADA).

- [ ] **Paso D — Commit**
```bash
git add supabase/migrations/223_venta_sin_cobro_cuenta_corriente.sql
git commit -m "feat(db): venta con saldo pendiente genera deuda en cuenta corriente (mig 223)"
```

> NOTA: el SQL no tiene unit test. Verificar a OJO: (1) firma de crear_venta_atomica idéntica a 222 (mismo `CREATE OR REPLACE` sin DROP); (2) el cuerpo copiado completo (no truncar); (3) el hook usa las vars reales. Smoke en prod tras aplicar.

## Task 2: `POST /api/ventas` requiere cliente con saldo pendiente (TDD)
**Files:** Modify `app/api/ventas/route.ts`; Test `__tests__/api/ventas.test.ts`

- [ ] **Test que falla**: POST con `pagosParcial: true` (o pagos suma < total) y SIN `clienteId` → **400**. Con `clienteId` → pasa (201). Seguir el patrón existente del test de ventas (mock auth + supabaseAdmin.rpc).
- [ ] Correr → FAIL.
- [ ] Implementar: en `POST /api/ventas`, antes de llamar la RPC, computar si queda saldo pendiente (la ruta ya maneja `pagosParcial`/pagos — ver `app/api/ventas/route.ts:243-247`). Si pendiente y `!data.clienteId` → `return NextResponse.json({ error: "Para una venta a cuenta corriente (sin cobro total) tenés que seleccionar un cliente." }, { status: 400 })`.
- [ ] Correr → PASS. `npx tsc --noEmit` limpio. **OJO BOM.**
- [ ] Commit: `feat(ventas): exige cliente cuando la venta queda con saldo pendiente`

## Task 3: POS exige cliente con saldo pendiente
**Files:** Modify `components/pos/pos-checkout-dialog.tsx` (y `pos-payload.ts` si valida ahí)

- [ ] Cuando "Paga después" / saldo pendiente y no hay cliente seleccionado: bloquear el confirmar (deshabilitar + mensaje "Seleccioná un cliente para fiar / dejar saldo pendiente"). Si hay un test de POS del payload, extender; si no, verificar por build + smoke.
- [ ] `npm run build` → ok. **OJO BOM.**
- [ ] Commit: `feat(pos): exige cliente para ventas con saldo pendiente`

## Task 4: Verificación
- [ ] `npm run test:run` completo → verde. `npx tsc --noEmit` limpio.
- [ ] PR (fresh review — especialmente la migración 223: confirmar firma idéntica + cuerpo completo).
- [ ] Smoke prod (tras aplicar 223): venta paga-después con cliente → saldo negativo + movimiento USO; anular → AJUSTE+, saldo vuelve; depositar → saldo hacia 0; venta sin cliente con pendiente → 400.

## Self-Review
- Cobertura spec: RPC deuda → T1.A; crear_venta_atomica hook → T1.B; anulación reversa → T1.C; requiere cliente server → T2; POS → T3. Sin overload (firma idéntica). Edición/pago-de-deuda fuera de alcance.
- Riesgo principal: copiar verbatim el cuerpo grande de crear_venta_atomica (222) y restore_stock_on_cancel (206) sin truncar ni cambiar firma. El review del PR debe verificar esto.
