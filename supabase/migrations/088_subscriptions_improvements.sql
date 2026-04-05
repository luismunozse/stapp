-- ============================================
-- Migration 088: Subscription Management Improvements
-- - Override de limites por organización
-- - Limpieza de campos LemonSqueezy no usados
-- - Función optimizada de counts con GROUP BY
-- - Limpieza automática de trials vencidos
-- ============================================

-- ========================================
-- 1. Override de limites por organización
-- ========================================
-- Permite que el superadmin asigne limites custom a una org sin cambiar su plan

CREATE TABLE IF NOT EXISTS organization_limit_overrides (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  limite_ordenes INTEGER,
  limite_tecnicos INTEGER,
  limite_clientes INTEGER,
  limite_vendedores INTEGER,
  limite_storage_mb INTEGER,
  motivo TEXT,
  aplicado_por TEXT, -- email del superadmin
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id)
);

CREATE TRIGGER org_limit_overrides_updated_at
  BEFORE UPDATE ON organization_limit_overrides
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ========================================
-- 2. Función optimizada: counts de suscripciones con un solo query
-- ========================================

CREATE OR REPLACE FUNCTION get_subscription_counts()
RETURNS JSON AS $$
DECLARE
  v_result JSON;
BEGIN
  SELECT json_build_object(
    'active', COALESCE(SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END), 0),
    'trialing', COALESCE(SUM(CASE WHEN status = 'TRIALING' AND (trial_end IS NULL OR trial_end > now()) THEN 1 ELSE 0 END), 0),
    'expiredTrials', COALESCE(SUM(CASE WHEN status = 'TRIALING' AND trial_end IS NOT NULL AND trial_end <= now() THEN 1 ELSE 0 END), 0),
    'canceled', COALESCE(SUM(CASE WHEN status = 'CANCELED' THEN 1 ELSE 0 END), 0),
    'past_due', COALESCE(SUM(CASE WHEN status = 'PAST_DUE' THEN 1 ELSE 0 END), 0)
  ) INTO v_result
  FROM subscriptions;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- ========================================
-- 3. Función: obtener limites efectivos de una org (plan + overrides)
-- ========================================

CREATE OR REPLACE FUNCTION get_effective_limits(p_organization_id TEXT)
RETURNS JSON AS $$
DECLARE
  v_plan RECORD;
  v_override RECORD;
BEGIN
  -- Obtener limites del plan
  SELECT p.limite_ordenes, p.limite_tecnicos, p.limite_clientes,
         p.limite_vendedores, p.limite_storage_mb
  INTO v_plan
  FROM subscriptions s
  JOIN plans p ON p.id = s.plan_id
  WHERE s.organization_id = p_organization_id;

  -- Obtener overrides
  SELECT * INTO v_override
  FROM organization_limit_overrides
  WHERE organization_id = p_organization_id;

  RETURN json_build_object(
    'limite_ordenes', COALESCE(v_override.limite_ordenes, v_plan.limite_ordenes),
    'limite_tecnicos', COALESCE(v_override.limite_tecnicos, v_plan.limite_tecnicos),
    'limite_clientes', COALESCE(v_override.limite_clientes, v_plan.limite_clientes),
    'limite_vendedores', COALESCE(v_override.limite_vendedores, v_plan.limite_vendedores),
    'limite_storage_mb', COALESCE(v_override.limite_storage_mb, v_plan.limite_storage_mb),
    'has_overrides', v_override.id IS NOT NULL
  );
END;
$$ LANGUAGE plpgsql;

-- ========================================
-- 4. Historial de cambios de suscripcion
-- ========================================

CREATE TABLE IF NOT EXISTS subscription_history (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  action TEXT NOT NULL, -- 'CREATED', 'ACTIVATED', 'RENEWED', 'CANCELED', 'TRIAL_EXTENDED', 'LIMIT_OVERRIDE'
  previous_status TEXT,
  new_status TEXT,
  details JSONB,
  performed_by TEXT, -- email del superadmin
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sub_history_sub ON subscription_history(subscription_id);
CREATE INDEX idx_sub_history_org ON subscription_history(organization_id);
CREATE INDEX idx_sub_history_created ON subscription_history(created_at DESC);

-- ========================================
-- 5. Limpieza de campos LemonSqueezy (drop columnas no usadas)
-- ========================================
-- Solo si existen las columnas
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'subscriptions' AND column_name = 'lemonsqueezy_subscription_id') THEN
    ALTER TABLE subscriptions DROP COLUMN lemonsqueezy_subscription_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'subscriptions' AND column_name = 'lemonsqueezy_customer_id') THEN
    ALTER TABLE subscriptions DROP COLUMN lemonsqueezy_customer_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'subscriptions' AND column_name = 'lemonsqueezy_variant_id') THEN
    ALTER TABLE subscriptions DROP COLUMN lemonsqueezy_variant_id;
  END IF;
END $$;
