-- Migration 205: API keys for the public inbound REST API (#9)
-- Keys are hashed at rest (sha256). The raw key is shown once at creation.

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  last_used_at TIMESTAMPTZ,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS api_keys_hash_idx ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS api_keys_org_idx ON api_keys(organization_id);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS api_keys_all_service ON api_keys;
CREATE POLICY api_keys_all_service ON api_keys
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON COLUMN api_keys.key_hash IS 'sha256 hex del valor crudo de la API key.';
COMMENT ON COLUMN api_keys.prefix IS 'Primeros chars de la key para mostrar (no secreto).';
