-- Probes de la migracion 338: guarda del ultimo ADMIN.
--
-- Correr en el SQL editor de Supabase Studio tal cual (BEGIN / ROLLBACK
-- incluidos). Requiere la 338 aplicada. Verde = esperado igual a obtenido.
--
-- NO cubre la carrera real entre dos sesiones (una sola transaccion no puede
-- probarla). Procedimiento manual en un taller de prueba con dos ADMIN A y B:
--   Sesion 1: BEGIN; SELECT solicitar_baja_usuario('<A>');   -- sin commit
--   Sesion 2: SELECT solicitar_baja_usuario('<B>');          -- debe QUEDAR ESPERANDO
--   Sesion 1: COMMIT;
--   Sesion 2: debe devolver 'LAST_ADMIN'.
BEGIN;

CREATE TEMP TABLE _r (orden INT, probe TEXT, esperado TEXT, obtenido TEXT);

DO $$
DECLARE
  v_org TEXT; v_a TEXT; v_b TEXT; v_res TEXT; v_activo BOOLEAN; v_rt TEXT;
BEGIN
  SELECT id INTO v_org FROM organizations ORDER BY created_at LIMIT 1;
  IF v_org IS NULL THEN
    INSERT INTO _r VALUES (0, 'setup', 'una org', 'SALTEADO: la base no tiene organizations');
    RETURN;
  END IF;

  BEGIN
    INSERT INTO users (email, nombre, rol, organization_id, refresh_token)
      VALUES ('probe-a-338@example.invalid', 'Probe A', 'ADMIN', v_org, 'tok-a') RETURNING id INTO v_a;
    INSERT INTO users (email, nombre, rol, organization_id)
      VALUES ('probe-b-338@example.invalid', 'Probe B', 'ADMIN', v_org) RETURNING id INTO v_b;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _r VALUES (0, 'setup', 'dos ADMIN de prueba', 'SALTEADO: ' || SQLERRM);
    RETURN;
  END;

  -- Se deja a A y B como unicos ADMIN activos: el resto de la org queda fuera del conteo.
  UPDATE users SET deleted_at = now()
   WHERE organization_id = v_org AND rol::text = 'ADMIN' AND id NOT IN (v_a, v_b) AND deleted_at IS NULL;

  v_res := solicitar_baja_usuario(v_a);
  INSERT INTO _r VALUES (1, 'A se da de baja con B presente', 'OK', v_res);

  SELECT activo, refresh_token INTO v_activo, v_rt FROM users WHERE id = v_a;
  INSERT INTO _r VALUES (2, 'A queda activo=false', 'false', v_activo::text);
  INSERT INTO _r VALUES (3, 'A pierde el refresh_token', 'null', COALESCE(v_rt, 'null'));

  v_res := solicitar_baja_usuario(v_b);
  INSERT INTO _r VALUES (4, 'B es el ultimo ADMIN', 'LAST_ADMIN', v_res);

  v_res := solicitar_baja_usuario(v_a);
  INSERT INTO _r VALUES (5, 'A repetido', 'ALREADY_DELETED', v_res);

  v_res := solicitar_baja_usuario('no-existe-338');
  INSERT INTO _r VALUES (6, 'id inexistente', 'NOT_FOUND', v_res);
END $$;

SELECT orden, probe, esperado, obtenido, (esperado = obtenido) AS ok FROM _r ORDER BY orden;

ROLLBACK;
