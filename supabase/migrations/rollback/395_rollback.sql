-- Rollback de politicas_abiertas_a_service_role (395): vuelve a abrir cada política al rol public.
-- Deja expuestas las tablas otra vez; usar solo si algo del servidor dejó de andar.

SET LOCAL lock_timeout = '3s';
ALTER POLICY "Service role full access to user_notifications" ON user_notifications TO public;
ALTER POLICY "Público puede registrarse en waitlist iOS" ON ios_waitlist TO public;
ALTER POLICY "Público puede suscribirse al newsletter" ON newsletter_subscribers TO public;
