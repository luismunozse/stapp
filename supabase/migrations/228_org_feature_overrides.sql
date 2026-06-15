-- ============================================
-- 228: Per-organization feature flag overrides
-- ============================================
-- Allows a superadmin to override a specific feature ON or OFF for a single
-- organization, regardless of its plan's featureFlags JSONB.
--
-- Access pattern:
--   All reads/writes go through app/api/superadmin/organizations/[id]/feature-overrides/route.ts
--   via supabaseAdmin (service_role). In Supabase, service_role has BYPASSRLS,
--   so enabling RLS without policies blocks anon/authenticated without breaking
--   any backend functionality.
--
-- This mirrors 098_enable_rls_organization_limit_overrides.sql exactly.

CREATE TABLE IF NOT EXISTS public.organization_feature_overrides (
  organization_id TEXT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  feature_key     TEXT NOT NULL,
  enabled         BOOLEAN NOT NULL,
  created_by      TEXT,            -- superadmin email
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, feature_key)
);

-- Enable RLS — no policies defined.
-- service_role (BYPASSRLS) retains full access; anon/authenticated are blocked.
ALTER TABLE public.organization_feature_overrides ENABLE ROW LEVEL SECURITY;

-- Defense-in-depth: revoke direct table grants from public roles.
REVOKE ALL ON public.organization_feature_overrides FROM PUBLIC, anon, authenticated;
