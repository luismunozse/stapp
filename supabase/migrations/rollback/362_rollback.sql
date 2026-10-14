-- Rollback of M3 (variantes-inventario-venta): removes organizations.pos_agrupa_variantes.
--
-- WHAT IS LOST: every organization's choice for the POS variants display. The choices
-- are lost: organizations that turned grouping OFF go back to the default, which is
-- grouped. Nothing else is touched: no inventory row, no other organizations column.
--
-- To restore the choices after a later re-apply, export who had turned it off first:
--
--   SELECT id, nombre, slug FROM organizations WHERE pos_agrupa_variantes = false;
--
-- and set them back to false once the column exists again.
--
-- No code change is needed to run this: with the column missing, each of the three
-- configuration cascades drops to its fallback step and the POS reads grouped (the same
-- `!== false` convention as 326), so nothing breaks. Revert the PR that plumbs the
-- preference only if the toggle should disappear from the screen too.
--
-- LOCKS (held until the transaction ends): ACCESS EXCLUSIVE on `organizations` for the
-- ALTER. lock_timeout bounds the wait, not the hold; if it aborts, nothing was applied:
-- re-run it. Run it off-peak.

SET LOCAL lock_timeout = '3s';

ALTER TABLE organizations
  DROP COLUMN IF EXISTS pos_agrupa_variantes;
