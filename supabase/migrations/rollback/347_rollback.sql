-- Rollback de la migracion 347.
--
-- Restaura las opciones y los permisos que las vistas tenían antes.

ALTER VIEW public.v_clientes_resumen   RESET (security_invoker);
ALTER VIEW public.v_comisiones_ordenes RESET (security_invoker);
ALTER VIEW public.v_comisiones_ventas  RESET (security_invoker);
ALTER VIEW public.plans_with_usage     RESET (security_invoker);
ALTER VIEW public.v_cc_drift           RESET (security_invoker);

GRANT ALL ON public.v_clientes_resumen   TO anon, authenticated;
GRANT ALL ON public.v_comisiones_ordenes TO anon, authenticated;
GRANT ALL ON public.v_comisiones_ventas  TO anon, authenticated;
GRANT ALL ON public.plans_with_usage     TO anon, authenticated;
GRANT ALL ON public.v_cc_drift           TO anon, authenticated;
