-- ========================================
-- Migration 215: TURNOS — add sucursal_id (nullable + backfill + index)
-- ========================================
-- Adds sucursal_id FK to turnos, backfills existing rows to the principal
-- sucursal of their org (same pattern as migration 202).
-- Column stays NULLABLE this migration; NOT NULL enforcement is deferred
-- to optional migration 216 (post-verify, separate PR).
--
-- Zero-downtime: ADD COLUMN IF NOT EXISTS (no lock), backfill via UPDATE
-- with IS NULL guard (idempotent), no NOT NULL in this migration.

-- 1. Add column (nullable)
ALTER TABLE turnos ADD COLUMN IF NOT EXISTS sucursal_id TEXT REFERENCES sucursales(id);

-- 2. Backfill: assign existing turnos to the principal sucursal of their org
UPDATE turnos t
SET sucursal_id = s.id
FROM sucursales s
WHERE t.sucursal_id IS NULL
  AND s.organization_id = t.organization_id
  AND s.principal = true
  AND s.deleted_at IS NULL;

-- 3. Index for branch-scoped queries
CREATE INDEX IF NOT EXISTS turnos_org_sucursal_inicio_idx
  ON turnos(organization_id, sucursal_id, inicio);
