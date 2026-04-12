-- =============================================
-- 115: Mejoras a audit_logs
--
-- 1. user_id nullable: login events para usuarios
--    inexistentes no pueden referenciar un user_id.
--    Esto causaba que LOGIN/LOGIN_FAILED/LOGOUT
--    silenciosamente fallaran el INSERT por NOT NULL.
--
-- 2. description column: campo legible para mostrar
--    qué cambió, sin necesidad de parsear el JSONB.
--
-- 3. Índices adicionales para las nuevas queries
--    (distribución horaria, alertas de actividad).
-- =============================================

-- 1. Permitir user_id NULL
ALTER TABLE audit_logs ALTER COLUMN user_id DROP NOT NULL;

-- 2. Agregar columna description
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS description TEXT;

-- 3. Índice para queries de distribución temporal (gráficos de actividad)
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
  ON audit_logs (created_at DESC);

-- 4. Índice para buscar por acción + fecha (tabs Security/Superadmin)
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_created
  ON audit_logs (action, created_at DESC);

-- =============================================
-- Tabla de configuración de alertas de auditoría
-- Permite al superadmin configurar umbrales sin redeploy.
-- =============================================
CREATE TABLE IF NOT EXISTS audit_alert_config (
  id TEXT PRIMARY KEY DEFAULT 'default',
  -- Umbral de eventos por usuario en un período
  user_activity_threshold INTEGER DEFAULT 100,
  user_activity_window_hours INTEGER DEFAULT 1,
  -- Umbral de logins fallidos para alerta
  failed_login_threshold INTEGER DEFAULT 5,
  failed_login_window_hours INTEGER DEFAULT 24,
  -- Política de retención (días en caliente)
  retention_days INTEGER DEFAULT 90,
  -- Metadata
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by TEXT
);

-- Insertar config por defecto
INSERT INTO audit_alert_config (id) VALUES ('default') ON CONFLICT DO NOTHING;
