-- Rollback de la migracion 323.
--
-- Devuelve `update_tecnicos_count()` y su trigger al estado de la 006: sin
-- rama UPDATE y registrado solo AFTER INSERT OR DELETE.
--
-- Lo que se recupera al revertir: nada. Esta migracion no agrega columnas ni
-- datos, corrige un trigger que estaba ciego a la mitad de los casos. Volver
-- atras reintroduce el bug a proposito.
--
-- Lo que NO deshace: los contadores que el trigger arreglado haya corregido
-- mientras estuvo aplicado quedan como esten. Son el numero correcto; el
-- rollback no tiene por que ensuciarlos de nuevo.
--
-- El unico motivo real para correr esto seria que la rama UPDATE este
-- rompiendo escrituras sobre `users` en produccion — por ejemplo, si un
-- taller quedo con mas tecnicos que su limite y ahora cualquier UPDATE de
-- una fila de usuario que entre al rol levanta PLAN_LIMIT_EXCEEDED. Ojo:
-- en ese caso el arreglo correcto casi seguro es el plan del taller o el
-- contador, no volver a cegar el trigger.

CREATE OR REPLACE FUNCTION update_tecnicos_count()
RETURNS TRIGGER AS $$
DECLARE
  v_new_count INTEGER;
  v_limit INTEGER;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.rol = 'TECNICO' THEN
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
  ELSIF TG_OP = 'DELETE' AND OLD.rol = 'TECNICO' THEN
    UPDATE organization_usage
    SET tecnicos_count = GREATEST(0, tecnicos_count - 1)
    WHERE organization_id = OLD.organization_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_tecnicos_count ON users;

CREATE TRIGGER trigger_tecnicos_count
  AFTER INSERT OR DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION update_tecnicos_count();
