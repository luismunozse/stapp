-- Global maintenance banner managed by superadmin.
-- Single-row table: always row with id = 'global'.
CREATE TABLE IF NOT EXISTS maintenance_banner (
  id TEXT PRIMARY KEY DEFAULT 'global',
  active BOOLEAN NOT NULL DEFAULT FALSE,
  message TEXT NOT NULL DEFAULT '',
  severity TEXT NOT NULL DEFAULT 'INFO' CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT,
  CONSTRAINT single_row CHECK (id = 'global')
);

-- Seed the single row if it doesn't exist
INSERT INTO maintenance_banner (id, active, message, severity)
VALUES ('global', FALSE, '', 'INFO')
ON CONFLICT (id) DO NOTHING;

-- RLS: anyone authenticated can read, only service_role can write
ALTER TABLE maintenance_banner ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read maintenance banner" ON maintenance_banner;
CREATE POLICY "Anyone can read maintenance banner"
  ON maintenance_banner FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Only service role can update maintenance banner" ON maintenance_banner;
CREATE POLICY "Only service role can update maintenance banner"
  ON maintenance_banner FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
