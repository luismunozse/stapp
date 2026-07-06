-- ============================================================================
-- 266: Free v3 — cotizaciones pasan a Profesional
-- ============================================================================
-- Contexto: la 187 metió cotizaciones_online en Free y aplanó la escalera de
-- valor (conversión ~0%). Este cambio devuelve SOLO cotizaciones_online a
-- Profesional. POS (pos_sales) y seguimiento (client_portal) quedan en Free.
--
-- El enforcement vive en el código (guard hasPlanFeature en las rutas de
-- creación). Esta migración apaga el flag; correr en el "día del flip", después
-- del aviso a los usuarios. NO toca precios, status ni suscripciones.
-- ============================================================================

BEGIN;

UPDATE plans SET
  feature_flags = feature_flags - 'cotizaciones_online',
  features = '["Hasta 30 órdenes/mes","1 técnico","1 vendedor","Hasta 200 clientes","100MB almacenamiento","Punto de venta (POS)","Portal de seguimiento cliente","Inventario básico","Soporte por email"]'::jsonb,
  updated_at = now()
WHERE slug = 'free';

COMMIT;
