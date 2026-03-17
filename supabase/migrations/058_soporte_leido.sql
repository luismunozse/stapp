-- ========================================
-- SOPORTE: Campo leido_at en mensajes
-- ========================================

ALTER TABLE support_ticket_messages
  ADD COLUMN leido_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN support_ticket_messages.leido_at IS 'Timestamp de cuando el destinatario leyó el mensaje';
