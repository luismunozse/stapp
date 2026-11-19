-- Verification of 419: pagos_informados.
--
-- Run AFTER 419 is applied:  node scripts/db-run.mjs <this file>
-- (no --apply: the file opens its own transaction and always ends in ROLLBACK).
-- No data is created. Green = obtenido equals esperado.

BEGIN;

CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);

INSERT INTO _r SELECT 1, 'la tabla existe', 'true',
  (to_regclass('public.pagos_informados') IS NOT NULL)::text;

INSERT INTO _r SELECT 2, 'RLS activo', 'true',
  (SELECT relrowsecurity::text FROM pg_class WHERE oid = 'public.pagos_informados'::regclass);

INSERT INTO _r SELECT 3, 'anon no tiene permisos', 'false',
  has_table_privilege('anon', 'public.pagos_informados', 'SELECT')::text;

INSERT INTO _r SELECT 4, 'un solo pendiente por orden (índice único parcial)', 'true',
  EXISTS (SELECT 1 FROM pg_indexes
           WHERE schemaname = 'public' AND indexname = 'pagos_informados_orden_pendiente_uniq')::text;

INSERT INTO _r SELECT 5, 'transferencia sin comprobante se rechaza', 'true',
  EXISTS (SELECT 1 FROM pg_constraint
           WHERE conname = 'pagos_informados_comprobante_check')::text;

SELECT orden, probe, esperado, obtenido,
       CASE WHEN esperado = obtenido THEN 'OK' ELSE 'FALLO' END AS resultado
  FROM _r ORDER BY orden;

ROLLBACK;
