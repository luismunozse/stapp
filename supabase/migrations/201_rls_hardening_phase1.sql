-- =============================================================================
-- Migration: 201_rls_hardening_phase1.sql
-- Purpose  : RLS hardening Phase 1 — defense-in-depth for multitenant SaaS.
--            Applies three independent but related changes in a single atomic
--            transaction so partial application is impossible.
--
-- Change B : Restrict the 12 *_all_service FOR ALL USING(true) policies to
--            TO service_role, preventing authenticated-role DML on these tables.
-- Change C : Replace the broken GUC current_setting('app.organization_id', true)
--            with public.get_current_organization_id() across all affected SELECT
--            and DML policies.  The GUC was never set in normal request flow;
--            the JWT-reading function is the correct mechanism.
-- Change D : Enable RLS + add org-scoped policies on four previously unprotected
--            tables: admin_emails, proveedor_contactos, proveedor_adjuntos,
--            proveedor_catalogo_items.  ENABLE RLS and CREATE POLICY are in the
--            same atomic block — no default-deny window.
--
-- Runtime impact: ZERO.  All application API routes use supabaseAdmin
--                 (service_role), which bypasses RLS unconditionally.  These
--                 changes only affect connections authenticated as `authenticated`
--                 or `anon`, neither of which is used by the app layer today.
--
-- Reference: RLS-Hardening SDD change (STApp — June 2026), audit exploration #21.
-- DO NOT apply individual chunks separately; paste the whole file in Studio.
--
-- SAFE-UNDER-LOAD GUARD: this migration takes ACCESS EXCLUSIVE locks on ~28
-- hot tables (DDL: DROP/CREATE POLICY, ALTER TABLE ENABLE RLS). lock_timeout
-- below makes the whole transaction ABORT-AND-ROLLBACK cleanly if it cannot
-- acquire a lock within 3s — instead of queueing live app queries behind it.
-- If it aborts with "canceling statement due to lock timeout", nothing was
-- applied (atomic) — just re-run it. Prefer a low-traffic window regardless.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '3s';

-- ===========================================================================
-- CHANGE B — Restrict *_all_service policies TO service_role
-- ===========================================================================
-- Each block: DROP IF EXISTS the existing FOR ALL USING(true) policy and
-- recreate it scoped to service_role.  The effective behaviour for the running
-- app is identical (service_role bypasses RLS unconditionally); this prevents
-- an authenticated-role connection from accidentally writing through RLS.

-- depositos (migration 169)
DROP POLICY IF EXISTS depositos_all_service ON depositos;
CREATE POLICY depositos_all_service ON depositos
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- inventario_depositos (migration 169)
DROP POLICY IF EXISTS inventario_depositos_all_service ON inventario_depositos;
CREATE POLICY inventario_depositos_all_service ON inventario_depositos
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- conteos_inventario (migration 170)
DROP POLICY IF EXISTS conteos_inv_all_service ON conteos_inventario;
CREATE POLICY conteos_inv_all_service ON conteos_inventario
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- conteos_items (migration 170)
DROP POLICY IF EXISTS conteos_items_all_service ON conteos_items;
CREATE POLICY conteos_items_all_service ON conteos_items
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- inventario_imagenes (migration 173)
DROP POLICY IF EXISTS inventario_imagenes_all_service ON inventario_imagenes;
CREATE POLICY inventario_imagenes_all_service ON inventario_imagenes
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- webhooks (migration 174)
DROP POLICY IF EXISTS webhooks_all_service ON webhooks;
CREATE POLICY webhooks_all_service ON webhooks
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- webhook_deliveries (migration 174)
DROP POLICY IF EXISTS webhook_deliveries_all_service ON webhook_deliveries;
CREATE POLICY webhook_deliveries_all_service ON webhook_deliveries
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- inventario_lotes (migration 175)
DROP POLICY IF EXISTS inventario_lotes_all_service ON inventario_lotes;
CREATE POLICY inventario_lotes_all_service ON inventario_lotes
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- inventario_series (migration 175)
DROP POLICY IF EXISTS inventario_series_all_service ON inventario_series;
CREATE POLICY inventario_series_all_service ON inventario_series
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- inventario_variantes (migration 176)
DROP POLICY IF EXISTS inventario_variantes_all_service ON inventario_variantes;
CREATE POLICY inventario_variantes_all_service ON inventario_variantes
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- inventario_kit_items (migration 177)
DROP POLICY IF EXISTS inventario_kit_items_all_service ON inventario_kit_items;
CREATE POLICY inventario_kit_items_all_service ON inventario_kit_items
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- label_templates (migration 178)
DROP POLICY IF EXISTS label_templates_all_service ON label_templates;
CREATE POLICY label_templates_all_service ON label_templates
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ===========================================================================
-- Change C note: the original policies (migrations 016/043/053/083/109/169-178)
-- had NO role clause, which in Postgres means they applied to PUBLIC (all roles
-- incl. anon). These rewrites add an explicit `TO authenticated`. This is safe
-- TODAY because no anon access path exists on any of these tables (verified
-- across the full migration history; migration 112's anon Realtime policies
-- only touch ordenes_servicio/cotizaciones/orden_eventos/repuestos_orden, which
-- are NOT in this change). If a future migration grants anon access to any
-- Change-C table, this `TO authenticated` scoping MUST be revisited.
-- ===========================================================================
-- CHANGE C — Replace GUC with public.get_current_organization_id()
-- ===========================================================================
-- For each policy: DROP IF EXISTS + CREATE with identical name/role/command
-- but using public.get_current_organization_id() instead of
-- current_setting('app.organization_id', true).
-- SELECT policies on the 12 inventory tables also gain an explicit TO authenticated.

-- ---- migration 016: ventas, items_venta, garantias_venta ----

DROP POLICY IF EXISTS ventas_select ON ventas;
CREATE POLICY ventas_select ON ventas
  FOR SELECT TO authenticated
  USING (organization_id = public.get_current_organization_id());

DROP POLICY IF EXISTS ventas_insert ON ventas;
CREATE POLICY ventas_insert ON ventas
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_current_organization_id());

DROP POLICY IF EXISTS ventas_update ON ventas;
CREATE POLICY ventas_update ON ventas
  FOR UPDATE TO authenticated
  USING (organization_id = public.get_current_organization_id());

DROP POLICY IF EXISTS ventas_delete ON ventas;
CREATE POLICY ventas_delete ON ventas
  FOR DELETE TO authenticated
  USING (organization_id = public.get_current_organization_id());

DROP POLICY IF EXISTS items_venta_select ON items_venta;
CREATE POLICY items_venta_select ON items_venta
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ventas v
      WHERE v.id = items_venta.venta_id
        AND v.organization_id = public.get_current_organization_id()
    )
  );

DROP POLICY IF EXISTS items_venta_insert ON items_venta;
CREATE POLICY items_venta_insert ON items_venta
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM ventas v
      WHERE v.id = items_venta.venta_id
        AND v.organization_id = public.get_current_organization_id()
    )
  );

DROP POLICY IF EXISTS items_venta_delete ON items_venta;
CREATE POLICY items_venta_delete ON items_venta
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ventas v
      WHERE v.id = items_venta.venta_id
        AND v.organization_id = public.get_current_organization_id()
    )
  );

DROP POLICY IF EXISTS garantias_venta_select ON garantias_venta;
CREATE POLICY garantias_venta_select ON garantias_venta
  FOR SELECT TO authenticated
  USING (organization_id = public.get_current_organization_id());

DROP POLICY IF EXISTS garantias_venta_insert ON garantias_venta;
CREATE POLICY garantias_venta_insert ON garantias_venta
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_current_organization_id());

DROP POLICY IF EXISTS garantias_venta_update ON garantias_venta;
CREATE POLICY garantias_venta_update ON garantias_venta
  FOR UPDATE TO authenticated
  USING (organization_id = public.get_current_organization_id());

-- ---- migration 043: movimientos_inventario, devoluciones_venta, items_devolucion ----

DROP POLICY IF EXISTS movimientos_inv_select ON movimientos_inventario;
CREATE POLICY movimientos_inv_select ON movimientos_inventario
  FOR SELECT TO authenticated
  USING (organization_id = public.get_current_organization_id());

DROP POLICY IF EXISTS movimientos_inv_insert ON movimientos_inventario;
CREATE POLICY movimientos_inv_insert ON movimientos_inventario
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_current_organization_id());

DROP POLICY IF EXISTS devoluciones_venta_select ON devoluciones_venta;
CREATE POLICY devoluciones_venta_select ON devoluciones_venta
  FOR SELECT TO authenticated
  USING (organization_id = public.get_current_organization_id());

DROP POLICY IF EXISTS devoluciones_venta_insert ON devoluciones_venta;
CREATE POLICY devoluciones_venta_insert ON devoluciones_venta
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_current_organization_id());

DROP POLICY IF EXISTS devoluciones_venta_update ON devoluciones_venta;
CREATE POLICY devoluciones_venta_update ON devoluciones_venta
  FOR UPDATE TO authenticated
  USING (organization_id = public.get_current_organization_id());

DROP POLICY IF EXISTS items_devolucion_select ON items_devolucion;
CREATE POLICY items_devolucion_select ON items_devolucion
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM devoluciones_venta d
      WHERE d.id = items_devolucion.devolucion_id
        AND d.organization_id = public.get_current_organization_id()
    )
  );

DROP POLICY IF EXISTS items_devolucion_insert ON items_devolucion;
CREATE POLICY items_devolucion_insert ON items_devolucion
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM devoluciones_venta d
      WHERE d.id = items_devolucion.devolucion_id
        AND d.organization_id = public.get_current_organization_id()
    )
  );

-- ---- migration 053: historial_precios, items_factura ----

DROP POLICY IF EXISTS "historial_precios_org_isolation" ON historial_precios;
CREATE POLICY "historial_precios_org_isolation" ON historial_precios
  FOR ALL TO authenticated
  USING (organization_id = public.get_current_organization_id());

DROP POLICY IF EXISTS "items_factura_access" ON items_factura;
CREATE POLICY "items_factura_access" ON items_factura
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM facturas f
      JOIN ordenes_servicio o ON f.orden_id = o.id
      WHERE f.id = items_factura.factura_id
        AND o.organization_id = public.get_current_organization_id()
    )
  );

-- ---- migration 083: cotizacion_templates, items_template_cotizacion ----
-- NOTE: 083 already superseded the USING(true) policies from 082.
-- Only the GUC fix is applied here (Change C); no re-tighten needed.

DROP POLICY IF EXISTS "cotizacion_templates_org_isolation" ON cotizacion_templates;
CREATE POLICY "cotizacion_templates_org_isolation" ON cotizacion_templates
  FOR ALL TO authenticated
  USING (organization_id = public.get_current_organization_id());

DROP POLICY IF EXISTS "items_template_cotizacion_via_template" ON items_template_cotizacion;
CREATE POLICY "items_template_cotizacion_via_template" ON items_template_cotizacion
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM cotizacion_templates ct
      WHERE ct.id = items_template_cotizacion.template_id
        AND ct.organization_id = public.get_current_organization_id()
    )
  );

-- ---- migration 109: ordenes_compra, items_orden_compra ----

DROP POLICY IF EXISTS "ordenes_compra_org_isolation" ON ordenes_compra;
CREATE POLICY "ordenes_compra_org_isolation" ON ordenes_compra
  FOR ALL TO authenticated
  USING (organization_id = public.get_current_organization_id());

DROP POLICY IF EXISTS "items_orden_compra_via_oc" ON items_orden_compra;
CREATE POLICY "items_orden_compra_via_oc" ON items_orden_compra
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ordenes_compra oc
      WHERE oc.id = items_orden_compra.orden_compra_id
        AND oc.organization_id = public.get_current_organization_id()
    )
  );

-- ---- migrations 169-178: SELECT policies on the 12 inventory/ext tables ----
-- These are the counterpart SELECT policies to the *_all_service ones above.
-- They gain an explicit TO authenticated for clarity.

-- depositos_select (169)
DROP POLICY IF EXISTS depositos_select ON depositos;
CREATE POLICY depositos_select ON depositos
  FOR SELECT TO authenticated
  USING (organization_id = public.get_current_organization_id());

-- inventario_depositos_select (169)
DROP POLICY IF EXISTS inventario_depositos_select ON inventario_depositos;
CREATE POLICY inventario_depositos_select ON inventario_depositos
  FOR SELECT TO authenticated
  USING (organization_id = public.get_current_organization_id());

-- conteos_inv_select (170)
DROP POLICY IF EXISTS conteos_inv_select ON conteos_inventario;
CREATE POLICY conteos_inv_select ON conteos_inventario
  FOR SELECT TO authenticated
  USING (organization_id = public.get_current_organization_id());

-- conteos_items_select (170)
DROP POLICY IF EXISTS conteos_items_select ON conteos_items;
CREATE POLICY conteos_items_select ON conteos_items
  FOR SELECT TO authenticated
  USING (organization_id = public.get_current_organization_id());

-- inventario_imagenes_select (173)
DROP POLICY IF EXISTS inventario_imagenes_select ON inventario_imagenes;
CREATE POLICY inventario_imagenes_select ON inventario_imagenes
  FOR SELECT TO authenticated
  USING (organization_id = public.get_current_organization_id());

-- webhooks_select (174)
DROP POLICY IF EXISTS webhooks_select ON webhooks;
CREATE POLICY webhooks_select ON webhooks
  FOR SELECT TO authenticated
  USING (organization_id = public.get_current_organization_id());

-- webhook_deliveries_select (174)
DROP POLICY IF EXISTS webhook_deliveries_select ON webhook_deliveries;
CREATE POLICY webhook_deliveries_select ON webhook_deliveries
  FOR SELECT TO authenticated
  USING (organization_id = public.get_current_organization_id());

-- inventario_lotes_select (175)
DROP POLICY IF EXISTS inventario_lotes_select ON inventario_lotes;
CREATE POLICY inventario_lotes_select ON inventario_lotes
  FOR SELECT TO authenticated
  USING (organization_id = public.get_current_organization_id());

-- inventario_series_select (175)
DROP POLICY IF EXISTS inventario_series_select ON inventario_series;
CREATE POLICY inventario_series_select ON inventario_series
  FOR SELECT TO authenticated
  USING (organization_id = public.get_current_organization_id());

-- inventario_variantes_select (176)
DROP POLICY IF EXISTS inventario_variantes_select ON inventario_variantes;
CREATE POLICY inventario_variantes_select ON inventario_variantes
  FOR SELECT TO authenticated
  USING (organization_id = public.get_current_organization_id());

-- inventario_kit_items_select (177)
DROP POLICY IF EXISTS inventario_kit_items_select ON inventario_kit_items;
CREATE POLICY inventario_kit_items_select ON inventario_kit_items
  FOR SELECT TO authenticated
  USING (organization_id = public.get_current_organization_id());

-- label_templates_select (178)
DROP POLICY IF EXISTS label_templates_select ON label_templates;
CREATE POLICY label_templates_select ON label_templates
  FOR SELECT TO authenticated
  USING (organization_id = public.get_current_organization_id());

-- ---- sucursales (multi-sucursal feature) — GUARDED ----
-- The sucursales table lives on the multi-sucursal feature branch, not on main,
-- so it may be absent in some environments. It replicated BOTH antipatterns:
-- a *_all_service FOR ALL USING(true) granted to PUBLIC (Change-B class) and a
-- broken-GUC SELECT policy (Change-C class). Wrapped in a DO block so the
-- migration self-skips where the table is absent (e.g. a main-only DB).
DO $$
BEGIN
  IF to_regclass('public.sucursales') IS NOT NULL THEN
    -- Change B: restrict the catch-all write policy to service_role
    DROP POLICY IF EXISTS sucursales_all_service ON sucursales;
    CREATE POLICY sucursales_all_service ON sucursales
      FOR ALL TO service_role
      USING (true) WITH CHECK (true);

    -- Change C: replace broken GUC with the JWT-reading function
    DROP POLICY IF EXISTS sucursales_select ON sucursales;
    CREATE POLICY sucursales_select ON sucursales
      FOR SELECT TO authenticated
      USING (organization_id = public.get_current_organization_id());
  ELSE
    RAISE NOTICE 'sucursales does not exist — skipped (multi-sucursal feature not applied to this DB)';
  END IF;
END $$;

-- ===========================================================================
-- CHANGE D — Enable RLS on previously unprotected tables
-- ===========================================================================
-- IMPORTANT: ENABLE RLS and CREATE POLICY are in the same atomic block.
-- Rolling back this transaction leaves the tables exactly as they were
-- (RLS disabled, no policies).  There is no default-deny window.

-- ---- admin_emails (migration 070) ----
-- No RLS existed before this migration.
-- GUARDED: migration 070 was not applied to all environments (the table may
-- be absent). Wrapped in a DO block so the migration self-skips instead of
-- aborting when admin_emails does not exist. If 070 is applied later, re-run
-- this migration to protect the table.
DO $$
BEGIN
  IF to_regclass('public.admin_emails') IS NOT NULL THEN
    ALTER TABLE admin_emails ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS admin_emails_select ON admin_emails;
    CREATE POLICY admin_emails_select ON admin_emails
      FOR SELECT TO authenticated
      USING (organization_id = public.get_current_organization_id());

    DROP POLICY IF EXISTS admin_emails_modify ON admin_emails;
    CREATE POLICY admin_emails_modify ON admin_emails
      FOR ALL TO authenticated
      USING (organization_id = public.get_current_organization_id())
      WITH CHECK (organization_id = public.get_current_organization_id());

    DROP POLICY IF EXISTS admin_emails_all_service ON admin_emails;
    CREATE POLICY admin_emails_all_service ON admin_emails
      FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  ELSE
    RAISE NOTICE 'admin_emails does not exist — skipped (migration 070 not applied to this DB)';
  END IF;
END $$;

-- ---- proveedor_contactos (migration 160) ----
-- No RLS existed before this migration.
ALTER TABLE proveedor_contactos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS proveedor_contactos_select ON proveedor_contactos;
CREATE POLICY proveedor_contactos_select ON proveedor_contactos
  FOR SELECT TO authenticated
  USING (organization_id = public.get_current_organization_id());

DROP POLICY IF EXISTS proveedor_contactos_modify ON proveedor_contactos;
CREATE POLICY proveedor_contactos_modify ON proveedor_contactos
  FOR ALL TO authenticated
  USING (organization_id = public.get_current_organization_id())
  WITH CHECK (organization_id = public.get_current_organization_id());

DROP POLICY IF EXISTS proveedor_contactos_all_service ON proveedor_contactos;
CREATE POLICY proveedor_contactos_all_service ON proveedor_contactos
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ---- proveedor_adjuntos (migration 160) ----
-- No RLS existed before this migration.
ALTER TABLE proveedor_adjuntos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS proveedor_adjuntos_select ON proveedor_adjuntos;
CREATE POLICY proveedor_adjuntos_select ON proveedor_adjuntos
  FOR SELECT TO authenticated
  USING (organization_id = public.get_current_organization_id());

DROP POLICY IF EXISTS proveedor_adjuntos_modify ON proveedor_adjuntos;
CREATE POLICY proveedor_adjuntos_modify ON proveedor_adjuntos
  FOR ALL TO authenticated
  USING (organization_id = public.get_current_organization_id())
  WITH CHECK (organization_id = public.get_current_organization_id());

DROP POLICY IF EXISTS proveedor_adjuntos_all_service ON proveedor_adjuntos;
CREATE POLICY proveedor_adjuntos_all_service ON proveedor_adjuntos
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ---- proveedor_catalogo_items (migration 160) ----
-- No RLS existed before this migration.
ALTER TABLE proveedor_catalogo_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS proveedor_catalogo_items_select ON proveedor_catalogo_items;
CREATE POLICY proveedor_catalogo_items_select ON proveedor_catalogo_items
  FOR SELECT TO authenticated
  USING (organization_id = public.get_current_organization_id());

DROP POLICY IF EXISTS proveedor_catalogo_items_modify ON proveedor_catalogo_items;
CREATE POLICY proveedor_catalogo_items_modify ON proveedor_catalogo_items
  FOR ALL TO authenticated
  USING (organization_id = public.get_current_organization_id())
  WITH CHECK (organization_id = public.get_current_organization_id());

DROP POLICY IF EXISTS proveedor_catalogo_items_all_service ON proveedor_catalogo_items;
CREATE POLICY proveedor_catalogo_items_all_service ON proveedor_catalogo_items
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- cotizacion_templates and items_template_cotizacion are NOT in Change D.
-- They were already org-scoped by migration 083 (which superseded 082's
-- USING(true) policies).  Only the GUC fix (Change C above) applies to them.

COMMIT;
