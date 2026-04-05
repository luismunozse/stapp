-- ============================================
-- Migration 086: Superadmin Security Enhancements
-- - Account lockout after failed login attempts
-- - Persistent rate limiting for superadmin endpoints
-- ============================================

-- Campos de account lockout en users
ALTER TABLE users
ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_failed_login TIMESTAMPTZ;

-- Tabla de rate limiting persistente para superadmin
CREATE TABLE IF NOT EXISTS superadmin_rate_limits (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  identifier TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  request_count INTEGER DEFAULT 1,
  window_start TIMESTAMPTZ DEFAULT now(),
  window_end TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sa_rate_limit_identifier
  ON superadmin_rate_limits(identifier, endpoint, window_end);

-- Auto-cleanup de entradas expiradas
CREATE OR REPLACE FUNCTION cleanup_superadmin_rate_limits() RETURNS void AS $$
BEGIN
  DELETE FROM superadmin_rate_limits WHERE window_end < now();
END;
$$ LANGUAGE plpgsql;

-- Función para verificar y registrar rate limit atómicamente
CREATE OR REPLACE FUNCTION check_superadmin_rate_limit(
  p_identifier TEXT,
  p_endpoint TEXT,
  p_max_requests INTEGER,
  p_window_seconds INTEGER
) RETURNS JSON AS $$
DECLARE
  v_count INTEGER;
  v_window_end TIMESTAMPTZ;
BEGIN
  -- Limpiar entradas expiradas para este identificador
  DELETE FROM superadmin_rate_limits
  WHERE identifier = p_identifier AND endpoint = p_endpoint AND window_end < now();

  -- Contar requests en la ventana actual
  SELECT COALESCE(SUM(request_count), 0), MAX(window_end)
  INTO v_count, v_window_end
  FROM superadmin_rate_limits
  WHERE identifier = p_identifier
    AND endpoint = p_endpoint
    AND window_end > now();

  IF v_count >= p_max_requests THEN
    RETURN json_build_object(
      'allowed', false,
      'count', v_count,
      'reset', EXTRACT(EPOCH FROM v_window_end)::BIGINT
    );
  END IF;

  -- Insertar o actualizar
  IF v_window_end IS NOT NULL THEN
    UPDATE superadmin_rate_limits
    SET request_count = request_count + 1
    WHERE identifier = p_identifier
      AND endpoint = p_endpoint
      AND window_end > now();
  ELSE
    INSERT INTO superadmin_rate_limits (identifier, endpoint, request_count, window_end)
    VALUES (p_identifier, p_endpoint, 1, now() + (p_window_seconds || ' seconds')::INTERVAL);
  END IF;

  RETURN json_build_object(
    'allowed', true,
    'count', v_count + 1,
    'reset', EXTRACT(EPOCH FROM COALESCE(v_window_end, now() + (p_window_seconds || ' seconds')::INTERVAL))::BIGINT
  );
END;
$$ LANGUAGE plpgsql;

-- Función para account lockout
CREATE OR REPLACE FUNCTION handle_failed_login(p_email TEXT) RETURNS JSON AS $$
DECLARE
  v_user RECORD;
  v_max_attempts INTEGER := 5;
  v_lockout_minutes INTEGER := 30;
BEGIN
  SELECT id, failed_login_attempts, locked_until
  INTO v_user
  FROM users
  WHERE email = p_email;

  IF NOT FOUND THEN
    RETURN json_build_object('locked', false, 'attempts', 0);
  END IF;

  -- Si está bloqueado y no expiró, rechazar
  IF v_user.locked_until IS NOT NULL AND v_user.locked_until > now() THEN
    RETURN json_build_object(
      'locked', true,
      'attempts', v_user.failed_login_attempts,
      'locked_until', v_user.locked_until
    );
  END IF;

  -- Incrementar intentos fallidos
  UPDATE users
  SET
    failed_login_attempts = CASE
      WHEN locked_until IS NOT NULL AND locked_until <= now() THEN 1
      ELSE COALESCE(failed_login_attempts, 0) + 1
    END,
    last_failed_login = now(),
    locked_until = CASE
      WHEN COALESCE(failed_login_attempts, 0) + 1 >= v_max_attempts
      THEN now() + (v_lockout_minutes || ' minutes')::INTERVAL
      ELSE NULL
    END
  WHERE id = v_user.id;

  RETURN json_build_object(
    'locked', COALESCE(v_user.failed_login_attempts, 0) + 1 >= v_max_attempts,
    'attempts', COALESCE(v_user.failed_login_attempts, 0) + 1,
    'max_attempts', v_max_attempts
  );
END;
$$ LANGUAGE plpgsql;

-- Función para resetear intentos fallidos tras login exitoso
CREATE OR REPLACE FUNCTION reset_failed_login(p_email TEXT) RETURNS void AS $$
BEGIN
  UPDATE users
  SET failed_login_attempts = 0, locked_until = NULL, last_failed_login = NULL
  WHERE email = p_email;
END;
$$ LANGUAGE plpgsql;
