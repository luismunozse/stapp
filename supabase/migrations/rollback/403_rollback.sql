-- Rollback de plans_audit_superadmin (403): vuelve la función de la 025. El
-- código puede quedar como está: el header de más se ignora.
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION audit_plan_changes()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO plans_audit (plan_id, changed_by_email, action, after_data)
    VALUES (
      NEW.id,
      COALESCE(current_setting('app.superadmin_email', TRUE), 'system'),
      'CREATE',
      to_jsonb(NEW)
    );
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO plans_audit (plan_id, changed_by_email, action, before_data, after_data)
    VALUES (
      NEW.id,
      COALESCE(current_setting('app.superadmin_email', TRUE), 'system'),
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
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION audit_plan_changes() IS NULL;
