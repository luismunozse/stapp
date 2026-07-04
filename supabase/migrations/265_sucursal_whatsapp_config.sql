-- ========================================
-- 265: sucursal_whatsapp_config — WhatsApp por sucursal (Evolution/QR)
-- ========================================
-- Config de WhatsApp por sucursal. El whatsapp_config central (per-org) queda
-- intacto: esta tabla solo guarda la instancia Evolution de cada sucursal.
-- Molde: 201_sucursales_tabla.sql. IDs son TEXT (cuid). Idempotente.

CREATE TABLE IF NOT EXISTS sucursal_whatsapp_config (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sucursal_id TEXT NOT NULL REFERENCES sucursales(id) ON DELETE CASCADE,
  evolution_instance_name TEXT,
  evolution_connection_state TEXT,
  evolution_last_qr_at TIMESTAMPTZ,
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Una config por sucursal
CREATE UNIQUE INDEX IF NOT EXISTS sucursal_whatsapp_config_sucursal_unique
  ON sucursal_whatsapp_config(sucursal_id);

CREATE INDEX IF NOT EXISTS sucursal_whatsapp_config_org_idx
  ON sucursal_whatsapp_config(organization_id);

ALTER TABLE sucursal_whatsapp_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sucursal_whatsapp_config_select ON sucursal_whatsapp_config;
CREATE POLICY sucursal_whatsapp_config_select ON sucursal_whatsapp_config
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS sucursal_whatsapp_config_all_service ON sucursal_whatsapp_config;
CREATE POLICY sucursal_whatsapp_config_all_service ON sucursal_whatsapp_config
  FOR ALL USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS sucursal_whatsapp_config_updated_at ON sucursal_whatsapp_config;
CREATE TRIGGER sucursal_whatsapp_config_updated_at
  BEFORE UPDATE ON sucursal_whatsapp_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMENT ON TABLE sucursal_whatsapp_config IS
  'WhatsApp (Evolution/QR) por sucursal. El central per-org sigue en whatsapp_config.';
COMMENT ON COLUMN sucursal_whatsapp_config.evolution_instance_name IS
  'Instancia Evolution de la sucursal: stapp-org-{org}-suc-{suc}.';
COMMENT ON COLUMN sucursal_whatsapp_config.evolution_connection_state IS
  'open | connecting | close | qr — ultimo estado reportado.';
