-- Agregaciones del panel superadmin en SQL (auditoría superadmin §4.7).
--
-- PostgREST corta cada respuesta en 1000 filas (max_rows) sin avisar. Las
-- rutas del panel traían filas para contarlas o sumarlas en JS, así que pasado
-- ese tamaño los números quedaban cortos sin ningún error:
--   * pagos: MRR, total histórico y total filtrado se sumaban en JS y además
--     mezclaban ARS con USD en un solo número;
--   * dashboard: ingresos del mes y de los últimos 6 meses (mismo problema);
--   * campañas: el segmento "inactivos" filtraba ordenes_servicio por
--     created_at, que no existe (la fecha de alta es fecha_ingreso): la
--     consulta fallaba en silencio y TODAS las orgs activas salían inactivas;
--   * engagement: mismo created_at/updated_at inexistente en órdenes, más
--     lecturas de ventas, clientes, emails y engagement truncadas;
--   * feature usage: el último registro por org salía de una lectura truncada.
--
-- Cada función devuelve pocas filas (una por moneda / por mes y moneda) o un
-- solo jsonb, así que el tope de max_rows no las alcanza. Son SECURITY INVOKER
-- y solo las ejecuta service_role (supabaseAdmin); anon y authenticated no.

SET LOCAL lock_timeout = '3s';

-- --------------------------------------------------------------------------
-- 1. Pagos sumados por moneda (nunca se suman ARS y USD).
--    Mismos filtros que la lista de /api/superadmin/payments.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.superadmin_pagos_por_moneda(
  p_status   TEXT,
  p_provider TEXT        DEFAULT NULL,
  p_desde    TIMESTAMPTZ DEFAULT NULL,
  p_hasta    TIMESTAMPTZ DEFAULT NULL,
  p_org_ids  TEXT[]      DEFAULT NULL
)
RETURNS TABLE (moneda TEXT, total NUMERIC, cantidad BIGINT)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(upper(sp.currency), 'SIN_MONEDA'),
         SUM(sp.amount),
         COUNT(*)
    FROM subscription_payments sp
   WHERE sp.status::text = p_status
     AND (p_provider IS NULL OR sp.payment_provider::text = p_provider)
     AND (p_desde IS NULL OR sp.paid_at >= p_desde)
     AND (p_hasta IS NULL OR sp.paid_at <= p_hasta)
     AND (p_org_ids IS NULL OR sp.organization_id = ANY (p_org_ids))
   GROUP BY 1
   ORDER BY 1;
$$;

-- --------------------------------------------------------------------------
-- 2. Ingresos cobrados por mes (UTC, 'YYYY-MM') y moneda, desde p_desde.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.superadmin_ingresos_por_mes(p_desde TIMESTAMPTZ)
RETURNS TABLE (mes TEXT, moneda TEXT, total NUMERIC)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT to_char(sp.paid_at AT TIME ZONE 'UTC', 'YYYY-MM'),
         COALESCE(upper(sp.currency), 'SIN_MONEDA'),
         SUM(sp.amount)
    FROM subscription_payments sp
   WHERE sp.status = 'SUCCEEDED'
     AND sp.paid_at >= p_desde
   GROUP BY 1, 2
   ORDER BY 1, 2;
$$;

-- --------------------------------------------------------------------------
-- 3. Segmentos de campañas: orgs activas (no archivadas, sin la org del panel)
--    en trial, canceladas, y sin órdenes reales en los últimos 7 / 30 días.
--    La actividad se mide por fecha_ingreso (ordenes_servicio no tiene
--    created_at) y deja afuera la orden de práctica del onboarding.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.superadmin_campania_segmentos()
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH orgs AS (
    SELECT o.id, o.nombre, o.slug
      FROM organizations o
     WHERE o.activo = TRUE
       AND o.deleted_at IS NULL
       AND o.slug IS DISTINCT FROM 'superadmin'
  ),
  inactivas AS (
    SELECT d.dias, o.id, o.nombre, o.slug
      FROM (VALUES (7), (30)) AS d(dias)
      CROSS JOIN orgs o
     WHERE NOT EXISTS (
       SELECT 1
         FROM ordenes_servicio os
        WHERE os.organization_id = o.id
          AND os.es_practica = FALSE
          AND os.fecha_ingreso >= now() - make_interval(days => d.dias)
     )
  )
  SELECT jsonb_build_object(
    'trials', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', o.id, 'nombre', o.nombre, 'slug', o.slug, 'trial_end', s.trial_end)
                       ORDER BY s.trial_end, o.id)
        FROM subscriptions s
        JOIN orgs o ON o.id = s.organization_id
       WHERE s.status = 'TRIALING'
         AND s.trial_end IS NOT NULL
    ), '[]'::jsonb),
    'cancelados', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', o.id, 'nombre', o.nombre, 'slug', o.slug) ORDER BY o.nombre, o.id)
        FROM subscriptions s
        JOIN orgs o ON o.id = s.organization_id
       WHERE s.status = 'CANCELED'
    ), '[]'::jsonb),
    'inactivas_7', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', i.id, 'nombre', i.nombre, 'slug', i.slug) ORDER BY i.nombre, i.id)
        FROM inactivas i WHERE i.dias = 7
    ), '[]'::jsonb),
    'inactivas_30', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', i.id, 'nombre', i.nombre, 'slug', i.slug) ORDER BY i.nombre, i.id)
        FROM inactivas i WHERE i.dias = 30
    ), '[]'::jsonb)
  );
$$;

-- --------------------------------------------------------------------------
-- 4. Engagement: métricas por org activa, tendencia diaria y emails.
--    El score y el riesgo se siguen calculando en la ruta con estos conteos.
--    Órdenes por fecha_ingreso; la última actividad de una orden es la mayor
--    de fecha_ingreso / fecha_completado / fecha_entrega (no hay updated_at).
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.superadmin_engagement_metricas(
  p_desde_30d TIMESTAMPTZ,
  p_desde_7d  TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH orgs AS (
    SELECT o.id, o.nombre, o.slug, o.created_at
      FROM organizations o
     WHERE o.activo = TRUE
       AND o.deleted_at IS NULL
       AND o.slug IS DISTINCT FROM 'superadmin'
  ),
  subs AS (
    SELECT DISTINCT ON (s.organization_id)
           s.organization_id, s.status::text AS status, s.trial_end, p.tipo::text AS plan_tipo
      FROM subscriptions s
      LEFT JOIN plans p ON p.id = s.plan_id
     WHERE s.status IN ('ACTIVE', 'TRIALING')
     ORDER BY s.organization_id, (s.status = 'ACTIVE') DESC, s.created_at DESC
  ),
  m_ordenes AS (
    SELECT os.organization_id,
           COUNT(*) AS ordenes30d,
           COUNT(*) FILTER (WHERE os.fecha_ingreso >= p_desde_7d) AS ordenes7d,
           COUNT(*) FILTER (WHERE os.fecha_ingreso >= p_desde_7d AND os.estado = 'ENTREGADO') AS completadas7d,
           MAX(GREATEST(os.fecha_ingreso, os.fecha_completado, os.fecha_entrega)) AS ultima
      FROM ordenes_servicio os
     WHERE os.es_practica = FALSE
       AND os.fecha_ingreso >= p_desde_30d
     GROUP BY os.organization_id
  ),
  m_ventas AS (
    SELECT v.organization_id,
           COUNT(*) AS ventas30d,
           COUNT(*) FILTER (WHERE v.created_at >= p_desde_7d) AS ventas7d,
           MAX(v.created_at) AS ultima
      FROM ventas v
     WHERE v.created_at >= p_desde_30d
     GROUP BY v.organization_id
  ),
  m_clientes AS (
    SELECT c.organization_id, COUNT(*) AS nuevos7d
      FROM clientes c
     WHERE c.es_practica = FALSE
       AND c.created_at >= p_desde_7d
     GROUP BY c.organization_id
  ),
  t_engagement AS (
    SELECT oe.fecha, SUM(oe.engagement_score) AS suma_score, COUNT(*) AS cantidad, SUM(oe.ordenes_creadas) AS ordenes
      FROM organization_engagement oe
     WHERE oe.fecha >= (p_desde_30d AT TIME ZONE 'UTC')::date
     GROUP BY oe.fecha
  ),
  actividad AS (
    SELECT (os.fecha_ingreso AT TIME ZONE 'UTC')::date AS fecha, os.organization_id
      FROM ordenes_servicio os
     WHERE os.es_practica = FALSE
       AND os.fecha_ingreso >= p_desde_30d
    UNION ALL
    SELECT (v.created_at AT TIME ZONE 'UTC')::date, v.organization_id
      FROM ventas v
     WHERE v.created_at >= p_desde_30d
  ),
  t_actividad AS (
    SELECT a.fecha, COUNT(*) AS total, COUNT(DISTINCT a.organization_id) AS orgs
      FROM actividad a
     GROUP BY a.fecha
  ),
  emails AS (
    SELECT le.email_type,
           COUNT(*) FILTER (WHERE le.status = 'SENT') AS sent,
           COUNT(*) FILTER (WHERE le.status IS DISTINCT FROM 'SENT') AS failed
      FROM lifecycle_emails le
     WHERE le.sent_at >= p_desde_30d
     GROUP BY le.email_type
  )
  SELECT jsonb_build_object(
    'orgs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', o.id,
               'nombre', o.nombre,
               'slug', o.slug,
               'created_at', o.created_at,
               'sub_status', s.status,
               'trial_end', s.trial_end,
               'plan_tipo', s.plan_tipo,
               'ordenes7d', COALESCE(mo.ordenes7d, 0),
               'ordenes_completadas7d', COALESCE(mo.completadas7d, 0),
               'ordenes30d', COALESCE(mo.ordenes30d, 0),
               'ventas7d', COALESCE(mv.ventas7d, 0),
               'ventas30d', COALESCE(mv.ventas30d, 0),
               'clientes_nuevos7d', COALESCE(mc.nuevos7d, 0),
               'ultima_actividad', GREATEST(mo.ultima, mv.ultima)
             ) ORDER BY o.id)
        FROM orgs o
        LEFT JOIN subs s        ON s.organization_id = o.id
        LEFT JOIN m_ordenes mo  ON mo.organization_id = o.id
        LEFT JOIN m_ventas mv   ON mv.organization_id = o.id
        LEFT JOIN m_clientes mc ON mc.organization_id = o.id
    ), '[]'::jsonb),
    'tendencia_engagement', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('fecha', t.fecha, 'suma_score', t.suma_score, 'cantidad', t.cantidad, 'ordenes', t.ordenes)
                       ORDER BY t.fecha)
        FROM t_engagement t
    ), '[]'::jsonb),
    'ultimo_calculo', (SELECT MAX(t.fecha) FROM t_engagement t),
    'tendencia_actividad', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('fecha', t.fecha, 'total', t.total, 'orgs', t.orgs) ORDER BY t.fecha)
        FROM t_actividad t
    ), '[]'::jsonb),
    'emails', COALESCE((
      SELECT jsonb_object_agg(e.email_type, jsonb_build_object('sent', e.sent, 'failed', e.failed))
        FROM emails e
    ), '{}'::jsonb)
  );
$$;

-- --------------------------------------------------------------------------
-- 5. Feature usage: el último registro de cada org (lo escribe el cron diario).
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.superadmin_feature_usage_ultimo()
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
           jsonb_agg(
             to_jsonb(fu) || jsonb_build_object('organizations', jsonb_build_object('nombre', o.nombre, 'slug', o.slug))
             ORDER BY fu.organization_id
           ),
           '[]'::jsonb
         )
    FROM (
      SELECT DISTINCT ON (f.organization_id) f.*
        FROM feature_usage f
       ORDER BY f.organization_id, f.fecha DESC
    ) fu
    LEFT JOIN organizations o ON o.id = fu.organization_id;
$$;

-- --------------------------------------------------------------------------
-- Permisos: solo service_role. Supabase da EXECUTE a anon/authenticated por
-- defecto en las funciones nuevas de public, y la anon key viaja en el bundle.
-- --------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.superadmin_pagos_por_moneda(TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.superadmin_pagos_por_moneda(TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.superadmin_pagos_por_moneda(TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.superadmin_pagos_por_moneda(TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT[]) TO service_role;

REVOKE EXECUTE ON FUNCTION public.superadmin_ingresos_por_mes(TIMESTAMPTZ) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.superadmin_ingresos_por_mes(TIMESTAMPTZ) FROM anon;
REVOKE EXECUTE ON FUNCTION public.superadmin_ingresos_por_mes(TIMESTAMPTZ) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.superadmin_ingresos_por_mes(TIMESTAMPTZ) TO service_role;

REVOKE EXECUTE ON FUNCTION public.superadmin_campania_segmentos() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.superadmin_campania_segmentos() FROM anon;
REVOKE EXECUTE ON FUNCTION public.superadmin_campania_segmentos() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.superadmin_campania_segmentos() TO service_role;

REVOKE EXECUTE ON FUNCTION public.superadmin_engagement_metricas(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.superadmin_engagement_metricas(TIMESTAMPTZ, TIMESTAMPTZ) FROM anon;
REVOKE EXECUTE ON FUNCTION public.superadmin_engagement_metricas(TIMESTAMPTZ, TIMESTAMPTZ) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.superadmin_engagement_metricas(TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;

REVOKE EXECUTE ON FUNCTION public.superadmin_feature_usage_ultimo() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.superadmin_feature_usage_ultimo() FROM anon;
REVOKE EXECUTE ON FUNCTION public.superadmin_feature_usage_ultimo() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.superadmin_feature_usage_ultimo() TO service_role;
