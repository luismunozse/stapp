-- Verificación de storage_buckets_privados (migración 390).
--
-- Correr DESPUÉS de aplicar la 390:  node scripts/db-run.mjs supabase/migrations/verify/390_probes.sql
-- (sin --apply: el archivo abre su propia transacción y termina en ROLLBACK).
--
-- No escribe ni lee archivos: solo mira el catálogo de Storage y cuenta filas
-- de storage.objects con los roles anon y authenticated.
--
-- Qué prueba:
--   1    los cuatro buckets quedaron privados;
--   2    ninguna política de storage.objects nombra a esos buckets para SELECT,
--        ni queda alguna de alta/baja abierta en soporte-attachments;
--   3-4  anon y authenticated (sin claims) no ven ningún objeto de esos buckets;
--   5    los buckets que siguen públicos (logos, fotos-inventario, avatars)
--        no cambiaron.
--
-- Resultado: UN select. Verde = esperado igual a obtenido.

BEGIN;

CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);
GRANT ALL ON _r TO anon, authenticated;

INSERT INTO _r
SELECT 1, 'buckets privados', 'firmas,fotos-ordenes,comprobantes-gastos,soporte-attachments: false',
       'firmas,fotos-ordenes,comprobantes-gastos,soporte-attachments: ' ||
       COALESCE(bool_or(public)::text, 'sin buckets') ||
       CASE WHEN count(*) = 4 THEN '' ELSE ' (encontrados ' || count(*) || ')' END
FROM storage.buckets
WHERE id IN ('firmas', 'fotos-ordenes', 'comprobantes-gastos', 'soporte-attachments');

INSERT INTO _r
SELECT 2, 'políticas abiertas sobre los buckets privados', '0',
       count(*)::text
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
  AND (
    (cmd IN ('SELECT', 'ALL') AND (
       qual ~ '''(firmas|fotos-ordenes|comprobantes-gastos|soporte-attachments)'''
    ))
    OR policyname IN ('soporte_attachments_insert', 'soporte_attachments_delete')
  );

SET LOCAL ROLE anon;
INSERT INTO _r
SELECT 3, 'anon ve objetos de los buckets privados', '0', count(*)::text
FROM storage.objects
WHERE bucket_id IN ('firmas', 'fotos-ordenes', 'comprobantes-gastos', 'soporte-attachments');
RESET ROLE;

SET LOCAL ROLE authenticated;
INSERT INTO _r
SELECT 4, 'authenticated sin claims ve objetos de los buckets privados', '0', count(*)::text
FROM storage.objects
WHERE bucket_id IN ('firmas', 'fotos-ordenes', 'comprobantes-gastos', 'soporte-attachments');
RESET ROLE;

INSERT INTO _r
SELECT 5, 'buckets que siguen públicos', 'avatars,fotos-inventario,logos',
       COALESCE(string_agg(id, ',' ORDER BY id), '')
FROM storage.buckets
WHERE public AND id IN ('logos', 'fotos-inventario', 'avatars');

SELECT orden, probe, esperado, obtenido FROM _r ORDER BY orden, probe;

ROLLBACK;
