-- Rollback of migration 374.
--
-- Drops the permission column. Every organization that had it on goes back to
-- the previous behavior: TECNICOs only see and work their own orders.
--
-- The app degrades on its own: the flag read is fail-closed, so with the column
-- missing the permission is simply off. Orders already taken keep their
-- technician. Note down which orgs had it enabled before running this if the
-- rollback is not immediate.

ALTER TABLE organizations
  DROP COLUMN IF EXISTS tecnicos_toman_ordenes;
