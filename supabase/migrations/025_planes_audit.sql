-- ========================================
-- PLANES - AUDITORÍA Y MEJORAS
-- ========================================
-- Migración para agregar auditoría de cambios en planes
-- y soft delete

-- Agregar soft delete a planes
ALTER TABLE plans ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Tabla de auditoría de planes
CREATE TABLE IF NOT EXISTS plans_audit (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  plan_id TEXT NOT NULL REFERENCES plans(id),

  -- Quién hizo el cambio
  changed_by_email TEXT NOT NULL,
  action TEXT NOT NULL, -- 'CREATE', 'UPDATE', 'DISABLE', 'ENABLE'

  -- Estado anterior y nuevo (JSONB para flexibilidad)
  before_data JSONB,
  after_data JSONB,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_plans_audit_plan ON plans_audit(plan_id);
CREATE INDEX IF NOT EXISTS idx_plans_audit_created ON plans_audit(created_at DESC);

-- Trigger automático para auditar cambios en planes
CREATE OR REPLACE FUNCTION audit_plan_changes()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO plans_audit (plan_id, changed_by_email, action, after_data)
    VALUES (
      NEW.id,
      COALESCE(current_setting('app.superadmin_email', TRUE), 'system'),
      'CREATE',
      to_jsonb(NEW)
    );
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO plans_audit (plan_id, changed_by_email, action, before_data, after_data)
    VALUES (
      NEW.id,
      COALESCE(current_setting('app.superadmin_email', TRUE), 'system'),
      CASE
        WHEN OLD.activo = TRUE AND NEW.activo = FALSE THEN 'DISABLE'
        WHEN OLD.activo = FALSE AND NEW.activo = TRUE THEN 'ENABLE'
        ELSE 'UPDATE'
      END,
      to_jsonb(OLD),
      to_jsonb(NEW)
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Aplicar trigger a tabla plans
DROP TRIGGER IF EXISTS trigger_audit_plans ON plans;
CREATE TRIGGER trigger_audit_plans
  AFTER INSERT OR UPDATE ON plans
  FOR EACH ROW EXECUTE FUNCTION audit_plan_changes();

-- Vista para obtener planes con información de uso
CREATE OR REPLACE VIEW plans_with_usage AS
SELECT
  p.id,
  p.nombre,
  p.tipo,
  p.descripcion,
  p.precio_mensual,
  p.precio_anual,
  p.moneda,
  p.limite_ordenes,
  p.limite_tecnicos,
  p.limite_clientes,
  p.limite_storage_mb,
  p.features,
  p.stripe_price_monthly,
  p.stripe_price_yearly,
  p.activo,
  p.created_at,
  p.updated_at,
  p.deleted_at,
  COUNT(DISTINCT s.organization_id) as organizations_count,
  SUM(CASE WHEN s.status = 'ACTIVE' THEN 1 ELSE 0 END) as active_subscriptions
FROM plans p
LEFT JOIN subscriptions s ON s.plan_id = p.id
WHERE p.deleted_at IS NULL
GROUP BY
  p.id,
  p.nombre,
  p.tipo,
  p.descripcion,
  p.precio_mensual,
  p.precio_anual,
  p.moneda,
  p.limite_ordenes,
  p.limite_tecnicos,
  p.limite_clientes,
  p.limite_storage_mb,
  p.features,
  p.stripe_price_monthly,
  p.stripe_price_yearly,
  p.activo,
  p.created_at,
  p.updated_at,
  p.deleted_at;

-- RLS para plans_audit
ALTER TABLE plans_audit ENABLE ROW LEVEL SECURITY;

-- Política: Superadmin puede ver todo
CREATE POLICY "Plans audit viewable by superadmin" ON plans_audit
  FOR SELECT USING (TRUE);

-- Política: Superadmin puede gestionar
CREATE POLICY "Plans audit manageable by superadmin" ON plans_audit
  FOR ALL USING (TRUE);

-- Comentarios para documentación
COMMENT ON TABLE plans_audit IS 'Auditoría de cambios en planes - registra todas las modificaciones';
COMMENT ON COLUMN plans_audit.action IS 'Tipo de acción: CREATE, UPDATE, DISABLE, ENABLE';
COMMENT ON COLUMN plans_audit.before_data IS 'Estado del plan antes del cambio (solo UPDATE)';
COMMENT ON COLUMN plans_audit.after_data IS 'Estado del plan después del cambio';
COMMENT ON COLUMN plans.deleted_at IS 'Fecha de soft delete - NULL significa plan activo';
