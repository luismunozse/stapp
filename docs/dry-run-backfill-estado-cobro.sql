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
