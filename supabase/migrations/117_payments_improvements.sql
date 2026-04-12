-- =============================================
-- 117: Mejoras en pagos y webhooks
--
-- 1. Agrega raw_payload a webhook_events para guardar el body completo
-- 2. Agrega plan_name y period_start/period_end a subscription_payments
--    para mostrar plan y período en el historial
-- 3. Hace subscription_id nullable (el pago se registra antes de la
--    activación de suscripción, puede no existir aún)
-- =============================================

-- raw_payload: body completo del webhook para reprocessing
ALTER TABLE webhook_events
  ADD COLUMN IF NOT EXISTS raw_payload TEXT;

COMMENT ON COLUMN webhook_events.raw_payload IS
  'Body crudo del webhook (texto original antes de parsear JSON). Útil para reprocessing.';

-- Campos extra en subscription_payments para el historial
ALTER TABLE subscription_payments
  ADD COLUMN IF NOT EXISTS plan_name TEXT,
  ADD COLUMN IF NOT EXISTS period_start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS period_end TIMESTAMPTZ;

-- Hacer subscription_id nullable si no lo es ya (el pago se registra
-- antes de la activación de suscripción)
ALTER TABLE subscription_payments
  ALTER COLUMN subscription_id DROP NOT NULL;

-- Índice para filtro por proveedor en el listado
CREATE INDEX IF NOT EXISTS idx_subscription_payments_provider
  ON subscription_payments (payment_provider, paid_at DESC);

-- Índice para cálculo de MRR
CREATE INDEX IF NOT EXISTS idx_subscription_payments_succeeded_month
  ON subscription_payments (status, paid_at DESC)
  WHERE status = 'SUCCEEDED';
