-- ============================================================================
-- 374: opt-in permission so TECNICOs can pick up unassigned repair orders
-- ============================================================================
-- Per-organization toggle (default off), same pattern as 314
-- (tecnicos_operan_pos) and 275 (vendedores_administran_inventario): an org
-- preference, NOT a commercial plan gate (that lives in plans.feature_flags).
--
-- Why it exists: when no ADMIN is around, orders without a technician stay in
-- limbo because only an ADMIN can assign them. With the flag on, a TECNICO can
-- see orders with tecnico_id IS NULL and take them (assign himself, nobody
-- else). Once taken the order is his and the usual rules apply.
--
-- What it does NOT open: reassigning orders that belong to someone else,
-- assigning another technician, un-assigning. The role is not modified.
-- ============================================================================

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS tecnicos_toman_ordenes BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN organizations.tecnicos_toman_ordenes IS
  'If true, users with role TECNICO can see unassigned orders (tecnico_id IS NULL) and take them for themselves. Default false: only ADMIN assigns. Does not modify the user role.';
