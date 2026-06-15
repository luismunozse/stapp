-- ========================================
-- 227 — Organization suspension reason + audit fields
-- ========================================
-- When a superadmin suspends (deactivates) an organization, we now capture WHY
-- and WHO/WHEN. Previously toggle-status only flipped `activo`, leaving no
-- record of the reason on the org itself (only an audit_logs row). Storing it
-- on the row lets the panel show the current suspension reason at a glance and
-- powers any "reactivate" review.
--
-- Purely additive: nullable columns, no backfill needed. Existing suspended
-- orgs simply have NULL reason until the next toggle.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS suspension_reason TEXT,
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspended_by TEXT; -- email of the superadmin
