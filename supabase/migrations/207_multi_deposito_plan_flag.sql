-- Habilita multi_deposito en planes pagos.
-- Free queda sin selector (usa depósito principal automaticamente).
-- Solo 'profesional' está activo; 'emprendedor' fue desactivado en migración 118.
UPDATE plans
SET feature_flags = COALESCE(feature_flags, '{}'::jsonb) || '{"multi_deposito": true}'::jsonb
WHERE slug IN ('profesional', 'emprendedor');
