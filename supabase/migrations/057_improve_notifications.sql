-- ========================================
-- MEJORAS AL SISTEMA DE NOTIFICACIONES
-- ========================================

-- 1. Tabla de broadcasts para historial (#7)
CREATE TABLE broadcasts (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  action_url TEXT,
  target TEXT NOT NULL DEFAULT 'all',
  filters JSONB,
  total_users INTEGER NOT NULL DEFAULT 0,
  sent_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX broadcasts_created_idx ON broadcasts(created_at DESC);

ALTER TABLE broadcasts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to broadcasts"
  ON broadcasts FOR ALL
  USING (true)
  WITH CHECK (true);

-- 2. Agregar broadcast_id a user_notifications
ALTER TABLE user_notifications ADD COLUMN broadcast_id TEXT REFERENCES broadcasts(id) ON DELETE SET NULL;
CREATE INDEX user_notifications_broadcast_idx ON user_notifications(broadcast_id) WHERE broadcast_id IS NOT NULL;

-- 3. Mejorar RLS: policy mas estricta por user_id (#9)
DROP POLICY IF EXISTS "Users can view own org notifications" ON user_notifications;

CREATE POLICY "Users can view own notifications"
  ON user_notifications FOR SELECT
  USING (
    user_id IN (
      SELECT id FROM users WHERE id = (current_setting('app.current_user_id', true))::text
    )
  );

-- Policy para que usuarios puedan eliminar sus propias notificaciones
CREATE POLICY "Users can delete own notifications"
  ON user_notifications FOR DELETE
  USING (
    user_id IN (
      SELECT id FROM users WHERE id = (current_setting('app.current_user_id', true))::text
    )
  );

-- 4. Tabla para push tokens (Capacitor) (#10)
CREATE TABLE push_tokens (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'android',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, token)
);

CREATE INDEX push_tokens_user_idx ON push_tokens(user_id) WHERE active = true;
CREATE INDEX push_tokens_org_idx ON push_tokens(organization_id) WHERE active = true;

ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to push_tokens"
  ON push_tokens FOR ALL
  USING (true)
  WITH CHECK (true);
