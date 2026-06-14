-- Soft-delete para organizations.
-- Reemplaza el hard-delete por defecto: archivar setea deleted_at; el borrado
-- permanente queda detras de un flag explicito en la API.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS deleted_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by      TEXT,        -- email del superadmin
  ADD COLUMN IF NOT EXISTS archived_reason TEXT;

-- Indice parcial: acelera el listado "no archivadas" (deleted_at IS NULL).
CREATE INDEX IF NOT EXISTS idx_organizations_not_deleted
  ON organizations (id)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN organizations.deleted_at IS
  'Soft-delete: si no es NULL, la org esta archivada y el tenant queda inaccesible.';
