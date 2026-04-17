-- ========================================
-- Suscriptores del newsletter del blog
-- ========================================
-- Captura emails de visitantes del blog
-- interesados en recibir novedades

CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  source TEXT DEFAULT 'blog',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE newsletter_subscribers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Público puede suscribirse al newsletter"
  ON newsletter_subscribers FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Admins pueden ver suscriptores"
  ON newsletter_subscribers FOR SELECT
  USING (auth.role() = 'authenticated');

COMMENT ON TABLE newsletter_subscribers IS 'Emails suscritos al newsletter del blog';
