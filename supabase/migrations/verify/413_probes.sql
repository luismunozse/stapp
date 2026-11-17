-- Verification of 413: foto_carga_sesiones and its reserve/release functions.
--
-- Run AFTER 413 is applied:  node scripts/db-run.mjs <this file>
-- (no --apply: the file opens its own transaction and always ends in ROLLBACK).
-- Only data created: upload sessions hung from one existing order (read, never modified),
-- rolled back with everything. Green = obtenido equals esperado.

BEGIN;

CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);

-- One session per case, all on the same (any) order.
INSERT INTO public.foto_carga_sesiones (id, organization_id, orden_id, token_hash, tipo, max_fotos, expires_at, revoked_at)
SELECT v.id, o.organization_id, o.id, v.hash, v.tipo, v.max_fotos, now() + v.vive, v.revocada
  FROM (SELECT id, organization_id FROM public.ordenes_servicio LIMIT 1) o,
       (VALUES
         ('probe413-viva',     'probe413-h-viva',     'DIAGNOSTICO', 2, INTERVAL '10 minutes',  NULL::timestamptz),
         ('probe413-vencida',  'probe413-h-vencida',  'REPARACION',  2, INTERVAL '-1 minute',   NULL),
         ('probe413-revocada', 'probe413-h-revocada', 'REPARACION',  2, INTERVAL '10 minutes',  now())
       ) AS v(id, hash, tipo, max_fotos, vive, revocada);

INSERT INTO _r SELECT 1, 'las tres sesiones de prueba existen', '3',
  (SELECT count(*)::text FROM public.foto_carga_sesiones WHERE id LIKE 'probe413-%');

INSERT INTO _r SELECT 2, 'reservar devuelve la sesión viva con su tipo', 'probe413-viva/DIAGNOSTICO',
  COALESCE((SELECT id || '/' || tipo FROM public.reservar_foto_carga_sesion('probe413-h-viva')), 'sin filas');

INSERT INTO _r SELECT 3, 'la reserva sumó 1', '1',
  (SELECT fotos_subidas::text FROM public.foto_carga_sesiones WHERE id = 'probe413-viva');

INSERT INTO _r SELECT 4, 'segunda reserva entra (cupo 2)', '1',
  (SELECT count(*)::text FROM public.reservar_foto_carga_sesion('probe413-h-viva'));

INSERT INTO _r SELECT 5, 'tercera reserva no entra: cupo lleno', '0',
  (SELECT count(*)::text FROM public.reservar_foto_carga_sesion('probe413-h-viva'));

SELECT public.liberar_foto_carga_sesion('probe413-viva');
INSERT INTO _r SELECT 6, 'liberar devuelve un lugar', '1',
  (SELECT fotos_subidas::text FROM public.foto_carga_sesiones WHERE id = 'probe413-viva');

INSERT INTO _r SELECT 7, 'tras liberar se puede reservar de nuevo', '1',
  (SELECT count(*)::text FROM public.reservar_foto_carga_sesion('probe413-h-viva'));

INSERT INTO _r SELECT 8, 'sesión vencida no reserva', '0',
  (SELECT count(*)::text FROM public.reservar_foto_carga_sesion('probe413-h-vencida'));

INSERT INTO _r SELECT 9, 'sesión revocada no reserva', '0',
  (SELECT count(*)::text FROM public.reservar_foto_carga_sesion('probe413-h-revocada'));

INSERT INTO _r SELECT 10, 'hash desconocido no reserva', '0',
  (SELECT count(*)::text FROM public.reservar_foto_carga_sesion('probe413-h-no-existe'));

SELECT public.liberar_foto_carga_sesion('probe413-vencida');
INSERT INTO _r SELECT 11, 'liberar no baja de cero', '0',
  (SELECT fotos_subidas::text FROM public.foto_carga_sesiones WHERE id = 'probe413-vencida');

INSERT INTO _r SELECT 12, 'RLS activado', 'true',
  (SELECT relrowsecurity::text FROM pg_class WHERE oid = 'public.foto_carga_sesiones'::regclass);

INSERT INTO _r SELECT 13, 'anon y authenticated no tienen privilegios sobre la tabla', 'false/false',
  has_table_privilege('anon', 'public.foto_carga_sesiones', 'SELECT,INSERT,UPDATE,DELETE')::text || '/' ||
  has_table_privilege('authenticated', 'public.foto_carga_sesiones', 'SELECT,INSERT,UPDATE,DELETE')::text;

INSERT INTO _r SELECT 14, 'anon/authenticated no ejecutan reservar; service_role sí', 'false/false/true',
  has_function_privilege('anon', 'public.reservar_foto_carga_sesion(text)', 'EXECUTE')::text || '/' ||
  has_function_privilege('authenticated', 'public.reservar_foto_carga_sesion(text)', 'EXECUTE')::text || '/' ||
  has_function_privilege('service_role', 'public.reservar_foto_carga_sesion(text)', 'EXECUTE')::text;

INSERT INTO _r SELECT 15, 'anon/authenticated no ejecutan liberar; service_role sí', 'false/false/true',
  has_function_privilege('anon', 'public.liberar_foto_carga_sesion(text)', 'EXECUTE')::text || '/' ||
  has_function_privilege('authenticated', 'public.liberar_foto_carga_sesion(text)', 'EXECUTE')::text || '/' ||
  has_function_privilege('service_role', 'public.liberar_foto_carga_sesion(text)', 'EXECUTE')::text;

SELECT orden, probe, esperado, obtenido,
       CASE WHEN esperado = obtenido THEN 'OK' ELSE 'FALLO' END AS resultado
  FROM _r ORDER BY orden;

ROLLBACK;
