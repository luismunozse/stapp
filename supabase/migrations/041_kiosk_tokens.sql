-- ============================================
-- Migration 041: Kiosk Mode Tokens
-- ============================================

CREATE TABLE IF NOT EXISTS kiosk_tokens (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
  token text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  name text DEFAULT 'Pantalla Principal',
  config jsonb DEFAULT '{
    "columns": ["numero_orden", "dispositivo", "estado", "cliente"],
    "filter_estados": [],
    "auto_refresh_seconds": 30,
    "show_branding": true,
    "font_size": "large"
  }',
  activo boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_kiosk_token ON kiosk_tokens(token);
CREATE INDEX idx_kiosk_org ON kiosk_tokens(organization_id);

-- RLS
ALTER TABLE kiosk_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_kiosk_tokens" ON kiosk_tokens
  FOR ALL USING (organization_id IN (
    SELECT organization_id FROM users WHERE id = auth.uid()::text
  ));

-- Trigger updated_at
CREATE TRIGGER kiosk_tokens_updated_at
  BEFORE UPDATE ON kiosk_tokens
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
