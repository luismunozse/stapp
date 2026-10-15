-- Rollback of orden_formato_papel: removes organizations.orden_formato_papel.
--
-- WHAT IS LOST: every organization's choice of paper size for the printed order. The choices
-- are lost: organizations that picked A5 or A6 go back to A4. Nothing else is touched: no
-- order, no other organizations column.
--
-- To restore the choices after a later re-apply, export who had picked a small size first:
--
--   SELECT id, nombre, slug, orden_formato_papel FROM organizations WHERE orden_formato_papel <> 'A4';
--
-- and set them back once the column exists again.
--
-- No code change is needed to run this: with the column missing, each of the three
-- configuration cascades drops to its fallback step and every order prints on A4 (the order
-- PDF route reads the size from `organizations (*)`), so nothing breaks. Revert the PR that
-- plumbs the setting only if the selector should disappear from the screen too.
--
-- LOCKS (held until the transaction ends): ACCESS EXCLUSIVE on `organizations` for the
-- ALTER. lock_timeout bounds the wait, not the hold; if it aborts, nothing was applied:
-- re-run it. Run it off-peak.

SET LOCAL lock_timeout = '3s';

ALTER TABLE organizations
  DROP COLUMN IF EXISTS orden_formato_papel;
