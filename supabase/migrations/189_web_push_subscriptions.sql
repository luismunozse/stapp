-- ============================================================================
-- Migration 189: Web Push subscriptions (PWA browser notifications)
-- ============================================================================
-- Complementa push_tokens (migration 057) que maneja Capacitor/FCM nativo.
-- Esta tabla guarda subscriptions del Web Push API (browser).
--
-- Una PushSubscription tiene:
--   endpoint: URL del servicio de push (FCM web, Mozilla push, Apple push)
--   p256dh:   clave pública del cliente (Base64URL)
--   auth:     secreto compartido para autenticar payload (Base64URL)
--
-- Un user puede tener varias subs (un endpoint por browser/device).
-- Endpoint es único: si el mismo browser re-subscribe, se hace upsert.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS web_push_subscriptions (
  id              TEXT PRIMARY KEY DEFAULT generate_cuid(),
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  endpoint        TEXT NOT NULL UNIQUE,
  p256dh          TEXT NOT NULL,
  auth            TEXT NOT NULL,
  user_agent      TEXT,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  failure_count   INTEGER NOT NULL DEFAULT 0,
  last_used_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS web_push_subscriptions_user_idx
  ON web_push_subscriptions(user_id) WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS web_push_subscriptions_org_idx
  ON web_push_subscriptions(organization_id) WHERE active = TRUE;

ALTER TABLE web_push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_web_push_subscriptions"
  ON web_push_subscriptions FOR ALL
  TO service_role
  USING (TRUE) WITH CHECK (TRUE);

COMMIT;
