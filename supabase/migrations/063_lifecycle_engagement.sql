-- ============================================
-- LIFECYCLE EMAILS & ENGAGEMENT METRICS
-- ============================================

-- Tabla de emails de lifecycle enviados (para no duplicar)
CREATE TABLE IF NOT EXISTS lifecycle_emails (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  email_type TEXT NOT NULL, -- WELCOME, TIP_DAY_3, TIP_DAY_7, TRIAL_EXPIRING_5, TRIAL_EXPIRING_1, TRIAL_EXPIRED, WIN_BACK_7, WIN_BACK_30, MILESTONE
  status TEXT NOT NULL DEFAULT 'SENT', -- SENT, FAILED
  metadata JSONB DEFAULT '{}',
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lifecycle_emails_org ON lifecycle_emails(organization_id);
CREATE INDEX idx_lifecycle_emails_type ON lifecycle_emails(email_type);
CREATE INDEX idx_lifecycle_emails_user_type ON lifecycle_emails(user_id, email_type);

-- Tabla de engagement diario por organización (snapshot diario)
CREATE TABLE IF NOT EXISTS organization_engagement (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  -- Métricas de actividad
  ordenes_creadas INT NOT NULL DEFAULT 0,
  ordenes_completadas INT NOT NULL DEFAULT 0,
  ventas_realizadas INT NOT NULL DEFAULT 0,
  clientes_nuevos INT NOT NULL DEFAULT 0,
  usuarios_activos INT NOT NULL DEFAULT 0,
  -- Métricas de engagement
  login_count INT NOT NULL DEFAULT 0,
  -- Score calculado (0-100)
  engagement_score INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, fecha)
);

CREATE INDEX idx_org_engagement_org_fecha ON organization_engagement(organization_id, fecha DESC);
CREATE INDEX idx_org_engagement_score ON organization_engagement(engagement_score);

-- Tabla de changelog (qué hay de nuevo)
CREATE TABLE IF NOT EXISTS changelog_entries (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  titulo TEXT NOT NULL,
  descripcion TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'MEJORA', -- NUEVA_FUNCION, MEJORA, CORRECCION
  importante BOOLEAN NOT NULL DEFAULT false,
  publicado BOOLEAN NOT NULL DEFAULT false,
  fecha_publicacion TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_changelog_publicado ON changelog_entries(publicado, fecha_publicacion DESC);

-- Tabla para trackear qué changelogs vio cada usuario
CREATE TABLE IF NOT EXISTS changelog_reads (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);

-- ============================================
-- FUNCIÓN: Calcular engagement score
-- ============================================
CREATE OR REPLACE FUNCTION calculate_engagement_score(
  p_ordenes INT,
  p_completadas INT,
  p_ventas INT,
  p_clientes INT,
  p_logins INT
) RETURNS INT AS $$
DECLARE
  score INT := 0;
BEGIN
  -- Logins (max 30 pts)
  score := score + LEAST(p_logins * 10, 30);
  -- Órdenes creadas (max 25 pts)
  score := score + LEAST(p_ordenes * 5, 25);
  -- Órdenes completadas (max 20 pts)
  score := score + LEAST(p_completadas * 5, 20);
  -- Ventas (max 15 pts)
  score := score + LEAST(p_ventas * 5, 15);
  -- Clientes nuevos (max 10 pts)
  score := score + LEAST(p_clientes * 5, 10);

  RETURN LEAST(score, 100);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================
-- RLS
-- ============================================
ALTER TABLE lifecycle_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_engagement ENABLE ROW LEVEL SECURITY;
ALTER TABLE changelog_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE changelog_reads ENABLE ROW LEVEL SECURITY;

-- Service role can do everything
CREATE POLICY "service_role_lifecycle" ON lifecycle_emails FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_engagement" ON organization_engagement FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_changelog" ON changelog_entries FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_changelog_reads" ON changelog_reads FOR ALL TO service_role USING (true) WITH CHECK (true);
