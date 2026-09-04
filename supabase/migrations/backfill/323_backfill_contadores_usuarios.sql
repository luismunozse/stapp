-- ============================================================================
-- 323 — BACKFILL: resincronizar los contadores de usuarios con la realidad
-- ============================================================================
-- Correr DESPUES de aplicar la migracion 323 y DESPUES de leer
-- 323_auditoria_contadores_usuarios.sql.
--
-- La 323 arregla el trigger hacia adelante. Lo que ya quedo corrido por
-- cambios de rol viejos lo corrige esto: recalcula tecnicos_count y
-- vendedores_count como el COUNT(*) real de `users`.
--
-- La definicion del contador es "cuantas filas de users tienen ese rol en
-- esta organizacion", sin filtrar por `activo`: es exactamente lo que suman y
-- restan las ramas INSERT y DELETE del trigger. Un tecnico desactivado sigue
-- ocupando cupo del plan, y asi funcionaba antes de esta correccion tambien.
-- Filtrar por activo aca introduciria una deriva NUEVA en sentido contrario.
--
-- Es idempotente: correrlo dos veces deja el mismo numero.
--
-- ANTES DE CORRERLO: si la auditoria marco algun taller con
-- `sobre_limite_despues = 'SI - avisar al taller'`, ese taller va a quedar por
-- encima del limite de su plan cuando esto termine. No se le rompe nada de lo
-- que ya tiene —el enforcement solo corre al dar de alta—, pero el proximo
-- alta de tecnico le va a fallar con PLAN_LIMIT_EXCEEDED. Decidir primero que
-- se hace con esos: subirles el plan, o avisarles.
--
-- Corre dentro de una transaccion. Revisar el resultado del SELECT final y
-- recien ahi cambiar el ROLLBACK por COMMIT.
-- ============================================================================

BEGIN;

-- 1. Toda organizacion tiene que tener su fila en organization_usage. Sin
--    ella el UPDATE de abajo no la alcanza, y el contador se queda en el
--    limbo: la rama DELETE del trigger tambien es un no-op silencioso cuando
--    la fila no existe.
INSERT INTO organization_usage (organization_id, tecnicos_count)
SELECT o.id, 0
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM organization_usage ou WHERE ou.organization_id = o.id
);

-- 2. Recalcular ambos contadores desde la fuente de verdad.
WITH real AS (
  SELECT
    o.id AS organization_id,
    COUNT(*) FILTER (WHERE u.rol = 'TECNICO')  AS tecnicos_reales,
    COUNT(*) FILTER (WHERE u.rol = 'VENDEDOR') AS vendedores_reales
  FROM organizations o
  LEFT JOIN users u ON u.organization_id = o.id
  GROUP BY o.id
)
UPDATE organization_usage ou
SET tecnicos_count   = r.tecnicos_reales,
    vendedores_count = r.vendedores_reales,
    updated_at       = NOW()
FROM real r
WHERE ou.organization_id = r.organization_id
  -- Solo las que estaban mal: no ensuciar `updated_at` de las sanas.
  AND (ou.tecnicos_count IS DISTINCT FROM r.tecnicos_reales
    OR ou.vendedores_count IS DISTINCT FROM r.vendedores_reales);

-- 3. Control: despues de esto no puede quedar ninguna fila con deriva.
--    Si devuelve algo, NO commitear.
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
  COUNT(*) FILTER (
    WHERE ou.tecnicos_count IS DISTINCT FROM r.tecnicos_reales
       OR ou.vendedores_count IS DISTINCT FROM r.vendedores_reales
  ) AS filas_con_deriva_restante,
  COUNT(*) AS organizaciones_revisadas
FROM organization_usage ou
JOIN real r ON r.organization_id = ou.organization_id;

-- Cambiar por COMMIT cuando filas_con_deriva_restante = 0.
ROLLBACK;
