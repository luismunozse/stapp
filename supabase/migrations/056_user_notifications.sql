-- ========================================
-- USER NOTIFICATIONS (in-app)
-- ========================================

CREATE TABLE user_notifications (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Contenido
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  type TEXT NOT NULL,
  icon TEXT,

  -- Navegacion
  action_url TEXT,

  -- Entidades relacionadas
  orden_id TEXT REFERENCES ordenes_servicio(id) ON DELETE SET NULL,
  cliente_id TEXT REFERENCES clientes(id) ON DELETE SET NULL,

  -- Estado
  read_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indices
CREATE INDEX user_notifications_user_org_idx ON user_notifications(user_id, organization_id);
CREATE INDEX user_notifications_user_unread_idx ON user_notifications(user_id) WHERE read_at IS NULL;
CREATE INDEX user_notifications_created_idx ON user_notifications(created_at DESC);
CREATE INDEX user_notifications_org_idx ON user_notifications(organization_id);

-- RLS
ALTER TABLE user_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own org notifications"
  ON user_notifications FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM users WHERE id = (current_setting('app.current_user_id', true))::text
  ));

CREATE POLICY "Service role full access to user_notifications"
  ON user_notifications FOR ALL
  USING (true)
  WITH CHECK (true);

-- Limpieza automatica: funcion para borrar notificaciones viejas (>90 dias)
CREATE OR REPLACE FUNCTION cleanup_old_notifications()
RETURNS void AS $$
BEGIN
  DELETE FROM user_notifications
  WHERE created_at < NOW() - INTERVAL '90 days';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
