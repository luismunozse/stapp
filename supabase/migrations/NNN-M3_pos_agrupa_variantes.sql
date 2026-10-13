-- ============================================================================
-- M3 (variantes-inventario-venta): POS preference "group variants" per organization
-- ============================================================================
-- Adds organizations.pos_agrupa_variantes. When true the POS collapses the variants of
-- one product into a single card that opens a bottom sheet; when false it lists every
-- variant as its own card (the flat list the POS has today).
--
-- DEFAULT true, not false, and the reason matters before copying the 275/314/320 pattern:
-- grouped is the display the feature ships with. An organization that never touches the
-- setting must get it, and a missing row value or a missing column must read as grouped.
-- Every reader uses `!== false` for that reason (same convention as 326).
--
-- This is its own file, separate from M1a/M1b on purpose. M1a must be applied before the
-- inventory side ships, while this flag only matters when the POS grouping ships. Putting
-- it in M1a would couple the organizations table to the inventory rollback.
--
-- Nothing reads the column until the POS PR. The app degrades without it: each of the
-- three configuration cascades (GET and PUT /api/configuracion, /api/configuracion/operativa)
-- has its own fallback step for this column, so applying this file before or after the
-- PR that plumbs it changes nothing for the other settings.
--
-- LOCKS: ADD COLUMN with a constant DEFAULT is a catalog-only change on PG11+ (no table
-- rewrite). It still takes ACCESS EXCLUSIVE on `organizations` until the transaction ends,
-- and that table is read on almost every request. The lock_timeout bounds the WAIT, not
-- the hold: if it aborts, nothing was applied, run the file again. It is one tiny
-- transaction, but apply it off-peak.
--
-- Re-runnable: ADD COLUMN IF NOT EXISTS, and COMMENT replaces the previous comment.
-- Rollback: rollback/<NNN>_rollback.sql drops the column (only the organizations' choice
-- is lost). Probes: verify/<NNN>_probes.sql, run WITHOUT --apply after this is applied.
-- ============================================================================

SET LOCAL lock_timeout = '3s';

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS pos_agrupa_variantes BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN organizations.pos_agrupa_variantes IS
  'POS display of product variants. true groups the variants of a product into one card that opens a bottom sheet, false lists every variant as its own card. Default true, so grouped is what an organization gets until an admin turns it off. Always read as `!== false`: a NULL or a missing column also means grouped.';
