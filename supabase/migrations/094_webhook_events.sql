-- ============================================
-- Migration 094: Tabla de auditoría de webhooks
-- ============================================
-- Antes de esta tabla los webhooks de MercadoPago / Rebill sólo dejaban
-- traza en console.log. Si una notificación fallaba (firma inválida,
-- payload raro, error en BD, etc.) no había forma de saberlo después.
-- Esto causó al menos un caso donde un cliente pagó por MercadoPago,
-- el webhook (presumiblemente) no impactó, y se tuvo que activar la
-- suscripción manualmente sin tener evidencia clara de qué pasó.
--
-- Esta tabla registra cada intento de webhook entrante con:
--   - quién (provider)
--   - qué (event_type, payload mínimo, organization_id si se pudo resolver)
--   - resultado (status http devuelto, processed/skipped/error y error_message)
--
-- La idea es que /superadmin/pagos pueda mostrar un panel "Webhooks recientes"
-- y dar el botón "Reintentar" si algo falló.
-- ============================================

CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Origen
  provider TEXT NOT NULL CHECK (provider IN ('MERCADOPAGO', 'REBILL')),
  event_type TEXT,                 -- ej. 'payment', 'subscription_preapproval', 'payment.updated'

  -- Identificadores externos para idempotencia / búsqueda
  provider_event_id TEXT,          -- id del recurso en el provider (paymentId, subscriptionId)
  provider_request_id TEXT,        -- x-request-id u equivalente, ayuda a correlacionar con el panel del provider

  -- Resolución
  organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  subscription_payment_id TEXT REFERENCES subscription_payments(id) ON DELETE SET NULL,

  -- Resultado
  status TEXT NOT NULL CHECK (status IN ('RECEIVED', 'PROCESSED', 'SKIPPED', 'INVALID_SIGNATURE', 'ERROR')),
  http_status INT,                 -- status HTTP que devolvimos a MP/Rebill
  error_message TEXT,
  signature_valid BOOLEAN,         -- null si no aplica (rebill no firma)

  -- Datos crudos para auditoría / reintento
  payload JSONB,                   -- body recibido (puede ser grande, lo aceptamos)
  headers JSONB,                   -- subset de headers relevantes (sin secrets)

  -- Timing
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,        -- cuando terminamos de procesarlo (puede ser NULL si crasheó antes)
  duration_ms INT
);

-- Índices para consultas típicas del panel superadmin
CREATE INDEX IF NOT EXISTS idx_webhook_events_received_at
  ON webhook_events (received_at DESC);

CREATE INDEX IF NOT EXISTS idx_webhook_events_provider_status
  ON webhook_events (provider, status, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_webhook_events_org
  ON webhook_events (organization_id, received_at DESC)
  WHERE organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_webhook_events_provider_event_id
  ON webhook_events (provider, provider_event_id)
  WHERE provider_event_id IS NOT NULL;

-- RLS: solo el service role accede (los webhooks corren con supabaseAdmin
-- y el panel superadmin también). No exponemos esta tabla a clientes.
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;

-- Política restrictiva: nadie con anon/authenticated puede leer/escribir.
-- El service role bypassa RLS por defecto.
CREATE POLICY "webhook_events_no_public_access"
  ON webhook_events
  FOR ALL
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);

COMMENT ON TABLE webhook_events IS
  'Auditoría de webhooks entrantes (MercadoPago, Rebill). Permite diagnosticar pagos que no impactaron y reintentar manualmente desde /superadmin/pagos.';
