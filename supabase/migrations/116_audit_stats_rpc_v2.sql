-- =============================================
-- 116: audit_log_stats v2
--
-- Agrega distribuciones temporales para el gráfico
-- de actividad y datos para alertas de actividad.
-- =============================================

CREATE OR REPLACE FUNCTION public.audit_log_stats(
  p_last_7_days timestamptz,
  p_last_30_days timestamptz,
  p_today timestamptz
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM audit_logs),
    'today', (SELECT count(*) FROM audit_logs WHERE created_at >= p_today),
    'last7Days', (SELECT count(*) FROM audit_logs WHERE created_at >= p_last_7_days),
    'last30Days', (SELECT count(*) FROM audit_logs WHERE created_at >= p_last_30_days),
    'loginsFailed7Days', (SELECT count(*) FROM audit_logs WHERE action = 'LOGIN_FAILED' AND created_at >= p_last_7_days),
    'loginsSuccess7Days', (SELECT count(*) FROM audit_logs WHERE action = 'LOGIN' AND created_at >= p_last_7_days),
    'actionDistribution', COALESCE((
      SELECT jsonb_object_agg(action, cnt)
      FROM (
        SELECT action, count(*) as cnt
        FROM audit_logs
        WHERE created_at >= p_last_30_days
        GROUP BY action
        ORDER BY cnt DESC
        LIMIT 15
      ) t
    ), '{}'::jsonb),
    'entityDistribution', COALESCE((
      SELECT jsonb_object_agg(entity, cnt)
      FROM (
        SELECT entity, count(*) as cnt
        FROM audit_logs
        WHERE created_at >= p_last_30_days
        GROUP BY entity
        ORDER BY cnt DESC
        LIMIT 15
      ) t
    ), '{}'::jsonb),
    'topUsers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('userId', user_id, 'actionCount', cnt))
      FROM (
        SELECT user_id, count(*) as cnt
        FROM audit_logs
        WHERE created_at >= p_last_30_days AND user_id IS NOT NULL
        GROUP BY user_id
        ORDER BY cnt DESC
        LIMIT 10
      ) t
    ), '[]'::jsonb),
    -- Distribución horaria (últimas 24h)
    'hourlyDistribution', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('hour', h, 'count', cnt) ORDER BY h)
      FROM (
        SELECT EXTRACT(HOUR FROM created_at)::int AS h, count(*) AS cnt
        FROM audit_logs
        WHERE created_at >= (now() - interval '24 hours')
        GROUP BY h
      ) t
    ), '[]'::jsonb),
    -- Distribución diaria (últimos 30d)
    'dailyDistribution', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('date', d, 'count', cnt) ORDER BY d)
      FROM (
        SELECT created_at::date AS d, count(*) AS cnt
        FROM audit_logs
        WHERE created_at >= p_last_30_days
        GROUP BY d
      ) t
    ), '[]'::jsonb),
    -- Usuarios con alta actividad (última hora)
    'highActivityUsers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('userId', user_id, 'count', cnt))
      FROM (
        SELECT user_id, count(*) AS cnt
        FROM audit_logs
        WHERE created_at >= (now() - interval '1 hour') AND user_id IS NOT NULL
        GROUP BY user_id
        HAVING count(*) > 50
        ORDER BY cnt DESC
        LIMIT 5
      ) t
    ), '[]'::jsonb),
    -- Total de registros y estimado de almacenamiento
    'storageEstimate', (
      SELECT jsonb_build_object(
        'totalRows', count(*),
        'oldestRecord', min(created_at),
        'newestRecord', max(created_at)
      )
      FROM audit_logs
    )
  );
$$;
