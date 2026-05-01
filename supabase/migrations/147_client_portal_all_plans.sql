-- ============================================
-- 147: Portal de seguimiento para todos los planes
-- ============================================
-- El link de seguimiento público (/seguimiento/[token]) deja de ser feature
-- exclusiva del plan Profesional. Pasa a estar disponible en todos los planes
-- (Free, Emprendedor, Profesional).
-- ============================================

UPDATE plans
SET feature_flags = COALESCE(feature_flags, '{}'::jsonb) || jsonb_build_object('client_portal', true);
