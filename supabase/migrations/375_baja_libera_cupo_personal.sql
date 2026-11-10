-- Dar de baja a un vendedor o tecnico libera su cupo del plan.
--
-- Una baja (users.deleted_at) conserva la fila, porque ventas, ordenes y caja la
-- referencian. Los triggers trigger_vendedores_count / trigger_tecnicos_count solo
-- descontaban en DELETE, asi que el contador de organization_usage nunca bajaba y
-- un taller en plan Free no podia reemplazar a quien habia dado de baja.
--
-- Regla nueva: un usuario cuenta si y solo si tiene el rol y deleted_at IS NULL.
--   * INSERT: suma si cuenta (y verifica el limite del plan).
--   * DELETE: resta si contaba. Borrar una fila ya dada de baja no resta de nuevo.
--   * UPDATE: pasar de no contar a contar suma (cambio de rol hacia adentro o
--     restaurar una baja) y verifica el limite; pasar de contar a no contar resta
--     (cambio de rol hacia afuera o baja). Cualquier otro UPDATE no toca el contador.
-- activo NO interviene: desactivar a alguien no libera el cupo.
--
-- Mismas firmas, mismo LANGUAGE y sin cambios de SECURITY respecto de produccion.
-- El backfill del final recalcula ambos contadores desde users; se puede correr
-- varias veces.

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

-- Backfill: el contador pasa a ser el conteo vivo de usuarios que cuentan.
UPDATE organization_usage ou
SET vendedores_count = (
      SELECT COUNT(*) FROM users u
      WHERE u.organization_id = ou.organization_id
        AND u.rol = 'VENDEDOR' AND u.deleted_at IS NULL),
    tecnicos_count = (
      SELECT COUNT(*) FROM users u
      WHERE u.organization_id = ou.organization_id
        AND u.rol = 'TECNICO' AND u.deleted_at IS NULL);
