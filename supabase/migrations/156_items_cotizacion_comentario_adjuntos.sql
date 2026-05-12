-- ========================================
-- 156: items_cotizacion — comentario del cliente + adjuntos
-- ========================================
-- Use case: catálogo público en taller técnico. Cliente solicita reparación
-- y necesita adjuntar foto del daño + comentario por item ("pantalla rota,
-- lado superior derecho"). Antes solo se podía agregar nota global.
-- Adjuntos: URLs públicas de Supabase Storage (bucket "catalogo").
-- ========================================

ALTER TABLE items_cotizacion
  ADD COLUMN IF NOT EXISTS comentario_cliente TEXT,
  ADD COLUMN IF NOT EXISTS adjuntos TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN items_cotizacion.comentario_cliente IS
  'Texto libre que el cliente agrega al item desde el catálogo público. Útil para describir daños o requerimientos específicos.';

COMMENT ON COLUMN items_cotizacion.adjuntos IS
  'URLs públicas de fotos/archivos adjuntos al item de cotización.';
