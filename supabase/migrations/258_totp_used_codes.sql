-- applied manually in Supabase SQL editor
-- users.id is TEXT (CUID) per migration 001_schema.sql

-- TOTP used codes: tracks consumed one-time passwords to prevent replay attacks.
-- RFC 6238: once a valid code is accepted, it must not be accepted again within its validity window.
-- Rows older than ~2 minutes are dead (the TOTP window is at most 90s with window:1).
-- A cleanup cron can purge old rows; the verify path also does a best-effort purge.

CREATE TABLE IF NOT EXISTS totp_used_codes (
  user_id TEXT NOT NULL,          -- TEXT to match users.id (CUID)
  code TEXT NOT NULL,
  used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, code)
);
CREATE INDEX IF NOT EXISTS idx_totp_used_codes_used_at ON totp_used_codes(used_at);
ALTER TABLE totp_used_codes ENABLE ROW LEVEL SECURITY;
-- No public RLS policies: this table is accessed only via supabaseAdmin (service role bypasses RLS).
