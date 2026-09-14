-- ============================================================================
-- 327 — AUDITORIA (solo lectura): ordenes entregadas con fecha_completado NULL
-- ============================================================================
-- Correr ESTO antes que 327_backfill_fecha_completado.sql. No escribe nada.
--
-- CONTEXTO
--
-- fecha_completado es la fecha de devengo contable UNICA para toda la
-- contabilidad por orden: estado-resultados/route.ts la exige con
-- `.not("fecha_completado", "is", null)` y comisiones/route.ts filtra por
-- ella con `.gte`/`.lte` cuando el usuario elige un rango de fechas (NULL
-- nunca matchea un rango, asi que esa orden no aparece en NINGUN mes).
--
-- Hasta el fix de codigo que acompaña esta migracion, la UNICA escritura de
-- esta columna vivia en el PUT generico (app/api/ordenes/[id]/route.ts:384-387),
-- condicionada a que el nuevo estado fuera REPARADO o alguno de los tres
-- ENTREGADO*. El endpoint dedicado de entrega (POST /api/ordenes/[id]/entregar,
-- el UNICO camino real hacia esos tres estados — el PUT los bloquea con el
-- guard ESTADOS_SOLO_VIA_ENTREGA) nunca la escribia. Y la maquina de estados
-- (lib/orden-state-machine.ts) permite SIN_FALLA_DETECTADA -> ENTREGADO*
-- saltando REPARADO por completo. Toda orden que entrego por ese camino quedo
-- con fecha_completado = NULL para siempre.
--
-- Esto ya paso una vez (ver migracion 179, mismo sintoma en ordenes viejas
-- pre-trigger) y volvio a pasar porque en ese momento se arreglo el dato,
-- nunca el camino de escritura. Este backfill (327) tapa el agujero de datos
-- otra vez; el fix de codigo que cierra el camino de escritura va en el mismo
-- PR, así que no debería volver a hacer falta un 3er backfill por esto.
--
-- COMO LEER EL RESULTADO
--
--   [1] Listado detallado de cada orden afectada (para revisar caso por caso
--       antes de correr el backfill).
--
--   [2] Resumen por organizacion:
--         ordenes_afectadas         total en los tres estados ENTREGADO*.
--         entregado / entregado_sin_reparacion / entregado_sin_cobro
--                                    el desglose por estado — importa porque
--                                    ENTREGADO_SIN_COBRO nunca genera ingreso
--                                    ni comision (estado-resultados/route.ts:155
--                                    y :178), asi que se excluye de las dos
--                                    columnas de plata.
--         dinero_no_reconocido      COTA SUPERIOR de costo_final no devengado
--                                    (excluye ENTREGADO_SIN_COBRO). Es una cota
--                                    superior y no el numero exacto que hubiera
--                                    mostrado el reporte: estado-resultados
--                                    ademas resta cobros parciales de periodos
--                                    anteriores, algo que esta auditoria no
--                                    puede fechar porque el ancla temporal
--                                    (fecha_completado) es justo la que falta.
--         filas_comision_afectadas  ordenes que generarian comision > 0 en
--                                    v_comisiones_ordenes (migracion 119) una
--                                    vez backfilleada la fecha: tecnico
--                                    asignado, costo_final > 0, porcentaje > 0,
--                                    fuera de ENTREGADO_SIN_COBRO, y respetando
--                                    el flag comision_aplica_sin_reparacion
--                                    para ENTREGADO_SIN_REPARACION (mismo gate
--                                    que estado-resultados/route.ts:178).
--         comision_no_reconocida    suma de esas comisiones (ganancia * pct/100,
--                                    mismo calculo que v_comisiones_ordenes).
--
--   [3] Total general (todas las organizaciones), para el titular del reporte.
-- ============================================================================

-- [1] Listado detallado.
SELECT
  o.id,
  o.organization_id,
  org.nombre_mostrar                             AS taller,
  o.numero_orden,
  o.codigo_orden,
  o.estado,
  o.tecnico_id,
  o.costo_final,
  o.fecha_ingreso,
  o.fecha_entrega
FROM ordenes_servicio o
JOIN organizations org ON org.id = o.organization_id
WHERE o.fecha_completado IS NULL
  AND o.estado IN ('ENTREGADO', 'ENTREGADO_SIN_REPARACION', 'ENTREGADO_SIN_COBRO')
ORDER BY o.organization_id, o.fecha_entrega NULLS FIRST;

-- [2] Resumen por organizacion.
WITH afectadas AS (
  SELECT
    o.id,
    o.organization_id,
    o.estado,
    o.tecnico_id,
    o.costo_final,
    o.porcentaje_comision,
    COALESCE((
      SELECT SUM(r.cantidad * r.precio_unitario)
      FROM repuestos_orden r
      WHERE r.orden_id = o.id
    ), 0) AS costo_repuestos
  FROM ordenes_servicio o
  WHERE o.fecha_completado IS NULL
    AND o.estado IN ('ENTREGADO', 'ENTREGADO_SIN_REPARACION', 'ENTREGADO_SIN_COBRO')
)
SELECT
  a.organization_id,
  org.nombre_mostrar                                                    AS taller,
  COUNT(*)                                                              AS ordenes_afectadas,
  COUNT(*) FILTER (WHERE a.estado = 'ENTREGADO')                        AS entregado,
  COUNT(*) FILTER (WHERE a.estado = 'ENTREGADO_SIN_REPARACION')         AS entregado_sin_reparacion,
  COUNT(*) FILTER (WHERE a.estado = 'ENTREGADO_SIN_COBRO')              AS entregado_sin_cobro,
  ROUND(SUM(COALESCE(a.costo_final, 0)) FILTER (
    WHERE a.estado <> 'ENTREGADO_SIN_COBRO'
  ), 2)                                                                 AS dinero_no_reconocido,
  COUNT(*) FILTER (
    WHERE a.tecnico_id IS NOT NULL
      AND COALESCE(a.costo_final, 0) > 0
      AND COALESCE(a.porcentaje_comision, 0) > 0
      AND a.estado <> 'ENTREGADO_SIN_COBRO'
      AND (a.estado <> 'ENTREGADO_SIN_REPARACION' OR COALESCE(org.comision_aplica_sin_reparacion, false))
  )                                                                     AS filas_comision_afectadas,
  ROUND(SUM(
    GREATEST(COALESCE(a.costo_final, 0) - a.costo_repuestos, 0) * COALESCE(a.porcentaje_comision, 0) / 100
  ) FILTER (
    WHERE a.tecnico_id IS NOT NULL
      AND COALESCE(a.costo_final, 0) > 0
      AND COALESCE(a.porcentaje_comision, 0) > 0
      AND a.estado <> 'ENTREGADO_SIN_COBRO'
      AND (a.estado <> 'ENTREGADO_SIN_REPARACION' OR COALESCE(org.comision_aplica_sin_reparacion, false))
  ), 2)                                                                 AS comision_no_reconocida
FROM afectadas a
JOIN organizations org ON org.id = a.organization_id
GROUP BY a.organization_id, org.nombre_mostrar
ORDER BY ordenes_afectadas DESC;

-- [3] Total general.
WITH afectadas AS (
  SELECT o.id, o.estado, o.costo_final
  FROM ordenes_servicio o
  WHERE o.fecha_completado IS NULL
    AND o.estado IN ('ENTREGADO', 'ENTREGADO_SIN_REPARACION', 'ENTREGADO_SIN_COBRO')
)
SELECT
  COUNT(*)                                                                               AS total_ordenes_afectadas,
  ROUND(SUM(COALESCE(costo_final, 0)) FILTER (WHERE estado <> 'ENTREGADO_SIN_COBRO'), 2) AS total_dinero_no_reconocido
FROM afectadas;
