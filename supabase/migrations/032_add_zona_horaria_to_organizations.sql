-- Add timezone column to organizations table
-- Default to America/Argentina/Buenos_Aires for backward compatibility
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS zona_horaria TEXT NOT NULL DEFAULT 'America/Argentina/Buenos_Aires';
