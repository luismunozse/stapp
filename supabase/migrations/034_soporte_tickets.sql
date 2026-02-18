-- ========================================
-- SOPORTE: Tickets y Mensajes
-- ========================================

CREATE TYPE tipo_ticket AS ENUM ('BUG', 'SUGERENCIA', 'PREGUNTA');
CREATE TYPE prioridad_ticket AS ENUM ('BAJA', 'MEDIA', 'ALTA');
CREATE TYPE estado_ticket AS ENUM ('ABIERTO', 'EN_PROCESO', 'RESUELTO', 'CERRADO');

-- ========================================
-- TABLA: support_tickets
-- ========================================
CREATE TABLE support_tickets (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tipo tipo_ticket NOT NULL,
  prioridad prioridad_ticket NOT NULL DEFAULT 'MEDIA',
  asunto TEXT NOT NULL,
  descripcion TEXT NOT NULL,
  estado estado_ticket NOT NULL DEFAULT 'ABIERTO',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_support_tickets_org ON support_tickets(organization_id);
CREATE INDEX idx_support_tickets_estado ON support_tickets(estado);
CREATE INDEX idx_support_tickets_created ON support_tickets(created_at DESC);

CREATE TRIGGER support_tickets_updated_at
  BEFORE UPDATE ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ========================================
-- TABLA: support_ticket_messages
-- ========================================
CREATE TABLE support_ticket_messages (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  autor_tipo TEXT NOT NULL CHECK (autor_tipo IN ('USUARIO', 'SUPERADMIN')),
  autor_id TEXT NOT NULL,
  autor_nombre TEXT NOT NULL,
  contenido TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ticket_messages_ticket ON support_ticket_messages(ticket_id);
CREATE INDEX idx_ticket_messages_created ON support_ticket_messages(created_at ASC);

-- ========================================
-- TABLA: support_ticket_attachments
-- ========================================
CREATE TABLE support_ticket_attachments (
  id TEXT PRIMARY KEY DEFAULT generate_cuid(),
  ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  message_id TEXT REFERENCES support_ticket_messages(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  mime TEXT NOT NULL,
  nombre_archivo TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ticket_attachments_ticket ON support_ticket_attachments(ticket_id);
CREATE INDEX idx_ticket_attachments_message ON support_ticket_attachments(message_id);

-- ========================================
-- RLS (acceso controlado via supabaseAdmin en la app)
-- ========================================
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_ticket_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_ticket_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "support_tickets_all" ON support_tickets FOR ALL USING (TRUE);
CREATE POLICY "support_ticket_messages_all" ON support_ticket_messages FOR ALL USING (TRUE);
CREATE POLICY "support_ticket_attachments_all" ON support_ticket_attachments FOR ALL USING (TRUE);
