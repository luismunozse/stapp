-- ============================================
-- 097: Enable RLS en superadmin_rate_limits
-- ============================================
-- Supabase advisor marca la tabla como "RLS Disabled in Public".
-- La tabla solo se accede vía la función check_superadmin_rate_limit
-- que se llama desde lib/rate-limit.ts con el cliente supabaseAdmin
-- (service_role). En Supabase service_role tiene BYPASSRLS, así que
-- habilitar RLS sin policies bloquea anon/authenticated sin romper
-- la funcionalidad existente.

ALTER TABLE public.superadmin_rate_limits ENABLE ROW LEVEL SECURITY;

-- Sin policies = nadie (excepto service_role / postgres) puede
-- leer/escribir directamente. Todo el acceso debe ir vía la RPC
-- check_superadmin_rate_limit invocada con service_role.

-- Defensa en profundidad: revocar permisos directos de tabla
-- a roles públicos.
REVOKE ALL ON public.superadmin_rate_limits FROM PUBLIC, anon, authenticated;
