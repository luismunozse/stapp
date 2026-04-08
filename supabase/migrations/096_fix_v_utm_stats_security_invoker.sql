-- ============================================
-- 096: Fix Security Definer View alert para v_utm_stats
-- ============================================
-- Supabase advisor marca v_utm_stats como SECURITY DEFINER
-- porque por defecto las vistas se ejecutan con los permisos
-- del creador (postgres), bypasseando RLS del usuario que consulta.
--
-- Recreamos la vista con security_invoker = true para que
-- respete los permisos y políticas RLS del usuario que la invoca.

DROP VIEW IF EXISTS public.v_utm_stats;

CREATE VIEW public.v_utm_stats
WITH (security_invoker = true) AS
SELECT
  utm_source,
  utm_medium,
  utm_campaign,
  COUNT(*)                                          AS registros,
  COUNT(*) FILTER (WHERE activo)                    AS activos,
  MIN(created_at)                                   AS primer_registro,
  MAX(created_at)                                   AS ultimo_registro
FROM organizations
WHERE utm_source IS NOT NULL
GROUP BY utm_source, utm_medium, utm_campaign
ORDER BY registros DESC;

-- Esta vista la usa el superadmin. Como ahora respeta RLS,
-- aseguramos que solo el rol service_role / superadmin pueda leerla.
REVOKE ALL ON public.v_utm_stats FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_utm_stats TO service_role;
