-- ========================================
-- ROW LEVEL SECURITY POLICIES
-- ========================================
--
-- Usa public.get_current_organization_id() para obtener el org_id
-- del JWT o header custom x-organization-id
-- ========================================

-- Función helper en PUBLIC schema
CREATE OR REPLACE FUNCTION public.get_current_organization_id()
RETURNS TEXT AS $$
BEGIN
  RETURN COALESCE(
    current_setting('request.jwt.claims', true)::json->>'organization_id',
    current_setting('request.headers', true)::json->>'x-organization-id'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ========================================
-- HABILITAR RLS EN TODAS LAS TABLAS
-- ========================================

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE ordenes_servicio ENABLE ROW LEVEL SECURITY;
ALTER TABLE fotos_orden ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventario ENABLE ROW LEVEL SECURITY;
ALTER TABLE repuestos_orden ENABLE ROW LEVEL SECURITY;
ALTER TABLE facturas ENABLE ROW LEVEL SECURITY;
ALTER TABLE pagos_parciales ENABLE ROW LEVEL SECURITY;
ALTER TABLE proveedores ENABLE ROW LEVEL SECURITY;
ALTER TABLE cotizaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE items_cotizacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE garantias ENABLE ROW LEVEL SECURITY;
ALTER TABLE reclamos_garantia ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_template_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_recepcion ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- ========================================
-- POLÍTICAS
-- ========================================

-- ORGANIZATIONS
CREATE POLICY "Users can view own organization" ON organizations FOR SELECT USING (id = public.get_current_organization_id());
CREATE POLICY "Admins can update own organization" ON organizations FOR UPDATE USING (id = public.get_current_organization_id());

-- USERS
CREATE POLICY "Users can view org members" ON users FOR SELECT USING (organization_id = public.get_current_organization_id());
CREATE POLICY "Admins can manage users" ON users FOR ALL USING (organization_id = public.get_current_organization_id());

-- CLIENTES
CREATE POLICY "Users can view org clients" ON clientes FOR SELECT USING (organization_id = public.get_current_organization_id());
CREATE POLICY "Users can manage org clients" ON clientes FOR ALL USING (organization_id = public.get_current_organization_id());

-- ÓRDENES
CREATE POLICY "Users can view org orders" ON ordenes_servicio FOR SELECT USING (organization_id = public.get_current_organization_id());
CREATE POLICY "Users can manage org orders" ON ordenes_servicio FOR ALL USING (organization_id = public.get_current_organization_id());

-- FOTOS
CREATE POLICY "Users can view org photos" ON fotos_orden FOR SELECT
  USING (EXISTS (SELECT 1 FROM ordenes_servicio o WHERE o.id = fotos_orden.orden_id AND o.organization_id = public.get_current_organization_id()));
CREATE POLICY "Users can manage org photos" ON fotos_orden FOR ALL
  USING (EXISTS (SELECT 1 FROM ordenes_servicio o WHERE o.id = fotos_orden.orden_id AND o.organization_id = public.get_current_organization_id()));

-- INVENTARIO
CREATE POLICY "Users can view org inventory" ON inventario FOR SELECT USING (organization_id = public.get_current_organization_id());
CREATE POLICY "Users can manage org inventory" ON inventario FOR ALL USING (organization_id = public.get_current_organization_id());

-- REPUESTOS ORDEN
CREATE POLICY "Users can view org order parts" ON repuestos_orden FOR SELECT
  USING (EXISTS (SELECT 1 FROM ordenes_servicio o WHERE o.id = repuestos_orden.orden_id AND o.organization_id = public.get_current_organization_id()));
CREATE POLICY "Users can manage org order parts" ON repuestos_orden FOR ALL
  USING (EXISTS (SELECT 1 FROM ordenes_servicio o WHERE o.id = repuestos_orden.orden_id AND o.organization_id = public.get_current_organization_id()));

-- FACTURAS
CREATE POLICY "Users can view org invoices" ON facturas FOR SELECT
  USING (EXISTS (SELECT 1 FROM ordenes_servicio o WHERE o.id = facturas.orden_id AND o.organization_id = public.get_current_organization_id()));
CREATE POLICY "Users can manage org invoices" ON facturas FOR ALL
  USING (EXISTS (SELECT 1 FROM ordenes_servicio o WHERE o.id = facturas.orden_id AND o.organization_id = public.get_current_organization_id()));

-- PAGOS
CREATE POLICY "Users can view org payments" ON pagos_parciales FOR SELECT
  USING (EXISTS (SELECT 1 FROM facturas f JOIN ordenes_servicio o ON o.id = f.orden_id WHERE f.id = pagos_parciales.factura_id AND o.organization_id = public.get_current_organization_id()));
CREATE POLICY "Users can manage org payments" ON pagos_parciales FOR ALL
  USING (EXISTS (SELECT 1 FROM facturas f JOIN ordenes_servicio o ON o.id = f.orden_id WHERE f.id = pagos_parciales.factura_id AND o.organization_id = public.get_current_organization_id()));

-- PROVEEDORES
CREATE POLICY "Users can view org suppliers" ON proveedores FOR SELECT USING (organization_id = public.get_current_organization_id());
CREATE POLICY "Users can manage org suppliers" ON proveedores FOR ALL USING (organization_id = public.get_current_organization_id());

-- COTIZACIONES
CREATE POLICY "Users can view org quotes" ON cotizaciones FOR SELECT
  USING (EXISTS (SELECT 1 FROM ordenes_servicio o WHERE o.id = cotizaciones.orden_id AND o.organization_id = public.get_current_organization_id()));
CREATE POLICY "Users can manage org quotes" ON cotizaciones FOR ALL
  USING (EXISTS (SELECT 1 FROM ordenes_servicio o WHERE o.id = cotizaciones.orden_id AND o.organization_id = public.get_current_organization_id()));
CREATE POLICY "Users can view org quote items" ON items_cotizacion FOR SELECT
  USING (EXISTS (SELECT 1 FROM cotizaciones c JOIN ordenes_servicio o ON o.id = c.orden_id WHERE c.id = items_cotizacion.cotizacion_id AND o.organization_id = public.get_current_organization_id()));
CREATE POLICY "Users can manage org quote items" ON items_cotizacion FOR ALL
  USING (EXISTS (SELECT 1 FROM cotizaciones c JOIN ordenes_servicio o ON o.id = c.orden_id WHERE c.id = items_cotizacion.cotizacion_id AND o.organization_id = public.get_current_organization_id()));

-- GARANTÍAS
CREATE POLICY "Users can view org warranties" ON garantias FOR SELECT
  USING (EXISTS (SELECT 1 FROM ordenes_servicio o WHERE o.id = garantias.orden_id AND o.organization_id = public.get_current_organization_id()));
CREATE POLICY "Users can manage org warranties" ON garantias FOR ALL
  USING (EXISTS (SELECT 1 FROM ordenes_servicio o WHERE o.id = garantias.orden_id AND o.organization_id = public.get_current_organization_id()));
CREATE POLICY "Users can view org warranty claims" ON reclamos_garantia FOR SELECT
  USING (EXISTS (SELECT 1 FROM garantias g JOIN ordenes_servicio o ON o.id = g.orden_id WHERE g.id = reclamos_garantia.garantia_id AND o.organization_id = public.get_current_organization_id()));
CREATE POLICY "Users can manage org warranty claims" ON reclamos_garantia FOR ALL
  USING (EXISTS (SELECT 1 FROM garantias g JOIN ordenes_servicio o ON o.id = g.orden_id WHERE g.id = reclamos_garantia.garantia_id AND o.organization_id = public.get_current_organization_id()));

-- CHECKLISTS
CREATE POLICY "Users can view org checklist templates" ON checklist_templates FOR SELECT USING (organization_id = public.get_current_organization_id());
CREATE POLICY "Users can manage org checklist templates" ON checklist_templates FOR ALL USING (organization_id = public.get_current_organization_id());
CREATE POLICY "Users can view org template items" ON checklist_template_items FOR SELECT
  USING (EXISTS (SELECT 1 FROM checklist_templates t WHERE t.id = checklist_template_items.template_id AND t.organization_id = public.get_current_organization_id()));
CREATE POLICY "Users can manage org template items" ON checklist_template_items FOR ALL
  USING (EXISTS (SELECT 1 FROM checklist_templates t WHERE t.id = checklist_template_items.template_id AND t.organization_id = public.get_current_organization_id()));
CREATE POLICY "Users can view org checklists" ON checklist_recepcion FOR SELECT
  USING (EXISTS (SELECT 1 FROM ordenes_servicio o WHERE o.id = checklist_recepcion.orden_id AND o.organization_id = public.get_current_organization_id()));
CREATE POLICY "Users can manage org checklists" ON checklist_recepcion FOR ALL
  USING (EXISTS (SELECT 1 FROM ordenes_servicio o WHERE o.id = checklist_recepcion.orden_id AND o.organization_id = public.get_current_organization_id()));

-- NOTIFICATIONS
CREATE POLICY "Users can view org notifications" ON notification_logs FOR SELECT USING (organization_id = public.get_current_organization_id());
CREATE POLICY "Users can create org notifications" ON notification_logs FOR INSERT WITH CHECK (organization_id = public.get_current_organization_id());

-- AUDIT
CREATE POLICY "Users can view org audit logs" ON audit_logs FOR SELECT USING (organization_id = public.get_current_organization_id());
CREATE POLICY "Users can create audit logs" ON audit_logs FOR INSERT WITH CHECK (organization_id = public.get_current_organization_id());

-- COUNTERS
CREATE POLICY "Users can view org counters" ON organization_counters FOR SELECT USING (organization_id = public.get_current_organization_id());
CREATE POLICY "Users can update org counters" ON organization_counters FOR UPDATE USING (organization_id = public.get_current_organization_id());
CREATE POLICY "Users can insert org counters" ON organization_counters FOR INSERT WITH CHECK (organization_id = public.get_current_organization_id());
