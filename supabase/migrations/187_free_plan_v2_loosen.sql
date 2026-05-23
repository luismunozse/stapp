-- ============================================================================
-- Migration 187: Free plan v2 — loosen limits + unlock conversion-led features
-- ============================================================================
-- Motivación (conversion-led):
--
-- Diagnóstico actual: 91 orgs, 0 pagos via MP/Rebill, 11 manuales Pro, 11 Free
-- activas, 33 trials en limbo, 36 trials activos. Conversion rate efectivo = 0%.
--
-- Free promedia 15 órdenes/mes (justo en el cap) y 15.7 clientes (mitad del cap
-- de 30). El cap actual es fricción, no enabler. El usuario churnea ANTES de
-- alcanzar el "aha moment" → nunca llega a evaluar si pagar conviene.
--
-- Estrategia: Free v2 entrega valor real (POS + cotizaciones + portal cliente
-- + más volumen) y reserva para Profesional las features de automatización y
-- escala (WhatsApp, reportes avanzados, garantías, firma digital, etc).
--
-- Cambios:
--   - limite_ordenes:  15  → 30  (2x volumen mensual)
--   - limite_clientes: 30  → 200 (~6x cap vitalicio)
--   - feature_flags: habilita pos_sales, cotizaciones_online, client_portal
--     (client_portal ya estaba on desde migration 147, se preserva idempotente)
--   - features (texto UI): refleja lo que Free realmente incluye ahora.
--
-- Lo que QUEDA gated para Profesional (intencional, drivers de upgrade):
--   whatsapp_notifications, advanced_reports, kiosk_mode, data_export,
--   custom_logo, cuenta_corriente, gestion_proveedores, import_export,
--   firma_digital, fotos_etapa, garantias.
--
-- Compat: NO modifica precio ni status del plan. NO migra suscripciones.
-- Los usuarios actuales en Free ven los nuevos límites en la próxima request
-- (no hay caché DB).
-- ============================================================================

BEGIN;

UPDATE plans SET
  limite_ordenes = 30,
  limite_clientes = 200,
  feature_flags = COALESCE(feature_flags, '{}'::jsonb) || jsonb_build_object(
    'pos_sales', true,
    'cotizaciones_online', true,
    'client_portal', true
  ),
  features = '["Hasta 30 órdenes/mes","1 técnico","1 vendedor","Hasta 200 clientes","100MB almacenamiento","Punto de venta (POS)","Cotizaciones","Portal de seguimiento cliente","Inventario básico","Soporte por email"]'::jsonb,
  updated_at = now()
WHERE slug = 'free';

COMMIT;
