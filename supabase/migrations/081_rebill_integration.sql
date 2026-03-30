-- Agregar campos de Rebill a subscriptions
ALTER TABLE subscriptions
ADD COLUMN IF NOT EXISTS rebill_subscription_id TEXT,
ADD COLUMN IF NOT EXISTS rebill_customer_id TEXT;

-- Actualizar constraint de payment_provider para incluir REBILL
ALTER TABLE subscriptions
DROP CONSTRAINT IF EXISTS subscriptions_payment_provider_check;

ALTER TABLE subscriptions
ADD CONSTRAINT subscriptions_payment_provider_check
CHECK (payment_provider IN ('MERCADOPAGO', 'STRIPE', 'LEMONSQUEEZY', 'REBILL'));
