# Trigger de integridad de `estado_cobro` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que `estado_cobro` y `total_cobrado` no puedan quedar desactualizados cuando cambia `costo_final` o `descuento_cobro`, sin importar qué camino de código haga la escritura.

**Architecture:** La regla ya existe en el RPC idempotente `recalcular_estado_cobro` (`068_mejoras_ordenes.sql:100-130`), pero se invoca solo desde 3 de ~13 caminos de escritura. En vez de repetirla por décima vez a mano, se mueve al motor con un trigger `AFTER UPDATE OF costo_final, descuento_cobro` sobre `ordenes_servicio`. No introduce una fuente de verdad nueva: hace cumplir la que ya existe.

**Tech Stack:** PostgreSQL (Supabase), plpgsql. Sin cambios en TypeScript.

**Spec de referencia:** `docs/superpowers/specs/2026-07-24-servicios-en-ordenes-design.md`, secciones 1, 4.1 y 4.2.

## Global Constraints

- **Sin `SECURITY DEFINER`.** `recalcular_estado_cobro` es `LANGUAGE plpgsql` sin `SECURITY DEFINER` (`068:132`). La función del trigger mantiene esa misma postura de privilegios. Este repo pasó por un hardening de RLS (migración 201); no se elevan privilegios por conveniencia.
- **Ninguna fila existente se modifica en esta entrega.** El backfill histórico es una entrega aparte (PR 2) y depende de revisar el dry-run producido en la Task 2.
- **Sin cambios en TypeScript.** Si un paso propone tocar un `.ts`, el plan está mal aplicado.
- **Numeración de migración:** 277. La última aplicada es 276 (`276_foto_borrador.sql`).
- **Comentarios SQL en español neutro**, como el resto de `supabase/migrations/`.

## Nota sobre la estrategia de test

El suite de vitest **mockea Supabase por completo** (`__tests__/api/helpers.ts:72`, `mockSupabaseFrom`). Un trigger de base de datos es, por definición, invisible para ese suite: no hay TypeScript que ejercitar y el mock nunca ejecuta SQL. Escribir un test de vitest acá daría cobertura falsa.

La verificación va a nivel SQL, siguiendo el precedente del propio repo: `supabase/migrations/verify/phase1_probes.sql`. El ciclo TDD se conserva — el probe se escribe y se corre **antes** de la migración, debe fallar, y recién después se aplica el trigger.

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `supabase/migrations/277_trigger_recalcular_estado_cobro.sql` | Crear la función del trigger y el trigger. Único cambio de comportamiento. |
| `supabase/migrations/verify/277_probes.sql` | Probes de verificación con resultados esperados. Se corre antes (falla) y después (pasa). |
| `supabase/migrations/rollback/277_rollback.sql` | Revertir el trigger. Sigue el patrón de `rollback/201_rollback.sql`. |
| `docs/dry-run-backfill-estado-cobro.sql` | Query de solo lectura que dimensiona el backfill del PR 2. No modifica nada. Espeja `docs/cc-backfill-fase3-dryrun.sql`. |

---

### Task 1: Trigger de recalculación de `estado_cobro`

**Files:**
- Create: `supabase/migrations/verify/277_probes.sql`
- Create: `supabase/migrations/277_trigger_recalcular_estado_cobro.sql`
- Create: `supabase/migrations/rollback/277_rollback.sql`

**Interfaces:**
- Consumes: `recalcular_estado_cobro(p_orden_id TEXT) RETURNS VOID` — ya existe en `068_mejoras_ordenes.sql:100`. No se modifica.
- Produces: trigger `ordenes_recalcular_cobro` sobre `ordenes_servicio` y función `trg_recalcular_estado_cobro() RETURNS TRIGGER`. El PR 3 (Servicios) depende de que este trigger exista: sus escrituras de `costo_final` no llaman al RPC explícitamente.

- [ ] **Step 1: Escribir el probe que falla**

Crear `supabase/migrations/verify/277_probes.sql`:

```sql
-- =============================================================================
-- Verificación de la migración 277 — trigger de recalculación de estado_cobro
-- Correr en el SQL editor de Supabase Studio.
--
-- CÓMO USAR:
--   1. Correr este archivo ANTES de aplicar 277. Los probes 2, 3 y 4 deben FALLAR
--      (devuelven FALLA). Eso confirma que el bug existe y que el probe lo detecta.
--   2. Aplicar 277_trigger_recalcular_estado_cobro.sql.
--   3. Volver a correr este archivo. Los cuatro probes deben devolver OK.
--
-- Todo corre dentro de BEGIN/ROLLBACK: no persiste ningún dato.
-- =============================================================================

BEGIN;

-- Se opera sobre una orden REAL en vez de insertar una sintética. ordenes_servicio
-- tiene varios NOT NULL sin default —cliente_id (001_schema.sql:186), sucursal_id
-- (207_sucursales_set_not_null.sql:25), dispositivo y tipo_dispositivo (001:189-190)—
-- y armar una fila válida a mano es frágil: se rompe con cada columna nueva.
-- Todo corre dentro de BEGIN/ROLLBACK, así que la orden elegida no queda modificada.
CREATE TEMP TABLE _probe AS
SELECT o.id, SUM(c.monto) AS cobrado
FROM ordenes_servicio o
JOIN cobros_orden c ON c.orden_id = o.id AND c.anulado = FALSE
GROUP BY o.id
HAVING SUM(c.monto) > 0
LIMIT 1;

-- ---------------------------------------------------------------------------
-- PROBE 0 — Setup
-- ESPERADO: OK. Si dice ABORTAR, no hay datos con los que probar: correr esto
-- en un entorno que tenga al menos una orden con cobros no anulados.
-- ---------------------------------------------------------------------------
SELECT CASE WHEN COUNT(*) = 0
            THEN 'ABORTAR: no hay ordenes con cobros'
            ELSE 'OK: orden de prueba seleccionada' END AS probe_0_setup
FROM _probe;

-- Punto de partida conocido: costo_final igual a lo cobrado, sin descuento.
UPDATE ordenes_servicio o
SET costo_final = p.cobrado, descuento_cobro = 0
FROM _probe p WHERE o.id = p.id;

SELECT recalcular_estado_cobro(id) FROM _probe;

-- ---------------------------------------------------------------------------
-- PROBE 1 — Estado inicial consistente
-- ESPERADO: OK  (pasa con y sin la migración; valida el setup)
-- ---------------------------------------------------------------------------
SELECT CASE WHEN o.estado_cobro = 'COBRADO'
            THEN 'OK' ELSE 'FALLA: ' || o.estado_cobro END AS probe_1_estado_inicial
FROM ordenes_servicio o JOIN _probe p ON p.id = o.id;

-- ---------------------------------------------------------------------------
-- PROBE 2 — Duplicar costo_final debe degradar el estado a PARCIAL
-- ESPERADO SIN 277: FALLA (queda en COBRADO)   |   CON 277: OK
-- ---------------------------------------------------------------------------
UPDATE ordenes_servicio o SET costo_final = p.cobrado * 2
FROM _probe p WHERE o.id = p.id;

SELECT CASE WHEN o.estado_cobro = 'PARCIAL'
            THEN 'OK' ELSE 'FALLA: quedo en ' || o.estado_cobro END AS probe_2_sube_costo_final
FROM ordenes_servicio o JOIN _probe p ON p.id = o.id;

-- ---------------------------------------------------------------------------
-- PROBE 3 — Un descuento que cubre el saldo debe volver el estado a COBRADO
-- ESPERADO SIN 277: FALLA   |   CON 277: OK
-- ---------------------------------------------------------------------------
UPDATE ordenes_servicio o SET descuento_cobro = p.cobrado
FROM _probe p WHERE o.id = p.id;

SELECT CASE WHEN o.estado_cobro = 'COBRADO'
            THEN 'OK' ELSE 'FALLA: quedo en ' || o.estado_cobro END AS probe_3_descuento_cubre_saldo
FROM ordenes_servicio o JOIN _probe p ON p.id = o.id;

-- ---------------------------------------------------------------------------
-- PROBE 4 — Anular el costo debe dejar el estado en PENDIENTE
-- ESPERADO SIN 277: FALLA   |   CON 277: OK
-- ---------------------------------------------------------------------------
UPDATE ordenes_servicio SET costo_final = NULL, descuento_cobro = 0
WHERE id IN (SELECT id FROM _probe);

SELECT CASE WHEN o.estado_cobro = 'PENDIENTE'
            THEN 'OK' ELSE 'FALLA: quedo en ' || o.estado_cobro END AS probe_4_costo_nulo
FROM ordenes_servicio o JOIN _probe p ON p.id = o.id;

-- ---------------------------------------------------------------------------
-- PROBE 5 — Un update que NO toca costo_final ni descuento_cobro no debe
--           disparar el trigger ni alterar el estado de cobro.
-- ESPERADO CON 277: OK. Si falla, el UPDATE OF está listando de más.
-- ---------------------------------------------------------------------------
UPDATE ordenes_servicio o SET costo_final = p.cobrado * 2
FROM _probe p WHERE o.id = p.id;

UPDATE ordenes_servicio SET observaciones = COALESCE(observaciones, '')
WHERE id IN (SELECT id FROM _probe);

SELECT CASE WHEN o.estado_cobro = 'PARCIAL'
            THEN 'OK' ELSE 'FALLA: quedo en ' || o.estado_cobro END AS probe_5_update_irrelevante
FROM ordenes_servicio o JOIN _probe p ON p.id = o.id;

ROLLBACK;
```

- [ ] **Step 2: Correr el probe contra la base — debe fallar**

Pegar el archivo completo en el SQL editor de Supabase Studio (entorno de staging si existe; si no, producción es seguro porque todo corre dentro de `BEGIN/ROLLBACK`).

Esperado **antes** de la migración:
- `probe_1_estado_inicial` → `OK`
- `probe_2_sube_costo_final` → `FALLA: quedo en COBRADO`
- `probe_3_descuento_cubre_saldo` → `FALLA: ...`
- `probe_4_costo_nulo` → `FALLA: ...`
- `probe_5_update_irrelevante` → `FALLA: ...`

Si el probe 2 devuelve `OK` antes de aplicar la migración, **parar**: significa que ya existe algún mecanismo de recalculación no detectado en el análisis y este plan hay que revisarlo.

- [ ] **Step 3: Escribir la migración**

Crear `supabase/migrations/277_trigger_recalcular_estado_cobro.sql`:

```sql
-- 277: Trigger de integridad para estado_cobro / total_cobrado
--
-- PROBLEMA
-- costo_final se escribe desde ~10 lugares y solo uno (app/api/ordenes/route.ts:464)
-- llama a recalcular_estado_cobro. Los otros dejan estado_cobro y total_cobrado
-- desactualizados:
--   - app/api/ordenes/[id]/route.ts:282 (PUT genérico)
--   - lib/cotizacion-aprobar-orden.ts:82
--   - app/api/public/ordenes/[token]/approve-budget/route.ts:64  <-- endpoint público
--   - app/api/public/ordenes/[token]/reject-budget/route.ts:41
--   - app/api/cotizaciones/route.ts:454
--   - app/api/cotizaciones/[id]/route.ts:84, 122, 141, 507, 634, 649
--
-- IMPACTO
--   - 273_deuda_solo_ordenes_cobrables.sql:56 filtra estado_cobro IN ('PENDIENTE','PARCIAL'),
--     así que una orden que quedó en COBRADO con saldo real desaparece de la deuda del cliente.
--   - app/api/comisiones/route.ts:57 filtra estado_cobro = 'COBRADO', así que esa misma
--     orden sí computa comisión, calculada sobre un ingreso que nunca entró.
--
-- SOLUCIÓN
-- La regla se mueve al motor. recalcular_estado_cobro (068_mejoras_ordenes.sql:100) ya es
-- idempotente y puro: deriva todo de cobros_orden + costo_final + descuento_cobro. No se
-- introduce una fuente de verdad nueva; se hace cumplir la que ya existe.
--
-- POR QUÉ NO HAY RECURSIÓN
-- El UPDATE anidado dentro de recalcular_estado_cobro (068:127-130) fija únicamente
-- total_cobrado y estado_cobro. En PostgreSQL, AFTER UPDATE OF <cols> dispara cuando la
-- columna aparece en la lista SET del statement; ninguna de las dos columnas del UPDATE OF
-- está ahí. La cláusula WHEN actúa como segunda guarda.
--
-- PRIVILEGIOS
-- Sin SECURITY DEFINER, igual que recalcular_estado_cobro (068:132). Todas las escrituras
-- de la app pasan por service_role.
--
-- ALCANCE
-- Esta migración NO modifica ninguna fila existente. La corrección de datos históricos
-- es la migración 278, y depende de revisar antes docs/dry-run-backfill-estado-cobro.sql.

CREATE OR REPLACE FUNCTION trg_recalcular_estado_cobro()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM recalcular_estado_cobro(NEW.id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trg_recalcular_estado_cobro() IS
  'Mantiene estado_cobro y total_cobrado sincronizados ante cambios de costo_final o descuento_cobro. Ver migración 277.';

DROP TRIGGER IF EXISTS ordenes_recalcular_cobro ON ordenes_servicio;

CREATE TRIGGER ordenes_recalcular_cobro
  AFTER UPDATE OF costo_final, descuento_cobro ON ordenes_servicio
  FOR EACH ROW
  WHEN (
    OLD.costo_final     IS DISTINCT FROM NEW.costo_final OR
    OLD.descuento_cobro IS DISTINCT FROM NEW.descuento_cobro
  )
  EXECUTE FUNCTION trg_recalcular_estado_cobro();
```

- [ ] **Step 4: Escribir el rollback**

Crear `supabase/migrations/rollback/277_rollback.sql`:

```sql
-- Rollback de 277_trigger_recalcular_estado_cobro.sql
--
-- Restaura el comportamiento previo: estado_cobro deja de recalcularse
-- automáticamente ante cambios de costo_final o descuento_cobro.
-- Ojo: eso reintroduce el bug descrito en la migración 277.

DROP TRIGGER IF EXISTS ordenes_recalcular_cobro ON ordenes_servicio;
DROP FUNCTION IF EXISTS trg_recalcular_estado_cobro();
```

- [ ] **Step 5: Aplicar la migración y volver a correr el probe — debe pasar**

Aplicar `supabase/migrations/277_trigger_recalcular_estado_cobro.sql` en Supabase Studio.

Volver a pegar y correr `supabase/migrations/verify/277_probes.sql` completo.

Esperado **después** de la migración: los cinco probes devuelven `OK`.

Si el probe 5 falla, el trigger está disparando de más: revisar que la cláusula `UPDATE OF` liste exactamente `costo_final, descuento_cobro`.

- [ ] **Step 6: Confirmar que no hay recursión**

No hace falta un probe aparte. Los probes 2, 3, 4 y 5 hacen cuatro `UPDATE` sobre `costo_final` o `descuento_cobro` con el trigger activo; si hubiera recursión, PostgreSQL habría abortado cualquiera de ellos con `stack depth limit exceeded` en vez de devolver `OK`.

Criterio: si el Step 5 devolvió los cinco `OK`, no hay recursión. Si en cambio apareció `stack depth limit exceeded`, revisar que la lista de `AFTER UPDATE OF` sea exactamente `costo_final, descuento_cobro` y que la cláusula `WHEN` esté presente.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/277_trigger_recalcular_estado_cobro.sql \
        supabase/migrations/verify/277_probes.sql \
        supabase/migrations/rollback/277_rollback.sql
git commit -m "fix(ordenes): recalcular estado_cobro ante cambios de costo_final"
```

---

### Task 2: Dry-run del backfill histórico

Esta task **no corrige datos**. Produce el número que hace falta para decidir el alcance del PR 2. El spec (sección 4.3) identifica dos riesgos que solo se pueden dimensionar con datos reales, y el segundo —órdenes con comisión ya pagada que van a desaparecer de `/comisiones`— es el que puede costar confianza.

**Files:**
- Create: `docs/dry-run-backfill-estado-cobro.sql`

**Interfaces:**
- Consumes: el trigger de la Task 1 no es necesario para esta query, pero el orden importa: primero se frena el sangrado (Task 1), después se dimensiona el daño acumulado.
- Produces: los conteos que definen el alcance de la migración 278 (PR 2). Sin este output, el PR 2 no se puede escribir.

- [ ] **Step 1: Escribir la query de dry-run**

Crear `docs/dry-run-backfill-estado-cobro.sql`:

```sql
-- =============================================================================
-- DRY-RUN: dimensionar el backfill de estado_cobro (migración 278 / PR 2)
--
-- SOLO LECTURA. No modifica ninguna fila.
-- Correr en el SQL editor de Supabase Studio y revisar los cuatro reportes
-- ANTES de escribir la migración 278.
--
-- Espeja el patrón de docs/cc-backfill-fase3-dryrun.sql.
-- =============================================================================

-- Estado que tendría cada orden si se recalculara ahora mismo, comparado
-- con el que tiene guardado.
WITH calculado AS (
  SELECT
    o.id,
    o.organization_id,
    o.numero_orden,
    o.codigo_orden,
    o.estado,
    o.estado_cobro                         AS estado_actual,
    o.comision_pagada,
    COALESCE(o.costo_final, 0)             AS costo_final,
    COALESCE(o.descuento_cobro, 0)         AS descuento,
    COALESCE(c.cobrado, 0)                 AS cobrado_real,
    CASE
      WHEN COALESCE(o.costo_final,0) - COALESCE(o.descuento_cobro,0) <= 0 THEN 'PENDIENTE'
      WHEN COALESCE(c.cobrado,0) >= COALESCE(o.costo_final,0) - COALESCE(o.descuento_cobro,0) THEN 'COBRADO'
      WHEN COALESCE(c.cobrado,0) > 0 THEN 'PARCIAL'
      ELSE 'PENDIENTE'
    END                                    AS estado_correcto
  FROM ordenes_servicio o
  LEFT JOIN (
    SELECT orden_id, SUM(monto) AS cobrado
    FROM cobros_orden
    WHERE anulado = FALSE
    GROUP BY orden_id
  ) c ON c.orden_id = o.id
),
divergentes AS (
  SELECT * FROM calculado WHERE estado_actual IS DISTINCT FROM estado_correcto
)

-- ---------------------------------------------------------------------------
-- REPORTE 1 — Cuántas órdenes cambian, y de qué estado a cuál
-- ---------------------------------------------------------------------------
SELECT
  estado_actual,
  estado_correcto,
  COUNT(*)                                                    AS ordenes,
  COUNT(DISTINCT organization_id)                             AS organizaciones,
  ROUND(SUM(GREATEST(costo_final - descuento - cobrado_real, 0)), 2) AS saldo_que_aparece
FROM divergentes
GROUP BY estado_actual, estado_correcto
ORDER BY ordenes DESC;

-- ---------------------------------------------------------------------------
-- REPORTE 2 — RIESGO CRÍTICO: órdenes que salen de COBRADO
--             con la comisión del técnico YA PAGADA.
--
-- Estas desaparecen de /comisiones (app/api/comisiones/route.ts:57 filtra
-- estado_cobro = 'COBRADO'). El técnico ya cobró una comisión calculada sobre
-- un ingreso que nunca entró, y además pierde la orden de su historial visible.
--
-- Si este número es alto, NO aplicar el backfill completo de una: evaluar
-- excluir estas órdenes o avisar organización por organización.
-- ---------------------------------------------------------------------------
SELECT
  COUNT(*)                        AS ordenes_con_comision_pagada,
  COUNT(DISTINCT organization_id) AS organizaciones_afectadas
FROM divergentes
WHERE estado_actual = 'COBRADO'
  AND comision_pagada = TRUE;

-- ---------------------------------------------------------------------------
-- REPORTE 3 — Desglose por organización, para decidir a quién avisar
-- ---------------------------------------------------------------------------
SELECT
  d.organization_id,
  org.nombre                                                        AS organizacion,
  COUNT(*)                                                          AS ordenes,
  COUNT(*) FILTER (WHERE d.comision_pagada)                         AS con_comision_pagada,
  ROUND(SUM(GREATEST(d.costo_final - d.descuento - d.cobrado_real, 0)), 2) AS saldo_que_aparece
FROM divergentes d
JOIN organizations org ON org.id = d.organization_id
GROUP BY d.organization_id, org.nombre
ORDER BY saldo_que_aparece DESC NULLS LAST;

-- ---------------------------------------------------------------------------
-- REPORTE 4 — Las 50 órdenes de mayor impacto, para inspección manual
-- ---------------------------------------------------------------------------
SELECT
  organization_id,
  codigo_orden,
  numero_orden,
  estado,
  estado_actual,
  estado_correcto,
  costo_final,
  descuento,
  cobrado_real,
  GREATEST(costo_final - descuento - cobrado_real, 0) AS saldo_que_aparece,
  comision_pagada
FROM divergentes
ORDER BY GREATEST(costo_final - descuento - cobrado_real, 0) DESC
LIMIT 50;
```

- [ ] **Step 2: Correr la query y guardar el resultado**

Correr el archivo completo en Supabase Studio. Copiar los cuatro reportes a un comentario en el PR.

Verificación de que la query es correcta: la lógica de `estado_correcto` debe replicar exactamente `recalcular_estado_cobro` (`068_mejoras_ordenes.sql:117-125`). Comparar las dos cascadas de `CASE` línea por línea antes de confiar en los números.

- [ ] **Step 3: Commit**

```bash
git add docs/dry-run-backfill-estado-cobro.sql
git commit -m "docs(ordenes): dry-run para dimensionar el backfill de estado_cobro"
```

- [ ] **Step 4: Detener acá y reportar**

**No escribir la migración 278 en esta entrega.** El alcance del backfill se decide con los números del Reporte 2 a la vista:

- Pocas órdenes con `comision_pagada = true` → backfill completo, con aviso previo.
- Muchas → evaluar excluirlas, o aplicar el backfill por organización.

Reportar al usuario los cuatro reportes y esperar su decisión.

---

## Definition of Done

- [ ] Los cinco probes de `verify/277_probes.sql` devuelven `OK` con la migración aplicada.
- [ ] El probe de recursión (Step 6 de la Task 1) devuelve `OK: sin recursion`.
- [ ] `npm run test:run` sigue en verde (no debería cambiar nada: esta entrega no toca TypeScript).
- [ ] El rollback está escrito y revisado.
- [ ] Los cuatro reportes del dry-run están corridos y pegados en el PR.
- [ ] La migración 278 **no** está escrita.
