-- ========================================
-- ARREGLAR CONTRASEÑA DEL USUARIO DEMO
-- ========================================
-- Este script actualiza la contraseña del usuario demo
-- al hash correcto para "Demo2024!"

UPDATE users
SET password = '$2a$10$20V80C9mS.iyUun6uZu7n.JkeOlfuwSjGvJSwIZeSDdD/tbD1oQD6'
WHERE email = 'demo@stapp.com';

-- Verificar que se actualizó
SELECT
  email,
  nombre,
  rol,
  LEFT(password, 15) || '...' as password_preview,
  LENGTH(password) as password_length,
  CASE
    WHEN password = '$2a$10$20V80C9mS.iyUun6uZu7n.JkeOlfuwSjGvJSwIZeSDdD/tbD1oQD6' THEN '✅ Contraseña actualizada correctamente'
    ELSE '❌ Contraseña no coincide'
  END as status
FROM users
WHERE email = 'demo@stapp.com';
