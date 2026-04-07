-- ============================================
-- Migration 093: Agregar MANUAL al enum payment_provider
-- ============================================
-- Permite registrar pagos manuales desde el panel superadmin
-- (renovaciones via /api/superadmin/subscriptions/renew) en la
-- tabla subscription_payments. Sin este valor las renovaciones
-- manuales no quedaban reflejadas en /superadmin/pagos ni en el
-- MRR del dashboard.
-- ============================================

ALTER TYPE payment_provider ADD VALUE IF NOT EXISTS 'MANUAL';
