-- Probes de 383 (marcar_lotes_vencidos por organización). Solo lectura.
-- Correr en el SQL editor de Studio después de aplicar 383. Todas las filas
-- deben salir con ok = true.

BEGIN;

CREATE TEMP TABLE _probe (probe TEXT, ok BOOLEAN, detalle TEXT) ON COMMIT DROP;

INSERT INTO _probe
SELECT 'firma nueva existe',
       to_regprocedure('public.marcar_lotes_vencidos(text)') IS NOT NULL,
       coalesce(to_regprocedure('public.marcar_lotes_vencidos(text)')::text, 'no existe');

INSERT INTO _probe
SELECT 'firma global sin parámetros eliminada',
       to_regprocedure('public.marcar_lotes_vencidos()') IS NULL,
       coalesce(to_regprocedure('public.marcar_lotes_vencidos()')::text, 'eliminada');

INSERT INTO _probe
SELECT 'anon no puede ejecutarla',
       NOT has_function_privilege('anon', 'public.marcar_lotes_vencidos(text)', 'EXECUTE'),
       NULL;

INSERT INTO _probe
SELECT 'authenticated no puede ejecutarla',
       NOT has_function_privilege('authenticated', 'public.marcar_lotes_vencidos(text)', 'EXECUTE'),
       NULL;

INSERT INTO _probe
SELECT 'service_role puede ejecutarla',
       has_function_privilege('service_role', 'public.marcar_lotes_vencidos(text)', 'EXECUTE'),
       NULL;

INSERT INTO _probe
SELECT 'search_path fijado',
       EXISTS (
         SELECT 1 FROM pg_proc p, unnest(coalesce(p.proconfig, '{}')) c
         WHERE p.oid = 'public.marcar_lotes_vencidos(text)'::regprocedure
           AND c LIKE 'search_path=%'
       ),
       NULL;

SELECT * FROM _probe ORDER BY ok, probe;

ROLLBACK;
