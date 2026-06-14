-- Habilita multi_deposito en el plan profesional.
-- Free queda sin selector (usa depósito principal automaticamente).
UPDATE plans
SET feature_flags = COALESCE(feature_flags, '{}'::jsonb) || '{"multi_deposito": true}'::jsonb
WHERE slug = 'profesional';
