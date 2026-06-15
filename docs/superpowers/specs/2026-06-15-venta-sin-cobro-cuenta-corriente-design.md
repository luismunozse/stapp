# Venta sin cobro → deuda en cuenta corriente

**Fecha:** 2026-06-15 · **Estado:** Diseño aprobado

## Problema

Una venta sin cobro / con saldo pendiente (`estado_pago=PENDIENTE/PAGADO_PARCIAL`) no se refleja en la cuenta corriente del cliente. El cliente debe pero su `saldo_cuenta` no baja. CC y ventas están desconectadas en ese caso.

## Objetivo

Toda venta con `cliente_id` y `total > monto_abonado` registra el pendiente como **deuda** en la CC del cliente: movimiento + `saldo_cuenta` negativo. Anular la venta revierte la deuda. (Convención existente: saldo positivo = crédito a favor; negativo = deuda.)

## Decisiones (cerradas)

1. **Disparo:** cualquier venta con cliente y `saldo_pendiente = total - monto_abonado > 0`. El pendiente ya excluye lo pagado con método `CUENTA_CORRIENTE` (que ya descuenta crédito vía `usar_cuenta_corriente`) → sin double-count.
2. **Requiere cliente:** una venta con saldo pendiente necesita `cliente_id` (no se fía a nadie). Validación server + POS.
3. **Permite saldo negativo:** la deuda NO usa `usar_cuenta_corriente` (que valida saldo ≥ monto). Usa un RPC nuevo que permite negativo.
4. **Anulación revierte** la deuda.
5. **Pagar la deuda = fuera de alcance** (el `depositar_cuenta_corriente` existente lleva el saldo de −X hacia 0). Edición de venta = fuera de alcance (solo creación + anulación).

## Arquitectura — Migración 223 (aplicar en prod)

> ⚠️ **Sin riesgo de overload:** NO se cambia la firma de `crear_venta_atomica` (21 params, mig 222). `CREATE OR REPLACE` con la MISMA firma reemplaza en el lugar. Igual para `restore_stock_on_cancel` (trigger, sin args). NO usar DROP.

### 1. RPC nuevo `cargar_deuda_cuenta_corriente` (permite negativo)
Espeja `usar_cuenta_corriente` (mig 066:102-150) PERO sin la validación de saldo:
```sql
CREATE OR REPLACE FUNCTION cargar_deuda_cuenta_corriente(
  p_org_id TEXT, p_cliente_id TEXT, p_monto DECIMAL,
  p_referencia_tipo TEXT, p_referencia_id TEXT, p_usuario_id TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE v_saldo_actual DECIMAL; v_nuevo_saldo DECIMAL; v_mov_id TEXT;
BEGIN
  SELECT saldo_cuenta INTO v_saldo_actual FROM clientes
   WHERE id = p_cliente_id AND organization_id = p_org_id FOR UPDATE;
  IF v_saldo_actual IS NULL THEN RAISE EXCEPTION 'Cliente no encontrado'; END IF;
  v_nuevo_saldo := COALESCE(v_saldo_actual,0) - p_monto;   -- puede quedar negativo
  INSERT INTO cuenta_corriente (organization_id, cliente_id, tipo, monto, saldo_posterior,
    referencia_tipo, referencia_id, usuario_id, observaciones)
  VALUES (p_org_id, p_cliente_id, 'USO', -p_monto, v_nuevo_saldo,
    p_referencia_tipo, p_referencia_id, p_usuario_id, 'Venta a cuenta corriente (saldo pendiente)')
  RETURNING id INTO v_mov_id;
  UPDATE clientes SET saldo_cuenta = v_nuevo_saldo WHERE id = p_cliente_id;
  RETURN jsonb_build_object('id', v_mov_id, 'saldoAnterior', v_saldo_actual, 'saldoNuevo', v_nuevo_saldo);
END; $$ LANGUAGE plpgsql;
```

### 2. `crear_venta_atomica` (CREATE OR REPLACE, firma idéntica a mig 222)
- Copiar el cuerpo **verbatim** de `supabase/migrations/222_auto_resolver_deposito_por_sucursal.sql` (la def LIVE).
- Tras insertar la venta y tener `v_venta_id` + `v_monto_abonado` (las vars que ya calcula), agregar al final (antes del RETURN):
```sql
  -- Saldo pendiente → deuda en cuenta corriente del cliente
  IF p_cliente_id IS NOT NULL AND (p_total - v_monto_abonado) > 0 THEN
    PERFORM cargar_deuda_cuenta_corriente(
      p_org_id, p_cliente_id, (p_total - v_monto_abonado),
      'VENTA', v_venta_id, p_vendedor_id);
  END IF;
```
  (Confirmar el nombre real de la var del monto abonado y del venta_id en la def de 222.)

### 3. `restore_stock_on_cancel` (CREATE OR REPLACE, trigger — anulación)
- Copiar el cuerpo verbatim de `supabase/migrations/206_multi_deposito_fase2.sql` (última def).
- Agregar la reversa de la deuda: si la venta anulada tenía cliente y saldo pendiente:
```sql
  IF NEW.cliente_id IS NOT NULL AND (NEW.total - NEW.monto_abonado) > 0 THEN
    -- revertir la deuda: AJUSTE positivo que sube el saldo
    DECLARE v_saldo DECIMAL; v_nuevo DECIMAL;
    BEGIN
      SELECT saldo_cuenta INTO v_saldo FROM clientes WHERE id = NEW.cliente_id FOR UPDATE;
      v_nuevo := COALESCE(v_saldo,0) + (NEW.total - NEW.monto_abonado);
      INSERT INTO cuenta_corriente (organization_id, cliente_id, tipo, monto, saldo_posterior,
        referencia_tipo, referencia_id, observaciones)
      VALUES (NEW.organization_id, NEW.cliente_id, 'AJUSTE', (NEW.total - NEW.monto_abonado), v_nuevo,
        'VENTA', NEW.id, 'Anulación de venta a cuenta corriente');
      UPDATE clientes SET saldo_cuenta = v_nuevo WHERE id = NEW.cliente_id;
    END;
  END IF;
```
  (Usar las columnas/alias reales del trigger — NEW vs OLD según cómo detecta la anulación. Confirmar contra la def de 206.)

## App layer

### `POST /api/ventas`
- Si la venta queda con saldo pendiente (`pagosParcial` o suma de pagos < total) y NO hay `clienteId` → **400** "Para una venta a cuenta corriente (sin cobro total) tenés que seleccionar un cliente."

### POS (`pos-checkout-dialog.tsx` / `pos-payload`)
- Al activar "Paga después" / quedar saldo pendiente: exigir cliente seleccionado (deshabilitar confirmar o mostrar error claro) antes de enviar.

## Edge cases
- Venta paga 100% → `saldo_pendiente=0` → no toca CC.
- Venta sin cliente y paga 100% → OK (no requiere cliente).
- Pago con método CUENTA_CORRIENTE → ya descuenta crédito; el pendiente restante (si lo hay) genera deuda adicional. Sin double-count (pendiente = total − abonado).
- Anulación → AJUSTE +pendiente, saldo vuelve. Si además hubo pago con crédito CC, la reversa de ESE es comportamiento pre-existente (no se toca acá).

## Testing
- **`cargar_deuda_cuenta_corriente`**: no es unit-testeable en TS (RPC SQL) → cubierto por smoke en prod + por los tests de la ruta que mockean `supabaseAdmin.rpc`.
- **`POST /api/ventas`** (`__tests__/api/ventas.test.ts`): venta con `pagosParcial:true` sin `clienteId` → 400; con `clienteId` → 201 y la RPC recibe los params (el descuento CC ocurre dentro de la RPC, no testeable acá). Mantener verde los tests existentes.
- **Smoke prod** (tras migración 223): venta "paga después" con cliente → `saldo_cuenta` baja (negativo), aparece movimiento USO en CC. Anular → AJUSTE +, saldo vuelve. Depositar → saldo sube hacia 0.

## Fuera de alcance
- Flujo dedicado "cobrar venta pendiente" (se usa depositar). Edición de venta recalculando deuda. Reversa de pagos-con-crédito-CC en anulación (pre-existente).
