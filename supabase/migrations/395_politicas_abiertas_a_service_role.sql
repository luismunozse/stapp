-- Políticas que quedaban abiertas al rol public (incluye anon): pasan a service_role.
--
-- La anon key es pública. Una política sin TO <rol> aplica a public, así que
-- cualquiera, sin login, por /rest/v1/:
--   - user_notifications: leía, editaba y borraba las notificaciones de todos
--     (se había dejado abierta para la campanita con Supabase Realtime).
--   - ios_waitlist, newsletter_subscribers: insertaba filas sin pasar por la
--     API (sin validación ni límite).
--
-- La campanita ya no usa Realtime: consulta el servidor (hooks/use-notifications.ts).
-- El alta en la waitlist y el newsletter va por /api/waitlist/ios y /api/newsletter
-- con service_role. Solo cambia el rol; la condición de cada política queda igual.
--
-- No se tocan: la lectura pública de maintenance_banner, ni los INSERT con
-- organization_id = get_current_organization_id() (anon no puede fijar esa org).

SET LOCAL lock_timeout = '3s';

ALTER POLICY "Service role full access to user_notifications" ON user_notifications TO service_role;
ALTER POLICY "Público puede registrarse en waitlist iOS" ON ios_waitlist TO service_role;
ALTER POLICY "Público puede suscribirse al newsletter" ON newsletter_subscribers TO service_role;
