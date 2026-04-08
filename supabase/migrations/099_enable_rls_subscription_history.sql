-- ============================================
-- 099: Enable RLS en subscription_history
-- ============================================
-- Supabase advisor marca la tabla como "RLS Disabled in Public".
-- La tabla solo se accede desde endpoints de superadmin server-side
-- con supabaseAdmin (service_role), todos protegidos por
-- requireSuperadmin():
--   - app/api/superadmin/subscriptions/history/route.ts
--   - app/api/superadmin/subscriptions/renew/route.ts
--   - app/api/superadmin/subscriptions/cancel/route.ts
--   - app/api/superadmin/subscriptions/bulk/route.ts
--   - app/api/superadmin/subscriptions/limit-overrides/route.ts
--   - app/api/superadmin/trial-extension/route.ts
--
-- service_role tiene BYPASSRLS, así que habilitar RLS sin policies
-- bloquea anon/authenticated sin romper funcionalidad.

ALTER TABLE public.subscription_history ENABLE ROW LEVEL SECURITY;

-- Sin policies = solo service_role / postgres pueden acceder.
-- Defensa en profundidad: revocar permisos directos.
REVOKE ALL ON public.subscription_history FROM PUBLIC, anon, authenticated;
