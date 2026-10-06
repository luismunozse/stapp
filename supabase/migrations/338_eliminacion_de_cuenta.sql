-- 338: eliminacion de cuenta (usuario y taller) con 30 dias de gracia.
--
-- Aditiva y re-ejecutable. Sin BEGIN/COMMIT (db-run.mjs hace dry-run en una
-- transaccion propia). Las columnas nuevas son NULLABLE sin DEFAULT: no
-- reescriben la tabla.
--
-- Partes:
--   1. organizations.deletion_requested_at: distingue "el taller pidio que lo
--      borren" de "se archivo por inactividad" (auto-archive-dormant tambien
--      setea deleted_at). No se usa archived_reason porque es texto libre.
--   2. users.deleted_at: baja de un usuario. La anonimizacion ocurre a los 30
--      dias (cron account-deletion-purge).
--   3. solicitar_baja_usuario(p_user_id): da de baja a un usuario aplicando la
--      guarda del ultimo ADMIN de forma atomica.
--
-- CONCURRENCIA DE LA GUARDA: dos ADMIN que se dan de baja a la vez no pueden
-- dejar el taller sin ADMIN. La funcion bloquea TODAS las filas ADMIN activas
-- del taller en un solo statement ordenado por id (no la propia primero: dos
-- sesiones tomando primero su propia fila y despues la ajena es un deadlock).
-- La segunda sesion espera, y al despertar PostgreSQL re-evalua el predicado
-- `deleted_at IS NULL` sobre la fila que la primera ya marco: queda fuera del
-- conjunto y el conteo de "otros ADMIN" da 0 -> LAST_ADMIN.
--
-- ADEMAS de deleted_at, la baja pone activo = false (users.activo es el
-- soft-disable de tecnicos que ya filtran las listas: sin esto el usuario
-- eliminado seguiria apareciendo como asignable durante los 30 dias) y borra el
-- refresh_token (corta la renovacion de sesion).
--
-- RESTAURAR UN USUARIO (soporte, mientras no este anonimizado):
--   UPDATE users SET deleted_at = NULL, activo = true WHERE id = '...';

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS organizations_deletion_requested_at_idx
  ON organizations (deletion_requested_at)
  WHERE deletion_requested_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS users_deleted_at_idx
  ON users (deleted_at)
  WHERE deleted_at IS NOT NULL;

CREATE OR REPLACE FUNCTION solicitar_baja_usuario(p_user_id TEXT)
RETURNS TEXT AS $$
DECLARE
  v_org      TEXT;
  v_rol      TEXT;
  v_rol_actual TEXT;
  v_deleted  TIMESTAMPTZ;
  v_otros    INTEGER;
BEGIN
  SELECT organization_id, rol::text
    INTO v_org, v_rol
    FROM users
   WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN 'NOT_FOUND';
  END IF;

  IF v_rol = 'ADMIN' THEN
    PERFORM id
       FROM users
      WHERE organization_id = v_org
        AND rol::text = 'ADMIN'
        AND deleted_at IS NULL
      ORDER BY id
        FOR UPDATE;
  ELSE
    PERFORM id FROM users WHERE id = p_user_id FOR UPDATE;
  END IF;

  -- Re-lectura DESPUES de tomar el lock: otra sesion pudo marcarlo (o cambiarle
  -- el rol) mientras esperabamos. Se usa el rol fresco, nunca el leido antes.
  SELECT deleted_at, rol::text INTO v_deleted, v_rol_actual FROM users WHERE id = p_user_id;
  IF v_deleted IS NOT NULL THEN
    RETURN 'ALREADY_DELETED';
  END IF;

  IF v_rol_actual IS DISTINCT FROM v_rol THEN
    v_rol := v_rol_actual;
    -- Paso a ADMIN mientras esperabamos: faltaba el lock del conjunto de ADMIN.
    IF v_rol = 'ADMIN' THEN
      PERFORM id
         FROM users
        WHERE organization_id = v_org
          AND rol::text = 'ADMIN'
          AND deleted_at IS NULL
        ORDER BY id
          FOR UPDATE;
    END IF;
  END IF;

  IF v_rol = 'ADMIN' THEN
    SELECT count(*) INTO v_otros
      FROM users
     WHERE organization_id = v_org
       AND rol::text = 'ADMIN'
       AND deleted_at IS NULL
       AND id <> p_user_id;

    IF v_otros = 0 THEN
      RETURN 'LAST_ADMIN';
    END IF;
  END IF;

  UPDATE users
     SET deleted_at = now(),
         activo = false,
         refresh_token = NULL,
         refresh_token_expires = NULL
   WHERE id = p_user_id;

  RETURN 'OK';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION solicitar_baja_usuario(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION solicitar_baja_usuario(TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION solicitar_baja_usuario(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION solicitar_baja_usuario(TEXT) TO service_role;
