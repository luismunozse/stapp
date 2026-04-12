-- ============================================
-- Migration 106: Bucket de fotos de inventario
-- ============================================
-- Hermano de 105: agrega el bucket para las imágenes de items.
-- Uploads server-side vía supabaseAdmin (bypass RLS).
-- Lectura pública para que las URLs sirvan directamente en la UI.
-- ============================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'fotos-inventario',
  'fotos-inventario',
  true,
  5242880, -- 5MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Lectura pública
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Public read for fotos-inventario'
  ) THEN
    CREATE POLICY "Public read for fotos-inventario"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'fotos-inventario');
  END IF;
END$$;
