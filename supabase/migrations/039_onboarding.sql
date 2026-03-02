-- ============================================
-- Migration 039: Onboarding System
-- ============================================

-- Campos de onboarding en organizations
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS onboarding_completed boolean DEFAULT false;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS onboarding_step integer DEFAULT 0;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS has_sample_data boolean DEFAULT false;

-- Tabla de progreso de onboarding
CREATE TABLE IF NOT EXISTS onboarding_progress (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE UNIQUE,
  step_logo boolean DEFAULT false,
  step_first_client boolean DEFAULT false,
  step_first_order boolean DEFAULT false,
  step_checklist boolean DEFAULT false,
  sample_data_loaded boolean DEFAULT false,
  sample_entity_ids jsonb DEFAULT '{}',
  completed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE onboarding_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_onboarding_select" ON onboarding_progress
  FOR SELECT USING (organization_id IN (
    SELECT organization_id FROM users WHERE id = auth.uid()::text
  ));

CREATE POLICY "org_onboarding_all" ON onboarding_progress
  FOR ALL USING (organization_id IN (
    SELECT organization_id FROM users WHERE id = auth.uid()::text
  ));

-- Trigger updated_at
CREATE TRIGGER onboarding_progress_updated_at
  BEFORE UPDATE ON onboarding_progress
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
