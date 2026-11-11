-- plans_audit registra al superadmin que hizo el cambio, no "system".
--
-- El trigger de la 025 lee current_setting('app.superadmin_email'). La app
-- habla con la base por PostgREST: cada request es su propia transacción, así
-- que un set_config anterior nunca llega al UPDATE (y el rpc("set_config") que
-- lo intentaba llamaba a una función inexistente). Resultado: las 38 filas de
-- plans_audit dicen "system".
--
-- Ahora las rutas de planes del panel mandan el email en el header
-- x-stapp-superadmin de la misma escritura, y el trigger lo lee de
-- request.headers. El header solo cuenta cuando la escritura viene como
-- service_role: esa clave existe solo en el servidor, así que un cliente no
-- puede firmar en nombre de otro (anon/authenticated ni siquiera escriben
-- plans desde la 384). Por eso la función NO es SECURITY DEFINER: current_user
-- tiene que ser el rol que llamó.
--
-- Sin header: desde el SQL editor queda 'sql:<usuario>'; desde la app sin
-- header (un webhook, un cron), 'system' como hasta ahora. app.superadmin_email
-- sigue teniendo prioridad para quien la setee en la misma transacción.
--
-- Solo reemplaza la función: el trigger trigger_audit_plans ya la usa.
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION audit_plan_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_autor TEXT;
BEGIN
  v_autor := NULLIF(btrim(current_setting('app.superadmin_email', TRUE)), '');

  IF v_autor IS NULL AND current_user = 'service_role' THEN
    v_autor := NULLIF(btrim(left(
      NULLIF(current_setting('request.headers', TRUE), '')::json ->> 'x-stapp-superadmin',
      320
    )), '');
  END IF;

  IF v_autor IS NULL THEN
    v_autor := CASE
      WHEN current_user IN ('postgres', 'supabase_admin') THEN 'sql:' || session_user
      ELSE 'system'
    END;
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO plans_audit (plan_id, changed_by_email, action, after_data)
    VALUES (NEW.id, v_autor, 'CREATE', to_jsonb(NEW));
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO plans_audit (plan_id, changed_by_email, action, before_data, after_data)
    VALUES (
      NEW.id,
      v_autor,
      CASE
        WHEN OLD.activo = TRUE AND NEW.activo = FALSE THEN 'DISABLE'
        WHEN OLD.activo = FALSE AND NEW.activo = TRUE THEN 'ENABLE'
        ELSE 'UPDATE'
      END,
      to_jsonb(OLD),
      to_jsonb(NEW)
    );
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION audit_plan_changes() IS
  'Audita plans en plans_audit. Autor: app.superadmin_email, o el header x-stapp-superadmin si escribe service_role, o sql:<usuario>, o system.';
