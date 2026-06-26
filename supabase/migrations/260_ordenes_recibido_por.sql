-- ========================================
-- Migration 260: ordenes_servicio.recibido_por
-- ========================================
-- Quién RECIBIÓ el equipo en la recepción (operador del mostrador), distinto de
-- tecnico_id (quién repara). Selección libre, nullable. Sin backfill.

ALTER TABLE ordenes_servicio
  ADD COLUMN IF NOT EXISTS recibido_por TEXT REFERENCES users(id);

CREATE INDEX IF NOT EXISTS ordenes_recibido_por_idx
  ON ordenes_servicio(organization_id, recibido_por);
