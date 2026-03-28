-- ============================================
-- 077: UTM Tracking para campañas de ads
-- ============================================
-- Agrega campos UTM a organizations para saber
-- de qué campaña proviene cada registro.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS utm_source    TEXT,
  ADD COLUMN IF NOT EXISTS utm_medium    TEXT,
  ADD COLUMN IF NOT EXISTS utm_campaign  TEXT,
  ADD COLUMN IF NOT EXISTS utm_content   TEXT,
  ADD COLUMN IF NOT EXISTS utm_term      TEXT;

-- Índice para consultas por campaña
CREATE INDEX IF NOT EXISTS idx_organizations_utm_source
  ON organizations (utm_source)
  WHERE utm_source IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_organizations_utm_campaign
  ON organizations (utm_campaign)
  WHERE utm_campaign IS NOT NULL;

-- Vista resumida para el superadmin
CREATE OR REPLACE VIEW v_utm_stats AS
SELECT
  utm_source,
  utm_medium,
  utm_campaign,
  COUNT(*)                                          AS registros,
  COUNT(*) FILTER (WHERE activo)                    AS activos,
  MIN(created_at)                                   AS primer_registro,
  MAX(created_at)                                   AS ultimo_registro
FROM organizations
WHERE utm_source IS NOT NULL
GROUP BY utm_source, utm_medium, utm_campaign
ORDER BY registros DESC;
