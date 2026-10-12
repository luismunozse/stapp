-- ============================================
-- 347: Vistas de reportes con security_invoker
-- ============================================
-- Mismo criterio que la 096 (v_utm_stats): las vistas de reportes corren con
-- los permisos de quien las consulta y solo las lee el servidor con
-- service_role. Consumidores:
--
--   v_clientes_resumen    app/api/clientes
--   v_comisiones_ordenes  app/api/comisiones
--   v_comisiones_ventas   app/api/comisiones/vendedores, app/api/vendedores/[id],
--                         app/api/vendedores/[id]/comisiones
--   plans_with_usage      app/api/superadmin/plans
--   v_cc_drift            sin consumidores en la app (diagnóstico por SQL)
--
-- Ninguna función ni vista depende de ellas, así que alcanza con ALTER VIEW:
-- no hace falta recrearlas.
--
-- OJO para quien las recree más adelante: CREATE OR REPLACE VIEW reemplaza
-- las opciones de la vista. Sin `WITH (security_invoker = true)` se pierde.

ALTER VIEW public.v_clientes_resumen   SET (security_invoker = true);
ALTER VIEW public.v_comisiones_ordenes SET (security_invoker = true);
ALTER VIEW public.v_comisiones_ventas  SET (security_invoker = true);
ALTER VIEW public.plans_with_usage     SET (security_invoker = true);
ALTER VIEW public.v_cc_drift           SET (security_invoker = true);

REVOKE ALL ON public.v_clientes_resumen   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.v_comisiones_ordenes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.v_comisiones_ventas  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.plans_with_usage     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.v_cc_drift           FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.v_clientes_resumen   TO service_role;
GRANT SELECT ON public.v_comisiones_ordenes TO service_role;
GRANT SELECT ON public.v_comisiones_ventas  TO service_role;
GRANT SELECT ON public.plans_with_usage     TO service_role;
GRANT SELECT ON public.v_cc_drift           TO service_role;
