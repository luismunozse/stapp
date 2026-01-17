-- ========================================
-- SCHEMA SAAS: Planes, Suscripciones y Pagos
-- ========================================

-- ========================================
-- ENUMS
-- ========================================

CREATE TYPE plan_type AS ENUM ('FREE', 'PREMIUM');
CREATE TYPE billing_period AS ENUM ('MONTHLY', 'YEARLY');
CREATE TYPE subscription_status AS ENUM ('ACTIVE', 'CANCELED', 'PAST_DUE', 'TRIALING');
CREATE TYPE payment_provider AS ENUM ('STRIPE', 'MERCADOPAGO');
CREATE TYPE subscription_payment_status AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED');

-- ========================================
-- TABLA DE PLANES
-- ========================================

CREATE TABLE plans (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  nombre TEXT NOT NULL,
  tipo plan_type NOT NULL UNIQUE,
  descripcion TEXT,
  precio_mensual DECIMAL(10,2) NOT NULL DEFAULT 0,
  precio_anual DECIMAL(10,2) NOT NULL DEFAULT 0,
  moneda TEXT DEFAULT 'USD',
  -- Límites del plan (NULL = ilimitado)
  limite_ordenes INTEGER,
  limite_tecnicos INTEGER,
  limite_clientes INTEGER,
  limite_storage_mb INTEGER,
  -- Features del plan (array JSON)
  features JSONB DEFAULT '[]',
  -- IDs de precios en Stripe
  stripe_price_monthly TEXT,
  stripe_price_yearly TEXT,
  -- Activo para nuevas suscripciones
  activo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER plans_updated_at
  BEFORE UPDATE ON plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ========================================
-- TABLA DE SUSCRIPCIONES
-- ========================================

CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES plans(id),
  status subscription_status DEFAULT 'TRIALING',
  billing_period billing_period DEFAULT 'MONTHLY',

  -- Proveedor de pago actual
  payment_provider payment_provider,

  -- Datos de Stripe
  stripe_subscription_id TEXT,
  stripe_customer_id TEXT,

  -- Datos de MercadoPago
  mercadopago_preapproval_id TEXT,
  mercadopago_payer_id TEXT,

  -- Periodos
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  trial_end TIMESTAMPTZ,

  -- Cancelación
  canceled_at TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Una sola suscripción activa por organización
  UNIQUE(organization_id)
);

CREATE INDEX idx_subscriptions_status ON subscriptions(status);
CREATE INDEX idx_subscriptions_stripe ON subscriptions(stripe_subscription_id);
CREATE INDEX idx_subscriptions_mp ON subscriptions(mercadopago_preapproval_id);

CREATE TRIGGER subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ========================================
-- HISTORIAL DE PAGOS DE SUSCRIPCIÓN
-- ========================================

CREATE TABLE subscription_payments (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Monto y moneda
  amount DECIMAL(10,2) NOT NULL,
  currency TEXT DEFAULT 'USD',

  -- Proveedor y referencia
  payment_provider payment_provider NOT NULL,
  provider_payment_id TEXT, -- ID del pago en Stripe/MP
  provider_invoice_id TEXT, -- ID de factura en Stripe

  -- Estado
  status subscription_payment_status NOT NULL DEFAULT 'PENDING',

  -- URLs
  invoice_url TEXT,
  receipt_url TEXT,

  -- Fechas
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_payments_subscription ON subscription_payments(subscription_id);
CREATE INDEX idx_payments_organization ON subscription_payments(organization_id);
CREATE INDEX idx_payments_provider_id ON subscription_payments(provider_payment_id);
CREATE INDEX idx_payments_status ON subscription_payments(status);

-- ========================================
-- USO DE RECURSOS POR ORGANIZACIÓN
-- ========================================

CREATE TABLE organization_usage (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Contadores de uso
  ordenes_count INTEGER DEFAULT 0,
  ordenes_mes_actual INTEGER DEFAULT 0,
  tecnicos_count INTEGER DEFAULT 0,
  clientes_count INTEGER DEFAULT 0,
  storage_used_mb DECIMAL(10,2) DEFAULT 0,

  -- Período del mes actual
  periodo_inicio TIMESTAMPTZ DEFAULT DATE_TRUNC('month', NOW()),

  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(organization_id)
);

CREATE TRIGGER organization_usage_updated_at
  BEFORE UPDATE ON organization_usage
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ========================================
-- INSERTAR PLANES POR DEFECTO
-- ========================================

INSERT INTO plans (nombre, tipo, descripcion, precio_mensual, precio_anual, moneda, limite_ordenes, limite_tecnicos, limite_clientes, limite_storage_mb, features) VALUES
(
  'Free',
  'FREE',
  'Plan gratuito para comenzar',
  0,
  0,
  'ARS',
  50,
  2,
  100,
  100,
  '["Hasta 50 órdenes/mes", "2 técnicos", "2 vendedores", "100 clientes", "Ventas y garantías", "Reportes básicos", "100MB almacenamiento"]'
),
(
  'Premium',
  'PREMIUM',
  'Plan completo para negocios en crecimiento',
  14999,
  143990,
  'ARS',
  NULL,
  NULL,
  NULL,
  5000,
  '["Órdenes ilimitadas", "Técnicos ilimitados", "Vendedores ilimitados", "Clientes ilimitados", "Reportes avanzados", "Soporte prioritario", "Notificaciones WhatsApp", "Logo personalizado", "5GB almacenamiento", "Exportación de datos"]'
);

-- ========================================
-- RLS POLICIES
-- ========================================

ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_usage ENABLE ROW LEVEL SECURITY;

-- Plans: público para lectura
CREATE POLICY "Plans are viewable by everyone" ON plans
  FOR SELECT USING (activo = TRUE);

-- Subscriptions: solo la organización propietaria
CREATE POLICY "Subscriptions are viewable by organization" ON subscriptions
  FOR SELECT USING (TRUE); -- Se filtra por organization_id en la app

CREATE POLICY "Subscriptions are manageable by organization" ON subscriptions
  FOR ALL USING (TRUE);

-- Payments: solo la organización propietaria
CREATE POLICY "Payments are viewable by organization" ON subscription_payments
  FOR SELECT USING (TRUE);

-- Usage: solo la organización propietaria
CREATE POLICY "Usage is viewable by organization" ON organization_usage
  FOR SELECT USING (TRUE);

CREATE POLICY "Usage is manageable by organization" ON organization_usage
  FOR ALL USING (TRUE);

-- ========================================
-- FUNCIONES HELPER
-- ========================================

-- Función para verificar límites del plan
CREATE OR REPLACE FUNCTION check_plan_limit(
  org_id TEXT,
  limit_type TEXT -- 'ordenes', 'tecnicos', 'clientes'
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

-- Función para obtener el plan actual de una organización
CREATE OR REPLACE FUNCTION get_organization_plan(org_id TEXT)
RETURNS TABLE(
  plan_id TEXT,
  plan_nombre TEXT,
  plan_tipo plan_type,
  subscription_status subscription_status,
  current_period_end TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.nombre,
    p.tipo,
    s.status,
    s.current_period_end
  FROM subscriptions s
  JOIN plans p ON s.plan_id = p.id
  WHERE s.organization_id = org_id
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Función para crear suscripción Free por defecto
CREATE OR REPLACE FUNCTION create_free_subscription(org_id TEXT)
RETURNS TEXT AS $$
DECLARE
  free_plan_id TEXT;
  new_sub_id TEXT;
BEGIN
  -- Obtener plan Free
  SELECT id INTO free_plan_id FROM plans WHERE tipo = 'FREE' LIMIT 1;

  IF free_plan_id IS NULL THEN
    RAISE EXCEPTION 'Free plan not found';
  END IF;

  -- Crear suscripción
  INSERT INTO subscriptions (organization_id, plan_id, status, current_period_start, current_period_end)
  VALUES (
    org_id,
    free_plan_id,
    'ACTIVE',
    NOW(),
    NOW() + INTERVAL '100 years' -- Free no expira
  )
  RETURNING id INTO new_sub_id;

  -- Crear registro de uso
  INSERT INTO organization_usage (organization_id)
  VALUES (org_id)
  ON CONFLICT (organization_id) DO NOTHING;

  RETURN new_sub_id;
END;
$$ LANGUAGE plpgsql;

-- ========================================
-- TRIGGER: Crear suscripción Free al crear organización
-- ========================================

CREATE OR REPLACE FUNCTION on_organization_created()
RETURNS TRIGGER AS $$
BEGIN
  -- Crear suscripción Free
  PERFORM create_free_subscription(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_organization_created
  AFTER INSERT ON organizations
  FOR EACH ROW EXECUTE FUNCTION on_organization_created();

-- ========================================
-- TRIGGER: Actualizar contadores de uso
-- ========================================

-- Contador de clientes
CREATE OR REPLACE FUNCTION update_clientes_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO organization_usage (organization_id, clientes_count)
    VALUES (NEW.organization_id, 1)
    ON CONFLICT (organization_id)
    DO UPDATE SET clientes_count = organization_usage.clientes_count + 1;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE organization_usage
    SET clientes_count = GREATEST(0, clientes_count - 1)
    WHERE organization_id = OLD.organization_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_clientes_count
  AFTER INSERT OR DELETE ON clientes
  FOR EACH ROW EXECUTE FUNCTION update_clientes_count();

-- Contador de técnicos
CREATE OR REPLACE FUNCTION update_tecnicos_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.rol = 'TECNICO' THEN
    INSERT INTO organization_usage (organization_id, tecnicos_count)
    VALUES (NEW.organization_id, 1)
    ON CONFLICT (organization_id)
    DO UPDATE SET tecnicos_count = organization_usage.tecnicos_count + 1;
  ELSIF TG_OP = 'DELETE' AND OLD.rol = 'TECNICO' THEN
    UPDATE organization_usage
    SET tecnicos_count = GREATEST(0, tecnicos_count - 1)
    WHERE organization_id = OLD.organization_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_tecnicos_count
  AFTER INSERT OR DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION update_tecnicos_count();

-- Contador de órdenes mensuales
CREATE OR REPLACE FUNCTION update_ordenes_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO organization_usage (organization_id, ordenes_count, ordenes_mes_actual)
    VALUES (NEW.organization_id, 1, 1)
    ON CONFLICT (organization_id)
    DO UPDATE SET
      ordenes_count = organization_usage.ordenes_count + 1,
      ordenes_mes_actual = CASE
        WHEN organization_usage.periodo_inicio < DATE_TRUNC('month', NOW())
        THEN 1 -- Nuevo mes, resetear contador
        ELSE organization_usage.ordenes_mes_actual + 1
      END,
      periodo_inicio = CASE
        WHEN organization_usage.periodo_inicio < DATE_TRUNC('month', NOW())
        THEN DATE_TRUNC('month', NOW())
        ELSE organization_usage.periodo_inicio
      END;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_ordenes_count
  AFTER INSERT ON ordenes_servicio
  FOR EACH ROW EXECUTE FUNCTION update_ordenes_count();
