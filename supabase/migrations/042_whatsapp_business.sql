-- ============================================
-- Migration 042: WhatsApp Business API
-- ============================================

-- Configuración de WhatsApp Business por organización
CREATE TABLE IF NOT EXISTS whatsapp_config (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE UNIQUE,
  phone_number_id text,
  business_account_id text,
  access_token_encrypted text,
  webhook_verify_token text DEFAULT encode(gen_random_bytes(16), 'hex'),
  is_configured boolean DEFAULT false,
  is_verified boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Templates de mensajes WhatsApp (aprobados por Meta)
CREATE TABLE IF NOT EXISTS whatsapp_templates (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  template_name text NOT NULL,
  template_language text DEFAULT 'es',
  category text,
  status text DEFAULT 'PENDING',
  components jsonb,
  created_at timestamptz DEFAULT now()
);

-- Tracking de mensajes enviados
CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  notification_log_id TEXT REFERENCES notification_logs(id),
  whatsapp_message_id text,
  phone_number text NOT NULL,
  template_name text,
  status text DEFAULT 'sent',
  error_code text,
  error_message text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_wa_config_org ON whatsapp_config(organization_id);
CREATE INDEX idx_wa_messages_org ON whatsapp_messages(organization_id);
CREATE INDEX idx_wa_messages_wa_id ON whatsapp_messages(whatsapp_message_id);

-- RLS
ALTER TABLE whatsapp_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_wa_config" ON whatsapp_config
  FOR ALL USING (organization_id IN (
    SELECT organization_id FROM users WHERE id = auth.uid()::text
  ));

CREATE POLICY "org_wa_templates" ON whatsapp_templates
  FOR ALL USING (organization_id IN (
    SELECT organization_id FROM users WHERE id = auth.uid()::text
  ));

CREATE POLICY "org_wa_messages" ON whatsapp_messages
  FOR ALL USING (organization_id IN (
    SELECT organization_id FROM users WHERE id = auth.uid()::text
  ));

-- Triggers updated_at
CREATE TRIGGER wa_config_updated_at
  BEFORE UPDATE ON whatsapp_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER wa_messages_updated_at
  BEFORE UPDATE ON whatsapp_messages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
