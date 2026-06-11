-- Migration 203: internal labor cost in profitability (#3)
-- Adds an hourly cost per employee and manual hours per order; labor cost is a
-- generated column from a per-order snapshot of the rate (mirrors the
-- porcentaje_comision snapshot in migration 119 and the generated duracion_minutos
-- in migration 068).

-- Employee internal hourly cost
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS costo_hora DECIMAL(10,2) NOT NULL DEFAULT 0
  CHECK (costo_hora >= 0);

-- Per-order manual hours + rate snapshot + derived labor cost
ALTER TABLE ordenes_servicio
  ADD COLUMN IF NOT EXISTS horas_trabajadas DECIMAL(6,2) NOT NULL DEFAULT 0
  CHECK (horas_trabajadas >= 0);

ALTER TABLE ordenes_servicio
  ADD COLUMN IF NOT EXISTS costo_hora_snapshot DECIMAL(10,2)
  CHECK (costo_hora_snapshot IS NULL OR costo_hora_snapshot >= 0);

ALTER TABLE ordenes_servicio
  ADD COLUMN IF NOT EXISTS costo_mano_obra DECIMAL(12,2)
  GENERATED ALWAYS AS (COALESCE(horas_trabajadas, 0) * COALESCE(costo_hora_snapshot, 0)) STORED;

COMMENT ON COLUMN users.costo_hora IS 'Costo interno por hora del empleado (ARS).';
COMMENT ON COLUMN ordenes_servicio.horas_trabajadas IS 'Horas de mano de obra cargadas manualmente.';
COMMENT ON COLUMN ordenes_servicio.costo_hora_snapshot IS 'Snapshot de users.costo_hora al asignar el tecnico.';
COMMENT ON COLUMN ordenes_servicio.costo_mano_obra IS 'Generada: horas_trabajadas * costo_hora_snapshot.';
