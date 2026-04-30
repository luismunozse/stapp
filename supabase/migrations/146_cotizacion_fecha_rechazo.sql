-- ============================================
-- 146: Cotizaciones - fecha de rechazo
-- ============================================
-- Simetría con fecha_aprobacion. Persiste el momento exacto en que el cliente
-- rechazó la cotización desde el portal público (o el taller internamente).
-- ============================================

ALTER TABLE cotizaciones
  ADD COLUMN IF NOT EXISTS fecha_rechazo TIMESTAMPTZ;

COMMENT ON COLUMN cotizaciones.fecha_rechazo IS 'Fecha/hora del rechazo de la cotización. Complemento de motivo_rechazo (082).';
