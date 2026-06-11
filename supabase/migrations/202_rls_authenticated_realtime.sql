-- =============================================================================
-- 202: Additive authenticated-role SELECT policies for Realtime tables
-- =============================================================================
--
-- PURPOSE
--   Add SELECT policies for Postgres role `authenticated` on the 4 tables
--   used by the dashboard Realtime subscriptions. These policies are ADDITIVE
--   and COEXIST with the existing anon USING(true) policies created in
--   migration 112 (anon policies remain until PR4/migration 203 drops them).
--
-- DEPLOY ORDER: apply this migration BEFORE deploying the PR3 app revision
--   (setAuth). If the code deploys first, authenticated sockets have no
--   matching policy and Realtime events are silently RLS-denied. Anon policies
--   remain until PR4 (change A).
--
-- APPLY ORDER — CRITICAL
--   This migration MUST be applied BEFORE deploying the PR3 application code
--   (app/api/realtime/token/route.ts + authenticateRealtime wiring). If the
--   code is deployed first, the socket will switch to the `authenticated` role
--   but find no matching policy, causing an immediate RLS deny and no events.
--
-- DESIGN
--   - ordenes_servicio: has a direct `organization_id TEXT` column → scope
--     directly with organization_id = public.get_current_organization_id().
--   - cotizaciones: HAS a direct `organization_id TEXT` column (added in
--     migration 054_cotizaciones_phase1.sql) → scope directly.
--   - orden_eventos: HAS a direct `organization_id TEXT` column → scope
--     directly. (Schema evidence: migration 040_enhanced_tracking.sql)
--   - repuestos_orden: NO direct organization_id. Has `orden_id` → EXISTS-join
--     to ordenes_servicio. (Schema evidence: migration 001_schema.sql)
--
-- IDEMPOTENCY
--   Uses DROP POLICY IF EXISTS + CREATE POLICY so re-running is safe.
--
-- ROLLBACK
--   See supabase/migrations/rollback/202_rollback.sql
--
-- ANON POLICIES
--   The four `anon_realtime_select` policies from migration 112 are NOT
--   dropped or altered here. They stay open until PR4 after the staging spike
--   confirms that authenticated filtering works correctly end-to-end.
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '3s';

-- ---------------------------------------------------------------------------
-- ordenes_servicio
-- Direct organization_id column → scope directly.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "os_auth_realtime_select" ON ordenes_servicio;
CREATE POLICY "os_auth_realtime_select" ON ordenes_servicio
  FOR SELECT TO authenticated
  USING (organization_id = public.get_current_organization_id());

-- ---------------------------------------------------------------------------
-- cotizaciones
-- HAS a direct organization_id column (added in migration 054_cotizaciones_phase1.sql).
-- Scope directly — no JOIN needed.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "cot_auth_realtime_select" ON cotizaciones;
CREATE POLICY "cot_auth_realtime_select" ON cotizaciones
  FOR SELECT TO authenticated
  USING (organization_id = public.get_current_organization_id());

-- ---------------------------------------------------------------------------
-- orden_eventos
-- Has direct organization_id column → scope directly.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "oe_auth_realtime_select" ON orden_eventos;
CREATE POLICY "oe_auth_realtime_select" ON orden_eventos
  FOR SELECT TO authenticated
  USING (organization_id = public.get_current_organization_id());

-- ---------------------------------------------------------------------------
-- repuestos_orden
-- No direct organization_id. Scoped via EXISTS-join to ordenes_servicio.
-- (repuestos_orden.orden_id → ordenes_servicio.id → organization_id)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "ro_auth_realtime_select" ON repuestos_orden;
CREATE POLICY "ro_auth_realtime_select" ON repuestos_orden
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM ordenes_servicio os
      WHERE os.id = repuestos_orden.orden_id
        AND os.organization_id = public.get_current_organization_id()
    )
  );

COMMIT;
