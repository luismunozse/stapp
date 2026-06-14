-- ============================================================
-- 212: Add p_sucursal_id parameter to get_vendedores_stats
-- ============================================================
-- Adding a 4th defaulted param creates a new overload. Postgres/PostgREST
-- would see two functions with the same name and different arity, causing
-- "could not choose a best candidate function" ambiguity errors.
-- DROP the existing 3-arg signature first, then CREATE the 4-arg version.
-- The new param defaults to NULL → callers passing 3 args still work during
-- the deployment window (pg matches by positional args before defaults).
-- ============================================================

DROP FUNCTION IF EXISTS get_vendedores_stats(TEXT, TIMESTAMPTZ, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION get_vendedores_stats(
  p_org_id       TEXT,
  p_desde        TIMESTAMPTZ DEFAULT NULL,
  p_hasta        TIMESTAMPTZ DEFAULT NULL,
  p_sucursal_id  TEXT        DEFAULT NULL
)
RETURNS TABLE (
  vendedor_id        TEXT,
  ventas_total       BIGINT,
  ventas_completadas BIGINT,
  ventas_anuladas    BIGINT,
  monto_total        DECIMAL(10,2),
  ticket_promedio    DECIMAL(10,2)
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    v.vendedor_id,
    COUNT(*) AS ventas_total,
    COUNT(*) FILTER (WHERE v.estado = 'COMPLETADA') AS ventas_completadas,
    COUNT(*) FILTER (WHERE v.estado = 'ANULADA')    AS ventas_anuladas,
    COALESCE(SUM(v.total) FILTER (WHERE v.estado = 'COMPLETADA'), 0)::DECIMAL(10,2) AS monto_total,
    CASE
      WHEN COUNT(*) FILTER (WHERE v.estado = 'COMPLETADA') > 0
        THEN (
          SUM(v.total) FILTER (WHERE v.estado = 'COMPLETADA')
          / COUNT(*) FILTER (WHERE v.estado = 'COMPLETADA')
        )::DECIMAL(10,2)
      ELSE NULL
    END AS ticket_promedio
  FROM ventas v
  WHERE v.organization_id = p_org_id
    AND (p_desde        IS NULL OR v.created_at  >= p_desde)
    AND (p_hasta        IS NULL OR v.created_at  <= p_hasta)
    AND (p_sucursal_id  IS NULL OR v.sucursal_id  = p_sucursal_id)
  GROUP BY v.vendedor_id;
$$;

COMMENT ON FUNCTION get_vendedores_stats(TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) IS
  'Stats agregadas por vendedor (count/sum/avg). Rango de fechas y sucursal opcionales (NULL = sin filtro). Vendedores sin ventas en el rango no aparecen — el caller debe hacer LEFT JOIN con users si los necesita con ceros.';
