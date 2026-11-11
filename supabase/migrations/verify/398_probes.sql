-- Verificación de superadmin_agregaciones_sql (398).
--
-- Correr DESPUÉS de aplicar la 398. Solo lee: termina en ROLLBACK.
--
-- Cada probe compara lo que devuelve una función con la misma cuenta hecha
-- con una consulta directa sobre las tablas (sin pasar por PostgREST, así que
-- sin el tope de 1000 filas). Verde = esperado igual a obtenido.
--
-- Resultado: UN select.

BEGIN;

CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);

-- ---------------------------------------------------------------- permisos
INSERT INTO _r
SELECT 1, 'solo service_role ejecuta ' || f.firma, 'false / false / true',
       has_function_privilege('anon', f.firma, 'EXECUTE')::text || ' / ' ||
       has_function_privilege('authenticated', f.firma, 'EXECUTE')::text || ' / ' ||
       has_function_privilege('service_role', f.firma, 'EXECUTE')::text
  FROM (VALUES
    ('public.superadmin_pagos_por_moneda(text, text, timestamptz, timestamptz, text[])'),
    ('public.superadmin_ingresos_por_mes(timestamptz)'),
    ('public.superadmin_campania_segmentos()'),
    ('public.superadmin_engagement_metricas(timestamptz, timestamptz)'),
    ('public.superadmin_feature_usage_ultimo()')
  ) AS f(firma);

INSERT INTO _r
SELECT 2, 'ninguna es SECURITY DEFINER', '0',
       count(*)::text
  FROM pg_proc
 WHERE pronamespace = 'public'::regnamespace
   AND proname IN ('superadmin_pagos_por_moneda', 'superadmin_ingresos_por_mes', 'superadmin_campania_segmentos',
                   'superadmin_engagement_metricas', 'superadmin_feature_usage_ultimo')
   AND prosecdef;

-- ---------------------------------------------------------------- pagos
INSERT INTO _r SELECT 10, 'pagos SUCCEEDED por moneda = suma directa',
  (SELECT COALESCE(string_agg(m || '=' || t || '/' || n, ' ' ORDER BY m), '')
     FROM (SELECT COALESCE(upper(currency), 'SIN_MONEDA') AS m, SUM(amount)::text AS t, COUNT(*)::text AS n
             FROM subscription_payments WHERE status = 'SUCCEEDED' GROUP BY 1) d),
  (SELECT COALESCE(string_agg(moneda || '=' || total::text || '/' || cantidad::text, ' ' ORDER BY moneda), '')
     FROM superadmin_pagos_por_moneda('SUCCEEDED'));

INSERT INTO _r SELECT 11, 'pagos del mes (MRR) por moneda = suma directa',
  (SELECT COALESCE(string_agg(m || '=' || t, ' ' ORDER BY m), '')
     FROM (SELECT COALESCE(upper(currency), 'SIN_MONEDA') AS m, SUM(amount)::text AS t
             FROM subscription_payments
            WHERE status = 'SUCCEEDED' AND paid_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
            GROUP BY 1) d),
  (SELECT COALESCE(string_agg(moneda || '=' || total::text, ' ' ORDER BY moneda), '')
     FROM superadmin_pagos_por_moneda('SUCCEEDED', NULL, date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'));

INSERT INTO _r SELECT 12, 'pagos: el filtro por org y proveedor se respeta',
  (SELECT COUNT(*)::text FROM subscription_payments sp
    WHERE sp.status = 'SUCCEEDED'
      AND sp.payment_provider::text = 'MERCADOPAGO'
      AND sp.organization_id = (SELECT organization_id FROM subscription_payments ORDER BY paid_at DESC NULLS LAST LIMIT 1)),
  (SELECT COALESCE(SUM(cantidad), 0)::text
     FROM superadmin_pagos_por_moneda('SUCCEEDED', 'MERCADOPAGO', NULL, NULL,
          ARRAY(SELECT organization_id FROM subscription_payments ORDER BY paid_at DESC NULLS LAST LIMIT 1)));

INSERT INTO _r SELECT 13, 'una fila por moneda (nunca se mezclan)', 'true',
  (SELECT (COUNT(*) = COUNT(DISTINCT moneda))::text FROM superadmin_pagos_por_moneda('SUCCEEDED'));

-- ---------------------------------------------------------------- ingresos por mes
INSERT INTO _r SELECT 20, 'ingresos de 6 meses por mes y moneda = suma directa',
  (SELECT COALESCE(string_agg(k || '=' || t, ' ' ORDER BY k), '')
     FROM (SELECT to_char(paid_at AT TIME ZONE 'UTC', 'YYYY-MM') || ':' || COALESCE(upper(currency), 'SIN_MONEDA') AS k,
                  SUM(amount)::text AS t
             FROM subscription_payments
            WHERE status = 'SUCCEEDED' AND paid_at >= now() - interval '6 months'
            GROUP BY 1) d),
  (SELECT COALESCE(string_agg(mes || ':' || moneda || '=' || total::text, ' ' ORDER BY mes || ':' || moneda), '')
     FROM superadmin_ingresos_por_mes(now() - interval '6 months'));

-- ---------------------------------------------------------------- campañas
INSERT INTO _r SELECT 30, 'campañas: trials = suscripciones TRIALING de orgs activas',
  (SELECT COUNT(*)::text FROM subscriptions s JOIN organizations o ON o.id = s.organization_id
    WHERE s.status = 'TRIALING' AND s.trial_end IS NOT NULL
      AND o.activo AND o.deleted_at IS NULL AND o.slug IS DISTINCT FROM 'superadmin'),
  (SELECT jsonb_array_length(superadmin_campania_segmentos() -> 'trials')::text);

INSERT INTO _r SELECT 31, 'campañas: inactivas 30d no incluye orgs con órdenes en 30d', '0',
  (SELECT COUNT(*)::text
     FROM jsonb_array_elements(superadmin_campania_segmentos() -> 'inactivas_30') e
    WHERE EXISTS (SELECT 1 FROM ordenes_servicio os
                   WHERE os.organization_id = e ->> 'id' AND os.es_practica = FALSE
                     AND os.fecha_ingreso >= now() - interval '30 days'));

INSERT INTO _r SELECT 32, 'campañas: inactivas 7d no incluye orgs con órdenes en 7d', '0',
  (SELECT COUNT(*)::text
     FROM jsonb_array_elements(superadmin_campania_segmentos() -> 'inactivas_7') e
    WHERE EXISTS (SELECT 1 FROM ordenes_servicio os
                   WHERE os.organization_id = e ->> 'id' AND os.es_practica = FALSE
                     AND os.fecha_ingreso >= now() - interval '7 days'));

INSERT INTO _r SELECT 33, 'campañas: inactivas 30d = orgs activas sin órdenes reales en 30d',
  (SELECT COUNT(*)::text FROM organizations o
    WHERE o.activo AND o.deleted_at IS NULL AND o.slug IS DISTINCT FROM 'superadmin'
      AND NOT EXISTS (SELECT 1 FROM ordenes_servicio os
                       WHERE os.organization_id = o.id AND os.es_practica = FALSE
                         AND os.fecha_ingreso >= now() - interval '30 days')),
  (SELECT jsonb_array_length(superadmin_campania_segmentos() -> 'inactivas_30')::text);

-- ---------------------------------------------------------------- engagement
CREATE TEMP TABLE _eng AS
SELECT superadmin_engagement_metricas(now() - interval '30 days', now() - interval '7 days') AS j;

INSERT INTO _r SELECT 40, 'engagement: una entrada por org activa',
  (SELECT COUNT(*)::text FROM organizations o
    WHERE o.activo AND o.deleted_at IS NULL AND o.slug IS DISTINCT FROM 'superadmin'),
  (SELECT jsonb_array_length(j -> 'orgs')::text FROM _eng);

INSERT INTO _r SELECT 41, 'engagement: órdenes 30d de orgs activas = conteo directo',
  (SELECT COUNT(*)::text FROM ordenes_servicio os JOIN organizations o ON o.id = os.organization_id
    WHERE o.activo AND o.deleted_at IS NULL AND o.slug IS DISTINCT FROM 'superadmin'
      AND os.es_practica = FALSE AND os.fecha_ingreso >= now() - interval '30 days'),
  (SELECT COALESCE(SUM((e ->> 'ordenes30d')::bigint), 0)::text FROM _eng, jsonb_array_elements(j -> 'orgs') e);

INSERT INTO _r SELECT 42, 'engagement: ventas 30d de orgs activas = conteo directo',
  (SELECT COUNT(*)::text FROM ventas v JOIN organizations o ON o.id = v.organization_id
    WHERE o.activo AND o.deleted_at IS NULL AND o.slug IS DISTINCT FROM 'superadmin'
      AND v.created_at >= now() - interval '30 days'),
  (SELECT COALESCE(SUM((e ->> 'ventas30d')::bigint), 0)::text FROM _eng, jsonb_array_elements(j -> 'orgs') e);

INSERT INTO _r SELECT 43, 'engagement: lifecycle emails 30d = conteo directo',
  (SELECT COUNT(*)::text FROM lifecycle_emails WHERE sent_at >= now() - interval '30 days'),
  (SELECT COALESCE(SUM((v ->> 'sent')::bigint + (v ->> 'failed')::bigint), 0)::text
     FROM _eng, jsonb_each(j -> 'emails') AS x(k, v));

INSERT INTO _r SELECT 44, 'engagement: tendencia de actividad = órdenes + ventas 30d',
  (SELECT ((SELECT COUNT(*) FROM ordenes_servicio WHERE es_practica = FALSE AND fecha_ingreso >= now() - interval '30 days')
         + (SELECT COUNT(*) FROM ventas WHERE created_at >= now() - interval '30 days'))::text),
  (SELECT COALESCE(SUM((e ->> 'total')::bigint), 0)::text FROM _eng, jsonb_array_elements(j -> 'tendencia_actividad') e);

-- ---------------------------------------------------------------- feature usage
INSERT INTO _r SELECT 50, 'feature usage: una fila por org con registros',
  (SELECT COUNT(DISTINCT organization_id)::text FROM feature_usage),
  (SELECT jsonb_array_length(superadmin_feature_usage_ultimo())::text);

INSERT INTO _r SELECT 51, 'feature usage: cada fila es la más reciente de su org', '0',
  (SELECT COUNT(*)::text
     FROM jsonb_array_elements(superadmin_feature_usage_ultimo()) e
    WHERE (e ->> 'fecha')::date <> (SELECT MAX(f.fecha) FROM feature_usage f WHERE f.organization_id = e ->> 'organization_id'));

SELECT orden, probe, esperado, obtenido, esperado = obtenido AS ok FROM _r ORDER BY orden, probe;

ROLLBACK;
