-- ========================================
-- AGREGAR CONTADOR DE VENDEDORES
-- ========================================

-- Agregar columna vendedores_count a organization_usage
ALTER TABLE organization_usage
ADD COLUMN IF NOT EXISTS vendedores_count INTEGER DEFAULT 0;

-- ========================================
-- TRIGGER: Contador de vendedores
-- ========================================

CREATE OR REPLACE FUNCTION update_vendedores_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.rol = 'VENDEDOR' THEN
    INSERT INTO organization_usage (organization_id, vendedores_count)
    VALUES (NEW.organization_id, 1)
    ON CONFLICT (organization_id)
    DO UPDATE SET vendedores_count = organization_usage.vendedores_count + 1;
  ELSIF TG_OP = 'DELETE' AND OLD.rol = 'VENDEDOR' THEN
    UPDATE organization_usage
    SET vendedores_count = GREATEST(0, vendedores_count - 1)
    WHERE organization_id = OLD.organization_id;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Si cambió de otro rol a VENDEDOR
    IF OLD.rol != 'VENDEDOR' AND NEW.rol = 'VENDEDOR' THEN
      UPDATE organization_usage
      SET vendedores_count = vendedores_count + 1
      WHERE organization_id = NEW.organization_id;
    -- Si cambió de VENDEDOR a otro rol
    ELSIF OLD.rol = 'VENDEDOR' AND NEW.rol != 'VENDEDOR' THEN
      UPDATE organization_usage
      SET vendedores_count = GREATEST(0, vendedores_count - 1)
      WHERE organization_id = OLD.organization_id;
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Eliminar trigger anterior si existe
DROP TRIGGER IF EXISTS trigger_vendedores_count ON users;

-- Crear trigger para INSERT, UPDATE y DELETE
CREATE TRIGGER trigger_vendedores_count
  AFTER INSERT OR UPDATE OR DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION update_vendedores_count();

-- ========================================
-- ACTUALIZAR check_plan_limit para vendedores
-- ========================================

CREATE OR REPLACE FUNCTION check_plan_limit(
  org_id TEXT,
  limit_type TEXT -- 'ordenes', 'tecnicos', 'clientes', 'vendedores'
)
RETURNS BOOLEAN AS $$
DECLARE
  plan_limit INTEGER;
  current_usage INTEGER;
BEGIN
  -- Obtener el límite del plan actual
  SELECT
    CASE limit_type
      WHEN 'ordenes' THEN p.limite_ordenes
      WHEN 'tecnicos' THEN p.limite_tecnicos
      WHEN 'clientes' THEN p.limite_clientes
      WHEN 'vendedores' THEN p.limite_tecnicos -- Vendedores usa el mismo límite que técnicos
    END
  INTO plan_limit
  FROM subscriptions s
  JOIN plans p ON s.plan_id = p.id
  WHERE s.organization_id = org_id
    AND s.status IN ('ACTIVE', 'TRIALING');

  -- Si no hay límite (NULL), permitir
  IF plan_limit IS NULL THEN
    RETURN TRUE;
  END IF;

  -- Obtener uso actual
  SELECT
    CASE limit_type
      WHEN 'ordenes' THEN ordenes_mes_actual
      WHEN 'tecnicos' THEN tecnicos_count
      WHEN 'clientes' THEN clientes_count
      WHEN 'vendedores' THEN vendedores_count
    END
  INTO current_usage
  FROM organization_usage
  WHERE organization_id = org_id;

  -- Si no hay registro de uso, crear uno
  IF current_usage IS NULL THEN
    current_usage := 0;
  END IF;

  RETURN current_usage < plan_limit;
END;
$$ LANGUAGE plpgsql;

-- ========================================
-- INICIALIZAR contadores existentes
-- ========================================

-- Actualizar vendedores_count para organizaciones existentes
UPDATE organization_usage ou
SET vendedores_count = (
  SELECT COUNT(*)
  FROM users u
  WHERE u.organization_id = ou.organization_id
    AND u.rol = 'VENDEDOR'
);
