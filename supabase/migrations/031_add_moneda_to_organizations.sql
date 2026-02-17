-- Add currency column to organizations table
-- Default to ARS for backward compatibility with existing Argentine organizations
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS moneda TEXT NOT NULL DEFAULT 'ARS';
