-- Verification of migration 375 (baja_libera_cupo_personal): a baja frees the plan seat.
--
-- Runs before or after 375 is applied (it re-creates the two functions inside its own transaction):  node scripts/db-run.mjs supabase/migrations/verify/375_baja_libera_cupo_personal_probe.sql
-- (no --apply: the file opens its own transaction and always ends in ROLLBACK). Any failed check
-- raises an exception and aborts the run; a clean run ends with the row 'probe 375 OK'.
-- Only data: one scratch organization (org-probe-375) with its seat counters, all rolled back.

BEGIN;

-- Cuerpos de la migracion 375 aplicados dentro de esta transaccion: el probe corre igual antes y despues de aplicarla.
CREATE OR REPLACE FUNCTION public.update_vendedores_count()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_new_count INTEGER;
  v_limit INTEGER;
  v_was BOOLEAN := FALSE;
  v_now BOOLEAN := FALSE;
BEGIN
  -- Un usuario cuenta si tiene el rol y no esta dado de baja (deleted_at IS NULL).
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    v_was := OLD.rol = 'VENDEDOR' AND OLD.deleted_at IS NULL;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_now := NEW.rol = 'VENDEDOR' AND NEW.deleted_at IS NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF v_now THEN
      INSERT INTO organization_usage (organization_id, vendedores_count)
      VALUES (NEW.organization_id, 1)
      ON CONFLICT (organization_id)
      DO UPDATE SET vendedores_count = organization_usage.vendedores_count + 1
      RETURNING vendedores_count INTO v_new_count;

      v_limit := get_plan_limit(NEW.organization_id, 'vendedores');
      IF v_limit IS NOT NULL AND v_new_count > v_limit THEN
        RAISE EXCEPTION 'PLAN_LIMIT_EXCEEDED:vendedores:%:%', v_new_count, v_limit
          USING ERRCODE = 'P0001';
      END IF;
    END IF;

  ELSIF TG_OP = 'DELETE' THEN
    -- Borrar a alguien que ya estaba dado de baja no descuenta de nuevo
    -- (la purga de una organizacion borra filas de baja).
    IF v_was THEN
      UPDATE organization_usage
      SET vendedores_count = GREATEST(0, vendedores_count - 1)
      WHERE organization_id = OLD.organization_id;
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    IF NOT v_was AND v_now THEN
      -- Entrar al rol (o volver de una baja) cuenta y, como en el alta, tiene que
      -- respetar el limite del plan: si no, cambiar de rol es la puerta de atras
      -- para saltearlo.
      -- INSERT ... ON CONFLICT y no UPDATE a secas: una organizacion puede no
      -- tener todavia su fila en organization_usage (la rama DELETE es un no-op
      -- silencioso en ese caso). Si no existe, un UPDATE pelado no contaria a
      -- este usuario nunca.
      INSERT INTO organization_usage (organization_id, vendedores_count)
      VALUES (NEW.organization_id, 1)
      ON CONFLICT (organization_id)
      DO UPDATE SET vendedores_count = organization_usage.vendedores_count + 1
      RETURNING vendedores_count INTO v_new_count;

      v_limit := get_plan_limit(NEW.organization_id, 'vendedores');
      IF v_limit IS NOT NULL AND v_new_count > v_limit THEN
        RAISE EXCEPTION 'PLAN_LIMIT_EXCEEDED:vendedores:%:%', v_new_count, v_limit
          USING ERRCODE = 'P0001';
      END IF;

    ELSIF v_was AND NOT v_now THEN
      -- Salir del rol o darlo de baja libera el cupo.
      UPDATE organization_usage
      SET vendedores_count = GREATEST(0, vendedores_count - 1)
      WHERE organization_id = OLD.organization_id;
    END IF;
    -- Cualquier otro UPDATE (p. ej. anonimizar una fila ya dada de baja) no cuenta.
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_tecnicos_count()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_new_count INTEGER;
  v_limit INTEGER;
  v_was BOOLEAN := FALSE;
  v_now BOOLEAN := FALSE;
BEGIN
  -- Un usuario cuenta si tiene el rol y no esta dado de baja (deleted_at IS NULL).
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    v_was := OLD.rol = 'TECNICO' AND OLD.deleted_at IS NULL;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_now := NEW.rol = 'TECNICO' AND NEW.deleted_at IS NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF v_now THEN
      INSERT INTO organization_usage (organization_id, tecnicos_count)
      VALUES (NEW.organization_id, 1)
      ON CONFLICT (organization_id)
      DO UPDATE SET tecnicos_count = organization_usage.tecnicos_count + 1
      RETURNING tecnicos_count INTO v_new_count;

      v_limit := get_plan_limit(NEW.organization_id, 'tecnicos');
      IF v_limit IS NOT NULL AND v_new_count > v_limit THEN
        RAISE EXCEPTION 'PLAN_LIMIT_EXCEEDED:tecnicos:%:%', v_new_count, v_limit
          USING ERRCODE = 'P0001';
      END IF;
    END IF;

  ELSIF TG_OP = 'DELETE' THEN
    -- Borrar a alguien que ya estaba dado de baja no descuenta de nuevo
    -- (la purga de una organizacion borra filas de baja).
    IF v_was THEN
      UPDATE organization_usage
      SET tecnicos_count = GREATEST(0, tecnicos_count - 1)
      WHERE organization_id = OLD.organization_id;
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    IF NOT v_was AND v_now THEN
      -- Entrar al rol (o volver de una baja) cuenta y, como en el alta, tiene que
      -- respetar el limite del plan: si no, cambiar de rol es la puerta de atras
      -- para saltearlo.
      -- INSERT ... ON CONFLICT y no UPDATE a secas: una organizacion puede no
      -- tener todavia su fila en organization_usage (la rama DELETE es un no-op
      -- silencioso en ese caso). Si no existe, un UPDATE pelado no contaria a
      -- este usuario nunca.
      INSERT INTO organization_usage (organization_id, tecnicos_count)
      VALUES (NEW.organization_id, 1)
      ON CONFLICT (organization_id)
      DO UPDATE SET tecnicos_count = organization_usage.tecnicos_count + 1
      RETURNING tecnicos_count INTO v_new_count;

      v_limit := get_plan_limit(NEW.organization_id, 'tecnicos');
      IF v_limit IS NOT NULL AND v_new_count > v_limit THEN
        RAISE EXCEPTION 'PLAN_LIMIT_EXCEEDED:tecnicos:%:%', v_new_count, v_limit
          USING ERRCODE = 'P0001';
      END IF;

    ELSIF v_was AND NOT v_now THEN
      -- Salir del rol o darlo de baja libera el cupo.
      UPDATE organization_usage
      SET tecnicos_count = GREATEST(0, tecnicos_count - 1)
      WHERE organization_id = OLD.organization_id;
    END IF;
    -- Cualquier otro UPDATE (p. ej. anonimizar una fila ya dada de baja) no cuenta.
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

INSERT INTO organizations (id, nombre, nombre_mostrar, slug)
VALUES ('org-probe-375', 'Probe 375', 'Probe 375', 'probe-375-' || substr(md5(random()::text), 1, 8));

-- Sin suscripcion activa: get_plan_limit cae al fallback Free.
DELETE FROM subscriptions WHERE organization_id = 'org-probe-375';
INSERT INTO organization_usage (organization_id) VALUES ('org-probe-375') ON CONFLICT (organization_id) DO NOTHING;
UPDATE organization_usage SET vendedores_count = 0, tecnicos_count = 0 WHERE organization_id = 'org-probe-375';

-- ---- vendedores ----
DO $$
DECLARE
  v_lim INTEGER;
  v_n INTEGER;
  v_code TEXT;
  v_id TEXT := 'usr-probe-375-v1';
  v_id2 TEXT := 'usr-probe-375-v2';
BEGIN
  v_lim := get_plan_limit('org-probe-375', 'vendedores');
  IF v_lim IS NULL OR v_lim < 1 THEN RAISE EXCEPTION 'vendedores: limite % inesperado para el probe', v_lim; END IF;

  SELECT vendedores_count INTO v_n FROM organization_usage WHERE organization_id = 'org-probe-375';
  IF COALESCE(v_n, 0) <> 0 THEN RAISE EXCEPTION 'vendedores: contador inicial % (esperado 0)', v_n; END IF;

  -- INSERT suma
  INSERT INTO users (id, organization_id, sucursal_id, email, nombre, password, rol)
  VALUES (v_id, 'org-probe-375', (SELECT id FROM sucursales WHERE organization_id = 'org-probe-375' AND principal), 'v1@probe-375.invalid', 'Probe', 'x', 'VENDEDOR');
  SELECT vendedores_count INTO v_n FROM organization_usage WHERE organization_id = 'org-probe-375';
  IF v_n <> 1 THEN RAISE EXCEPTION 'vendedores: tras insert esperado 1, obtenido %', v_n; END IF;

  -- baja resta
  UPDATE users SET deleted_at = now(), activo = false WHERE id = v_id;
  SELECT vendedores_count INTO v_n FROM organization_usage WHERE organization_id = 'org-probe-375';
  IF v_n <> 0 THEN RAISE EXCEPTION 'vendedores: tras baja esperado 0, obtenido %', v_n; END IF;

  -- anonimizar una fila ya dada de baja no toca el contador
  UPDATE users SET nombre = 'anon' WHERE id = v_id;
  SELECT vendedores_count INTO v_n FROM organization_usage WHERE organization_id = 'org-probe-375';
  IF v_n <> 0 THEN RAISE EXCEPTION 'vendedores: anonimizar una baja cambio el contador (%)', v_n; END IF;

  -- cambio de rol de un usuario dado de baja no toca el contador
  UPDATE users SET rol = 'ADMIN' WHERE id = v_id;
  UPDATE users SET rol = 'VENDEDOR' WHERE id = v_id;
  SELECT vendedores_count INTO v_n FROM organization_usage WHERE organization_id = 'org-probe-375';
  IF v_n <> 0 THEN RAISE EXCEPTION 'vendedores: cambio de rol de una baja cambio el contador (%)', v_n; END IF;

  -- restaurar suma
  UPDATE users SET deleted_at = NULL, activo = true WHERE id = v_id;
  SELECT vendedores_count INTO v_n FROM organization_usage WHERE organization_id = 'org-probe-375';
  IF v_n <> 1 THEN RAISE EXCEPTION 'vendedores: tras restaurar esperado 1, obtenido %', v_n; END IF;

  -- baja de nuevo y DELETE duro de una baja: sin cambio
  UPDATE users SET deleted_at = now() WHERE id = v_id;
  DELETE FROM users WHERE id = v_id;
  SELECT vendedores_count INTO v_n FROM organization_usage WHERE organization_id = 'org-probe-375';
  IF v_n <> 0 THEN RAISE EXCEPTION 'vendedores: DELETE de una baja cambio el contador (%)', v_n; END IF;

  -- DELETE de un usuario vivo resta
  INSERT INTO users (id, organization_id, sucursal_id, email, nombre, password, rol)
  VALUES (v_id, 'org-probe-375', (SELECT id FROM sucursales WHERE organization_id = 'org-probe-375' AND principal), 'v1@probe-375.invalid', 'Probe', 'x', 'VENDEDOR');
  DELETE FROM users WHERE id = v_id;
  SELECT vendedores_count INTO v_n FROM organization_usage WHERE organization_id = 'org-probe-375';
  IF v_n <> 0 THEN RAISE EXCEPTION 'vendedores: DELETE de un usuario vivo, esperado 0, obtenido %', v_n; END IF;

  -- el limite se sigue haciendo cumplir en el alta
  FOR i IN 1..v_lim LOOP
    INSERT INTO users (id, organization_id, sucursal_id, email, nombre, password, rol)
    VALUES ('usr-probe-375-vf' || i, 'org-probe-375', (SELECT id FROM sucursales WHERE organization_id = 'org-probe-375' AND principal), 'vf' || i || '@probe-375.invalid', 'Probe', 'x', 'VENDEDOR');
  END LOOP;
  BEGIN
    INSERT INTO users (id, organization_id, sucursal_id, email, nombre, password, rol)
    VALUES (v_id2, 'org-probe-375', (SELECT id FROM sucursales WHERE organization_id = 'org-probe-375' AND principal), 'v2@probe-375.invalid', 'Probe', 'x', 'VENDEDOR');
    RAISE EXCEPTION 'NOT_REJECTED';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS v_code = MESSAGE_TEXT;
    IF v_code = 'NOT_REJECTED' OR v_code NOT LIKE 'PLAN_LIMIT_EXCEEDED:vendedores:%' THEN
      RAISE EXCEPTION 'vendedores: el alta por encima del limite % no fue rechazada (%)', v_lim, v_code;
    END IF;
  END;

  -- dar de baja a uno libera el cupo y permite el reemplazo
  UPDATE users SET deleted_at = now() WHERE id = 'usr-probe-375-vf1';
  INSERT INTO users (id, organization_id, sucursal_id, email, nombre, password, rol)
  VALUES (v_id2, 'org-probe-375', (SELECT id FROM sucursales WHERE organization_id = 'org-probe-375' AND principal), 'v2@probe-375.invalid', 'Probe', 'x', 'VENDEDOR');

  -- restaurar al dado de baja ahora excede el limite y se rechaza
  BEGIN
    UPDATE users SET deleted_at = NULL WHERE id = 'usr-probe-375-vf1';
    RAISE EXCEPTION 'NOT_REJECTED';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS v_code = MESSAGE_TEXT;
    IF v_code = 'NOT_REJECTED' OR v_code NOT LIKE 'PLAN_LIMIT_EXCEEDED:vendedores:%' THEN
      RAISE EXCEPTION 'vendedores: restaurar por encima del limite no fue rechazado (%)', v_code;
    END IF;
  END;

  -- limpiar para el siguiente bloque
  DELETE FROM users WHERE organization_id = 'org-probe-375' AND rol = 'VENDEDOR';
  SELECT vendedores_count INTO v_n FROM organization_usage WHERE organization_id = 'org-probe-375';
  IF v_n <> 0 THEN RAISE EXCEPTION 'vendedores: tras limpiar esperado 0, obtenido %', v_n; END IF;
  RAISE NOTICE 'OK vendedores';
END $$;

-- ---- tecnicos ----
DO $$
DECLARE
  v_lim INTEGER;
  v_n INTEGER;
  v_code TEXT;
  v_id TEXT := 'usr-probe-375-t1';
  v_id2 TEXT := 'usr-probe-375-t2';
BEGIN
  v_lim := get_plan_limit('org-probe-375', 'tecnicos');
  IF v_lim IS NULL OR v_lim < 1 THEN RAISE EXCEPTION 'tecnicos: limite % inesperado para el probe', v_lim; END IF;

  SELECT tecnicos_count INTO v_n FROM organization_usage WHERE organization_id = 'org-probe-375';
  IF COALESCE(v_n, 0) <> 0 THEN RAISE EXCEPTION 'tecnicos: contador inicial % (esperado 0)', v_n; END IF;

  -- INSERT suma
  INSERT INTO users (id, organization_id, sucursal_id, email, nombre, password, rol)
  VALUES (v_id, 'org-probe-375', (SELECT id FROM sucursales WHERE organization_id = 'org-probe-375' AND principal), 't1@probe-375.invalid', 'Probe', 'x', 'TECNICO');
  SELECT tecnicos_count INTO v_n FROM organization_usage WHERE organization_id = 'org-probe-375';
  IF v_n <> 1 THEN RAISE EXCEPTION 'tecnicos: tras insert esperado 1, obtenido %', v_n; END IF;

  -- baja resta
  UPDATE users SET deleted_at = now(), activo = false WHERE id = v_id;
  SELECT tecnicos_count INTO v_n FROM organization_usage WHERE organization_id = 'org-probe-375';
  IF v_n <> 0 THEN RAISE EXCEPTION 'tecnicos: tras baja esperado 0, obtenido %', v_n; END IF;

  -- anonimizar una fila ya dada de baja no toca el contador
  UPDATE users SET nombre = 'anon' WHERE id = v_id;
  SELECT tecnicos_count INTO v_n FROM organization_usage WHERE organization_id = 'org-probe-375';
  IF v_n <> 0 THEN RAISE EXCEPTION 'tecnicos: anonimizar una baja cambio el contador (%)', v_n; END IF;

  -- cambio de rol de un usuario dado de baja no toca el contador
  UPDATE users SET rol = 'ADMIN' WHERE id = v_id;
  UPDATE users SET rol = 'TECNICO' WHERE id = v_id;
  SELECT tecnicos_count INTO v_n FROM organization_usage WHERE organization_id = 'org-probe-375';
  IF v_n <> 0 THEN RAISE EXCEPTION 'tecnicos: cambio de rol de una baja cambio el contador (%)', v_n; END IF;

  -- restaurar suma
  UPDATE users SET deleted_at = NULL, activo = true WHERE id = v_id;
  SELECT tecnicos_count INTO v_n FROM organization_usage WHERE organization_id = 'org-probe-375';
  IF v_n <> 1 THEN RAISE EXCEPTION 'tecnicos: tras restaurar esperado 1, obtenido %', v_n; END IF;

  -- baja de nuevo y DELETE duro de una baja: sin cambio
  UPDATE users SET deleted_at = now() WHERE id = v_id;
  DELETE FROM users WHERE id = v_id;
  SELECT tecnicos_count INTO v_n FROM organization_usage WHERE organization_id = 'org-probe-375';
  IF v_n <> 0 THEN RAISE EXCEPTION 'tecnicos: DELETE de una baja cambio el contador (%)', v_n; END IF;

  -- DELETE de un usuario vivo resta
  INSERT INTO users (id, organization_id, sucursal_id, email, nombre, password, rol)
  VALUES (v_id, 'org-probe-375', (SELECT id FROM sucursales WHERE organization_id = 'org-probe-375' AND principal), 't1@probe-375.invalid', 'Probe', 'x', 'TECNICO');
  DELETE FROM users WHERE id = v_id;
  SELECT tecnicos_count INTO v_n FROM organization_usage WHERE organization_id = 'org-probe-375';
  IF v_n <> 0 THEN RAISE EXCEPTION 'tecnicos: DELETE de un usuario vivo, esperado 0, obtenido %', v_n; END IF;

  -- el limite se sigue haciendo cumplir en el alta
  FOR i IN 1..v_lim LOOP
    INSERT INTO users (id, organization_id, sucursal_id, email, nombre, password, rol)
    VALUES ('usr-probe-375-tf' || i, 'org-probe-375', (SELECT id FROM sucursales WHERE organization_id = 'org-probe-375' AND principal), 'tf' || i || '@probe-375.invalid', 'Probe', 'x', 'TECNICO');
  END LOOP;
  BEGIN
    INSERT INTO users (id, organization_id, sucursal_id, email, nombre, password, rol)
    VALUES (v_id2, 'org-probe-375', (SELECT id FROM sucursales WHERE organization_id = 'org-probe-375' AND principal), 't2@probe-375.invalid', 'Probe', 'x', 'TECNICO');
    RAISE EXCEPTION 'NOT_REJECTED';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS v_code = MESSAGE_TEXT;
    IF v_code = 'NOT_REJECTED' OR v_code NOT LIKE 'PLAN_LIMIT_EXCEEDED:tecnicos:%' THEN
      RAISE EXCEPTION 'tecnicos: el alta por encima del limite % no fue rechazada (%)', v_lim, v_code;
    END IF;
  END;

  -- dar de baja a uno libera el cupo y permite el reemplazo
  UPDATE users SET deleted_at = now() WHERE id = 'usr-probe-375-tf1';
  INSERT INTO users (id, organization_id, sucursal_id, email, nombre, password, rol)
  VALUES (v_id2, 'org-probe-375', (SELECT id FROM sucursales WHERE organization_id = 'org-probe-375' AND principal), 't2@probe-375.invalid', 'Probe', 'x', 'TECNICO');

  -- restaurar al dado de baja ahora excede el limite y se rechaza
  BEGIN
    UPDATE users SET deleted_at = NULL WHERE id = 'usr-probe-375-tf1';
    RAISE EXCEPTION 'NOT_REJECTED';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS v_code = MESSAGE_TEXT;
    IF v_code = 'NOT_REJECTED' OR v_code NOT LIKE 'PLAN_LIMIT_EXCEEDED:tecnicos:%' THEN
      RAISE EXCEPTION 'tecnicos: restaurar por encima del limite no fue rechazado (%)', v_code;
    END IF;
  END;

  -- limpiar para el siguiente bloque
  DELETE FROM users WHERE organization_id = 'org-probe-375' AND rol = 'TECNICO';
  SELECT tecnicos_count INTO v_n FROM organization_usage WHERE organization_id = 'org-probe-375';
  IF v_n <> 0 THEN RAISE EXCEPTION 'tecnicos: tras limpiar esperado 0, obtenido %', v_n; END IF;
  RAISE NOTICE 'OK tecnicos';
END $$;

SELECT 'probe 375 OK' AS resultado;

ROLLBACK;
