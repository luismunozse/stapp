-- ============================================
-- Migration 105: Inventario — imagen y proveedor como FK
-- ============================================
-- Parte de la Fase 2 del plan de mejoras al módulo /inventario:
--  - Permite asociar una imagen al item (identificación visual).
--  - Convierte el campo `proveedor` (texto libre) en una FK real a
--    la tabla `proveedores` que ya existe. Mantenemos la columna
--    `proveedor` como fallback durante la transición.
--
-- El bucket de storage `fotos-inventario` se crea en el archivo
-- complementario 106_fotos_inventario_bucket.sql para que cada cambio
-- quede aislado y fácil de revertir.
-- ============================================

-- 1. Imagen
ALTER TABLE public.inventario
  ADD COLUMN IF NOT EXISTS imagen_url TEXT,
  ADD COLUMN IF NOT EXISTS imagen_path TEXT; -- path en el bucket para poder borrar

-- 2. Proveedor como FK
--    NOTA: el schema usa TEXT con generate_cuid() para todos los PKs,
--    no UUID. Por eso proveedor_id es TEXT, no UUID.
ALTER TABLE public.inventario
  ADD COLUMN IF NOT EXISTS proveedor_id TEXT REFERENCES public.proveedores(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS inventario_proveedor_id_idx
  ON public.inventario(proveedor_id)
  WHERE proveedor_id IS NOT NULL;

-- 3. Backfill best-effort: matchear por nombre dentro de la misma org.
--    Case-insensitive y trimmed. Items con typos quedan con proveedor_id NULL
--    pero conservan el texto original en la columna `proveedor`.
UPDATE public.inventario i
SET proveedor_id = p.id
FROM public.proveedores p
WHERE p.organization_id = i.organization_id
  AND i.proveedor IS NOT NULL
  AND LOWER(TRIM(p.nombre)) = LOWER(TRIM(i.proveedor))
  AND i.proveedor_id IS NULL;

COMMENT ON COLUMN public.inventario.proveedor IS
  'DEPRECATED: texto libre histórico. Usar proveedor_id. Se mantiene durante la transición.';
COMMENT ON COLUMN public.inventario.proveedor_id IS
  'FK a proveedores. Reemplaza el campo texto `proveedor`.';
COMMENT ON COLUMN public.inventario.imagen_url IS
  'URL pública de la imagen del item (bucket fotos-inventario).';
COMMENT ON COLUMN public.inventario.imagen_path IS
  'Path en el bucket fotos-inventario. Usado para borrar la imagen al reemplazarla o eliminarla.';
