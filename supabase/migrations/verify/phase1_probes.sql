-- =============================================================================
-- RLS Hardening Phase 1 — SQL Probe Verification Harness
-- Run in Supabase Studio SQL editor AFTER applying 201_rls_hardening_phase1.sql
-- =============================================================================
--
-- HOW TO USE:
-- 1. Paste the entire file in Studio's SQL editor.
-- 2. Run section-by-section (each SET CONFIG block + its probes together).
-- 3. Compare each SELECT result against the EXPECTED comment.
--
-- SIMULATED IDENTITIES:
--   A) service_role   — no JWT needed; use the service_role key in the Studio
--                       connection, or SET LOCAL ROLE service_role.
--   B) authenticated  — set the JWT claims manually via set_config, then
--                       SET LOCAL ROLE authenticated.
--   C) anon           — SET LOCAL ROLE anon (no claims needed).
--
-- NOTE: These probes must run inside a transaction so ROLE resets cleanly.
--       Use BEGIN / ROLLBACK wrappers as shown below — they don't commit any
--       data changes.
--
-- ASSUMPTION: A small set of test rows exists for at least two distinct
-- organization_id values (referred to as ORG_A and ORG_B below).
-- Replace the literal values as needed for your staging data.
-- =============================================================================

-- =========================================
-- SECTION 0 — Confirm function + metadata
-- =========================================

-- 0.1 Confirm public.get_current_organization_id() exists and returns TEXT.
-- EXPECTED: one row with proname = 'get_current_organization_id', rettype = 'text'
SELECT p.proname, pg_catalog.format_type(p.prorettype, NULL) AS rettype
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'get_current_organization_id';

-- 0.2 Confirm the function reads the JWT claim (SECURITY DEFINER).
-- EXPECTED: one row with prosecdef = true
SELECT proname, prosecdef
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND proname = 'get_current_organization_id';

-- 0.3 Confirm NO remaining policies use the broken GUC on any of the affected
--     tables covered by Change C.
-- EXPECTED: 0 rows
SELECT tablename, policyname, qual
FROM pg_policies
WHERE qual LIKE '%app.organization_id%'
   OR with_check LIKE '%app.organization_id%';

-- 0.4 Confirm get_current_organization_id() appears in relevant policies.
-- EXPECTED: many rows (one per recreated policy that uses the function)
SELECT tablename, policyname, roles, cmd, qual
FROM pg_policies
WHERE qual LIKE '%get_current_organization_id%'
   OR with_check LIKE '%get_current_organization_id%'
ORDER BY tablename, policyname;

-- =========================================
-- SECTION 1 — Change B: *_all_service scoped TO service_role
-- =========================================

-- 1.1 Confirm all 12 *_all_service policies list ONLY {service_role} in roles.
-- EXPECTED: 12 rows, each with roles = {service_role}
SELECT tablename, policyname, roles, cmd
FROM pg_policies
WHERE policyname LIKE '%_all_service'
  AND tablename IN (
    'depositos','inventario_depositos','conteos_inventario','conteos_items',
    'inventario_imagenes','webhooks','webhook_deliveries','inventario_lotes',
    'inventario_series','inventario_variantes','inventario_kit_items','label_templates'
  )
ORDER BY tablename;

-- 1.2 Probe: authenticated role cannot INSERT on a Change-B table (depositos).
-- EXPECTED: ERROR "new row violates row-level security policy" or 0 rows affected.
-- If Supabase Studio halts on the RLS error before reaching ROLLBACK, run ROLLBACK; manually to close the transaction.
BEGIN;
  SELECT set_config('request.jwt.claims',
    '{"organization_id":"ORG_A","role":"authenticated","sub":"test-user-id","aud":"authenticated"}',
    true);
  SET LOCAL ROLE authenticated;
  -- Attempting INSERT should be blocked by RLS (no insert policy for authenticated).
  INSERT INTO depositos (id, organization_id, nombre, principal, activo)
  VALUES ('probe-dep-1', 'ORG_A', 'ProbeDeposito', false, false);
ROLLBACK;
-- If the INSERT raised an error → Change B is working correctly.
-- If it succeeded (0 error) → INVESTIGATE: authenticated insert policy may exist.

-- 1.3 Probe: authenticated role cannot UPDATE on a Change-B table (webhooks).
-- EXPECTED: 0 rows affected (RLS filters all rows for the authenticated role).
BEGIN;
  SELECT set_config('request.jwt.claims',
    '{"organization_id":"ORG_A","role":"authenticated","sub":"test-user-id","aud":"authenticated"}',
    true);
  SET LOCAL ROLE authenticated;
  UPDATE webhooks SET activo = activo WHERE organization_id = 'ORG_A';
  -- rowcount should be 0 — no update policy exists for authenticated.
ROLLBACK;

-- =========================================
-- SECTION 2 — Change C: JWT-scoped SELECT isolation
-- =========================================

-- 2.1 ventas — org isolation (authenticated, ORG_A claim)
-- EXPECTED: only rows where organization_id = 'ORG_A'
BEGIN;
  SELECT set_config('request.jwt.claims',
    '{"organization_id":"ORG_A","role":"authenticated","sub":"test-user-id","aud":"authenticated"}',
    true);
  SET LOCAL ROLE authenticated;
  SELECT id, organization_id FROM ventas ORDER BY created_at DESC LIMIT 20;
  -- All returned rows must have organization_id = 'ORG_A'.
ROLLBACK;

-- 2.2 ventas — cross-tenant denied (authenticated, ORG_A claim, ORG_B data present)
-- EXPECTED: 0 rows where organization_id = 'ORG_B'
BEGIN;
  SELECT set_config('request.jwt.claims',
    '{"organization_id":"ORG_A","role":"authenticated","sub":"test-user-id","aud":"authenticated"}',
    true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) AS org_b_rows_visible FROM ventas WHERE organization_id = 'ORG_B';
  -- EXPECTED: 0
ROLLBACK;

-- 2.3 items_venta — org isolation via EXISTS-join
-- EXPECTED: only items belonging to ventas of ORG_A
BEGIN;
  SELECT set_config('request.jwt.claims',
    '{"organization_id":"ORG_A","role":"authenticated","sub":"test-user-id","aud":"authenticated"}',
    true);
  SET LOCAL ROLE authenticated;
  SELECT iv.id, v.organization_id
  FROM items_venta iv
  JOIN ventas v ON v.id = iv.venta_id
  LIMIT 20;
  -- All rows must have v.organization_id = 'ORG_A'.
ROLLBACK;

-- 2.4 movimientos_inventario — org isolation
BEGIN;
  SELECT set_config('request.jwt.claims',
    '{"organization_id":"ORG_A","role":"authenticated","sub":"test-user-id","aud":"authenticated"}',
    true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) AS org_b_visible FROM movimientos_inventario WHERE organization_id = 'ORG_B';
  -- EXPECTED: 0
ROLLBACK;

-- 2.5 historial_precios — FOR ALL policy, org isolation
BEGIN;
  SELECT set_config('request.jwt.claims',
    '{"organization_id":"ORG_A","role":"authenticated","sub":"test-user-id","aud":"authenticated"}',
    true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) AS org_b_visible FROM historial_precios WHERE organization_id = 'ORG_B';
  -- EXPECTED: 0
ROLLBACK;

-- 2.6 cotizacion_templates — GUC fix confirmed (Function used, not GUC)
-- EXPECTED: 0 rows where organization_id = 'ORG_B'
BEGIN;
  SELECT set_config('request.jwt.claims',
    '{"organization_id":"ORG_A","role":"authenticated","sub":"test-user-id","aud":"authenticated"}',
    true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) AS org_b_visible FROM cotizacion_templates WHERE organization_id = 'ORG_B';
  -- EXPECTED: 0
ROLLBACK;

-- 2.7 ordenes_compra — org isolation
BEGIN;
  SELECT set_config('request.jwt.claims',
    '{"organization_id":"ORG_A","role":"authenticated","sub":"test-user-id","aud":"authenticated"}',
    true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) AS org_b_visible FROM ordenes_compra WHERE organization_id = 'ORG_B';
  -- EXPECTED: 0
ROLLBACK;

-- 2.8 depositos (inventory table) — org isolation after GUC fix
BEGIN;
  SELECT set_config('request.jwt.claims',
    '{"organization_id":"ORG_A","role":"authenticated","sub":"test-user-id","aud":"authenticated"}',
    true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) AS own_org FROM depositos WHERE organization_id = 'ORG_A';
  -- EXPECTED: >= 1 (no zero-row regression from broken GUC)
  SELECT count(*) AS org_b_visible FROM depositos WHERE organization_id = 'ORG_B';
  -- EXPECTED: 0
ROLLBACK;

-- 2.9 service_role bypass — sees ALL rows across all C-affected tables
-- EXPECTED: total row counts > 0 (sanity that app is unaffected)
BEGIN;
  SET LOCAL ROLE service_role;
  SELECT
    (SELECT count(*) FROM ventas)                   AS ventas_total,
    (SELECT count(*) FROM movimientos_inventario)   AS mov_inv_total,
    (SELECT count(*) FROM historial_precios)        AS hist_precios_total,
    (SELECT count(*) FROM cotizacion_templates)     AS cot_templates_total,
    (SELECT count(*) FROM ordenes_compra)           AS oc_total,
    (SELECT count(*) FROM depositos)                AS depositos_total,
    (SELECT count(*) FROM inventario_series)        AS series_total;
ROLLBACK;

-- 2.10 Confirm JWT org resolves correctly via the function (standalone check)
-- EXPECTED: returns 'ORG_A'
BEGIN;
  SELECT set_config('request.jwt.claims',
    '{"organization_id":"ORG_A","role":"authenticated","sub":"test-user-id","aud":"authenticated"}',
    true);
  SET LOCAL ROLE authenticated;
  SELECT public.get_current_organization_id() AS resolved_org;
  -- EXPECTED: 'ORG_A'
ROLLBACK;

-- =========================================
-- SECTION 3 — Change D: RLS enabled on PII tables
-- =========================================

-- 3.1 Confirm RLS is enabled on all four D-tables.
-- EXPECTED: 4 rows with relrowsecurity = true
SELECT relname, relrowsecurity
FROM pg_class
WHERE relname IN ('admin_emails','proveedor_contactos','proveedor_adjuntos','proveedor_catalogo_items')
ORDER BY relname;

-- 3.2 Confirm expected policies exist on D-tables (select + modify + all_service per table).
-- EXPECTED: 12 rows total (3 per table × 4 tables)
SELECT tablename, policyname, roles, cmd
FROM pg_policies
WHERE tablename IN ('admin_emails','proveedor_contactos','proveedor_adjuntos','proveedor_catalogo_items')
ORDER BY tablename, policyname;

-- 3.3 admin_emails — cross-tenant SELECT denied
BEGIN;
  SELECT set_config('request.jwt.claims',
    '{"organization_id":"ORG_A","role":"authenticated","sub":"test-user-id","aud":"authenticated"}',
    true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) AS org_b_visible FROM admin_emails WHERE organization_id = 'ORG_B';
  -- EXPECTED: 0
ROLLBACK;

-- 3.4 proveedor_contactos — authenticated sees own org only
BEGIN;
  SELECT set_config('request.jwt.claims',
    '{"organization_id":"ORG_A","role":"authenticated","sub":"test-user-id","aud":"authenticated"}',
    true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) AS org_b_visible FROM proveedor_contactos WHERE organization_id = 'ORG_B';
  -- EXPECTED: 0
ROLLBACK;

-- 3.5 proveedor_adjuntos — authenticated sees own org only
BEGIN;
  SELECT set_config('request.jwt.claims',
    '{"organization_id":"ORG_A","role":"authenticated","sub":"test-user-id","aud":"authenticated"}',
    true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) AS org_b_visible FROM proveedor_adjuntos WHERE organization_id = 'ORG_B';
  -- EXPECTED: 0
ROLLBACK;

-- 3.6 proveedor_catalogo_items — authenticated sees own org only
BEGIN;
  SELECT set_config('request.jwt.claims',
    '{"organization_id":"ORG_A","role":"authenticated","sub":"test-user-id","aud":"authenticated"}',
    true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) AS org_b_visible FROM proveedor_catalogo_items WHERE organization_id = 'ORG_B';
  -- EXPECTED: 0
ROLLBACK;

-- 3.7 service_role bypass on D-tables — all rows visible
BEGIN;
  SET LOCAL ROLE service_role;
  SELECT
    (SELECT count(*) FROM admin_emails)           AS admin_emails_total,
    (SELECT count(*) FROM proveedor_contactos)    AS prov_contactos_total,
    (SELECT count(*) FROM proveedor_adjuntos)     AS prov_adjuntos_total,
    (SELECT count(*) FROM proveedor_catalogo_items) AS prov_catalogo_total;
  -- EXPECTED: same counts as before Phase 1 was applied (no data change).
ROLLBACK;

-- 3.8 anon role on D-tables — no anon policy → zero rows (default-deny after ENABLE RLS).
-- EXPECTED: 0 rows from each table for anon role.
BEGIN;
  SET LOCAL ROLE anon;
  SELECT count(*) AS anon_admin_emails       FROM admin_emails;           -- EXPECTED: 0
  SELECT count(*) AS anon_prov_contactos     FROM proveedor_contactos;    -- EXPECTED: 0
  SELECT count(*) AS anon_prov_adjuntos      FROM proveedor_adjuntos;     -- EXPECTED: 0
  SELECT count(*) AS anon_prov_catalogo      FROM proveedor_catalogo_items; -- EXPECTED: 0
ROLLBACK;

-- =========================================
-- SECTION 4 — Pre-change-A open window documentation (DO NOT FIX HERE)
-- =========================================
-- These probes DOCUMENT the still-open anon read window on the 4 order tables.
-- Phase 1 intentionally does NOT close this window (Change A is Phase 4).
-- Run them to confirm the window is still open and baseline it for the Phase 4 probe.

-- 4.1 anon SELECT on ordenes_servicio — EXPECTED: all rows visible (open window).
BEGIN;
  SET LOCAL ROLE anon;
  SELECT count(*) AS anon_ordenes_servicio FROM ordenes_servicio;
  -- EXPECTED: > 0 (open window — to be closed in Phase 4 / Change A).
ROLLBACK;

-- 4.2 anon SELECT on cotizaciones — EXPECTED: all rows visible (open window).
BEGIN;
  SET LOCAL ROLE anon;
  SELECT count(*) AS anon_cotizaciones FROM cotizaciones;
  -- EXPECTED: > 0 (open window — to be closed in Phase 4 / Change A).
ROLLBACK;

-- =========================================
-- SECTION 5 — Full policy inventory snapshot (audit reference)
-- =========================================
-- Run this after apply and save the output as a baseline for future audits.
-- EXPECTED: no policy should have qual containing 'app.organization_id'.

SELECT
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  left(qual, 120)       AS qual_preview,
  left(with_check, 120) AS with_check_preview
FROM pg_policies
WHERE tablename IN (
  -- Change B + C: inventory/extended tables
  'depositos','inventario_depositos','conteos_inventario','conteos_items',
  'inventario_imagenes','webhooks','webhook_deliveries','inventario_lotes',
  'inventario_series','inventario_variantes','inventario_kit_items','label_templates',
  -- Change C: ventas/finance tables
  'ventas','items_venta','garantias_venta','movimientos_inventario',
  'devoluciones_venta','items_devolucion','historial_precios','items_factura',
  'cotizacion_templates','items_template_cotizacion','ordenes_compra','items_orden_compra',
  -- Change D: PII tables
  'admin_emails','proveedor_contactos','proveedor_adjuntos','proveedor_catalogo_items'
)
ORDER BY tablename, policyname;
