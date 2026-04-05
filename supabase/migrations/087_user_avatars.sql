-- ========================================
-- USER AVATARS
-- ========================================

-- Agregar columna avatar_url a users
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Crear bucket para avatars
-- Uploads se manejan server-side con supabaseAdmin (bypassa RLS)
-- Solo se necesita policy de lectura pública para servir las imágenes
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars', 'avatars', true, 2097152, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Lectura pública (para que las URLs de avatar sean accesibles)
CREATE POLICY "Public read for avatars"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');
