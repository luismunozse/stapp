-- =============================================================================
-- Migration: 203_drop_anon_realtime_policies.sql
-- RLS hardening — Change A (final). Closes the CRITICAL cross-tenant anon read leak.
-- =============================================================================
--
-- BACKGROUND
--   Migration 112 added `anon ... USING(true)` SELECT policies on four order
--   tables so the dashboard + public seguimiento page could use Supabase
--   Realtime via the anon key. Because the anon key is public (shipped in the
--   JS bundle), this let ANY unauthenticated client read every tenant's rows
--   via PostgREST. (Audit 2026-06-09, CRITICAL.)
--
--   Both Realtime consumers were migrated to POLLING (seguimiento → PR2,
--   dashboard → the dashboard-polling pivot). The push-via-minted-JWT approach
--   (PR3) was abandoned: this Supabase project uses asymmetric JWT signing
--   keys (ECC P-256), so HS256-minted tokens are rejected. With both consumers
--   polling the token-gated / service_role API paths, NOTHING subscribes to
--   these four tables via Realtime anymore.
--
-- THEREFORE this migration drops all now-unused realtime SELECT policies on the
-- four tables:
--   * the 4 anon `anon_realtime_select` policies (migration 112)  <- the leak
--   * the 4 `*_auth_realtime_select` policies (migration 202, never used —
--     no socket authenticates as `authenticated` now)
--   * a pre-existing leftover `anon realtime read own org` on ordenes_servicio
--     (an earlier manual attempt at the same fix; authenticated + auth.uid(),
--     also unused now)
--
-- SAFETY
--   ZERO impact on the app: all API access is via service_role (bypasses RLS).
--   The only consumers of these anon policies were the Realtime sockets, which
--   no longer exist. A stale browser tab still on the OLD (pre-pivot) bundle
--   would lose live updates until refresh — apply AFTER the dashboard-polling
--   deploy is live so new clients poll.
--
--   NOTE: user_notifications is NOT touched here — its anon Realtime (used by
--   the notification bell) lives on a separate table/policy lineage.
--
--   lock_timeout aborts-and-rolls-back cleanly if locks aren't acquired in 3s.
--   Reversible via rollback/203_rollback.sql.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '3s';

-- ---- Change A: drop the 4 anon USING(true) policies (migration 112) ----
DROP POLICY IF EXISTS anon_realtime_select ON ordenes_servicio;
DROP POLICY IF EXISTS anon_realtime_select ON cotizaciones;
DROP POLICY IF EXISTS anon_realtime_select ON orden_eventos;
DROP POLICY IF EXISTS anon_realtime_select ON repuestos_orden;

-- ---- Drop the unused authenticated realtime policies (migration 202) ----
DROP POLICY IF EXISTS os_auth_realtime_select  ON ordenes_servicio;
DROP POLICY IF EXISTS cot_auth_realtime_select ON cotizaciones;
DROP POLICY IF EXISTS oe_auth_realtime_select  ON orden_eventos;
DROP POLICY IF EXISTS ro_auth_realtime_select  ON repuestos_orden;

-- ---- Drop the pre-existing leftover authenticated policy on ordenes_servicio ----
DROP POLICY IF EXISTS "anon realtime read own org" ON ordenes_servicio;

COMMIT;
