-- Verification of 414: order-less upload sessions and photos in transit.
--
-- Run AFTER 414 is applied:  node scripts/db-run.mjs <this file>
-- (no --apply: the file opens its own transaction and always ends in ROLLBACK).
-- Only data created: one order-less session hung from an existing organization (read, never
-- modified) and two photos in transit, rolled back with everything. Green = obtenido equals esperado.

BEGIN;

CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);

INSERT INTO public.foto_carga_sesiones (id, organization_id, orden_id, token_hash, tipo, expires_at)
SELECT 'probe414-s', o.id, NULL, 'probe414-h', 'INGRESO', now() + INTERVAL '10 minutes'
  FROM (SELECT id FROM public.organizations LIMIT 1) o;

INSERT INTO _r SELECT 1, 'una sesión puede no tener orden', '1',
  (SELECT count(*)::text FROM public.foto_carga_sesiones WHERE id = 'probe414-s' AND orden_id IS NULL);

INSERT INTO _r SELECT 2, 'reservar funciona sin orden y devuelve orden_id NULL', 'probe414-s/sin-orden',
  COALESCE((SELECT id || '/' || COALESCE(orden_id, 'sin-orden')
              FROM public.reservar_foto_carga_sesion('probe414-h')), 'sin filas');

INSERT INTO public.foto_carga_pendientes (id, sesion_id, mime, data) VALUES
  ('probe414-p1', 'probe414-s', 'image/jpeg', 'AAAA'),
  ('probe414-p2', 'probe414-s', 'image/webp', 'BBBB');

INSERT INTO _r SELECT 3, 'las fotos en tránsito se guardan', '2',
  (SELECT count(*)::text FROM public.foto_carga_pendientes WHERE sesion_id = 'probe414-s');

DO $$
BEGIN
  BEGIN
    INSERT INTO public.foto_carga_pendientes (sesion_id, mime, data) VALUES ('probe414-s', 'image/svg+xml', 'AAAA');
    INSERT INTO _r VALUES (4, 'un mime no admitido se rechaza', '23514', 'aceptado');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES (4, 'un mime no admitido se rechaza', '23514', SQLSTATE);
  END;
  BEGIN
    INSERT INTO public.foto_carga_pendientes (sesion_id, mime, data) VALUES ('probe414-no-existe', 'image/jpeg', 'AAAA');
    INSERT INTO _r VALUES (5, 'una foto sin sesión se rechaza', '23503', 'aceptado');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES (5, 'una foto sin sesión se rechaza', '23503', SQLSTATE);
  END;
END $$;

DELETE FROM public.foto_carga_sesiones WHERE id = 'probe414-s';
INSERT INTO _r SELECT 6, 'borrar la sesión borra sus fotos en tránsito', '0',
  (SELECT count(*)::text FROM public.foto_carga_pendientes WHERE id LIKE 'probe414-%');

INSERT INTO _r SELECT 7, 'RLS activado', 'true',
  (SELECT relrowsecurity::text FROM pg_class WHERE oid = 'public.foto_carga_pendientes'::regclass);

INSERT INTO _r SELECT 8, 'anon y authenticated no tienen privilegios sobre la tabla', 'false/false',
  has_table_privilege('anon', 'public.foto_carga_pendientes', 'SELECT,INSERT,UPDATE,DELETE')::text || '/' ||
  has_table_privilege('authenticated', 'public.foto_carga_pendientes', 'SELECT,INSERT,UPDATE,DELETE')::text;

INSERT INTO _r SELECT 9, 'las sesiones con orden (413) siguen sin tocarse', 'true',
  (NOT EXISTS (SELECT 1 FROM public.foto_carga_pendientes p
                 JOIN public.foto_carga_sesiones s ON s.id = p.sesion_id
                WHERE s.orden_id IS NOT NULL))::text;

SELECT orden, probe, esperado, obtenido,
       CASE WHEN esperado = obtenido THEN 'OK' ELSE 'FALLO' END AS resultado
  FROM _r ORDER BY orden;

ROLLBACK;
