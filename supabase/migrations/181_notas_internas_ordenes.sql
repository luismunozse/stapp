-- ============================================
-- Migration 181: Notas internas en ordenes_servicio
-- Campo de uso interno (no visible al cliente en portal/PDF publico)
-- ============================================

ALTER TABLE ordenes_servicio
  ADD COLUMN IF NOT EXISTS notas_internas TEXT;

COMMENT ON COLUMN ordenes_servicio.notas_internas IS
  'Notas internas del equipo. NUNCA debe exponerse en endpoints publicos ni en PDFs/portales que ve el cliente.';
