-- Verificación de refresh_tokens_por_sesion (migración 391).
--
-- Correr DESPUÉS de aplicar la 391:  node scripts/db-run.mjs supabase/migrations/verify/391_probes.sql
-- (sin --apply: el archivo abre su propia transacción y termina en ROLLBACK).
--
-- Sin RLS, como dice verify/README.md. Crea una organización y un usuario de
-- prueba (org-probe-391), todo revertido al final.
--
-- Qué prueba:
--   1    la tabla existe con RLS encendido;
--   2    anon y authenticated no tienen ningún privilegio sobre ella;
--   3    se guardan dos sesiones del mismo usuario;
--   4    el mismo hash no se puede guardar dos veces;
--   5    un valor que no es un SHA-256 en hex (p. ej. un token en claro) se rechaza;
--   6    borrar el usuario borra sus sesiones.
--
-- Resultado: UN select. Verde = esperado igual a obtenido.

BEGIN;

CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);

CREATE PROCEDURE pg_temp.probe(p_orden INT, p_probe TEXT, p_esperado TEXT, p_sql TEXT)
LANGUAGE plpgsql AS $$
DECLARE v_got TEXT := 'ok'; v_cn TEXT; v_msg TEXT;
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_cn = CONSTRAINT_NAME, v_msg = MESSAGE_TEXT;
    v_got := SQLSTATE || ' ' || COALESCE(NULLIF(v_cn, ''), v_msg);
  END;
  INSERT INTO _r VALUES (p_orden, p_probe, p_esperado, v_got);
END $$;

INSERT INTO _r
SELECT 1, 'tabla con RLS', 'true', COALESCE((SELECT relrowsecurity::text FROM pg_class
  WHERE oid = to_regclass('public.refresh_tokens')), 'sin tabla');

INSERT INTO _r
SELECT 2, 'privilegios de anon/authenticated', '0', count(*)::text
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'refresh_tokens'
  AND grantee IN ('anon', 'authenticated');

INSERT INTO organizations (id, nombre, nombre_mostrar, slug)
VALUES ('org-probe-391', 'Probe 391', 'Probe 391', 'probe-391-' || substr(md5(random()::text), 1, 8));

INSERT INTO users (id, organization_id, sucursal_id, email, nombre, password, rol)
VALUES ('usr-probe-391', 'org-probe-391',
        (SELECT id FROM sucursales WHERE organization_id = 'org-probe-391' AND principal),
        'admin@probe-391.invalid', 'Probe 391', 'x', 'ADMIN');

CALL pg_temp.probe(3, 'dos sesiones del mismo usuario', 'ok',
  $q$INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES
       ('usr-probe-391', repeat('a', 64), now() + interval '7 days'),
       ('usr-probe-391', repeat('b', 64), now() + interval '7 days')$q$);
CALL pg_temp.probe(4, 'hash repetido', '23505 refresh_tokens_token_hash_unico',
  $q$INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ('usr-probe-391', repeat('a', 64), now() + interval '7 days')$q$);
CALL pg_temp.probe(5, 'valor que no es un hash', '23514 refresh_tokens_token_hash_formato',
  $q$INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ('usr-probe-391', repeat('c', 128), now() + interval '7 days')$q$);

CALL pg_temp.probe(6, 'borrar el usuario de prueba', 'ok',
  $q$DELETE FROM users WHERE id = 'usr-probe-391'$q$);
INSERT INTO _r
SELECT 6, 'borrar el usuario borra sus sesiones', '0', count(*)::text
FROM refresh_tokens WHERE user_id = 'usr-probe-391';

SELECT orden, probe, esperado, obtenido FROM _r ORDER BY orden, probe;

ROLLBACK;
