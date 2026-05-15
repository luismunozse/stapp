-- ============================================
-- Migration 163: Ubicación física del repuesto en el depósito
-- ============================================
-- Texto libre para que cada org use su propio esquema
-- (ej: "Rack 1 / Fila 2 / Columna 3" o "Estante A-12").

ALTER TABLE inventario
  ADD COLUMN IF NOT EXISTS ubicacion TEXT;

CREATE INDEX IF NOT EXISTS inventario_ubicacion_idx
  ON inventario(organization_id, ubicacion)
  WHERE ubicacion IS NOT NULL;
