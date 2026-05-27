-- ============================================
-- 195: whatsapp_config provider + Evolution API
-- ============================================
-- Soporta dos providers de envio:
--   meta:      WhatsApp Cloud API (Meta). Default historico.
--   evolution: Evolution API self-hosted (Baileys). QR pairing.
-- ============================================

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'meta';

ALTER TABLE whatsapp_config
  DROP CONSTRAINT IF EXISTS whatsapp_config_provider_check;
ALTER TABLE whatsapp_config
  ADD CONSTRAINT whatsapp_config_provider_check
    CHECK (provider IN ('meta', 'evolution'));

-- Campos Evolution API
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS evolution_base_url TEXT;
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS evolution_instance_name TEXT;
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS evolution_api_key_encrypted TEXT;
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS evolution_connection_state TEXT;
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS evolution_last_qr_at TIMESTAMPTZ;

COMMENT ON COLUMN whatsapp_config.provider IS
  'Provider de envio: meta (Cloud API) | evolution (Evolution API self-hosted).';
COMMENT ON COLUMN whatsapp_config.evolution_base_url IS
  'URL base del servidor Evolution API (ej: https://evo.midominio.com).';
COMMENT ON COLUMN whatsapp_config.evolution_instance_name IS
  'Nombre de la instancia en Evolution (1 por organizacion).';
COMMENT ON COLUMN whatsapp_config.evolution_api_key_encrypted IS
  'API key de Evolution encriptada (header apikey).';
COMMENT ON COLUMN whatsapp_config.evolution_connection_state IS
  'open | connecting | close | qr — ultimo estado reportado.';
