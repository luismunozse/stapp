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

-- ========================================
-- Fix: habilitar RLS en importaciones
-- Tabla usada por el historial de importaciones CSV/Excel
-- ========================================

ALTER TABLE importaciones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view org imports" ON importaciones FOR SELECT
  USING (organization_id = public.get_current_organization_id());
CREATE POLICY "Users can insert org imports" ON importaciones FOR INSERT
  WITH CHECK (organization_id = public.get_current_organization_id());
CREATE POLICY "Users can delete org imports" ON importaciones FOR DELETE
  USING (organization_id = public.get_current_organization_id());

-- ========================================
-- Fix: habilitar RLS en sectores_cliente
-- Se vincula a clientes via cliente_id (mismo patrón que facturas/pagos)
-- ========================================

ALTER TABLE sectores_cliente ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view org sectores" ON sectores_cliente FOR SELECT
  USING (EXISTS (SELECT 1 FROM clientes c WHERE c.id = sectores_cliente.cliente_id AND c.organization_id = public.get_current_organization_id()));
CREATE POLICY "Users can manage org sectores" ON sectores_cliente FOR ALL
  USING (EXISTS (SELECT 1 FROM clientes c WHERE c.id = sectores_cliente.cliente_id AND c.organization_id = public.get_current_organization_id()));
