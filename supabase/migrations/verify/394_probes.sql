-- Verificación de superadmin_identidad_y_bloqueo (394). Correr DESPUÉS de
-- aplicarla y de marcar a los superadmins. Termina en ROLLBACK.
--
-- Qué prueba:
--   1-3  las columnas existen con el tipo y default esperados;
--   4    hay al menos un superadmin marcado (si da 0, el panel queda sin acceso);
--   5    ningún superadmin marcado pertenece a un taller distinto de 'superadmin';
--   6    el trigger deja a postgres (este editor) cambiar la marca;
--   7    el trigger rechaza el cambio hecho como service_role (el rol de la app);
--   8    acceso_bloqueado_at se puede escribir como service_role (lo usa el panel).
--
-- Resultado: UN select. Verde = esperado igual a obtenido.

BEGIN;

CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);
GRANT ALL ON _r TO service_role;

INSERT INTO _r SELECT 1, 'es_superadmin boolean not null default false', 'boolean|NO|false',
  (SELECT data_type || '|' || is_nullable || '|' || column_default
   FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'es_superadmin');
INSERT INTO _r SELECT 2, 'acceso_bloqueado_at timestamptz nullable', 'timestamp with time zone|YES',
  (SELECT data_type || '|' || is_nullable
   FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'acceso_bloqueado_at');
INSERT INTO _r SELECT 3, 'acceso_bloqueado_por text nullable', 'text|YES',
  (SELECT data_type || '|' || is_nullable
   FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'acceso_bloqueado_por');

INSERT INTO _r SELECT 4, 'superadmins marcados (>= 1)', 'true',
  ((SELECT count(*) FROM users WHERE es_superadmin) >= 1)::TEXT;
INSERT INTO _r SELECT 5, 'superadmins marcados en un taller', '0',
  (SELECT count(*)::TEXT FROM users u LEFT JOIN organizations o ON o.id = u.organization_id
   WHERE u.es_superadmin AND o.slug IS DISTINCT FROM 'superadmin' AND u.organization_id IS NOT NULL);

DO $$
DECLARE v_id TEXT;
BEGIN
  SELECT id INTO v_id FROM users WHERE NOT es_superadmin LIMIT 1;
  UPDATE users SET es_superadmin = true WHERE id = v_id;
  UPDATE users SET es_superadmin = false WHERE id = v_id;
  INSERT INTO _r VALUES (6, 'postgres cambia la marca', 'ok', 'ok');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES (6, 'postgres cambia la marca', 'ok', 'FALLO: ' || SQLERRM);
END $$;

SET LOCAL ROLE service_role;

DO $$
DECLARE v_id TEXT;
BEGIN
  SELECT id INTO v_id FROM users WHERE NOT es_superadmin LIMIT 1;
  UPDATE users SET es_superadmin = true WHERE id = v_id;
  INSERT INTO _r VALUES (7, 'service_role no puede marcar', 'error', 'FALLO: no levantó excepción');
EXCEPTION WHEN insufficient_privilege THEN
  INSERT INTO _r VALUES (7, 'service_role no puede marcar', 'error', 'error');
END $$;

DO $$
DECLARE v_id TEXT;
BEGIN
  SELECT id INTO v_id FROM users WHERE NOT es_superadmin LIMIT 1;
  UPDATE users SET acceso_bloqueado_at = now(), acceso_bloqueado_por = 'probe' WHERE id = v_id;
  INSERT INTO _r VALUES (8, 'service_role bloquea acceso', 'ok', 'ok');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES (8, 'service_role bloquea acceso', 'ok', 'FALLO: ' || SQLERRM);
END $$;

RESET ROLE;

SELECT orden, probe, esperado, obtenido FROM _r ORDER BY orden;

ROLLBACK;
