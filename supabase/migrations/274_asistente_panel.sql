-- ============================================================================
-- 274: asistente IA del panel — conversaciones, mensajes y flag de plan
-- ============================================================================
-- Asistente de ayuda dentro del panel (guía de uso basada en el manual).
-- Solo para plan Profesional ACTIVO (el gate de trial se aplica en app-layer).
-- asistente_mensajes lleva organization_id denormalizado para contar el tope
-- diario por org con un count directo (sin join) y para RLS simple.
-- ============================================================================

-- (1) Conversaciones
CREATE TABLE IF NOT EXISTS asistente_conversaciones (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  usuario_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS asistente_conversaciones_org_idx
  ON asistente_conversaciones(organization_id);
CREATE INDEX IF NOT EXISTS asistente_conversaciones_usuario_idx
  ON asistente_conversaciones(usuario_id);

ALTER TABLE asistente_conversaciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS asistente_conversaciones_select ON asistente_conversaciones;
CREATE POLICY asistente_conversaciones_select ON asistente_conversaciones
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS asistente_conversaciones_all_service ON asistente_conversaciones;
CREATE POLICY asistente_conversaciones_all_service ON asistente_conversaciones
  FOR ALL USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS asistente_conversaciones_updated_at ON asistente_conversaciones;
CREATE TRIGGER asistente_conversaciones_updated_at
  BEFORE UPDATE ON asistente_conversaciones
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- (2) Mensajes (con tokens para costo real por org)
CREATE TABLE IF NOT EXISTS asistente_mensajes (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  conversacion_id TEXT NOT NULL REFERENCES asistente_conversaciones(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('USER', 'ASSISTANT')),
  contenido TEXT NOT NULL,
  modelo TEXT,
  input_tokens INTEGER,
  cache_read_input_tokens INTEGER,
  cache_creation_input_tokens INTEGER,
  output_tokens INTEGER,
  tiempo_respuesta_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS asistente_mensajes_conversacion_idx
  ON asistente_mensajes(conversacion_id);
-- Índice para el tope diario: count por org + tipo + fecha
CREATE INDEX IF NOT EXISTS asistente_mensajes_org_tipo_created_idx
  ON asistente_mensajes(organization_id, tipo, created_at);

ALTER TABLE asistente_mensajes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS asistente_mensajes_select ON asistente_mensajes;
CREATE POLICY asistente_mensajes_select ON asistente_mensajes
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS asistente_mensajes_all_service ON asistente_mensajes;
CREATE POLICY asistente_mensajes_all_service ON asistente_mensajes
  FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE asistente_conversaciones IS 'Conversaciones del asistente IA del panel (guía de uso)';
COMMENT ON TABLE asistente_mensajes IS 'Mensajes del asistente del panel, con tokens de la API para costo por org';

-- (3) Flag de plan: solo Profesional
UPDATE plans SET
  feature_flags = COALESCE(feature_flags, '{}'::jsonb) || '{"asistente_ia": true}'::jsonb,
  updated_at = NOW()
WHERE slug = 'profesional';
