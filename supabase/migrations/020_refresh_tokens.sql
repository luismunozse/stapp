-- Migración para agregar refresh tokens a usuarios
-- Esto permite mantener sesiones activas en PWA por más tiempo

-- Agregar campos de refresh token a usuarios
ALTER TABLE users
ADD COLUMN IF NOT EXISTS refresh_token TEXT,
ADD COLUMN IF NOT EXISTS refresh_token_expires TIMESTAMPTZ;

-- Crear índice para búsqueda rápida por refresh token
CREATE INDEX IF NOT EXISTS idx_users_refresh_token ON users(refresh_token) WHERE refresh_token IS NOT NULL;

-- Comentarios
COMMENT ON COLUMN users.refresh_token IS 'Token para refrescar la sesión automáticamente';
COMMENT ON COLUMN users.refresh_token_expires IS 'Fecha de expiración del refresh token';
