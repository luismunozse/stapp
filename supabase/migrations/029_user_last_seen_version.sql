-- Campo para rastrear la última versión de la app que vio el usuario
-- Se usa para mostrar el modal de "Novedades" al ingresar al panel
ALTER TABLE users
ADD COLUMN IF NOT EXISTS last_seen_version TEXT;
