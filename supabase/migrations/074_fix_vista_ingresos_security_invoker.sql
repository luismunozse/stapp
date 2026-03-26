-- ========================================
-- Fix: cambiar vista_ingresos_unificados de SECURITY DEFINER a SECURITY INVOKER
-- para que respete las políticas RLS del usuario que consulta
-- ========================================

ALTER VIEW vista_ingresos_unificados SET (security_invoker = true);

-- ========================================
-- Fix: habilitar RLS en rate_limit_log
-- Tabla interna de tracking, no necesita acceso desde el cliente
-- ========================================

ALTER TABLE rate_limit_log ENABLE ROW LEVEL SECURITY;
