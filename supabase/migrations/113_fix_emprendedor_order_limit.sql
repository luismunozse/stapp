-- =============================================
-- 113: Corregir límite de órdenes del plan Emprendedor
--
-- El plan Emprendedor tenía limite_ordenes=30, mientras que
-- el plan Free tiene 50 por defecto en el código. Un usuario
-- que paga tenía menos capacidad que uno gratuito.
--
-- Se actualiza a 500 órdenes/mes para el plan Emprendedor.
-- El plan Profesional mantiene NULL (ilimitado).
-- =============================================

UPDATE plans
SET
  limite_ordenes = 500,
  features = jsonb_set(
    COALESCE(features, '[]'::jsonb),
    '{0}',
    '"Hasta 500 órdenes/mes"'
  )
WHERE slug = 'emprendedor';
