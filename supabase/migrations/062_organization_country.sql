-- Add country field to organizations for multi-country LATAM support
ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS pais TEXT DEFAULT 'AR';

-- Add comment
COMMENT ON COLUMN organizations.pais IS 'ISO 3166-1 alpha-2 country code (AR, MX, CL, CO, PE, etc.)';
