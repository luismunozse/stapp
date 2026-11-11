-- Identidad del superadmin por fila (no solo por email) y bloqueo real de acceso.
--
-- 1) users.es_superadmin. El acceso a admin.* se decidía solo por el email
--    (SUPERADMIN_EMAILS). Si un email de la lista no tenía usuario todavía, un
--    ADMIN de tenant podía crear un técnico con ese email, activarle el 2FA y
--    entrar al panel. Desde esta migración hace falta las DOS cosas: el email
--    en la lista y la fila marcada. La marca solo se puede poner desde el SQL
--    editor (postgres): el trigger rechaza cualquier cambio hecho por los roles
--    de la app (service_role, authenticated, anon), así que ningún bug de
--    asignación masiva en una ruta puede crear un superadmin.
--
-- 2) users.acceso_bloqueado_at. "Desactivar usuario" en el panel solo ponía
--    email_verified = false: el login con Google lo volvía a true, reenviar la
--    verificación lo reactivaba y las sesiones abiertas seguían. Ahora el login
--    (los tres modos), la revalidación de la sesión y el proxy rechazan a un
--    usuario con esta columna seteada. Distinto de users.activo, que solo lo
--    saca de las listas de asignación (121) y no bloquea nada.
--
-- ORDEN (ver el PR): aplicar ANTES del deploy del código, y marcar a los
-- superadmins con el UPDATE de abajo también antes. El código nuevo exige la
-- marca: sin ella el superadmin pierde el panel en la próxima revalidación.

SET LOCAL lock_timeout = '3s';

ALTER TABLE users ADD COLUMN IF NOT EXISTS es_superadmin BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS acceso_bloqueado_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS acceso_bloqueado_por TEXT;

COMMENT ON COLUMN users.es_superadmin IS
  'Acceso al panel admin.*: además del email en SUPERADMIN_EMAILS. Solo se cambia '
  'desde el SQL editor (trigger users_es_superadmin_protegido).';
COMMENT ON COLUMN users.acceso_bloqueado_at IS
  'Si tiene valor, el usuario no puede iniciar sesión y sus sesiones se cortan. '
  'Lo setea "Desactivar usuario" del panel superadmin. No confundir con activo.';
COMMENT ON COLUMN users.acceso_bloqueado_por IS
  'Email del superadmin que bloqueó el acceso.';

CREATE OR REPLACE FUNCTION users_es_superadmin_protegido()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user IN ('postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.es_superadmin THEN
    RAISE EXCEPTION 'es_superadmin solo se puede setear desde el SQL editor'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.es_superadmin IS DISTINCT FROM OLD.es_superadmin THEN
    RAISE EXCEPTION 'es_superadmin solo se puede cambiar desde el SQL editor'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_es_superadmin_protegido ON users;
CREATE TRIGGER users_es_superadmin_protegido
  BEFORE INSERT OR UPDATE OF es_superadmin ON users
  FOR EACH ROW EXECUTE FUNCTION users_es_superadmin_protegido();

-- Después de aplicar, en el SQL editor (con los emails de SUPERADMIN_EMAILS):
--
--   -- 1. Revisar: tiene que haber UNA fila por superadmin, y ninguna de un taller.
--   SELECT u.id, u.email, u.created_at, o.slug, u.totp_enabled
--   FROM users u LEFT JOIN organizations o ON o.id = u.organization_id
--   WHERE lower(u.email) IN ('<email1>', '<email2>');
--
--   -- 2. Marcar por id (no por email), solo las filas que reconocés:
--   UPDATE users SET es_superadmin = true WHERE id IN ('<id1>');
