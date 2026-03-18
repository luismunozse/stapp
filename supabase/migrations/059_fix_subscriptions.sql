-- ========================================
-- FIX: Sistema de suscripciones (Parte 1)
-- Schema changes + enum (sin usar el nuevo valor)
-- ========================================

-- 1. AGREGAR LEMONSQUEEZY AL ENUM (se commitea aquí, se usa en migración 060)
ALTER TYPE payment_provider ADD VALUE IF NOT EXISTS 'LEMONSQUEEZY';

-- 2. AGREGAR limite_vendedores A PLANS
ALTER TABLE plans
ADD COLUMN IF NOT EXISTS limite_vendedores INTEGER;

UPDATE plans SET limite_vendedores = 2 WHERE tipo = 'FREE';
UPDATE plans SET limite_vendedores = NULL WHERE tipo = 'PREMIUM';

-- 3. AGREGAR CAMPOS LEMONSQUEEZY A SUBSCRIPTIONS
ALTER TABLE subscriptions
ADD COLUMN IF NOT EXISTS lemonsqueezy_subscription_id TEXT,
ADD COLUMN IF NOT EXISTS lemonsqueezy_customer_id TEXT;

CREATE INDEX IF NOT EXISTS idx_subscriptions_ls
  ON subscriptions(lemonsqueezy_subscription_id);

-- 4. MEJORAR RLS POLICIES

DROP POLICY IF EXISTS "Subscriptions are viewable by organization" ON subscriptions;
DROP POLICY IF EXISTS "Subscriptions are manageable by organization" ON subscriptions;

CREATE POLICY "Subscriptions are viewable by own organization" ON subscriptions
  FOR SELECT USING (
    organization_id = public.get_current_organization_id()
    OR current_setting('role', true) = 'service_role'
  );

CREATE POLICY "Subscriptions are manageable by service role" ON subscriptions
  FOR ALL USING (
    current_setting('role', true) = 'service_role'
  );

DROP POLICY IF EXISTS "Payments are viewable by organization" ON subscription_payments;

CREATE POLICY "Payments are viewable by own organization" ON subscription_payments
  FOR SELECT USING (
    organization_id = public.get_current_organization_id()
    OR current_setting('role', true) = 'service_role'
  );

DROP POLICY IF EXISTS "Usage is viewable by organization" ON organization_usage;
DROP POLICY IF EXISTS "Usage is manageable by organization" ON organization_usage;

CREATE POLICY "Usage is viewable by own organization" ON organization_usage
  FOR SELECT USING (
    organization_id = public.get_current_organization_id()
    OR current_setting('role', true) = 'service_role'
  );

CREATE POLICY "Usage is manageable by service role" ON organization_usage
  FOR ALL USING (
    current_setting('role', true) = 'service_role'
  );

-- 5. ACTUALIZAR check_plan_limit

CREATE OR REPLACE FUNCTION check_plan_limit(
  org_id TEXT,
  limit_type TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  plan_limit INTEGER;
  current_usage INTEGER;
  storage_limit INTEGER;
  storage_current DECIMAL;
BEGIN
  IF limit_type = 'storage' THEN
    SELECT p.limite_storage_mb
    INTO storage_limit
    FROM subscriptions s
    JOIN plans p ON s.plan_id = p.id
    WHERE s.organization_id = org_id
      AND s.status IN ('ACTIVE', 'TRIALING');

    IF storage_limit IS NULL THEN
      RETURN TRUE;
    END IF;

    SELECT COALESCE(ou.storage_used_mb, 0)
    INTO storage_current
    FROM organization_usage ou
    WHERE ou.organization_id = org_id;

    RETURN COALESCE(storage_current, 0) < storage_limit;
  END IF;

  SELECT
    CASE limit_type
      WHEN 'ordenes' THEN p.limite_ordenes
      WHEN 'tecnicos' THEN p.limite_tecnicos
      WHEN 'clientes' THEN p.limite_clientes
      WHEN 'vendedores' THEN p.limite_vendedores
    END
  INTO plan_limit
  FROM subscriptions s
  JOIN plans p ON s.plan_id = p.id
  WHERE s.organization_id = org_id
    AND s.status IN ('ACTIVE', 'TRIALING');

  IF plan_limit IS NULL THEN
    RETURN TRUE;
  END IF;

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

  IF current_usage IS NULL THEN
    current_usage := 0;
  END IF;

  RETURN current_usage < plan_limit;
END;
$$ LANGUAGE plpgsql;

-- 6. FUNCIÓN PARA ACTUALIZAR STORAGE USAGE

CREATE OR REPLACE FUNCTION update_storage_usage(
  org_id TEXT,
  mb_added DECIMAL
)
RETURNS VOID AS $$
BEGIN
  UPDATE organization_usage
  SET storage_used_mb = GREATEST(0, COALESCE(storage_used_mb, 0) + mb_added)
  WHERE organization_id = org_id;
END;
$$ LANGUAGE plpgsql;
