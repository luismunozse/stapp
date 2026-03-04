-- ========================================
-- Waitlist para app iOS
-- ========================================
-- Captura emails de usuarios interesados
-- en la futura app nativa para iOS

CREATE TABLE IF NOT EXISTS ios_waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE ios_waitlist ENABLE ROW LEVEL SECURITY;

-- Cualquier visitante puede registrarse
CREATE POLICY "Público puede registrarse en waitlist iOS"
  ON ios_waitlist FOR INSERT
  WITH CHECK (true);

-- Solo usuarios autenticados (admin) pueden ver los registros
CREATE POLICY "Admins pueden ver waitlist iOS"
  ON ios_waitlist FOR SELECT
  USING (auth.role() = 'authenticated');

COMMENT ON TABLE ios_waitlist IS 'Emails de usuarios interesados en la app iOS';
