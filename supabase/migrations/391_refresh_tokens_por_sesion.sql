-- Refresh tokens por sesión, guardados como hash.
--
-- Hasta ahora cada usuario tenía UN refresh token, en claro, en
-- users.refresh_token: cada login pisaba el del dispositivo anterior y el valor
-- guardado servía tal cual para restaurar una sesión. Desde esta migración cada
-- sesión (login o restauración de la PWA) tiene su fila, con el SHA-256 del
-- token (lib/auth-tokens.ts).
--
-- users.refresh_token / refresh_token_expires quedan: el código sigue aceptando
-- los tokens viejos hasta que venzan (30 días como máximo) y los borra al
-- rotarlos. Se pueden quitar en una migración posterior.
--
-- Acceso: solo service_role (la app). RLS encendido sin políticas y sin
-- privilegios para anon/authenticated.
--
-- ORDEN: aplicar esta migración ANTES de desplegar el código. Sin la tabla,
-- ningún login puede guardar su refresh token.

SET LOCAL lock_timeout = '3s';

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          TEXT PRIMARY KEY DEFAULT generate_cuid(),
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT refresh_tokens_token_hash_formato CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT refresh_tokens_token_hash_unico UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens (user_id);

ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON refresh_tokens FROM anon, authenticated;

COMMENT ON TABLE refresh_tokens IS 'Una fila por sesión: SHA-256 del refresh token (el valor en claro no se guarda).';
