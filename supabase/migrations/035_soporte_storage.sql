-- ========================================
-- STORAGE: Bucket para adjuntos de soporte
-- ========================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('soporte-attachments', 'soporte-attachments', true, 5242880,
   ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY "soporte_attachments_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'soporte-attachments');

CREATE POLICY "soporte_attachments_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'soporte-attachments');

CREATE POLICY "soporte_attachments_delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'soporte-attachments');
