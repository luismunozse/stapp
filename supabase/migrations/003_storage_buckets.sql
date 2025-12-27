-- ========================================
-- STORAGE BUCKETS
-- ========================================
-- Ejecutar en Supabase Dashboard > Storage o via SQL

-- Crear buckets
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('fotos-ordenes', 'fotos-ordenes', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']),
  ('logos', 'logos', true, 2097152, ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml']),
  ('firmas', 'firmas', true, 1048576, ARRAY['image/png', 'image/jpeg'])
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ========================================
-- POLÍTICAS DE STORAGE
-- ========================================

-- FOTOS DE ÓRDENES
-- Estructura: fotos-ordenes/{organization_id}/{orden_id}/{filename}

-- Lectura pública (las URLs son públicas)
CREATE POLICY "Public read for order photos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'fotos-ordenes');

-- Upload solo para usuarios de la organización
CREATE POLICY "Org users can upload order photos"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'fotos-ordenes' AND
    (storage.foldername(name))[1] = auth.organization_id()
  );

-- Delete solo para usuarios de la organización
CREATE POLICY "Org users can delete order photos"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'fotos-ordenes' AND
    (storage.foldername(name))[1] = auth.organization_id()
  );

-- LOGOS
-- Estructura: logos/{organization_id}/{filename}

CREATE POLICY "Public read for logos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'logos');

CREATE POLICY "Org users can upload logos"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'logos' AND
    (storage.foldername(name))[1] = auth.organization_id()
  );

CREATE POLICY "Org users can delete logos"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'logos' AND
    (storage.foldername(name))[1] = auth.organization_id()
  );

CREATE POLICY "Org users can update logos"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'logos' AND
    (storage.foldername(name))[1] = auth.organization_id()
  );

-- FIRMAS
-- Estructura: firmas/{organization_id}/{entity_type}/{entity_id}/{filename}

CREATE POLICY "Public read for signatures"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'firmas');

CREATE POLICY "Org users can upload signatures"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'firmas' AND
    (storage.foldername(name))[1] = auth.organization_id()
  );

CREATE POLICY "Org users can delete signatures"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'firmas' AND
    (storage.foldername(name))[1] = auth.organization_id()
  );
