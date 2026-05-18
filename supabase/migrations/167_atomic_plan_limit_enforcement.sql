-- Enforce atomico de limites de plan via triggers.
--
-- Motivacion: el pre-check TS en enforcePlanLimit() lee el contador, compara
-- contra el limite y luego inserta. Sin lock, dos requests concurrentes pueden
-- leer current=14, ambos pasar 14 < 15 y ambos insertar, llegando a 16.
--
-- Fix: el trigger AFTER INSERT incrementa el contador via ON CONFLICT UPDATE
-- (que adquiere row lock implicito sobre organization_usage), y RAISE EXCEPTION
-- si el nuevo valor excede el limite del plan. El RAISE rollbackea la
-- transaccion completa (incluyendo el INSERT en la tabla origen). Los inserts
-- concurrentes se serializan por el row lock de organization_usage, asi que
-- solo el primer overshoot raisea y los demas tambien al ver contador ya alto.
--
-- El TS pre-check sigue como fast-path: rechaza temprano sin tocar DB de
-- origen. El trigger es defensa atomica para race conditions.

-- ============================================================================
-- HELPER: get_plan_limit(org_id, limit_type)
-- ============================================================================
-- Retorna el limite efectivo para una org+tipo. NULL = ilimitado (Profesional).
-- Si no hay suscripcion activa, devuelve fallback Free.
CREATE OR REPLACE FUNCTION get_plan_limit(org_id TEXT, limit_type TEXT)
RETURNS INTEGER AS $$
DECLARE
  v_limit INTEGER;
  v_found BOOLEAN := FALSE;
BEGIN
  SELECT
    CASE limit_type
      WHEN 'ordenes'    THEN p.limite_ordenes
      WHEN 'tecnicos'   THEN p.limite_tecnicos
      WHEN 'vendedores' THEN p.limite_vendedores
      WHEN 'clientes'   THEN p.limite_clientes
      WHEN 'storage'    THEN p.limite_storage_mb
    END
  INTO v_limit
  FROM subscriptions s
  JOIN plans p ON s.plan_id = p.id
  WHERE s.organization_id = org_id
    AND s.status IN ('ACTIVE', 'TRIALING')
  LIMIT 1;

  GET DIAGNOSTICS v_found = ROW_COUNT;

  IF NOT v_found THEN
    -- Fallback Free para orgs sin suscripcion activa
    RETURN CASE limit_type
      WHEN 'ordenes'    THEN 15
      WHEN 'tecnicos'   THEN 1
      WHEN 'vendedores' THEN 1
      WHEN 'clientes'   THEN 30
      WHEN 'storage'    THEN 100
    END;
  END IF;

  RETURN v_limit;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_plan_limit(TEXT, TEXT) IS
'Retorna el limite numerico del plan activo para un tipo dado. NULL = ilimitado. Fallback Free si no hay suscripcion activa.';


-- ============================================================================
-- ORDENES: increment + check atomico
-- ============================================================================
CREATE OR REPLACE FUNCTION update_ordenes_count()
RETURNS TRIGGER AS $$
DECLARE
  v_new_count INTEGER;
  v_limit INTEGER;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO organization_usage (organization_id, ordenes_count, ordenes_mes_actual, periodo_inicio)
    VALUES (NEW.organization_id, 1, 1, DATE_TRUNC('month', NOW()))
    ON CONFLICT (organization_id)
    DO UPDATE SET
      ordenes_count = organization_usage.ordenes_count + 1,
      ordenes_mes_actual = CASE
        WHEN organization_usage.periodo_inicio < DATE_TRUNC('month', NOW())
        THEN 1
        ELSE organization_usage.ordenes_mes_actual + 1
      END,
      periodo_inicio = CASE
        WHEN organization_usage.periodo_inicio < DATE_TRUNC('month', NOW())
        THEN DATE_TRUNC('month', NOW())
        ELSE organization_usage.periodo_inicio
      END
    RETURNING ordenes_mes_actual INTO v_new_count;

    v_limit := get_plan_limit(NEW.organization_id, 'ordenes');

    IF v_limit IS NOT NULL AND v_new_count > v_limit THEN
      RAISE EXCEPTION 'PLAN_LIMIT_EXCEEDED:ordenes:%:%', v_new_count, v_limit
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- CLIENTES: increment + check atomico (DELETE permanece sin check)
-- ============================================================================
CREATE OR REPLACE FUNCTION update_clientes_count()
RETURNS TRIGGER AS $$
DECLARE
  v_new_count INTEGER;
  v_limit INTEGER;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO organization_usage (organization_id, clientes_count)
    VALUES (NEW.organization_id, 1)
    ON CONFLICT (organization_id)
    DO UPDATE SET clientes_count = organization_usage.clientes_count + 1
    RETURNING clientes_count INTO v_new_count;

    v_limit := get_plan_limit(NEW.organization_id, 'clientes');
    IF v_limit IS NOT NULL AND v_new_count > v_limit THEN
      RAISE EXCEPTION 'PLAN_LIMIT_EXCEEDED:clientes:%:%', v_new_count, v_limit
        USING ERRCODE = 'P0001';
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE organization_usage
    SET clientes_count = GREATEST(0, clientes_count - 1)
    WHERE organization_id = OLD.organization_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- TECNICOS: increment + check atomico
-- ============================================================================
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


-- ============================================================================
-- VENDEDORES: increment + check atomico (INSERT y UPDATE rol→VENDEDOR)
-- ============================================================================
CREATE OR REPLACE FUNCTION update_vendedores_count()
RETURNS TRIGGER AS $$
DECLARE
  v_new_count INTEGER;
  v_limit INTEGER;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.rol = 'VENDEDOR' THEN
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
  ELSIF TG_OP = 'DELETE' AND OLD.rol = 'VENDEDOR' THEN
    UPDATE organization_usage
    SET vendedores_count = GREATEST(0, vendedores_count - 1)
    WHERE organization_id = OLD.organization_id;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.rol != 'VENDEDOR' AND NEW.rol = 'VENDEDOR' THEN
      UPDATE organization_usage
      SET vendedores_count = vendedores_count + 1
      WHERE organization_id = NEW.organization_id
      RETURNING vendedores_count INTO v_new_count;

      v_limit := get_plan_limit(NEW.organization_id, 'vendedores');
      IF v_limit IS NOT NULL AND v_new_count > v_limit THEN
        RAISE EXCEPTION 'PLAN_LIMIT_EXCEEDED:vendedores:%:%', v_new_count, v_limit
          USING ERRCODE = 'P0001';
      END IF;
    ELSIF OLD.rol = 'VENDEDOR' AND NEW.rol != 'VENDEDOR' THEN
      UPDATE organization_usage
      SET vendedores_count = GREATEST(0, vendedores_count - 1)
      WHERE organization_id = OLD.organization_id;
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- STORAGE: increment + check atomico (decrements siempre permitidos)
-- ============================================================================
CREATE OR REPLACE FUNCTION update_storage_usage(
  org_id TEXT,
  mb_added DECIMAL
)
RETURNS VOID AS $$
DECLARE
  v_new_mb DECIMAL;
  v_limit INTEGER;
BEGIN
  UPDATE organization_usage
  SET storage_used_mb = GREATEST(0, COALESCE(storage_used_mb, 0) + mb_added)
  WHERE organization_id = org_id
  RETURNING storage_used_mb INTO v_new_mb;

  -- Solo enforzar en increments. Borrar archivos no requiere chequeo.
  IF mb_added > 0 THEN
    v_limit := get_plan_limit(org_id, 'storage');
    IF v_limit IS NOT NULL AND v_new_mb > v_limit THEN
      RAISE EXCEPTION 'PLAN_LIMIT_EXCEEDED:storage:%:%', CEIL(v_new_mb)::INTEGER, v_limit
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql;
