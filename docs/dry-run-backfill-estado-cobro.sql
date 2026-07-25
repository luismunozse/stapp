-- =============================================================================
-- DRY-RUN: dimensionar el backfill de estado_cobro (migración 278 / PR 2)
--
-- SOLO LECTURA. No modifica ninguna fila.
-- Correr en el SQL editor de Supabase Studio y revisar los cuatro reportes
-- ANTES de escribir la migración 278.
--
-- Espeja el patrón de docs/cc-backfill-fase3-dryrun.sql.
--
-- NOTA SOBRE LA REPETICIÓN DEL WITH: cada uno de los cuatro reportes de abajo
-- es una sentencia independiente, separada por ";". El alcance de un CTE
-- termina con la sentencia a la que pertenece: un "WITH calculado AS (...),
-- divergentes AS (...)" seguido de un SELECT solo es visible dentro de ESE
-- SELECT. Por eso el bloque WITH se repite completo antes de cada reporte en
-- vez de escribirse una sola vez arriba — no es una duplicación accidental,
-- es lo que hace que los reportes 2, 3 y 4 puedan resolver "divergentes". La
-- alternativa (CREATE TEMP TABLE) queda descartada a propósito: introduciría
-- DDL en un script cuya premisa entera es ser de solo lectura sobre producción.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- REPORTE 1 — Cuántas órdenes cambian, y de qué estado a cuál
-- ---------------------------------------------------------------------------
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
-- Modela las DOS mitades del filtro real de /comisiones
-- (app/api/comisiones/route.ts:32-34,56-57): ".in('estado', estadosComision)"
-- MÁS ".eq('estado_cobro','COBRADO')". estadosComision depende del flag por
-- organización organizations.comision_aplica_sin_reparacion: si es TRUE la
-- lista es ['REPARADO','ENTREGADO','ENTREGADO_SIN_REPARACION'], si es FALSE
-- (default) es ['REPARADO','ENTREGADO']. Sin la mitad de estado, una orden
-- que ya salió de esos estados (ej. volvió de REPARADO a EN_REPARACION,
-- transición válida según lib/orden-state-machine.ts:18) ya está ausente de
-- /comisiones hoy, y contarla infla el número de riesgo crítico.
--
-- Las órdenes que sí cumplen ambas condiciones desaparecen de /comisiones.
-- El técnico ya cobró una comisión calculada sobre un ingreso que nunca
-- entró, y además pierde la orden de su historial visible.
--
-- Si este número es alto, NO aplicar el backfill completo de una: evaluar
-- excluir estas órdenes o avisar organización por organización.
-- ---------------------------------------------------------------------------
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
SELECT
  COUNT(*)                          AS ordenes_con_comision_pagada,
  COUNT(DISTINCT d.organization_id) AS organizaciones_afectadas
FROM divergentes d
JOIN organizations org ON org.id = d.organization_id
WHERE d.estado_actual = 'COBRADO'
  AND d.comision_pagada = TRUE
  AND d.estado = ANY(
        CASE WHEN org.comision_aplica_sin_reparacion
             THEN ARRAY['REPARADO','ENTREGADO','ENTREGADO_SIN_REPARACION']
             ELSE ARRAY['REPARADO','ENTREGADO']
        END);

-- ---------------------------------------------------------------------------
-- REPORTE 3 — Desglose por organización, para decidir a quién avisar
-- ---------------------------------------------------------------------------
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
SELECT
  d.organization_id,
  org.nombre                                                        AS organizacion,
  COUNT(*)                                                          AS ordenes,
  -- Misma lógica de estadosComision que el Reporte 2 (app/api/comisiones/route.ts:32-34):
  -- sin el filtro de estado, esta columna también sobrecuenta.
  COUNT(*) FILTER (
    WHERE d.comision_pagada
      AND d.estado = ANY(
            CASE WHEN org.comision_aplica_sin_reparacion
                 THEN ARRAY['REPARADO','ENTREGADO','ENTREGADO_SIN_REPARACION']
                 ELSE ARRAY['REPARADO','ENTREGADO']
            END)
  )                                                                  AS con_comision_pagada,
  ROUND(SUM(GREATEST(d.costo_final - d.descuento - d.cobrado_real, 0)), 2) AS saldo_que_aparece
FROM divergentes d
JOIN organizations org ON org.id = d.organization_id
GROUP BY d.organization_id, org.nombre
ORDER BY saldo_que_aparece DESC NULLS LAST;

-- ---------------------------------------------------------------------------
-- REPORTE 4 — Las 50 órdenes de mayor impacto, para inspección manual
-- ---------------------------------------------------------------------------
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
