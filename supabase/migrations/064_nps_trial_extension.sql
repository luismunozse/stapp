-- ============================================
-- NPS SURVEYS & TRIAL EXTENSION TRACKING
-- ============================================

-- Tabla de respuestas NPS
CREATE TABLE IF NOT EXISTS nps_responses (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score INT NOT NULL CHECK (score >= 0 AND score <= 10),
  comentario TEXT,
  -- Categoría auto-calculada
  categoria TEXT NOT NULL GENERATED ALWAYS AS (
    CASE
      WHEN score >= 9 THEN 'PROMOTOR'
      WHEN score >= 7 THEN 'PASIVO'
      ELSE 'DETRACTOR'
    END
  ) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_nps_org ON nps_responses(organization_id);
CREATE INDEX idx_nps_user ON nps_responses(user_id);
CREATE INDEX idx_nps_created ON nps_responses(created_at DESC);
CREATE INDEX idx_nps_categoria ON nps_responses(categoria);

-- Tabla para trackear cuándo mostrar el próximo NPS
CREATE TABLE IF NOT EXISTS nps_schedule (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  next_prompt_at TIMESTAMPTZ NOT NULL,
  dismissed_count INT NOT NULL DEFAULT 0,
  UNIQUE(user_id)
);

-- Tabla de extensiones de trial (auditoría)
CREATE TABLE IF NOT EXISTS trial_extensions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  dias_extendidos INT NOT NULL,
  nueva_fecha_fin TIMESTAMPTZ NOT NULL,
  motivo TEXT,
  extendido_por TEXT NOT NULL, -- email del superadmin
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_trial_ext_org ON trial_extensions(organization_id);

-- ============================================
-- RLS
-- ============================================
ALTER TABLE nps_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE nps_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE trial_extensions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_nps" ON nps_responses FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_nps_schedule" ON nps_schedule FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_trial_ext" ON trial_extensions FOR ALL TO service_role USING (true) WITH CHECK (true);
