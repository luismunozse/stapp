-- ========================================
-- VERIFICAR USUARIO DEMO
-- ========================================
-- Script rápido para verificar si el usuario demo existe

SELECT
  u.id,
  u.email,
  u.nombre,
  u.rol,
  u.email_verified,
  u.organization_id,
  o.slug as org_slug,
  o.nombre as org_nombre,
  LENGTH(u.password) as password_length,
  -- Verificar si la contraseña es un hash bcrypt válido (empieza con $2a$ o $2b$)
  CASE
    WHEN u.password LIKE '$2a$%' OR u.password LIKE '$2b$%' THEN 'Hash bcrypt válido'
    ELSE 'NO es hash bcrypt'
  END as password_type
FROM users u
LEFT JOIN organizations o ON u.organization_id = o.id
WHERE u.email = 'demo@stapp.com';

-- Si el resultado está vacío, el usuario NO existe
-- Si existe, verifica:
-- 1. email_verified debe ser true
-- 2. rol debe ser ADMIN
-- 3. password_type debe ser 'Hash bcrypt válido'
-- 4. password_length debe ser 60 caracteres (típico de bcrypt)
