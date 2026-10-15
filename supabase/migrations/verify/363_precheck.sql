-- Pre-check of M2 (variantes-inventario-venta): READ-ONLY look at what M2 is about to drop.
--
-- Run it BEFORE the migration, against the same database:
--
--   node scripts/db-run.mjs supabase/migrations/verify/<NNN>_precheck.sql
--
-- (no --apply: db-run wraps it in a transaction and rolls back. The first statement also makes
-- that transaction READ ONLY, so even a typo in this file cannot write. It does not create a
-- temp table or a function for the same reason.) db-run prints every result set; in the Supabase
-- SQL editor only the LAST one would show, so use db-run.
--
-- It reads the legacy table directly, so it only works while the table still exists. After M2 is
-- applied use verify/<NNN>_probes.sql instead.
--
-- HOW TO READ IT
--   1. object inventory     what exists now: all four rows must be true before M2.
--   2. row counts           rows_total must be 0 or the M2 guard aborts (the verdict says so).
--                           rows_soft_deleted counts too: the guard counts every row.
--   3. flagged items        the items M2 will set tiene_variantes = false on. EXPORT THIS LIST
--                           first if you want to be able to flag them again after a rollback.
--   4. views                none expected. A view over the legacy table would make DROP TABLE fail.
--   5. foreign keys         none expected. Same effect.
--   6. triggers on the table  exactly the two M2 drops.
--   7. policies on the table  exactly the two M2 drops.
--   8. functions            the four M2 drops, and NOTHING else. Any UNEXPECTED row is a function
--                           that mentions a legacy object: read it before applying.
--   9. other tables running the sync function   none expected.
--  10. movement history     rows whose referencia_tipo points at the legacy variants. There is no
--                           foreign key, M2 leaves them as they are; this is just so nobody is surprised.
--
-- Every UNEXPECTED row is a reason to stop and read, not an automatic failure of M2: Postgres
-- itself will refuse the DROP (there is no CASCADE in M2) if something really depends on it.
-- Nothing here was run against production when it was written; the first real run is yours.

SET TRANSACTION READ ONLY;

-- 1. Object inventory
SELECT 'table' AS kind, 'inventario_variantes' AS object,
       to_regclass('public.inventario_variantes') IS NOT NULL AS exists_now
UNION ALL
SELECT 'function', 'sync_inventario_total_variantes()',
       to_regprocedure('public.sync_inventario_total_variantes()') IS NOT NULL
UNION ALL
SELECT 'function', 'crear_variantes_bulk(text, text, text, jsonb)',
       to_regprocedure('public.crear_variantes_bulk(text, text, text, jsonb)') IS NOT NULL
UNION ALL
SELECT 'function', 'ajustar_stock_variante_atomic(text, text, text, text, integer, text)',
       to_regprocedure('public.ajustar_stock_variante_atomic(text, text, text, text, integer, text)') IS NOT NULL
UNION ALL
SELECT 'function', 'eliminar_variantes_y_consolidar(text, text, text)',
       to_regprocedure('public.eliminar_variantes_y_consolidar(text, text, text)') IS NOT NULL;

-- 2. Row counts (the M2 guard aborts unless rows_total = 0)
SELECT count(*) AS rows_total,
       count(*) FILTER (WHERE deleted_at IS NULL) AS rows_active,
       count(*) FILTER (WHERE deleted_at IS NOT NULL) AS rows_soft_deleted,
       count(DISTINCT inventario_id) AS distinct_items,
       count(DISTINCT organization_id) AS distinct_orgs,
       CASE WHEN count(*) = 0 THEN 'OK: the M2 guard will pass'
            ELSE 'STOP: the M2 guard will abort, do not apply' END AS verdict
  FROM inventario_variantes;

-- 3. Items still carrying the legacy flag (M2 sets it to false)
SELECT id, organization_id, codigo, nombre, stock, deleted_at IS NULL AS active
  FROM inventario WHERE tiene_variantes IS TRUE
 ORDER BY organization_id, codigo;

-- 4. Views that read the legacy table
SELECT DISTINCT v.oid::regclass::text AS dependent_view,
       'UNEXPECTED: a view reads the legacy table, M2 cannot remove the table' AS verdict
  FROM pg_depend d
  JOIN pg_rewrite r ON r.oid = d.objid
  JOIN pg_class v ON v.oid = r.ev_class
 WHERE d.classid = 'pg_rewrite'::regclass
   AND d.refobjid = to_regclass('public.inventario_variantes')
   AND v.oid <> d.refobjid;

-- 5. Foreign keys pointing at the legacy table
SELECT conrelid::regclass::text AS referencing_table, conname AS constraint_name,
       'UNEXPECTED: a foreign key points at the legacy table, M2 cannot remove the table' AS verdict
  FROM pg_constraint
 WHERE contype = 'f' AND confrelid = to_regclass('public.inventario_variantes');

-- 6. Triggers on the legacy table
SELECT t.tgname AS trigger_name, t.tgfoid::regproc::text AS function_name,
       CASE WHEN t.tgname IN ('inventario_variantes_sync_total', 'inventario_variantes_updated_at')
            THEN 'expected (dropped by M2)'
            ELSE 'UNEXPECTED: M2 does not name this trigger, it would vanish silently with the table' END AS verdict
  FROM pg_trigger t
 WHERE t.tgrelid = to_regclass('public.inventario_variantes') AND NOT t.tgisinternal
 ORDER BY t.tgname;

-- 7. Policies on the legacy table
SELECT policyname, cmd, roles::text AS roles,
       CASE WHEN policyname IN ('inventario_variantes_select', 'inventario_variantes_all_service')
            THEN 'expected (dropped by M2)'
            ELSE 'UNEXPECTED: M2 does not name this policy' END AS verdict
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'inventario_variantes'
 ORDER BY policyname;

-- 8. Functions that are, or mention, a legacy object
SELECT p.oid::regprocedure::text AS function_name,
       CASE WHEN p.proname IN ('sync_inventario_total_variantes', 'crear_variantes_bulk',
                               'ajustar_stock_variante_atomic', 'eliminar_variantes_y_consolidar')
            THEN 'expected (dropped by M2)'
            ELSE 'UNEXPECTED: mentions a legacy object, read it before applying' END AS verdict
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND (p.proname IN ('sync_inventario_total_variantes', 'crear_variantes_bulk',
                      'ajustar_stock_variante_atomic', 'eliminar_variantes_y_consolidar')
        OR p.prosrc ~* '(inventario_variantes|sync_inventario_total_variantes|crear_variantes_bulk|ajustar_stock_variante_atomic|eliminar_variantes_y_consolidar)')
 ORDER BY p.proname;

-- 9. Triggers on OTHER tables that run the sync function
SELECT t.tgrelid::regclass::text AS on_table, t.tgname AS trigger_name,
       'UNEXPECTED: M2 cannot remove the function while this trigger exists' AS verdict
  FROM pg_trigger t
 WHERE NOT t.tgisinternal
   AND t.tgfoid = to_regproc('public.sync_inventario_total_variantes')::oid
   AND t.tgrelid <> to_regclass('public.inventario_variantes');

-- 10. Movement history written by the legacy RPCs (no foreign key, left untouched)
SELECT referencia_tipo, count(*) AS movements,
       'INFO: history rows stay as they are' AS verdict
  FROM movimientos_inventario WHERE referencia_tipo IN ('VARIANTE', 'CONSOLIDACION_VARIANTES')
 GROUP BY referencia_tipo
 ORDER BY referencia_tipo;
