-- Creem (Merchant of Record) para cobro internacional en USD.
-- MP queda para Argentina (ARS); Creem cubre el resto del mundo.

-- 1. Permitir 'CREEM' como payment_provider.
ALTER TYPE payment_provider ADD VALUE IF NOT EXISTS 'CREEM';

-- 2. product_id de Creem por plan. Cada plan x período es un producto distinto
--    en Creem (no hay precio dinámico en el checkout).
ALTER TABLE plans ADD COLUMN IF NOT EXISTS creem_product_id_monthly TEXT;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS creem_product_id_yearly TEXT;

-- 3. Identificadores de Creem en la suscripción.
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS creem_customer_id TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS creem_subscription_id TEXT;

-- 4. Actualizar el CHECK de subscriptions para no regresionar y permitir CREEM.
--    Comparamos como text para no depender de que el nuevo valor del enum esté
--    commiteado dentro de esta misma transacción.
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_payment_provider_check;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_payment_provider_check
  CHECK (payment_provider::text IN (
    'MERCADOPAGO', 'STRIPE', 'LEMONSQUEEZY', 'REBILL', 'MANUAL', 'CREEM'
  ));
