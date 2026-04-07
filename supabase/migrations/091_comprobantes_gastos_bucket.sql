-- ============================================
-- Migration 091: Bucket de comprobantes de gastos
-- ============================================
-- Permite adjuntar facturas/recibos (imagen o PDF) a movimientos de caja.
-- Uploads vía supabaseAdmin (server-side, bypassa RLS).
-- Lectura: pública para que las URLs sirvan en la UI.
-- ============================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'comprobantes-gastos',
  'comprobantes-gastos',
  true,
  5242880, -- 5MB
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
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
      AND policyname = 'Public read for comprobantes-gastos'
  ) THEN
    CREATE POLICY "Public read for comprobantes-gastos"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'comprobantes-gastos');
  END IF;
END$$;
