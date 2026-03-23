-- ============================================
-- FEATURE USAGE TRACKING PER ORGANIZATION
-- ============================================

CREATE TABLE IF NOT EXISTS feature_usage (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,

  -- Features de servicio
  usa_ordenes BOOLEAN NOT NULL DEFAULT false,
  ordenes_count INT NOT NULL DEFAULT 0,
  usa_cotizaciones BOOLEAN NOT NULL DEFAULT false,
  cotizaciones_count INT NOT NULL DEFAULT 0,
  usa_garantias BOOLEAN NOT NULL DEFAULT false,
  garantias_count INT NOT NULL DEFAULT 0,
  usa_fotos BOOLEAN NOT NULL DEFAULT false,
  fotos_count INT NOT NULL DEFAULT 0,

  -- Features de ventas
  usa_ventas BOOLEAN NOT NULL DEFAULT false,
  ventas_count INT NOT NULL DEFAULT 0,
  usa_inventario BOOLEAN NOT NULL DEFAULT false,
  inventario_count INT NOT NULL DEFAULT 0,

  -- Features de comunicación
  usa_whatsapp BOOLEAN NOT NULL DEFAULT false,
  whatsapp_count INT NOT NULL DEFAULT 0,
  usa_email_notif BOOLEAN NOT NULL DEFAULT false,
  email_count INT NOT NULL DEFAULT 0,

  -- Features avanzadas
  usa_facturacion BOOLEAN NOT NULL DEFAULT false,
  facturas_count INT NOT NULL DEFAULT 0,
  usa_checklist BOOLEAN NOT NULL DEFAULT false,
  checklist_count INT NOT NULL DEFAULT 0,
  usa_firma_digital BOOLEAN NOT NULL DEFAULT false,
  firmas_count INT NOT NULL DEFAULT 0,
  usa_tracking_publico BOOLEAN NOT NULL DEFAULT false,
  tracking_count INT NOT NULL DEFAULT 0,
  usa_kiosco BOOLEAN NOT NULL DEFAULT false,

  -- Equipo
  tecnicos_count INT NOT NULL DEFAULT 0,
  vendedores_count INT NOT NULL DEFAULT 0,
  clientes_count INT NOT NULL DEFAULT 0,

  -- Score de adopción (0-100)
  adoption_score INT NOT NULL DEFAULT 0,
  features_activas INT NOT NULL DEFAULT 0,
  total_features INT NOT NULL DEFAULT 12,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, fecha)
);

CREATE INDEX idx_feature_usage_org ON feature_usage(organization_id, fecha DESC);
CREATE INDEX idx_feature_usage_adoption ON feature_usage(adoption_score DESC);

-- ============================================
-- RLS
-- ============================================
ALTER TABLE feature_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_feature_usage" ON feature_usage FOR ALL TO service_role USING (true) WITH CHECK (true);
