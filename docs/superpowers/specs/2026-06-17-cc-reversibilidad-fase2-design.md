# Cuenta corriente — Reversibilidad / crédito de vuelta (Fase 2)

**Fecha:** 2026-06-17 · **Estado:** Diseño aprobado

## Problema

Las reversas no devuelven plata a la cuenta corriente. Tras Fase 1 (que sumó
tipos `CARGO`/`PAGO` y el fiado en órdenes), los huecos son:

1. **Anular cobro de orden** pagado con CUENTA_CORRIENTE (USO): el saldo gastado
   NO se reacredita → el cliente pierde su crédito.
2. **Anular venta**: el trigger `restore_stock_on_cancel` revierte la deuda con
   una fórmula `total - monto_abonado` que **quedó incorrecta post-Fase-1** — no
   contempla los movimientos `PAGO` (que subieron `monto_abonado`) ni los `USO`,
   y sub-revierte.
3. **Nota de crédito** con `metodoDevolucion = CUENTA_CORRIENTE`: guarda la
   etiqueta pero NO acredita el saldo.
4. **Devolución de venta**: el enum `metodoReembolso` ni incluye CUENTA_CORRIENTE
   → no se puede devolver a la cuenta.
5. El tipo `DEVOLUCION` existe en el CHECK pero **ningún código lo inserta**
   (schema muerto).

## Objetivo

Que toda reversa/devolución reacredite correctamente la cuenta corriente, dejando
el saldo neto consistente. Cerrar los 5 huecos con una primitiva de crédito
compartida.

## Alcance

Fase 2 de 3 (Fase 1 = acumulación de fiado, hecha; Fase 3 = migración de datos
históricos, aparte).

Dentro: primitiva `devolver_cuenta_corriente` + wiring en los 4 puntos + arreglo
del trigger de anulación de venta.

Fuera: liftear el guard "no se anulan cobros de órdenes entregadas" (deja el caso
PAGO de cobros fuera — ver Decisión 5); Fase 3 (datos históricos); UI nueva más
allá de exponer CUENTA_CORRIENTE en el selector de devolución.

## Decisiones (cerradas)

1. **Primitiva `devolver_cuenta_corriente`** (tipo `DEVOLUCION`, monto +, sin
   validar saldo, FOR UPDATE). Es el "devolver plata a la cuenta" canónico, usado
   por los puntos de reversa explícita (cobro anular, nota de crédito, devolución
   de venta). Cierra el hueco #5 (usa el tipo DEVOLUCION).
2. **Anular venta = reversa net-zero por ledger** (no fórmula). En el trigger:
   `SUM(monto)` de los movimientos `CARGO/USO/PAGO` con `referencia_id = venta` y
   postear un único `AJUSTE` de `-suma`. Como CARGO/USO son negativos y PAGO
   positivo, esto neutraliza el efecto total de la venta sobre el saldo, sin
   importar la combinación. Reemplaza la fórmula vieja.
3. **Nota de crédito**: el crédito se hace DENTRO de `crear_nota_credito` (SQL),
   atómico con la creación, resolviendo `cliente_id` de la venta/orden.
4. **Devolución de venta**: agregar `CUENTA_CORRIENTE` al enum; acreditar en el
   route tras insertar los items.
5. **Cobro de orden — solo caso USO.** El cobro con método CUENTA_CORRIENTE
   pre-entrega (USO) se reacredita al anular. El caso PAGO (pago externo
   post-entrega) está bloqueado por el guard existente "no se anulan cobros de
   órdenes entregadas"; NO se levanta ese guard en Fase 2 (regla de negocio
   vigente). Documentado como límite conocido.

## Arquitectura

### Migración (DB — aplicar en prod por el usuario)

`supabase/migrations/235_cc_devolucion_reversibilidad.sql` (verificar próximo
número libre; asume 235):

1. **`devolver_cuenta_corriente`** (nueva):
   ```sql
   CREATE OR REPLACE FUNCTION devolver_cuenta_corriente(
     p_org_id TEXT, p_cliente_id TEXT, p_monto DECIMAL,
     p_referencia_tipo TEXT, p_referencia_id TEXT,
     p_usuario_id TEXT DEFAULT NULL, p_observaciones TEXT DEFAULT NULL
   ) RETURNS JSONB AS $$
   -- FOR UPDATE en clientes; saldo += p_monto; INSERT tipo='DEVOLUCION', monto=+p_monto;
   -- update saldo_cuenta; return {id, saldoAnterior, saldoNuevo}. plpgsql, sin SECURITY DEFINER.
   $$ LANGUAGE plpgsql;
   ```

2. **`restore_stock_on_cancel`** (redefinir): mantener intacta la parte de stock;
   reemplazar el bloque de CC (la fórmula `total - monto_abonado` con `AJUSTE`)
   por:
   ```sql
   -- Reversa net-zero de TODO lo que la venta movió en cuenta corriente
   IF NEW.cliente_id IS NOT NULL THEN
     SELECT COALESCE(SUM(monto), 0) INTO v_neto
     FROM cuenta_corriente
     WHERE referencia_id = NEW.id AND referencia_tipo = 'VENTA'
       AND tipo IN ('CARGO','USO','PAGO');
     IF v_neto <> 0 THEN
       SELECT saldo_cuenta INTO v_saldo FROM clientes WHERE id = NEW.cliente_id FOR UPDATE;
       v_nuevo := COALESCE(v_saldo,0) - v_neto;   -- revertir el efecto neto
       INSERT INTO cuenta_corriente (organization_id, cliente_id, tipo, monto, saldo_posterior,
         referencia_tipo, referencia_id, observaciones)
       VALUES (NEW.organization_id, NEW.cliente_id, 'AJUSTE', -v_neto, v_nuevo,
         'VENTA', NEW.id, 'Reversa por anulacion de venta');
       UPDATE clientes SET saldo_cuenta = v_nuevo WHERE id = NEW.cliente_id;
     END IF;
   END IF;
   ```
   (`v_neto` = efecto neto de la venta en el saldo; `-v_neto` lo cancela.)

3. **`crear_nota_credito`** (redefinir): tras el INSERT de la nota, si
   `p_metodo_devolucion = 'CUENTA_CORRIENTE'`, resolver `v_cliente_id` de
   `ventas`/`ordenes_servicio` (por `p_venta_id`/`p_orden_id`) y, si no es NULL:
   ```sql
   PERFORM devolver_cuenta_corriente(p_org_id, v_cliente_id, p_monto,
     'NOTA_CREDITO', v_nc_id, p_user_id, 'Nota de credito');
   ```

### Backend (rutas)

**Anular cobro de orden — `app/api/ordenes/[id]/cobros/route.ts` DELETE:**
- Ampliar el select del cobro a `id, monto, anulado, metodo_pago`.
- Ampliar el select de la orden a `estado, cliente_id`.
- Tras el soft-delete, si `cobro.metodo_pago === 'CUENTA_CORRIENTE'` y
  `orden.cliente_id` → `devolver_cuenta_corriente(org, cliente, cobro.monto,
  'ORDEN', ordenId, userId, 'Anulacion de cobro con cuenta corriente')`.
- El guard existente (`estado` ENTREGADO* → 400) se mantiene; por eso el caso
  PAGO no es alcanzable acá (Decisión 5).
- Idempotencia: el guard `cobro.anulado` garantiza una sola reversa.

**Devolución de venta — `app/api/ventas/[id]/devolucion/route.ts`:**
- Agregar `CUENTA_CORRIENTE` al enum `metodoReembolso`.
- Tras insertar `devoluciones_venta`/`items_devolucion`, si
  `metodoReembolso === 'CUENTA_CORRIENTE'` y `venta.cliente_id` →
  `devolver_cuenta_corriente(org, cliente, montoDevolucion, 'VENTA', ventaId,
  userId, 'Devolucion de venta')`.

### UI (mínima)

- `components/ventas/.../devolucion-dialog` (o donde se elija `metodoReembolso`):
  agregar la opción "Cuenta corriente" al selector. Si el selector se arma de un
  arreglo de métodos, sumar la opción. (Confirmar el componente en implementación.)
- Nota de crédito: la opción CUENTA_CORRIENTE ya existe en el diálogo; ahora
  funcionará de verdad. Sin cambios de UI.

## Idempotencia / correctitud

- **Cobro anular:** `cobro.anulado` previene doble reversa.
- **Anular venta:** el trigger dispara solo en `COMPLETADA→ANULADA` (transición
  única). La suma del ledger es determinística; postear `-v_neto` una vez deja el
  saldo neto en el estado previo a la venta.
- **Nota de crédito:** el crédito se hace en la creación de la nota (una nota =
  un crédito). Anular una nota de crédito y revertir su crédito queda fuera de
  alcance (no hay flujo de anulación de NC con reversa hoy).
- **Devolución:** cada `devoluciones_venta` acredita su `montoDevolucion` una vez;
  devoluciones parciales múltiples acreditan cada una su parte (correcto).

## Testing

Infra: tests de API (vitest + helpers). Funciones/trigger SQL: manual.

Tests de API (`__tests__/api/cc-reversibilidad.test.ts`, nuevo):
- Anular cobro método CUENTA_CORRIENTE (orden NO entregada) → llama
  `devolver_cuenta_corriente` con `('ORDEN', ordenId)` y `cobro.monto`.
- Anular cobro método EFECTIVO → NO llama `devolver_cuenta_corriente`.
- Devolución de venta con `metodoReembolso=CUENTA_CORRIENTE` → llama
  `devolver_cuenta_corriente` con `montoDevolucion`.
- Devolución con otro método → NO llama.
- Tests existentes (cobros, devoluciones, ventas) siguen verdes.
- (Nota de crédito y trigger de anulación se verifican manual: lógica SQL.)

## Plan de entrega

Un solo PR. Orden:
1. Migración 235 (devolver + trigger anular venta + crear_nota_credito).
2. Cobro DELETE: reversa USO.
3. Devolución venta: enum + crédito + opción UI.
4. Tests de API + verificación.

## Fuera de alcance

- Levantar el guard de anular cobros de órdenes entregadas (caso PAGO).
- Anulación de nota de crédito con reversa de su crédito.
- Fase 3 (recálculo/migración de saldos históricos).
- Rediseño de UI del saldo.
