-- Verificación de plans_audit_superadmin (403). Correr DESPUÉS de aplicarla.
-- Toca un plan y termina en ROLLBACK: no deja filas en plans ni en plans_audit.
--
-- Qué prueba (cada caso hace un UPDATE no-op sobre un plan y mira quién quedó
-- como autor en la fila de plans_audit de esta transacción):
--   1  la función no es SECURITY DEFINER (current_user tiene que ser quien llama);
--   2  service_role con header x-stapp-superadmin -> el email del header;
--   3  service_role sin header -> 'system';
--   4  postgres con header -> se ignora el header: 'sql:<usuario>';
--   5  app.superadmin_email gana sobre el header.
--
-- Resultado: UN select. Verde = esperado igual a obtenido.

BEGIN;

CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);
GRANT ALL ON _r TO service_role;
CREATE TEMP TABLE _plan AS SELECT id FROM plans ORDER BY created_at LIMIT 1;
GRANT ALL ON _plan TO service_role;

-- Autor de la última fila de plans_audit escrita en esta transacción (now() es
-- fijo dentro de ella; se borra para que el caso siguiente parta de cero).
CREATE FUNCTION pg_temp.autor_y_limpiar() RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v TEXT;
BEGIN
  SELECT string_agg(changed_by_email, ',') INTO v FROM plans_audit
  WHERE plan_id = (SELECT id FROM _plan) AND created_at = now();
  DELETE FROM plans_audit WHERE plan_id = (SELECT id FROM _plan) AND created_at = now();
  RETURN COALESCE(v, '(sin fila)');
END $$;

INSERT INTO _r SELECT 1, 'audit_plan_changes no es SECURITY DEFINER', 'false',
  (SELECT prosecdef::TEXT FROM pg_proc WHERE oid = 'audit_plan_changes'::regproc);

-- 2: service_role con header
SET LOCAL "request.headers" = '{"x-stapp-superadmin":"probe@stapp.com.ar"}';
SET LOCAL ROLE service_role;
UPDATE plans SET activo = activo WHERE id = (SELECT id FROM _plan);
RESET ROLE;
INSERT INTO _r SELECT 2, 'service_role con header', 'probe@stapp.com.ar', pg_temp.autor_y_limpiar();

-- 3: service_role sin header
SET LOCAL "request.headers" = '{}';
SET LOCAL ROLE service_role;
UPDATE plans SET activo = activo WHERE id = (SELECT id FROM _plan);
RESET ROLE;
INSERT INTO _r SELECT 3, 'service_role sin header', 'system', pg_temp.autor_y_limpiar();

-- 4: postgres (SQL editor) con header: el header no cuenta
SET LOCAL "request.headers" = '{"x-stapp-superadmin":"falso@x.com"}';
UPDATE plans SET activo = activo WHERE id = (SELECT id FROM _plan);
INSERT INTO _r SELECT 4, 'postgres ignora el header', 'sql:' || session_user, pg_temp.autor_y_limpiar();

-- 5: app.superadmin_email tiene prioridad
SET LOCAL "request.headers" = '{"x-stapp-superadmin":"probe@stapp.com.ar"}';
SET LOCAL "app.superadmin_email" = 'setting@stapp.com.ar';
SET LOCAL ROLE service_role;
UPDATE plans SET activo = activo WHERE id = (SELECT id FROM _plan);
RESET ROLE;
INSERT INTO _r SELECT 5, 'app.superadmin_email gana', 'setting@stapp.com.ar', pg_temp.autor_y_limpiar();

SELECT orden, probe, esperado, obtenido FROM _r ORDER BY orden;

ROLLBACK;
