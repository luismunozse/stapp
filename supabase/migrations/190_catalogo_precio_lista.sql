-- ============================================
-- 190: Catálogo — precio_lista (anchor pricing)
-- ============================================
-- Precio de lista / antes-de-descuento. Cuando se setea y es mayor que precio,
-- la UI lo renderiza tachado al lado del precio actual para reforzar percepción
-- de descuento (anchor pricing). NULL = sin anchor.
-- ============================================

ALTER TABLE catalogo_items
  ADD COLUMN IF NOT EXISTS precio_lista DECIMAL(10,2)
    CHECK (precio_lista IS NULL OR precio_lista >= 0);

COMMENT ON COLUMN catalogo_items.precio_lista IS
  'Precio de lista (anchor). Si > precio, UI lo muestra tachado para indicar descuento.';
