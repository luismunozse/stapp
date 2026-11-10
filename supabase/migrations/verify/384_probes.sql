-- Probes de 384 (cerrar tablas y funciones accesibles con la anon key).
-- Solo lectura. Correr en el SQL editor de Studio después de aplicar 384.
-- Todas las filas deben salir con ok = true.

BEGIN;

CREATE TEMP TABLE _probe (probe TEXT, ok BOOLEAN, detalle TEXT) ON COMMIT DROP;

WITH t(nombre) AS (VALUES
  ('sucursales'), ('sucursal_whatsapp_config'), ('asistente_conversaciones'),
  ('asistente_mensajes'), ('foto_borrador'), ('foto_borrador_item'),
  ('support_tickets'), ('support_ticket_messages'), ('support_ticket_attachments'),
  ('push_tokens'), ('broadcasts'), ('plans_audit'),
  ('chatbot_conversaciones'), ('chatbot_mensajes'),
  ('tipos_dispositivo'), ('notas_credito_counter'), ('audit_alert_config')
), existentes AS (
  SELECT nombre, to_regclass('public.' || nombre) AS rel FROM t
)
INSERT INTO _probe
SELECT 'RLS + sin privilegios anon/authenticated: ' || nombre,
       c.relrowsecurity
         AND NOT has_table_privilege('anon', rel, 'SELECT,INSERT,UPDATE,DELETE')
         AND NOT has_table_privilege('authenticated', rel, 'SELECT,INSERT,UPDATE,DELETE')
         AND NOT EXISTS (SELECT 1 FROM pg_policies p
                         WHERE p.schemaname = 'public' AND p.tablename = nombre
                           AND p.roles && ARRAY['public','anon','authenticated']::name[]),
       CASE WHEN rel IS NULL THEN 'la tabla no existe (se omitió)' END
FROM existentes e
LEFT JOIN pg_class c ON c.oid = e.rel
WHERE rel IS NOT NULL;

INSERT INTO _probe
SELECT 'anon no ejecuta ' || f,
       NOT has_function_privilege('anon', to_regprocedure(f), 'EXECUTE'),
       NULL
FROM unnest(ARRAY[
  'public.audit_log_stats(timestamptz, timestamptz, timestamptz)',
  'public.cleanup_old_notifications()',
  'public.reset_ordenes_mes_if_needed(text)'
]) AS f
WHERE to_regprocedure(f) IS NOT NULL;

INSERT INTO _probe
SELECT 'search_path fijo en ' || f,
       EXISTS (SELECT 1 FROM pg_proc p, unnest(coalesce(p.proconfig, '{}')) c
               WHERE p.oid = to_regprocedure(f) AND c LIKE 'search_path=%'),
       NULL
FROM unnest(ARRAY[
  'public.audit_log_stats(timestamptz, timestamptz, timestamptz)',
  'public.cleanup_old_notifications()',
  'public.reset_ordenes_mes_if_needed(text)'
]) AS f
WHERE to_regprocedure(f) IS NOT NULL;

SELECT * FROM _probe ORDER BY ok, probe;

ROLLBACK;
