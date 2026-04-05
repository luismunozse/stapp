-- ========================================
-- SUPERADMIN SETUP
-- ========================================
-- Crear organización y usuario SuperAdmin
-- El usuario admin@stapp.com.ar NO necesita verificar su email

-- Primero agregar campos de verificación de email si no existen
ALTER TABLE users
ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS email_verification_token TEXT,
ADD COLUMN IF NOT EXISTS email_verification_expires TIMESTAMPTZ;

-- Crear índice para tokens de verificación
CREATE INDEX IF NOT EXISTS users_email_verification_token_idx
ON users(email_verification_token)
WHERE email_verification_token IS NOT NULL;

-- Crear organización SuperAdmin
INSERT INTO organizations (id, nombre, slug, email, activo)
VALUES (
  'superadmin_org_001',
  'SuperAdmin Panel',
  'superadmin',
  'admin@stapp.com.ar',
  true
)
ON CONFLICT (slug) DO NOTHING;

-- Crear contador para la organización SuperAdmin
INSERT INTO organization_counters (organization_id)
VALUES ('superadmin_org_001')
ON CONFLICT (organization_id) DO NOTHING;

-- Crear usuario SuperAdmin
-- Email: admin@stapp.com.ar
-- IMPORTANTE: Cambiar la contraseña después del primer login
INSERT INTO users (
  email,
  password,
  nombre,
  rol,
  organization_id,
  email_verified
)
VALUES (
  'admin@stapp.com.ar',
  '$2a$10$TcasqwjxlKAiSAu2/YbKa.cqz0lNOHgefM5ZZtKgoBr0XRm0LCH.6',
  'SuperAdmin',
  'ADMIN',
  'superadmin_org_001',
  true
)
ON CONFLICT (email) DO UPDATE SET
  password = EXCLUDED.password,
  email_verified = EXCLUDED.email_verified;

-- Comentario informativo
COMMENT ON COLUMN users.email_verified IS 'Indica si el email del usuario ha sido verificado. SuperAdmin siempre tiene true.';
COMMENT ON COLUMN users.email_verification_token IS 'Token único para verificación de email (expira en 24 horas)';
COMMENT ON COLUMN users.email_verification_expires IS 'Fecha de expiración del token de verificación';
