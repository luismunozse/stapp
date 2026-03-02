-- ============================================
-- Migration 037: Rate Limiting
-- ============================================

-- Tabla para tracking de rate limits (respaldo, el rate limiting principal es in-memory)
CREATE TABLE IF NOT EXISTS rate_limit_log (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  ip_address text,
  endpoint text NOT NULL,
  window_start timestamptz DEFAULT now(),
  request_count integer DEFAULT 1
);

CREATE INDEX idx_rate_limit_org_endpoint ON rate_limit_log(organization_id, endpoint, window_start);
CREATE INDEX idx_rate_limit_ip ON rate_limit_log(ip_address, endpoint, window_start);

-- Auto-cleanup de entradas viejas (mayores a 1 hora)
CREATE OR REPLACE FUNCTION cleanup_rate_limits() RETURNS void AS $$
BEGIN
  DELETE FROM rate_limit_log WHERE window_start < now() - interval '1 hour';
END;
$$ LANGUAGE plpgsql;
