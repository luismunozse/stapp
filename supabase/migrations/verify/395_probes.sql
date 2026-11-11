-- Verificación de politicas_abiertas_a_service_role (395).
--
-- Correr ANTES y DESPUÉS de aplicar:  node scripts/db-run.mjs supabase/migrations/verify/395_probes.sql
-- (sin --apply: termina en ROLLBACK). Los INSERT de prueba se deshacen.
--
-- Resultado: UN select. Después de aplicar, todo en ok = true. Antes, 1, 2 y 3 dan false.

BEGIN;

CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);
GRANT ALL ON _r TO anon, authenticated, service_role;

INSERT INTO _r
SELECT 1, 'políticas con true para public/anon en las 3 tablas', '0', count(*)::text
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('user_notifications', 'ios_waitlist', 'newsletter_subscribers')
  AND roles && ARRAY['public', 'anon']::name[]
  AND (qual = 'true' OR with_check = 'true');

SET LOCAL ROLE anon;
INSERT INTO _r
SELECT 2, 'anon ve notificaciones', '0', count(*)::text FROM user_notifications;
RESET ROLE;

SET LOCAL ROLE anon;
DO $$
BEGIN
  INSERT INTO newsletter_subscribers (email, source) VALUES ('probe-395-anon@example.invalid', 'probe');
  INSERT INTO _r VALUES (3, 'anon inserta en newsletter_subscribers', 'rechazado', 'insertó');
EXCEPTION WHEN insufficient_privilege THEN
  INSERT INTO _r VALUES (3, 'anon inserta en newsletter_subscribers', 'rechazado', 'rechazado');
END $$;
RESET ROLE;

-- El servidor (service_role) sigue pudiendo leer y escribir.
SET LOCAL ROLE service_role;
INSERT INTO _r
SELECT 4, 'service_role lee notificaciones', 'true', (count(*) >= 0)::text FROM user_notifications;
DO $$
BEGIN
  INSERT INTO newsletter_subscribers (email, source) VALUES ('probe-395@example.invalid', 'probe');
  INSERT INTO _r VALUES (5, 'service_role inserta en newsletter_subscribers', 'insertó', 'insertó');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES (5, 'service_role inserta en newsletter_subscribers', 'insertó', SQLERRM);
END $$;
RESET ROLE;

INSERT INTO _r
SELECT 6, 'lectura pública de maintenance_banner intacta', '1', count(*)::text
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'maintenance_banner'
  AND policyname = 'Anyone can read maintenance banner' AND roles && ARRAY['public']::name[];

SELECT orden, probe, esperado, obtenido, esperado = obtenido AS ok FROM _r ORDER BY orden;

ROLLBACK;
