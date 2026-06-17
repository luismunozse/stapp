# Cuenta corriente — Backfill de fiado histórico (Fase 3)

**Fecha:** 2026-06-17 · **Estado:** Diseño aprobado

## Problema

El saldo de la cuenta corriente no refleja el fiado de documentos previos a las
Fases 1/2:

- **Órdenes:** nunca debitaron la cuenta corriente antes de Fase 1 (mig. 234).
  Toda orden entregada con saldo pendiente anterior al deploy de 234 no tiene un
  `CARGO` → su fiado no está en el saldo.
- **Ventas:** recién debitan desde la mig. 225. Ventas impagas anteriores a 225
  tampoco tienen `CARGO`.

Resultado: clientes con fiado histórico muestran saldo más alto del real (deben
plata que el sistema no registra en la cuenta corriente).

## Objetivo

Backfillear los `CARGO` faltantes de órdenes y ventas históricas impagas, dejando
`saldo_cuenta` consistente con la deuda real. Operación única, idempotente,
auditable (dry-run antes de aplicar).

## Alcance

Fase 3 (final) de la unificación de fiado. Fases 1 (acumulación) y 2
(reversibilidad) ya en producción.

Dentro: migración de datos (backfill) para órdenes + ventas. Dry-run de
auditoría. Recompute implícito del saldo vía el running balance.

Fuera: cambios de código de app (es solo datos); nuevas reglas de negocio; UI.

## Decisiones (cerradas)

1. **Backfill por documento, no recompute ciego.** Las órdenes nunca tuvieron
   `CARGO`, así que recalcular `saldo = Σ ledger` no alcanza (no hay nada que
   sumar). Hay que INSERTAR los `CARGO` faltantes.
2. **Idempotente por `NOT EXISTS`.** Solo se procesan documentos que NO tengan ya
   un `CARGO` con su `(referencia_tipo, referencia_id)`. Re-correr la migración no
   duplica.
3. **Fórmula anti-doble-conteo:** `cargo = pendiente_actual + Σ(PAGO existentes
   del doc)`. Si post-Fase-1 ya se posteó un `PAGO(+)` para ese doc (pago externo
   sobre una orden entregada histórica) sin que existiera el `CARGO`, hay que
   cargar el bruto para que el neto del doc quede en `-pendiente`. Sin PAGO
   previo, `cargo = pendiente` (caso común).
4. **Running balance correcto.** El backfill corre por cliente con lock
   (`FOR UPDATE`), manteniendo `saldo_posterior` coherente y dejando
   `saldo_cuenta` en el valor final. No se setea `saldo_posterior` en cero.
5. **Dry-run obligatorio antes de aplicar.** Query de auditoría que reporta # de
   órdenes, # de ventas y monto total a cargar por cliente. El usuario lo revisa
   antes del apply.

## Definiciones de "impago"

- **Orden:** `estado IN ('ENTREGADO','ENTREGADO_SIN_REPARACION')` y
  `pendiente = costo_final - COALESCE(descuento_cobro,0) - COALESCE(total_cobrado,0) > 0`
  y `cliente_id IS NOT NULL`. (Se excluye `ENTREGADO_SIN_COBRO`: entrega sin cargo.)
- **Venta:** `estado = 'COMPLETADA'` (no ANULADA) y
  `pendiente = total - COALESCE(monto_abonado,0) > 0` y `cliente_id IS NOT NULL`.
- **Sin CARGO previo:** `NOT EXISTS (SELECT 1 FROM cuenta_corriente cc WHERE
  cc.referencia_tipo = <'ORDEN'|'VENTA'> AND cc.referencia_id = doc.id AND
  cc.tipo = 'CARGO')`.
- **Σ PAGO del doc:** `COALESCE((SELECT SUM(monto) FROM cuenta_corriente WHERE
  referencia_tipo = <tipo> AND referencia_id = doc.id AND tipo = 'PAGO'), 0)`
  (monto positivo).

## Arquitectura

### Dry-run (auditoría — correr ANTES de aplicar)

Un archivo/snippet SQL `SELECT` (lo entrega el plan; NO va en la migración) que
lista, por organización y cliente, cuántas órdenes y ventas se cargarían y el
monto total. El usuario lo corre en prod (read-only) para validar magnitudes
antes de aplicar la migración.

### Migración (DB — aplicar en prod por el usuario, tras revisar el dry-run)

`supabase/migrations/236_cc_backfill_fiado_historico.sql` (verificar próximo
número libre; asume 236). Un bloque `DO $$ ... $$` PL/pgSQL:

```text
PARA cada cliente C con al menos un documento impago sin CARGO:
  SELECT saldo_cuenta INTO v_saldo FROM clientes WHERE id = C FOR UPDATE;
  PARA cada documento D (orden o venta) impago sin CARGO de C, ordenado por fecha:
    v_pendiente := pendiente(D)
    v_pagos     := Σ PAGO(D)
    v_cargo     := v_pendiente + v_pagos
    v_saldo     := v_saldo - v_cargo
    INSERT INTO cuenta_corriente (
      organization_id, cliente_id, tipo, monto, saldo_posterior,
      referencia_tipo, referencia_id, observaciones, created_at
    ) VALUES (
      org, C, 'CARGO', -v_cargo, v_saldo,
      <'ORDEN'|'VENTA'>, D.id, 'Backfill fiado historico', <fecha del doc>
    );
  UPDATE clientes SET saldo_cuenta = v_saldo WHERE id = C;
```

- `<fecha del doc>`: `fecha_entrega` (orden) / `created_at` (venta) para que el
  movimiento aparezca cronológico en el historial.
- Implementación concreta: un único recorrido que une órdenes y ventas elegibles
  (UNION ALL con un campo discriminador de tipo), agrupado por cliente, con el
  running balance por cliente. (Detalle en el plan.)
- Todo dentro de una transacción (la migración es atómica); si algo falla, no se
  aplica nada.

### Sin cambios de código de app

No se tocan rutas, componentes ni funciones SQL existentes. Las funciones de
Fases 1/2 ya manejan los documentos nuevos correctamente; Fase 3 solo rellena el
pasado.

## Idempotencia y seguridad

- Re-aplicar la migración no duplica: el filtro `NOT EXISTS CARGO` excluye los ya
  backfilleados.
- `FOR UPDATE` por cliente evita carreras con operaciones concurrentes.
- La fórmula con `Σ PAGO` garantiza que el neto por documento sea exactamente
  `-pendiente`, sin importar si hubo pagos post-Fase-1.
- El dry-run permite validar montos antes de tocar prod.

## Testing

No hay infra para testear un backfill de datos vía los mocks de API. Verificación:

1. **Dry-run** en prod (read-only): revisar # docs y montos por cliente; sanity
   check contra clientes conocidos con fiado.
2. **Aplicar en dev/staging** (con datos representativos o copia de prod) y
   validar a mano el `saldo_cuenta` de varios clientes contra la suma real de sus
   órdenes/ventas impagas.
3. **Idempotencia:** correr la migración dos veces en dev y confirmar que la
   segunda no inserta filas nuevas ni cambia saldos.
4. Recién entonces aplicar en prod.

(No se agregan tests automatizados; se documenta el protocolo de verificación
manual como parte del plan.)

## Plan de entrega

Un solo PR (la migración + el snippet de dry-run en docs). Orden:
1. Escribir el dry-run `SELECT` (docs/snippet).
2. Escribir la migración 236 (DO block).
3. Verificación manual según protocolo (dry-run + dev + idempotencia).

## Fuera de alcance

- Tests automatizados del backfill.
- Cambios de código de aplicación.
- Reconciliación de otros conceptos (depósitos, ajustes) — ya consistentes vía el
  ledger.
- Reversa de este backfill (si hiciera falta, se hace con AJUSTE manual; no se
  diseña acá).
