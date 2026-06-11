-- =============================================================================
-- ROLLBACK: 201_rls_hardening_phase1 — DO NOT apply in normal operation.
-- Use only if a probe from the verification harness fails after applying
-- 201_rls_hardening_phase1.sql.
--
-- This file reverts Changes B, C, and D introduced in that migration, in
-- reverse order (D → C → B).  Each section is independently wrapped in
-- BEGIN/COMMIT so you can roll back one change at a time if needed.
-- Paste the relevant section(s) in Supabase Studio SQL editor and run.
-- =============================================================================

-- ===========================================================================
-- FULL ATOMIC ROLLBACK (use this block under incident pressure)
-- ===========================================================================
-- Use this single BEGIN/COMMIT block to revert ALL of Phase 1 (Changes D, C,
-- and B) in one atomic transaction. If any statement fails the entire revert
-- rolls back, preventing partial state.
--
-- Use the three individual blocks below ONLY for selective partial rollback
-- (e.g., reverting just Change B or just Change D without touching the others).
-- ===========================================================================

BEGIN;

-- ---- Revert D: disable RLS on the four tables enabled in Change D ----

-- admin_emails
DROP POLICY IF EXISTS admin_emails_all_service ON admin_emails;
DROP POLICY IF EXISTS admin_emails_modify ON admin_emails;
DROP POLICY IF EXISTS admin_emails_select ON admin_emails;
ALTER TABLE admin_emails DISABLE ROW LEVEL SECURITY;

-- proveedor_contactos
DROP POLICY IF EXISTS proveedor_contactos_all_service ON proveedor_contactos;
DROP POLICY IF EXISTS proveedor_contactos_modify ON proveedor_contactos;
DROP POLICY IF EXISTS proveedor_contactos_select ON proveedor_contactos;
ALTER TABLE proveedor_contactos DISABLE ROW LEVEL SECURITY;

-- proveedor_adjuntos
DROP POLICY IF EXISTS proveedor_adjuntos_all_service ON proveedor_adjuntos;
DROP POLICY IF EXISTS proveedor_adjuntos_modify ON proveedor_adjuntos;
DROP POLICY IF EXISTS proveedor_adjuntos_select ON proveedor_adjuntos;
ALTER TABLE proveedor_adjuntos DISABLE ROW LEVEL SECURITY;

-- proveedor_catalogo_items
DROP POLICY IF EXISTS proveedor_catalogo_items_all_service ON proveedor_catalogo_items;
DROP POLICY IF EXISTS proveedor_catalogo_items_modify ON proveedor_catalogo_items;
DROP POLICY IF EXISTS proveedor_catalogo_items_select ON proveedor_catalogo_items;
ALTER TABLE proveedor_catalogo_items DISABLE ROW LEVEL SECURITY;

-- ---- Revert C: restore original current_setting() expressions ----

-- migration 016 originals
DROP POLICY IF EXISTS ventas_select ON ventas;
CREATE POLICY ventas_select ON ventas
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS ventas_insert ON ventas;
CREATE POLICY ventas_insert ON ventas
  FOR INSERT WITH CHECK (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS ventas_update ON ventas;
CREATE POLICY ventas_update ON ventas
  FOR UPDATE USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS ventas_delete ON ventas;
CREATE POLICY ventas_delete ON ventas
  FOR DELETE USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS items_venta_select ON items_venta;
CREATE POLICY items_venta_select ON items_venta
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM ventas v
      WHERE v.id = items_venta.venta_id
        AND v.organization_id = current_setting('app.organization_id', true)
    )
  );

DROP POLICY IF EXISTS items_venta_insert ON items_venta;
CREATE POLICY items_venta_insert ON items_venta
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM ventas v
      WHERE v.id = items_venta.venta_id
        AND v.organization_id = current_setting('app.organization_id', true)
    )
  );

DROP POLICY IF EXISTS items_venta_delete ON items_venta;
CREATE POLICY items_venta_delete ON items_venta
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM ventas v
      WHERE v.id = items_venta.venta_id
        AND v.organization_id = current_setting('app.organization_id', true)
    )
  );

DROP POLICY IF EXISTS garantias_venta_select ON garantias_venta;
CREATE POLICY garantias_venta_select ON garantias_venta
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS garantias_venta_insert ON garantias_venta;
CREATE POLICY garantias_venta_insert ON garantias_venta
  FOR INSERT WITH CHECK (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS garantias_venta_update ON garantias_venta;
CREATE POLICY garantias_venta_update ON garantias_venta
  FOR UPDATE USING (organization_id = current_setting('app.organization_id', true));

-- migration 043 originals
DROP POLICY IF EXISTS movimientos_inv_select ON movimientos_inventario;
CREATE POLICY movimientos_inv_select ON movimientos_inventario
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS movimientos_inv_insert ON movimientos_inventario;
CREATE POLICY movimientos_inv_insert ON movimientos_inventario
  FOR INSERT WITH CHECK (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS devoluciones_venta_select ON devoluciones_venta;
CREATE POLICY devoluciones_venta_select ON devoluciones_venta
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS devoluciones_venta_insert ON devoluciones_venta;
CREATE POLICY devoluciones_venta_insert ON devoluciones_venta
  FOR INSERT WITH CHECK (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS devoluciones_venta_update ON devoluciones_venta;
CREATE POLICY devoluciones_venta_update ON devoluciones_venta
  FOR UPDATE USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS items_devolucion_select ON items_devolucion;
CREATE POLICY items_devolucion_select ON items_devolucion
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM devoluciones_venta d
      WHERE d.id = items_devolucion.devolucion_id
        AND d.organization_id = current_setting('app.organization_id', true)
    )
  );

DROP POLICY IF EXISTS items_devolucion_insert ON items_devolucion;
CREATE POLICY items_devolucion_insert ON items_devolucion
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM devoluciones_venta d
      WHERE d.id = items_devolucion.devolucion_id
        AND d.organization_id = current_setting('app.organization_id', true)
    )
  );

-- migration 053 originals
DROP POLICY IF EXISTS "historial_precios_org_isolation" ON historial_precios;
CREATE POLICY "historial_precios_org_isolation" ON historial_precios
  FOR ALL USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS "items_factura_access" ON items_factura;
CREATE POLICY "items_factura_access" ON items_factura
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM facturas f
      JOIN ordenes_servicio o ON f.orden_id = o.id
      WHERE f.id = items_factura.factura_id
        AND o.organization_id = current_setting('app.organization_id', true)
    )
  );

-- migration 083 originals
DROP POLICY IF EXISTS "cotizacion_templates_org_isolation" ON cotizacion_templates;
CREATE POLICY "cotizacion_templates_org_isolation" ON cotizacion_templates
  FOR ALL USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS "items_template_cotizacion_via_template" ON items_template_cotizacion;
CREATE POLICY "items_template_cotizacion_via_template" ON items_template_cotizacion
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM cotizacion_templates ct
      WHERE ct.id = items_template_cotizacion.template_id
        AND ct.organization_id = current_setting('app.organization_id', true)
    )
  );

-- migration 109 originals
DROP POLICY IF EXISTS "ordenes_compra_org_isolation" ON ordenes_compra;
CREATE POLICY "ordenes_compra_org_isolation" ON ordenes_compra
  FOR ALL USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS "items_orden_compra_via_oc" ON items_orden_compra;
CREATE POLICY "items_orden_compra_via_oc" ON items_orden_compra
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM ordenes_compra oc
      WHERE oc.id = items_orden_compra.orden_compra_id
        AND oc.organization_id = current_setting('app.organization_id', true)
    )
  );

-- migrations 169-178: SELECT policies (restore without TO authenticated)
DROP POLICY IF EXISTS depositos_select ON depositos;
CREATE POLICY depositos_select ON depositos
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS inventario_depositos_select ON inventario_depositos;
CREATE POLICY inventario_depositos_select ON inventario_depositos
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS conteos_inv_select ON conteos_inventario;
CREATE POLICY conteos_inv_select ON conteos_inventario
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS conteos_items_select ON conteos_items;
CREATE POLICY conteos_items_select ON conteos_items
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS inventario_imagenes_select ON inventario_imagenes;
CREATE POLICY inventario_imagenes_select ON inventario_imagenes
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS webhooks_select ON webhooks;
CREATE POLICY webhooks_select ON webhooks
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS webhook_deliveries_select ON webhook_deliveries;
CREATE POLICY webhook_deliveries_select ON webhook_deliveries
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS inventario_lotes_select ON inventario_lotes;
CREATE POLICY inventario_lotes_select ON inventario_lotes
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS inventario_series_select ON inventario_series;
CREATE POLICY inventario_series_select ON inventario_series
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS inventario_variantes_select ON inventario_variantes;
CREATE POLICY inventario_variantes_select ON inventario_variantes
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS inventario_kit_items_select ON inventario_kit_items;
CREATE POLICY inventario_kit_items_select ON inventario_kit_items
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS label_templates_select ON label_templates;
CREATE POLICY label_templates_select ON label_templates
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

-- ---- Revert B: restore *_all_service policies WITHOUT TO service_role ----

DROP POLICY IF EXISTS depositos_all_service ON depositos;
CREATE POLICY depositos_all_service ON depositos
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS inventario_depositos_all_service ON inventario_depositos;
CREATE POLICY inventario_depositos_all_service ON inventario_depositos
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS conteos_inv_all_service ON conteos_inventario;
CREATE POLICY conteos_inv_all_service ON conteos_inventario
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS conteos_items_all_service ON conteos_items;
CREATE POLICY conteos_items_all_service ON conteos_items
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS inventario_imagenes_all_service ON inventario_imagenes;
CREATE POLICY inventario_imagenes_all_service ON inventario_imagenes
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS webhooks_all_service ON webhooks;
CREATE POLICY webhooks_all_service ON webhooks
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS webhook_deliveries_all_service ON webhook_deliveries;
CREATE POLICY webhook_deliveries_all_service ON webhook_deliveries
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS inventario_lotes_all_service ON inventario_lotes;
CREATE POLICY inventario_lotes_all_service ON inventario_lotes
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS inventario_series_all_service ON inventario_series;
CREATE POLICY inventario_series_all_service ON inventario_series
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS inventario_variantes_all_service ON inventario_variantes;
CREATE POLICY inventario_variantes_all_service ON inventario_variantes
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS inventario_kit_items_all_service ON inventario_kit_items;
CREATE POLICY inventario_kit_items_all_service ON inventario_kit_items
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS label_templates_all_service ON label_templates;
CREATE POLICY label_templates_all_service ON label_templates
  FOR ALL USING (true) WITH CHECK (true);

COMMIT;

-- ===========================================================================
-- ROLLBACK D — Disable RLS on the four tables we enabled in Change D
-- ===========================================================================
-- Run this FIRST if rolling back the full Phase 1.

BEGIN;

-- admin_emails
DROP POLICY IF EXISTS admin_emails_all_service ON admin_emails;
DROP POLICY IF EXISTS admin_emails_modify ON admin_emails;
DROP POLICY IF EXISTS admin_emails_select ON admin_emails;
ALTER TABLE admin_emails DISABLE ROW LEVEL SECURITY;

-- proveedor_contactos
DROP POLICY IF EXISTS proveedor_contactos_all_service ON proveedor_contactos;
DROP POLICY IF EXISTS proveedor_contactos_modify ON proveedor_contactos;
DROP POLICY IF EXISTS proveedor_contactos_select ON proveedor_contactos;
ALTER TABLE proveedor_contactos DISABLE ROW LEVEL SECURITY;

-- proveedor_adjuntos
DROP POLICY IF EXISTS proveedor_adjuntos_all_service ON proveedor_adjuntos;
DROP POLICY IF EXISTS proveedor_adjuntos_modify ON proveedor_adjuntos;
DROP POLICY IF EXISTS proveedor_adjuntos_select ON proveedor_adjuntos;
ALTER TABLE proveedor_adjuntos DISABLE ROW LEVEL SECURITY;

-- proveedor_catalogo_items
DROP POLICY IF EXISTS proveedor_catalogo_items_all_service ON proveedor_catalogo_items;
DROP POLICY IF EXISTS proveedor_catalogo_items_modify ON proveedor_catalogo_items;
DROP POLICY IF EXISTS proveedor_catalogo_items_select ON proveedor_catalogo_items;
ALTER TABLE proveedor_catalogo_items DISABLE ROW LEVEL SECURITY;

COMMIT;

-- ===========================================================================
-- ROLLBACK C — Revert GUC fix; restore original current_setting() expressions
-- ===========================================================================
-- Restores the exact policy shapes from each source migration verbatim.
-- Run AFTER rollback D if doing a full revert, or standalone for C only.

BEGIN;

-- ---- migration 016 originals ----
DROP POLICY IF EXISTS ventas_select ON ventas;
CREATE POLICY ventas_select ON ventas
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS ventas_insert ON ventas;
CREATE POLICY ventas_insert ON ventas
  FOR INSERT WITH CHECK (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS ventas_update ON ventas;
CREATE POLICY ventas_update ON ventas
  FOR UPDATE USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS ventas_delete ON ventas;
CREATE POLICY ventas_delete ON ventas
  FOR DELETE USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS items_venta_select ON items_venta;
CREATE POLICY items_venta_select ON items_venta
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM ventas v
      WHERE v.id = items_venta.venta_id
        AND v.organization_id = current_setting('app.organization_id', true)
    )
  );

DROP POLICY IF EXISTS items_venta_insert ON items_venta;
CREATE POLICY items_venta_insert ON items_venta
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM ventas v
      WHERE v.id = items_venta.venta_id
        AND v.organization_id = current_setting('app.organization_id', true)
    )
  );

DROP POLICY IF EXISTS items_venta_delete ON items_venta;
CREATE POLICY items_venta_delete ON items_venta
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM ventas v
      WHERE v.id = items_venta.venta_id
        AND v.organization_id = current_setting('app.organization_id', true)
    )
  );

DROP POLICY IF EXISTS garantias_venta_select ON garantias_venta;
CREATE POLICY garantias_venta_select ON garantias_venta
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS garantias_venta_insert ON garantias_venta;
CREATE POLICY garantias_venta_insert ON garantias_venta
  FOR INSERT WITH CHECK (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS garantias_venta_update ON garantias_venta;
CREATE POLICY garantias_venta_update ON garantias_venta
  FOR UPDATE USING (organization_id = current_setting('app.organization_id', true));

-- ---- migration 043 originals ----
DROP POLICY IF EXISTS movimientos_inv_select ON movimientos_inventario;
CREATE POLICY movimientos_inv_select ON movimientos_inventario
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS movimientos_inv_insert ON movimientos_inventario;
CREATE POLICY movimientos_inv_insert ON movimientos_inventario
  FOR INSERT WITH CHECK (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS devoluciones_venta_select ON devoluciones_venta;
CREATE POLICY devoluciones_venta_select ON devoluciones_venta
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS devoluciones_venta_insert ON devoluciones_venta;
CREATE POLICY devoluciones_venta_insert ON devoluciones_venta
  FOR INSERT WITH CHECK (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS devoluciones_venta_update ON devoluciones_venta;
CREATE POLICY devoluciones_venta_update ON devoluciones_venta
  FOR UPDATE USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS items_devolucion_select ON items_devolucion;
CREATE POLICY items_devolucion_select ON items_devolucion
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM devoluciones_venta d
      WHERE d.id = items_devolucion.devolucion_id
        AND d.organization_id = current_setting('app.organization_id', true)
    )
  );

DROP POLICY IF EXISTS items_devolucion_insert ON items_devolucion;
CREATE POLICY items_devolucion_insert ON items_devolucion
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM devoluciones_venta d
      WHERE d.id = items_devolucion.devolucion_id
        AND d.organization_id = current_setting('app.organization_id', true)
    )
  );

-- ---- migration 053 originals ----
DROP POLICY IF EXISTS "historial_precios_org_isolation" ON historial_precios;
CREATE POLICY "historial_precios_org_isolation" ON historial_precios
  FOR ALL USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS "items_factura_access" ON items_factura;
CREATE POLICY "items_factura_access" ON items_factura
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM facturas f
      JOIN ordenes_servicio o ON f.orden_id = o.id
      WHERE f.id = items_factura.factura_id
        AND o.organization_id = current_setting('app.organization_id', true)
    )
  );

-- ---- migration 083 originals ----
DROP POLICY IF EXISTS "cotizacion_templates_org_isolation" ON cotizacion_templates;
CREATE POLICY "cotizacion_templates_org_isolation" ON cotizacion_templates
  FOR ALL USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS "items_template_cotizacion_via_template" ON items_template_cotizacion;
CREATE POLICY "items_template_cotizacion_via_template" ON items_template_cotizacion
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM cotizacion_templates ct
      WHERE ct.id = items_template_cotizacion.template_id
        AND ct.organization_id = current_setting('app.organization_id', true)
    )
  );

-- ---- migration 109 originals ----
DROP POLICY IF EXISTS "ordenes_compra_org_isolation" ON ordenes_compra;
CREATE POLICY "ordenes_compra_org_isolation" ON ordenes_compra
  FOR ALL USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS "items_orden_compra_via_oc" ON items_orden_compra;
CREATE POLICY "items_orden_compra_via_oc" ON items_orden_compra
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM ordenes_compra oc
      WHERE oc.id = items_orden_compra.orden_compra_id
        AND oc.organization_id = current_setting('app.organization_id', true)
    )
  );

-- ---- migrations 169-178: SELECT policies (restore without TO authenticated) ----
DROP POLICY IF EXISTS depositos_select ON depositos;
CREATE POLICY depositos_select ON depositos
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS inventario_depositos_select ON inventario_depositos;
CREATE POLICY inventario_depositos_select ON inventario_depositos
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS conteos_inv_select ON conteos_inventario;
CREATE POLICY conteos_inv_select ON conteos_inventario
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS conteos_items_select ON conteos_items;
CREATE POLICY conteos_items_select ON conteos_items
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS inventario_imagenes_select ON inventario_imagenes;
CREATE POLICY inventario_imagenes_select ON inventario_imagenes
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS webhooks_select ON webhooks;
CREATE POLICY webhooks_select ON webhooks
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS webhook_deliveries_select ON webhook_deliveries;
CREATE POLICY webhook_deliveries_select ON webhook_deliveries
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS inventario_lotes_select ON inventario_lotes;
CREATE POLICY inventario_lotes_select ON inventario_lotes
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS inventario_series_select ON inventario_series;
CREATE POLICY inventario_series_select ON inventario_series
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS inventario_variantes_select ON inventario_variantes;
CREATE POLICY inventario_variantes_select ON inventario_variantes
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS inventario_kit_items_select ON inventario_kit_items;
CREATE POLICY inventario_kit_items_select ON inventario_kit_items
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS label_templates_select ON label_templates;
CREATE POLICY label_templates_select ON label_templates
  FOR SELECT USING (organization_id = current_setting('app.organization_id', true));

COMMIT;

-- ===========================================================================
-- ROLLBACK B — Restore *_all_service policies WITHOUT TO service_role
-- ===========================================================================
-- Run LAST if doing a full revert, or standalone for B only.

BEGIN;

DROP POLICY IF EXISTS depositos_all_service ON depositos;
CREATE POLICY depositos_all_service ON depositos
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS inventario_depositos_all_service ON inventario_depositos;
CREATE POLICY inventario_depositos_all_service ON inventario_depositos
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS conteos_inv_all_service ON conteos_inventario;
CREATE POLICY conteos_inv_all_service ON conteos_inventario
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS conteos_items_all_service ON conteos_items;
CREATE POLICY conteos_items_all_service ON conteos_items
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS inventario_imagenes_all_service ON inventario_imagenes;
CREATE POLICY inventario_imagenes_all_service ON inventario_imagenes
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS webhooks_all_service ON webhooks;
CREATE POLICY webhooks_all_service ON webhooks
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS webhook_deliveries_all_service ON webhook_deliveries;
CREATE POLICY webhook_deliveries_all_service ON webhook_deliveries
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS inventario_lotes_all_service ON inventario_lotes;
CREATE POLICY inventario_lotes_all_service ON inventario_lotes
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS inventario_series_all_service ON inventario_series;
CREATE POLICY inventario_series_all_service ON inventario_series
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS inventario_variantes_all_service ON inventario_variantes;
CREATE POLICY inventario_variantes_all_service ON inventario_variantes
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS inventario_kit_items_all_service ON inventario_kit_items;
CREATE POLICY inventario_kit_items_all_service ON inventario_kit_items
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS label_templates_all_service ON label_templates;
CREATE POLICY label_templates_all_service ON label_templates
  FOR ALL USING (true) WITH CHECK (true);

COMMIT;
