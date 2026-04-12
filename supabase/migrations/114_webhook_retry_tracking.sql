-- =============================================
-- 114: Tracking de reintentos de webhooks
--
-- Agrega retry_count y requires_manual_review a webhook_events
-- para detectar webhooks que fallan repetidamente y necesitan
-- intervención manual del superadmin.
-- =============================================

ALTER TABLE webhook_events
  ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS requires_manual_review BOOLEAN DEFAULT FALSE;

-- Índice para buscar rápidamente webhooks con errores recientes
CREATE INDEX IF NOT EXISTS idx_webhook_events_error_recent
  ON webhook_events (status, received_at DESC)
  WHERE status = 'ERROR';

-- Índice para webhooks que requieren revisión manual
CREATE INDEX IF NOT EXISTS idx_webhook_events_manual_review
  ON webhook_events (requires_manual_review, received_at DESC)
  WHERE requires_manual_review = TRUE;
