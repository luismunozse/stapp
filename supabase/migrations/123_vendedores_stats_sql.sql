-- ========================================
-- Stats agregadas de vendedores en SQL
-- ========================================
-- Reemplaza el cálculo en JS que traía TODAS las ventas del vendedor para
-- contar/sumar en Node. Agrega:
--   1. Índice compuesto cubriente para las queries de stats
--   2. RPC get_vendedores_stats(org_id, desde?, hasta?) que devuelve
--      por vendedor: totales, completadas, anuladas, monto, ticket promedio.
--      Parámetros de fecha opcionales (NULL = desde siempre / hasta ahora).
-- ========================================

-- Índice cubriente: usado por aggregate queries y por filtros de reportes.
-- Orden de columnas: más selectiva primero (organization_id), luego vendedor_id,
-- luego estado (para COUNT FILTER), created_at al final para rangos.
CREATE INDEX IF NOT EXISTS ventas_org_vendedor_estado_fecha_idx
  ON ventas(organization_id, vendedor_id, estado, created_at);

CREATE OR REPLACE FUNCTION get_vendedores_stats(
  p_org_id TEXT,
  p_desde TIMESTAMPTZ DEFAULT NULL,
  p_hasta TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  vendedor_id TEXT,
  ventas_total BIGINT,
  ventas_completadas BIGINT,
  ventas_anuladas BIGINT,
  monto_total DECIMAL(10,2),
  ticket_promedio DECIMAL(10,2)
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    v.vendedor_id,
    COUNT(*) AS ventas_total,
    COUNT(*) FILTER (WHERE v.estado = 'COMPLETADA') AS ventas_completadas,
    COUNT(*) FILTER (WHERE v.estado = 'ANULADA') AS ventas_anuladas,
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
    AND (p_desde IS NULL OR v.created_at >= p_desde)
    AND (p_hasta IS NULL OR v.created_at <= p_hasta)
  GROUP BY v.vendedor_id;
$$;

COMMENT ON FUNCTION get_vendedores_stats(TEXT, TIMESTAMPTZ, TIMESTAMPTZ) IS
  'Stats agregadas por vendedor (count/sum/avg). Rango de fechas opcional. Vendedores sin ventas en el rango no aparecen — el caller debe hacer LEFT JOIN con users si los necesita con ceros.';
