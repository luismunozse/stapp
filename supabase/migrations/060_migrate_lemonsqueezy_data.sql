-- ========================================
-- FIX: Sistema de suscripciones (Parte 2)
-- Migrar datos existentes de STRIPE a LEMONSQUEEZY
-- (Requiere que el enum LEMONSQUEEZY ya esté commiteado en migración 059)
-- ========================================

UPDATE subscriptions
SET
  lemonsqueezy_subscription_id = stripe_subscription_id,
  lemonsqueezy_customer_id = stripe_customer_id,
  stripe_subscription_id = NULL,
  stripe_customer_id = NULL,
  payment_provider = 'LEMONSQUEEZY'
WHERE payment_provider = 'STRIPE'
  AND stripe_subscription_id IS NOT NULL
  AND mercadopago_preapproval_id IS NULL;
