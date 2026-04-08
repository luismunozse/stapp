-- ============================================
-- 098: Enable RLS en organization_limit_overrides
-- ============================================
-- Supabase advisor marca la tabla como "RLS Disabled in Public".
-- La tabla solo se accede desde:
--   1) app/api/superadmin/subscriptions/limit-overrides/route.ts
--      vía supabaseAdmin (service_role) protegido por requireSuperadmin().
--   2) La función get_organization_effective_limits() (SQL) usada
--      internamente desde el backend con service_role.
--
-- En Supabase service_role tiene BYPASSRLS, así que habilitar RLS
-- sin policies bloquea anon/authenticated sin romper funcionalidad.

ALTER TABLE public.organization_limit_overrides ENABLE ROW LEVEL SECURITY;

-- Sin policies = solo service_role / postgres pueden acceder.
-- Esto es correcto: solo el superadmin puede modificar overrides
-- y siempre lo hace vía endpoints server-side con service_role.

-- Defensa en profundidad: revocar permisos directos de tabla
-- a roles públicos.
REVOKE ALL ON public.organization_limit_overrides FROM PUBLIC, anon, authenticated;
