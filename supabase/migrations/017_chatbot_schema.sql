-- ========================================
-- MÓDULO CHATBOT "SANTI"
-- ========================================

-- ========================================
-- ENUMS
-- ========================================

CREATE TYPE estado_lead AS ENUM (
  'NUEVO',
  'CONTACTADO',
  'CALIFICADO',
  'CONVERTIDO',
  'DESCARTADO'
);

CREATE TYPE origen_lead AS ENUM (
  'CHATBOT',
  'FORMULARIO',
  'OTRO'
);

CREATE TYPE tipo_mensaje_chatbot AS ENUM (
  'USER',
  'ASSISTANT',
  'SYSTEM'
);

-- ========================================
-- TABLA: leads
-- ========================================
-- Nota: Leads inicialmente NO tienen organization_id (son anónimos)
-- Se asigna organización cuando el admin los gestiona

CREATE TABLE leads (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),

  -- Información del lead
  nombre TEXT,
  email TEXT,
  telefono TEXT,
  empresa TEXT,

  -- Estado y origen
  estado estado_lead DEFAULT 'NUEVO',
  origen origen_lead DEFAULT 'CHATBOT',

  -- Información capturada durante la conversación
  interes TEXT, -- Ej: "precios", "demo", "funcionalidades"
  plan_interes TEXT, -- Ej: "Free", "Premium", "Enterprise"

  -- Asignación (cuando se gestiona desde el admin)
  organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  assigned_to TEXT REFERENCES users(id) ON DELETE SET NULL,

  -- Notas del admin
  notas TEXT,

  -- Timestamps
  ultima_interaccion TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ========================================
-- TABLA: chatbot_conversaciones
-- ========================================

CREATE TABLE chatbot_conversaciones (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),

  -- Identificador de sesión (generado en el navegador)
  session_id TEXT NOT NULL,

  -- Relación con lead (se establece cuando se captura el lead)
  lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,

  -- Metadata de tracking
  ip_address TEXT,
  user_agent TEXT,
  referrer TEXT,

  -- Estado de la conversación
  activa BOOLEAN DEFAULT TRUE,
  lead_capturado BOOLEAN DEFAULT FALSE,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ========================================
-- TABLA: chatbot_mensajes
-- ========================================

CREATE TABLE chatbot_mensajes (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  conversacion_id TEXT NOT NULL REFERENCES chatbot_conversaciones(id) ON DELETE CASCADE,

  -- Contenido del mensaje
  tipo tipo_mensaje_chatbot NOT NULL,
  contenido TEXT NOT NULL,

  -- Metadata de IA (solo para mensajes de ASSISTANT)
  modelo TEXT, -- Ej: "gemini-1.5-flash"
  tokens_usados INTEGER,
  tiempo_respuesta_ms INTEGER,

  -- Detección de intención
  intencion_detectada TEXT, -- Ej: "solicitar_demo", "preguntar_precio", "proporcionar_contacto"
  confianza NUMERIC(3, 2), -- 0.00 a 1.00

  -- Timestamp
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ========================================
-- ÍNDICES PARA PERFORMANCE
-- ========================================

-- Leads
CREATE INDEX idx_leads_estado ON leads(estado);
CREATE INDEX idx_leads_created_at ON leads(created_at DESC);
CREATE INDEX idx_leads_organization_id ON leads(organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX idx_leads_email ON leads(email) WHERE email IS NOT NULL;
CREATE INDEX idx_leads_telefono ON leads(telefono) WHERE telefono IS NOT NULL;
CREATE INDEX idx_leads_ultima_interaccion ON leads(ultima_interaccion DESC) WHERE ultima_interaccion IS NOT NULL;

-- Conversaciones
CREATE INDEX idx_chatbot_conversaciones_session ON chatbot_conversaciones(session_id);
CREATE INDEX idx_chatbot_conversaciones_lead ON chatbot_conversaciones(lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX idx_chatbot_conversaciones_activa ON chatbot_conversaciones(activa) WHERE activa = TRUE;
CREATE INDEX idx_chatbot_conversaciones_created ON chatbot_conversaciones(created_at DESC);

-- Mensajes
CREATE INDEX idx_chatbot_mensajes_conversacion ON chatbot_mensajes(conversacion_id);
CREATE INDEX idx_chatbot_mensajes_created_at ON chatbot_mensajes(created_at DESC);
CREATE INDEX idx_chatbot_mensajes_tipo ON chatbot_mensajes(tipo);
CREATE INDEX idx_chatbot_mensajes_intencion ON chatbot_mensajes(intencion_detectada) WHERE intencion_detectada IS NOT NULL;

-- ========================================
-- TRIGGERS
-- ========================================

-- Trigger para actualizar updated_at en leads
CREATE TRIGGER update_leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Trigger para actualizar updated_at en conversaciones
CREATE TRIGGER update_chatbot_conversaciones_updated_at
  BEFORE UPDATE ON chatbot_conversaciones
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Trigger para actualizar ultima_interaccion del lead cuando se crea un mensaje
CREATE OR REPLACE FUNCTION update_lead_ultima_interaccion()
RETURNS TRIGGER AS $$
BEGIN
  -- Actualizar ultima_interaccion del lead asociado a la conversación
  UPDATE leads
  SET ultima_interaccion = NOW()
  WHERE id = (
    SELECT lead_id
    FROM chatbot_conversaciones
    WHERE id = NEW.conversacion_id
  )
  AND id IS NOT NULL;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_lead_interaccion
  AFTER INSERT ON chatbot_mensajes
  FOR EACH ROW
  EXECUTE FUNCTION update_lead_ultima_interaccion();

-- ========================================
-- RLS POLICIES
-- ========================================

-- LEADS: Solo accesibles por usuarios autenticados de la misma organización
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

-- Los leads anónimos (sin organization_id) NO son accesibles vía RLS
-- Solo se pueden crear desde el endpoint público

CREATE POLICY "Admins pueden ver leads de su organización"
  ON leads FOR SELECT
  USING (
    organization_id IS NOT NULL AND
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()::text
    )
  );

CREATE POLICY "Admins pueden actualizar leads de su organización"
  ON leads FOR UPDATE
  USING (
    organization_id IS NOT NULL AND
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()::text
    )
  );

-- CONVERSACIONES: Públicas para creación/lectura (sin autenticación)
ALTER TABLE chatbot_conversaciones ENABLE ROW LEVEL SECURITY;

-- Cualquiera puede crear conversaciones (público)
CREATE POLICY "Público puede crear conversaciones"
  ON chatbot_conversaciones FOR INSERT
  WITH CHECK (true);

-- Cualquiera puede leer conversaciones (necesario para el chatbot público)
CREATE POLICY "Público puede leer conversaciones"
  ON chatbot_conversaciones FOR SELECT
  USING (true);

-- Cualquiera puede actualizar conversaciones (para marcar lead_capturado)
CREATE POLICY "Público puede actualizar conversaciones"
  ON chatbot_conversaciones FOR UPDATE
  USING (true);

-- Admins autenticados pueden ver todas las conversaciones con leads
CREATE POLICY "Admins pueden ver conversaciones con leads"
  ON chatbot_conversaciones FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users WHERE id = auth.uid()::text
    )
  );

-- MENSAJES: Públicos para creación/lectura (sin autenticación)
ALTER TABLE chatbot_mensajes ENABLE ROW LEVEL SECURITY;

-- Cualquiera puede crear mensajes (público)
CREATE POLICY "Público puede crear mensajes"
  ON chatbot_mensajes FOR INSERT
  WITH CHECK (true);

-- Cualquiera puede leer mensajes (necesario para el chatbot público)
CREATE POLICY "Público puede leer mensajes"
  ON chatbot_mensajes FOR SELECT
  USING (true);

-- Admins autenticados pueden ver todos los mensajes
CREATE POLICY "Admins pueden ver todos los mensajes"
  ON chatbot_mensajes FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users WHERE id = auth.uid()::text
    )
  );

-- ========================================
-- FUNCIONES ÚTILES
-- ========================================

-- Función para obtener estadísticas de leads
CREATE OR REPLACE FUNCTION get_leads_stats(org_id TEXT DEFAULT NULL)
RETURNS TABLE(
  total_leads BIGINT,
  nuevos BIGINT,
  contactados BIGINT,
  calificados BIGINT,
  convertidos BIGINT,
  descartados BIGINT,
  tasa_conversion NUMERIC(5,2)
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT as total_leads,
    COUNT(*) FILTER (WHERE estado = 'NUEVO')::BIGINT as nuevos,
    COUNT(*) FILTER (WHERE estado = 'CONTACTADO')::BIGINT as contactados,
    COUNT(*) FILTER (WHERE estado = 'CALIFICADO')::BIGINT as calificados,
    COUNT(*) FILTER (WHERE estado = 'CONVERTIDO')::BIGINT as convertidos,
    COUNT(*) FILTER (WHERE estado = 'DESCARTADO')::BIGINT as descartados,
    CASE
      WHEN COUNT(*) > 0 THEN
        ROUND((COUNT(*) FILTER (WHERE estado = 'CONVERTIDO')::DECIMAL / COUNT(*)::DECIMAL * 100), 2)
      ELSE 0
    END as tasa_conversion
  FROM leads
  WHERE (org_id IS NULL OR organization_id = org_id);
END;
$$ LANGUAGE plpgsql;

-- Comentarios de documentación
COMMENT ON TABLE leads IS 'Leads capturados por el chatbot Santi. Inicialmente anónimos (sin organization_id).';
COMMENT ON TABLE chatbot_conversaciones IS 'Sesiones de conversación del chatbot. Identificadas por session_id del navegador.';
COMMENT ON TABLE chatbot_mensajes IS 'Mensajes individuales de las conversaciones. Incluye metadata de IA y detección de intenciones.';
COMMENT ON FUNCTION get_leads_stats IS 'Obtiene estadísticas de leads para una organización (o todas si org_id es NULL).';
