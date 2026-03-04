-- ========================================
-- 2FA TOTP para cuentas ADMIN
-- ========================================
-- Agrega soporte para autenticacion de dos factores
-- usando TOTP (Time-based One-Time Password)

-- Agregar columnas de 2FA a la tabla users
ALTER TABLE users
ADD COLUMN IF NOT EXISTS totp_secret TEXT,
ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS totp_backup_codes TEXT[],
ADD COLUMN IF NOT EXISTS totp_verified_at TIMESTAMPTZ;

-- Indice para consultas de usuarios con 2FA activado
CREATE INDEX IF NOT EXISTS idx_users_totp_enabled
ON users(totp_enabled)
WHERE totp_enabled = true;

-- Comentarios
COMMENT ON COLUMN users.totp_secret IS 'Secreto TOTP encriptado (AES-256) para generar codigos 2FA';
COMMENT ON COLUMN users.totp_enabled IS 'Indica si el usuario tiene 2FA activado';
COMMENT ON COLUMN users.totp_backup_codes IS 'Backup codes hasheados para recuperacion de acceso';
COMMENT ON COLUMN users.totp_verified_at IS 'Fecha en que se verifico y activo el 2FA';
