-- ============================================================================
-- 323 — AUDITORIA (solo lectura): contadores de usuarios vs. la realidad
-- ============================================================================
-- Correr ESTO antes que el backfill. No escribe nada.
--
-- `organization_usage.tecnicos_count` y `vendedores_count` son contadores
-- cacheados que mantienen triggers sobre `users`. El de tecnicos estuvo ciego
-- a los UPDATE hasta la migracion 323, asi que cada cambio de rol lo dejo
-- corrido. Este script muestra, por organizacion, cuanto se corrio.
--
-- Como leer el resultado:
--
--   deriva_tecnicos > 0   el contador esta ALTO: hay tecnicos fantasma. El
--                         taller no puede dar de alta tecnicos que su plan si
--                         le permite. Resincronizar los DESBLOQUEA.
--
--   deriva_tecnicos < 0   el contador esta BAJO: hay mas tecnicos reales que
--                         los contados. Resincronizar puede dejar al taller
--                         POR ENCIMA del limite de su plan. No rompe nada de
--                         lo que ya existe —el enforcement solo corre al dar
--                         de alta—, pero el proximo alta le va a fallar, y
--                         eso es una conversacion comercial. Mirar la columna
--                         `sobre_limite_despues` antes de correr el backfill.
--
-- La columna `limite_tecnicos` sale de get_plan_limit(), la misma funcion que
-- usa el trigger. NULL = ilimitado.
-- ============================================================================

WITH real AS (
  SELECT
    o.id AS organization_id,
    COUNT(*) FILTER (WHERE u.rol = 'TECNICO')  AS tecnicos_reales,
    COUNT(*) FILTER (WHERE u.rol = 'VENDEDOR') AS vendedores_reales
  FROM organizations o
  LEFT JOIN users u ON u.organization_id = o.id
  GROUP BY o.id
)
SELECT
  o.id                                        AS organization_id,
  o.nombre_mostrar                            AS taller,
  -- Tecnicos: contador cacheado vs. filas reales.
  -- COALESCE porque una organizacion puede no tener fila en organization_usage
  -- todavia; para el limite eso vale cero.
  COALESCE(ou.tecnicos_count, 0)              AS tecnicos_contados,
  r.tecnicos_reales,
  COALESCE(ou.tecnicos_count, 0) - r.tecnicos_reales   AS deriva_tecnicos,
  get_plan_limit(o.id, 'tecnicos')            AS limite_tecnicos,
  -- Que pasa DESPUES de resincronizar: el numero real contra el limite real.
  CASE
    WHEN get_plan_limit(o.id, 'tecnicos') IS NULL THEN 'ilimitado'
    WHEN r.tecnicos_reales > get_plan_limit(o.id, 'tecnicos') THEN 'SI - avisar al taller'
    ELSE 'no'
  END                                         AS sobre_limite_despues,
  -- Vendedores: su trigger si mira los UPDATE desde la 015, asi que aca no
  -- deberia haber deriva. Se lista igual: si aparece, el problema es otro y
  -- conviene saberlo antes de tocar nada.
  COALESCE(ou.vendedores_count, 0)            AS vendedores_contados,
  r.vendedores_reales,
  COALESCE(ou.vendedores_count, 0) - r.vendedores_reales AS deriva_vendedores
FROM organizations o
JOIN real r ON r.organization_id = o.id
LEFT JOIN organization_usage ou ON ou.organization_id = o.id
WHERE COALESCE(ou.tecnicos_count, 0)  <> r.tecnicos_reales
   OR COALESCE(ou.vendedores_count, 0) <> r.vendedores_reales
ORDER BY ABS(COALESCE(ou.tecnicos_count, 0) - r.tecnicos_reales) DESC,
         o.nombre_mostrar;
