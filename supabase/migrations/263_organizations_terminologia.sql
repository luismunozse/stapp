-- ========================================
-- Migration 263: organizations.terminologia
-- ========================================
-- Vocabulario configurable por organización (SP-1 multipropósito). Guarda solo
-- overrides de términos conocidos; lo no-seteado cae al default neutral.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS terminologia JSONB NOT NULL DEFAULT '{}'::jsonb;
