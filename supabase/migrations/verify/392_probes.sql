-- Verificación de storage_politicas_escritura_abiertas (392), y de lo que la 390 no alcanzó.
--
-- Correr DESPUÉS de aplicar:  node scripts/db-run.mjs supabase/migrations/verify/392_probes.sql
-- (sin --apply: termina en ROLLBACK). No escribe ni lee archivos.
--
-- Resultado: UN select. Verde = esperado igual a obtenido.

BEGIN;

CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);
GRANT ALL ON _r TO anon, authenticated;

INSERT INTO _r
SELECT 1, 'políticas de alta/edición/baja en storage.objects para public/anon/authenticated', '0', count(*)::text
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
  AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  AND roles && ARRAY['public', 'anon', 'authenticated']::name[];

INSERT INTO _r
SELECT 2, 'políticas de lectura sobre buckets privados', '0', count(*)::text
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
  AND cmd IN ('SELECT', 'ALL')
  AND qual ~ '''(firmas|fotos-ordenes|comprobantes-gastos|soporte-attachments)''';

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
SELECT 5, 'lectura de buckets públicos intacta', 'avatars,fotos-inventario,logos',
       COALESCE(string_agg(DISTINCT substring(qual from '''([a-z-]+)'''), ',' ORDER BY substring(qual from '''([a-z-]+)''')), '')
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects' AND cmd = 'SELECT';

SELECT orden, probe, esperado, obtenido, esperado = obtenido AS ok FROM _r ORDER BY orden;

ROLLBACK;
