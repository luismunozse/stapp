-- ============================================================================
-- M2 (variantes-inventario-venta): drop the legacy per-product variants
-- ============================================================================
-- Removes the model migration 176 introduced and the variant groups (355/361) replaced:
--
--   table      inventario_variantes     (its 6 indexes, constraints and RLS go with it)
--   triggers   inventario_variantes_sync_total, inventario_variantes_updated_at
--   function   sync_inventario_total_variantes()
--   RPCs       crear_variantes_bulk, ajustar_stock_variante_atomic,
--              eliminar_variantes_y_consolidar
--   policies   inventario_variantes_select, inventario_variantes_all_service (as 201 left them)
--
-- It also clears the legacy flag on the inventory items that still carry it
-- (UPDATE inventario SET tiene_variantes = false) and rewrites the column comment, which still
-- promised the sync trigger. The COLUMN is NOT dropped: `inventario.tiene_variantes` stays, nothing
-- reads or writes it any more, and dropping it would be a separate decision.
--
-- IT ABORTS INSTEAD OF DROPPING DATA. The first thing it does is lock the table and count its rows,
-- soft-deleted ones included. If there is even one row the DO block raises an exception, the
-- transaction rolls back and the schema is exactly as it was. The expected count is 0, because the
-- legacy UI and routes were removed in the PR before this one, but that is an expectation, not a
-- checked fact: verify/<NNN>_precheck.sql must confirm it against production before applying.
-- Row security is switched off for the transaction so that no policy can filter the count: with it
-- off, PostgreSQL raises an error instead of silently hiding rows from a role that is subject to RLS.
--
-- NO BLIND CASCADE. Every dependent object is dropped by name, in dependency order: triggers and
-- policies, then the trigger function, then the RPCs, then the table with a plain DROP TABLE. If
-- something this file does not know about depends on one of them (a view, a foreign key, a trigger
-- on another table), Postgres refuses the DROP and the whole transaction rolls back. That is the
-- point: a surprise dependent must stop the migration, not disappear with it.
--
-- RUN THE PRE-CHECK FIRST: verify/<NNN>_precheck.sql, read-only. It counts the rows and lists every
-- dependent it can find, so the first time anyone sees a surprise is NOT during the apply.
-- Dry-run the migration next (the default of scripts/db-run.mjs), apply only after the row count
-- is re-checked as 0 and the PR that removed the legacy code is verified live in production.
--
-- LOCKS: LOCK TABLE and DROP TABLE take ACCESS EXCLUSIVE on inventario_variantes, and dropping a
-- table that references `inventario` and `organizations` takes ACCESS EXCLUSIVE on those two as
-- well until the transaction ends. `inventario` is read on almost every request. lock_timeout
-- bounds the WAIT, not the hold: if it aborts with "canceling statement due to lock timeout",
-- nothing was applied, run the file again. The UPDATE touches only the few flagged rows. Apply off-peak.
--
-- Re-runnable: every DROP is IF EXISTS, the guard only looks at the table while it exists, and the
-- UPDATE only matches rows still flagged.
-- Rollback: rollback/<NNN>_rollback.sql recreates the EMPTY legacy objects (no data can be lost: the
-- guard guarantees there was none). Probes: verify/<NNN>_probes.sql, run WITHOUT --apply after this
-- is applied.
-- ============================================================================

SET LOCAL lock_timeout = '3s';
SET LOCAL row_security = off;

-- GUARD:BEGIN
DO $$
DECLARE
  v_rows BIGINT;
BEGIN
  IF to_regclass('public.inventario_variantes') IS NOT NULL THEN
    -- Lock first: no row can be inserted between this count and the DROP TABLE below.
    LOCK TABLE inventario_variantes IN ACCESS EXCLUSIVE MODE;

    IF EXISTS (SELECT 1 FROM inventario_variantes) THEN
      SELECT count(*) INTO v_rows FROM inventario_variantes;
      RAISE EXCEPTION 'M2 aborted: inventario_variantes still holds % row(s). Nothing was dropped.', v_rows
        USING ERRCODE = '55000',
              HINT = 'Decide what to do with those rows (migrate them to variant groups or remove them on purpose), then run M2 again.';
    END IF;
  END IF;
END $$;
-- GUARD:END

-- Right after the guard and before the DROP TABLE: the exclusive locks that DROP TABLE takes on
-- `inventario` start as late as possible, so they are held for less time.
UPDATE inventario SET tiene_variantes = false WHERE tiene_variantes IS TRUE;

DROP TRIGGER IF EXISTS inventario_variantes_sync_total ON inventario_variantes;
DROP TRIGGER IF EXISTS inventario_variantes_updated_at ON inventario_variantes;

DROP POLICY IF EXISTS inventario_variantes_select ON inventario_variantes;
DROP POLICY IF EXISTS inventario_variantes_all_service ON inventario_variantes;

DROP FUNCTION IF EXISTS sync_inventario_total_variantes();
DROP FUNCTION IF EXISTS crear_variantes_bulk(TEXT, TEXT, TEXT, JSONB);
DROP FUNCTION IF EXISTS ajustar_stock_variante_atomic(TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT);
DROP FUNCTION IF EXISTS eliminar_variantes_y_consolidar(TEXT, TEXT, TEXT);

DROP TABLE IF EXISTS inventario_variantes;

COMMENT ON COLUMN inventario.tiene_variantes IS
  'Legacy flag from migration 176, no longer read or written. It used to mark an item whose stock was the sum of inventario_variantes; that table and its sync trigger are gone (M2). Variants now live in inventario_grupos, and an item is a variant when grupo_id is set.';
