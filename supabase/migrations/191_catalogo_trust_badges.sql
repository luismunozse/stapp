-- ============================================
-- 191: Catálogo — trust_badges (sellos de confianza)
-- ============================================
-- Array configurable de "trust badges" que se renderiza bajo el hero del
-- catálogo público. Refuerza percepción de seriedad/confianza:
--   - Envío a todo el país
--   - Garantía 6 meses
--   - Devolución 30 días
--   - Pago seguro
--   - etc.
--
-- Shape: jsonb array de objetos { icon: string, label: string }.
-- icon: clave de un set predefinido en el front (truck, shield, undo, card,
--       clock, star, check, phone, map).
-- label: texto libre <= 30 chars.
-- ============================================

ALTER TABLE catalogo_config
  ADD COLUMN IF NOT EXISTS trust_badges JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN catalogo_config.trust_badges IS
  'Array de {icon, label} renderizados como strip de confianza en el hero del catálogo público.';
