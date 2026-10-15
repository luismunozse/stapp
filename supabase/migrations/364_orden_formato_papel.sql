-- ============================================================================
-- Paper size of the printed service order, per organization
-- ============================================================================
-- Adds organizations.orden_formato_papel: 'A4' (the order PDF the app has always printed),
-- 'A5' or 'A6' (single-column layouts for small sheets). A workshop that prints on A6 sets it
-- once in Configuracion and every order comes out sized for that sheet; the order screen can
-- still pick another size for one print.
--
-- DEFAULT 'A4', not NULL: an organization that never touches the setting must keep printing
-- exactly what it prints today. Every reader goes through normalizeOrdenPapel() (lib/orden-papel.ts),
-- so a NULL, an unknown value or a missing column all read as A4.
--
-- Own file and own column on purpose: no existing settings column fits (`terminologia` holds
-- vocabulary overrides, not print layout).
--
-- The app degrades without it: each of the three configuration cascades (GET and PUT
-- /api/configuracion, /api/configuracion/operativa) has its own fallback step for this column,
-- and the order PDF routes read it from `organizations (*)`, so applying this file before or
-- after the deploy that plumbs it changes nothing for the other settings. Until it is applied
-- the selector in Configuracion saves nothing (the PUT drops the key and answers A4) and each
-- print can still choose its size.
--
-- LOCKS: ADD COLUMN with a constant DEFAULT is a catalog-only change on PG11+ (no table
-- rewrite), but the CHECK is validated against the existing rows and the statement takes
-- ACCESS EXCLUSIVE on `organizations` until the transaction ends. That table is read on almost
-- every request. The lock_timeout bounds the WAIT, not the hold: if it aborts, nothing was
-- applied, run the file again. It is one tiny transaction; apply it off-peak.
--
-- Re-runnable: ADD COLUMN IF NOT EXISTS, and COMMENT replaces the previous comment.
-- Rollback: rollback/364_rollback.sql drops the column (only the organizations' choice is
-- lost). Probes: verify/364_probes.sql, run WITHOUT --apply after this is applied.
-- ============================================================================

SET LOCAL lock_timeout = '3s';

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS orden_formato_papel TEXT NOT NULL DEFAULT 'A4'
    CHECK (orden_formato_papel IN ('A4', 'A5', 'A6'));

COMMENT ON COLUMN organizations.orden_formato_papel IS
  'Paper size of the printed service order PDF: A4 (default, the full page with customer part and workshop stub), A5 or A6 (single-column layouts for small sheets). Always read through normalizeOrdenPapel: a NULL, an unknown value or a missing column all mean A4.';
