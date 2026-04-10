-- Add city, province and postal code to organizations
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS ciudad TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS provincia TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS codigo_postal TEXT;
