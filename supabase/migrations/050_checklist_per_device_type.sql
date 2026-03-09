-- Add tipo_dispositivo_id to checklist_templates for per-device-type checklists
ALTER TABLE checklist_templates
  ADD COLUMN IF NOT EXISTS tipo_dispositivo_id TEXT REFERENCES tipos_dispositivo(id) ON DELETE SET NULL;

-- Drop the existing unique constraint on (organization_id, nombre) and create a new one
-- that includes tipo_dispositivo_id, allowing same-name templates for different device types
ALTER TABLE checklist_templates DROP CONSTRAINT IF EXISTS checklist_templates_organization_id_nombre_key;
ALTER TABLE checklist_templates
  ADD CONSTRAINT checklist_templates_org_nombre_tipo_key
  UNIQUE (organization_id, nombre, tipo_dispositivo_id);

-- Index for quick lookup by device type
CREATE INDEX IF NOT EXISTS checklist_templates_tipo_dispositivo_idx
  ON checklist_templates(tipo_dispositivo_id);
