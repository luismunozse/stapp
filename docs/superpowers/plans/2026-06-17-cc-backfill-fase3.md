# Cuenta corriente — Backfill de fiado histórico (Fase 3) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backfillear los `CARGO` faltantes de órdenes entregadas y ventas impagas históricas para que `saldo_cuenta` refleje el fiado real.

**Architecture:** Una migración de datos (PL/pgSQL `DO` block) inserta los `CARGO` faltantes (idempotente vía `NOT EXISTS`), con running balance por cliente, y deja `saldo_cuenta` consistente. Un `SELECT` de dry-run permite auditar montos antes de aplicar. Sin cambios de código de app.

**Tech Stack:** Postgres / Supabase migration (SQL puro). Sin TypeScript.

**Convención de tests:** No hay infra para testear un backfill de datos. Verificación = dry-run + aplicar en dev + chequear idempotencia (protocolo manual en Task 3). No se agregan tests automatizados.

**Columnas (confirmadas en auditorías previas):**
- `ordenes_servicio`: `costo_final`, `descuento_cobro`, `total_cobrado`, `estado`, `cliente_id`, `organization_id`, `fecha_entrega`.
- `ventas`: `total`, `monto_abonado`, `estado`, `cliente_id`, `organization_id`, `created_at`.
- `cuenta_corriente`: `id` (DEFAULT generate_cuid()), `organization_id`, `cliente_id`, `tipo`, `monto`, `saldo_posterior` (DECIMAL NOT NULL), `referencia_tipo`, `referencia_id`, `observaciones`, `usuario_id` (nullable), `created_at`.

---

## File Structure

**Crear:**
- `docs/cc-backfill-fase3-dryrun.sql` — query de auditoría (NO es migración; no corre solo).
- `supabase/migrations/236_cc_backfill_fiado_historico.sql` — el backfill.

Sin otros archivos. Sin cambios de código de app.

---

## Task 1: Dry-run de auditoría

**Files:**
- Create: `docs/cc-backfill-fase3-dryrun.sql`

- [ ] **Step 1: Escribir el query**

`docs/cc-backfill-fase3-dryrun.sql`:

```sql
-- DRY-RUN Fase 3: preview del backfill de fiado historico.
-- Read-only. Correr en prod ANTES de aplicar la migracion 236 para validar montos.
-- Reporta, por organizacion y cliente, cuantas ordenes/ventas se cargarian y el total.
WITH docs AS (
  SELECT o.organization_id, o.cliente_id, 'ORDEN'::text AS ref_tipo, o.id AS ref_id,
    (o.costo_final - COALESCE(o.descuento_cobro,0) - COALESCE(o.total_cobrado,0)) AS pendiente
  FROM ordenes_servicio o
  WHERE o.estado IN ('ENTREGADO','ENTREGADO_SIN_REPARACION')
    AND o.cliente_id IS NOT NULL
    AND (o.costo_final - COALESCE(o.descuento_cobro,0) - COALESCE(o.total_cobrado,0)) > 0
    AND NOT EXISTS (
      SELECT 1 FROM cuenta_corriente cc
      WHERE cc.referencia_tipo='ORDEN' AND cc.referencia_id=o.id AND cc.tipo='CARGO')
  UNION ALL
  SELECT v.organization_id, v.cliente_id, 'VENTA'::text, v.id,
    (v.total - COALESCE(v.monto_abonado,0))
  FROM ventas v
  WHERE v.estado = 'COMPLETADA'
    AND v.cliente_id IS NOT NULL
    AND (v.total - COALESCE(v.monto_abonado,0)) > 0
    AND NOT EXISTS (
      SELECT 1 FROM cuenta_corriente cc
      WHERE cc.referencia_tipo='VENTA' AND cc.referencia_id=v.id AND cc.tipo='CARGO')
),
docs_cargo AS (
  SELECT d.*,
    d.pendiente + COALESCE(
      (SELECT SUM(cc.monto) FROM cuenta_corriente cc
       WHERE cc.referencia_tipo = d.ref_tipo AND cc.referencia_id = d.ref_id AND cc.tipo='PAGO'), 0
    ) AS cargo
  FROM docs d
)
SELECT organization_id, cliente_id,
  COUNT(*) FILTER (WHERE ref_tipo='ORDEN') AS ordenes,
  COUNT(*) FILTER (WHERE ref_tipo='VENTA') AS ventas,
  ROUND(SUM(cargo), 2) AS total_a_cargar
FROM docs_cargo
GROUP BY organization_id, cliente_id
ORDER BY total_a_cargar DESC;
```

- [ ] **Step 2: Commit**

```bash
git add docs/cc-backfill-fase3-dryrun.sql
git commit -m "docs(cc): dry-run de auditoria del backfill de fiado (Fase 3)"
```
(NO ejecutar git si sos subagente — el controlador commitea.)

---

## Task 2: Migración 236 — backfill

**Files:**
- Create: `supabase/migrations/236_cc_backfill_fiado_historico.sql`

- [ ] **Step 1: Confirmar número de migración**

Run: `ls supabase/migrations/ | grep -oE '^[0-9]+' | sort -n | uniq | tail -1`
Si el mayor NO es 235, usar `<mayor>+1`. (Asume 236.)

- [ ] **Step 2: Escribir la migración**

`supabase/migrations/236_cc_backfill_fiado_historico.sql`:

```sql
-- Fase 3: backfill de fiado historico en cuenta corriente.
-- Inserta los CARGO faltantes de ordenes entregadas y ventas impagas que nunca
-- debitaron la cuenta corriente (ordenes pre-Fase-1 / ventas pre-mig-225).
-- Idempotente: solo procesa documentos SIN un CARGO previo. Running balance por
-- cliente con lock. La migracion es atomica (todo o nada).
DO $$
DECLARE
  r RECORD;
  v_cliente TEXT := NULL;
  v_saldo   DECIMAL := 0;
  v_pagos   DECIMAL;
  v_cargo   DECIMAL;
BEGIN
  FOR r IN
    SELECT * FROM (
      SELECT o.organization_id AS org_id, o.cliente_id AS cliente_id,
             'ORDEN'::text AS ref_tipo, o.id AS ref_id,
             (o.costo_final - COALESCE(o.descuento_cobro,0) - COALESCE(o.total_cobrado,0)) AS pendiente,
             o.fecha_entrega AS fecha
      FROM ordenes_servicio o
      WHERE o.estado IN ('ENTREGADO','ENTREGADO_SIN_REPARACION')
        AND o.cliente_id IS NOT NULL
        AND (o.costo_final - COALESCE(o.descuento_cobro,0) - COALESCE(o.total_cobrado,0)) > 0
        AND NOT EXISTS (
          SELECT 1 FROM cuenta_corriente cc
          WHERE cc.referencia_tipo='ORDEN' AND cc.referencia_id=o.id AND cc.tipo='CARGO')
      UNION ALL
      SELECT v.organization_id, v.cliente_id,
             'VENTA'::text, v.id,
             (v.total - COALESCE(v.monto_abonado,0)),
             v.created_at
      FROM ventas v
      WHERE v.estado = 'COMPLETADA'
        AND v.cliente_id IS NOT NULL
        AND (v.total - COALESCE(v.monto_abonado,0)) > 0
        AND NOT EXISTS (
          SELECT 1 FROM cuenta_corriente cc
          WHERE cc.referencia_tipo='VENTA' AND cc.referencia_id=v.id AND cc.tipo='CARGO')
    ) docs
    ORDER BY cliente_id, fecha
  LOOP
    -- Cambio de cliente: flush del anterior, cargar saldo del nuevo (con lock)
    IF v_cliente IS DISTINCT FROM r.cliente_id THEN
      IF v_cliente IS NOT NULL THEN
        UPDATE clientes SET saldo_cuenta = v_saldo WHERE id = v_cliente;
      END IF;
      SELECT saldo_cuenta INTO v_saldo FROM clientes WHERE id = r.cliente_id FOR UPDATE;
      v_saldo := COALESCE(v_saldo, 0);
      v_cliente := r.cliente_id;
    END IF;

    -- cargo = pendiente + SUM(PAGO previos del doc)  (anti doble-conteo)
    v_pagos := COALESCE(
      (SELECT SUM(cc.monto) FROM cuenta_corriente cc
       WHERE cc.referencia_tipo = r.ref_tipo AND cc.referencia_id = r.ref_id AND cc.tipo='PAGO'), 0);
    v_cargo := r.pendiente + v_pagos;
    v_saldo := v_saldo - v_cargo;

    INSERT INTO cuenta_corriente (
      organization_id, cliente_id, tipo, monto, saldo_posterior,
      referencia_tipo, referencia_id, observaciones, created_at
    ) VALUES (
      r.org_id, r.cliente_id, 'CARGO', -v_cargo, v_saldo,
      r.ref_tipo, r.ref_id, 'Backfill fiado historico', COALESCE(r.fecha, NOW())
    );
  END LOOP;

  -- flush del ultimo cliente
  IF v_cliente IS NOT NULL THEN
    UPDATE clientes SET saldo_cuenta = v_saldo WHERE id = v_cliente;
  END IF;
END $$;
```

Notas de implementación:
- `cuenta_corriente.id` tiene DEFAULT `generate_cuid()` → no se pasa.
- `usuario_id` queda NULL (backfill del sistema).
- `saldo_posterior` se setea con el running balance por cliente (coherente).
- Si `costo_final`/`total` fueran TEXT en vez de numeric en el esquema (revisar
  el tipo real de la columna), castear con `::numeric` en las expresiones. En la
  implementación, VERIFICAR el tipo de `ordenes_servicio.costo_final` y
  `ventas.total` (leer el `CREATE TABLE`/`ALTER` en migraciones) y agregar casts
  si hace falta para que la aritmética y `SUM` funcionen.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/236_cc_backfill_fiado_historico.sql
git commit -m "feat(db): 236 — backfill de fiado historico en cuenta corriente"
```

---

## Task 3: Verificación

No hay tests automatizados. Protocolo:

- [ ] **Step 1: Typecheck/build (sanity, no hay cambios TS)**

Run: `npx tsc --noEmit` (debe seguir igual; esta fase no toca TS).
(Build opcional: no cambió código de app.)

- [ ] **Step 2: Dry-run en una DB con datos (dev/staging o copia de prod)**

Correr `docs/cc-backfill-fase3-dryrun.sql`. Revisar # órdenes/ventas y
`total_a_cargar` por cliente. Sanity check: elegir 1-2 clientes conocidos con
fiado y verificar que el total coincide con sus documentos impagos reales.

- [ ] **Step 3: Aplicar la migración en dev/staging y validar**

Aplicar `236_*`. Para varios clientes, confirmar:
`saldo_cuenta == (SELECT SUM(monto) FROM cuenta_corriente WHERE cliente_id = X)`.
Y que el saldo neto = (lo que realmente deben menos su crédito a favor).

- [ ] **Step 4: Idempotencia**

Correr la migración (o el mismo DO block) una segunda vez en dev → confirmar 0
filas nuevas en `cuenta_corriente` y `saldo_cuenta` sin cambios.

- [ ] **Step 5: Aplicar en prod**

Solo después de validar en dev. (Acción del usuario.)

---

## Self-Review (completado)

- **Cobertura del spec:** dry-run (T1), migración backfill (T2), verificación
  manual (T3). Cubierto.
- **Placeholders:** ninguno; SQL completo.
- **Idempotencia:** el `NOT EXISTS CARGO` en ambas ramas garantiza que re-correr
  no duplica. Verificado explícitamente en T3 S4.
- **Anti-doble-conteo:** `cargo = pendiente + Σ PAGO` por documento; el net del
  doc queda en `-pendiente`. Running balance por cliente arranca del
  `saldo_cuenta` actual (que ya incluye los PAGO), así que el resultado es
  consistente.
- **Riesgo de tipos:** marcado en T2 (verificar si costo_final/total son numeric;
  castear si son TEXT).
- **Atomicidad:** la migración corre en transacción; falla = no aplica nada.
- **Sin código de app:** no hay impacto en rutas/tests existentes.
