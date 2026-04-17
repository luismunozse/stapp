-- ========================================
-- Perfil extendido de técnicos
-- ========================================
-- Campos adicionales para gestión operativa:
--   - telefono: contacto rápido (ej. WhatsApp)
--   - activo: soft-disable para "jubilar" técnicos sin perder historial
--   - especialidades: tipos de dispositivo en los que es experto
--   - fecha_ingreso_tecnico: fecha oficial de alta en el taller
--     (created_at es la fecha de creación de la cuenta, no del vínculo laboral)
-- ========================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS telefono TEXT,
  ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS especialidades TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS fecha_ingreso_tecnico DATE;

CREATE INDEX IF NOT EXISTS users_org_rol_activo_idx
  ON users(organization_id, rol, activo);

COMMENT ON COLUMN users.activo IS 'Soft-disable: FALSE oculta al usuario de asignaciones nuevas pero conserva historial';
COMMENT ON COLUMN users.especialidades IS 'Tipos de dispositivo: CELULAR, NOTEBOOK, TV, IMPRESORA, etc.';
COMMENT ON COLUMN users.fecha_ingreso_tecnico IS 'Fecha de alta laboral (distinto de created_at que es la creación de la cuenta)';
