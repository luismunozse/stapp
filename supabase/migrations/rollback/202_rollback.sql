-- =============================================================================
-- Rollback for migration 202: Additive authenticated Realtime policies
-- =============================================================================
--
-- Drops only the authenticated-role SELECT policies added in 202.
-- The anon policies from migration 112 are NOT touched — they remain active.
--
-- When to run:
--   If PR3 needs to be reverted AND the application code has already been
--   rolled back (or never deployed). Running this rollback before reverting
--   the code would leave the socket trying to authenticate with no policy
--   matching — same as the wrong apply-order scenario. Revert code first,
--   then run this SQL.
-- =============================================================================

BEGIN;

DROP POLICY IF EXISTS "os_auth_realtime_select" ON ordenes_servicio;
DROP POLICY IF EXISTS "cot_auth_realtime_select" ON cotizaciones;
DROP POLICY IF EXISTS "oe_auth_realtime_select" ON orden_eventos;
DROP POLICY IF EXISTS "ro_auth_realtime_select" ON repuestos_orden;

COMMIT;
