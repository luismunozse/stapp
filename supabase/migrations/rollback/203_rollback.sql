-- =============================================================================
-- ROLLBACK: 203_drop_anon_realtime_policies — DO NOT apply in normal operation.
-- Recreates every realtime SELECT policy dropped by 203, restoring the exact
-- pre-203 state (including the CRITICAL anon leak). Use ONLY to revert.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '3s';

-- ---- Recreate the 4 anon USING(true) policies (migration 112) ----
CREATE POLICY anon_realtime_select ON ordenes_servicio FOR SELECT TO anon USING (true);
CREATE POLICY anon_realtime_select ON cotizaciones      FOR SELECT TO anon USING (true);
CREATE POLICY anon_realtime_select ON orden_eventos     FOR SELECT TO anon USING (true);
CREATE POLICY anon_realtime_select ON repuestos_orden   FOR SELECT TO anon USING (true);

-- ---- Recreate the authenticated realtime policies (migration 202) ----
CREATE POLICY os_auth_realtime_select ON ordenes_servicio
  FOR SELECT TO authenticated
  USING (organization_id = public.get_current_organization_id());

CREATE POLICY cot_auth_realtime_select ON cotizaciones
  FOR SELECT TO authenticated
  USING (organization_id = public.get_current_organization_id());

CREATE POLICY oe_auth_realtime_select ON orden_eventos
  FOR SELECT TO authenticated
  USING (organization_id = public.get_current_organization_id());

CREATE POLICY ro_auth_realtime_select ON repuestos_orden
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ordenes_servicio os
      WHERE os.id = repuestos_orden.orden_id
        AND os.organization_id = public.get_current_organization_id()
    )
  );

-- ---- Recreate the pre-existing leftover policy on ordenes_servicio ----
CREATE POLICY "anon realtime read own org" ON ordenes_servicio
  FOR SELECT TO authenticated
  USING (
    organization_id = (
      SELECT users.organization_id FROM users
      WHERE users.id = (auth.uid())::text
    )
  );

COMMIT;
