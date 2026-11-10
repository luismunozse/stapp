-- ============================================================================
-- M1 (multimoneda-inventario-servicios): schema foundation. Additive, re-runnable.
-- ============================================================================
-- Money columns that existing readers already sum stay in the LOCAL currency (the "local
-- equivalent"). This file only adds the columns that remember the ORIGINAL currency, amount
-- and rate beside them, plus two small tables. Nothing reads any of it until the app code
-- lands, and the whole feature stays dark behind organizacion_moneda.multimoneda_habilitada
-- (default false), so applying this file changes no behavior.
--
-- DESIGN DECISIONS
--   * Rates are NUMERIC(14,6): the app accepts up to 6 decimals (REQ-1.6), so storage must not truncate.
--   * moneda CHAR(3) NULL, NULL = the organization's local currency, CHECK NULL or 'USD'.
--     No DEFAULT and no backfill: an insert path that forgets the column (import, bulk,
--     v1 API, onboarding seed) must not label CLP/EUR items as ARS. Existing rows are NOT
--     rewritten (no UPDATE in this file).
--   * Variants and kits are plain `inventario` rows (355/177), so inventario.moneda covers
--     them. The legacy inventario_variantes table is gone (363).
--   * Settings live in their own table organizacion_moneda (one row per org) instead of new
--     `organizations` columns, so the three /api/configuracion cascades gain no new rung and
--     no 42703 fallback step. `organizations` is not touched here.
--   * USD amounts exist only on catalog rows and as origin metadata on lines/payments.
--     monto, total, precio_unitario and costo_final keep meaning local currency.
--   * crear_venta_atomica is NOT redefined here (that is M2, a later change).
--
-- No BEGIN/COMMIT: scripts/db-run.mjs wraps the file (dry-run by default).
--
-- LOCKS. ADD COLUMN without a DEFAULT does not rewrite the table, but an INLINE CHECK on that
-- ADD COLUMN is validated against every existing row (a full scan) while ACCESS EXCLUSIVE is
-- held. So the columns are added bare and each CHECK is added NOT VALID: no row is scanned,
-- and the rule is still enforced for every new write. Validating existing rows is a separate optional
-- step (365b_multimoneda_validate.sql): it must NOT run in this transaction, because the
-- ACCESS EXCLUSIVE lock would stay held until commit and the scan would happen under it anyway.
-- The columns are all-NULL when added, so the constraints already hold for existing rows.
-- Each ALTER still takes ACCESS EXCLUSIVE on its table until the transaction ends: inventario,
-- ventas, items_venta, pagos_venta and ordenes_servicio are hot tables, so APPLY OFF-PEAK.
-- lock_timeout bounds the WAIT, not the hold; if it aborts, nothing was applied: re-run it.
--
-- Rollback: rollback/365_rollback.sql. Probes: verify/365_probes.sql.
-- ============================================================================

SET LOCAL lock_timeout = '3s';

-- ----------------------------------------------------------------------------
-- 1. Per-organization settings
-- ----------------------------------------------------------------------------
-- Defaults that depend on the country (AR: BLUE source, rounding 10) are resolved in code
-- (lib/currency/config-moneda.ts), not stored.
CREATE TABLE IF NOT EXISTS organizacion_moneda (
  organization_id        TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  multimoneda_habilitada BOOLEAN NOT NULL DEFAULT false,
  tipo_cambio_fuente     TEXT CHECK (tipo_cambio_fuente IN ('MANUAL', 'OFICIAL', 'BLUE', 'MEP')),
  tipo_cambio_manual     NUMERIC(14,6) CHECK (tipo_cambio_manual IS NULL OR tipo_cambio_manual > 0),
  -- Last confirmed rate, kept for the fallback chain when the rate service is down.
  tipo_cambio_referencia NUMERIC(14,6) CHECK (tipo_cambio_referencia IS NULL OR tipo_cambio_referencia > 0),
  referencia_en          TIMESTAMPTZ,
  redondeo_conversion    NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (redondeo_conversion >= 0),
  acepta_usd_efectivo    BOOLEAN NOT NULL DEFAULT false,
  vuelto_moneda_default  TEXT NOT NULL DEFAULT 'LOCAL' CHECK (vuelto_moneda_default IN ('LOCAL', 'USD')),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE organizacion_moneda ENABLE ROW LEVEL SECURITY;
-- Own-organization read for authenticated sessions (201 hardening shape, see 300_servicios.sql).
DROP POLICY IF EXISTS organizacion_moneda_select ON organizacion_moneda;
CREATE POLICY organizacion_moneda_select ON organizacion_moneda
  FOR SELECT TO authenticated
  USING (organization_id = public.get_current_organization_id());
DROP POLICY IF EXISTS organizacion_moneda_all_service ON organizacion_moneda;
CREATE POLICY organizacion_moneda_all_service ON organizacion_moneda
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON public.organizacion_moneda FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.organizacion_moneda TO authenticated;

DROP TRIGGER IF EXISTS organizacion_moneda_updated_at ON organizacion_moneda;
CREATE TRIGGER organizacion_moneda_updated_at
  BEFORE UPDATE ON organizacion_moneda
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ----------------------------------------------------------------------------
-- Helper: named CHECK, NOT VALID, idempotent (constraints have no IF NOT EXISTS).
-- ----------------------------------------------------------------------------
CREATE FUNCTION pg_temp.add_check_nv(p_tabla TEXT, p_name TEXT, p_expr TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = p_name AND conrelid = ('public.' || p_tabla)::regclass
  ) THEN
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (%s) NOT VALID', p_tabla, p_name, p_expr);
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. Catalog and cash movements: the row's own currency (NULL = local)
-- ----------------------------------------------------------------------------
ALTER TABLE inventario ADD COLUMN IF NOT EXISTS moneda CHAR(3);
ALTER TABLE servicios ADD COLUMN IF NOT EXISTS moneda CHAR(3);
ALTER TABLE movimientos_caja ADD COLUMN IF NOT EXISTS moneda CHAR(3);

SELECT pg_temp.add_check_nv('inventario', 'inventario_moneda_chk', 'moneda IS NULL OR moneda = ''USD''');
SELECT pg_temp.add_check_nv('servicios', 'servicios_moneda_chk', 'moneda IS NULL OR moneda = ''USD''');
SELECT pg_temp.add_check_nv('movimientos_caja', 'movimientos_caja_moneda_chk', 'moneda IS NULL OR moneda = ''USD''');

-- ----------------------------------------------------------------------------
-- 3. Line tables: origin snapshot (the local-equivalent columns stay as they are)
-- ----------------------------------------------------------------------------
ALTER TABLE items_venta
  ADD COLUMN IF NOT EXISTS moneda_origen CHAR(3),
  ADD COLUMN IF NOT EXISTS precio_origen NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS tipo_cambio NUMERIC(14,6);
ALTER TABLE servicios_orden
  ADD COLUMN IF NOT EXISTS moneda_origen CHAR(3),
  ADD COLUMN IF NOT EXISTS precio_origen NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS tipo_cambio NUMERIC(14,6);
ALTER TABLE repuestos_orden
  ADD COLUMN IF NOT EXISTS moneda_origen CHAR(3),
  ADD COLUMN IF NOT EXISTS precio_origen NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS tipo_cambio NUMERIC(14,6);
-- items_cotizacion.moneda_item already exists (082); quotes reuse it and cotizaciones.tipo_cambio.
ALTER TABLE items_cotizacion
  ADD COLUMN IF NOT EXISTS moneda_origen CHAR(3),
  ADD COLUMN IF NOT EXISTS precio_origen NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS tipo_cambio NUMERIC(14,6);

SELECT pg_temp.add_check_nv('items_venta', 'items_venta_moneda_origen_chk', 'moneda_origen IS NULL OR moneda_origen = ''USD''');
SELECT pg_temp.add_check_nv('items_venta', 'items_venta_tipo_cambio_chk', 'tipo_cambio IS NULL OR tipo_cambio > 0');
SELECT pg_temp.add_check_nv('servicios_orden', 'servicios_orden_moneda_origen_chk', 'moneda_origen IS NULL OR moneda_origen = ''USD''');
SELECT pg_temp.add_check_nv('servicios_orden', 'servicios_orden_tipo_cambio_chk', 'tipo_cambio IS NULL OR tipo_cambio > 0');
SELECT pg_temp.add_check_nv('repuestos_orden', 'repuestos_orden_moneda_origen_chk', 'moneda_origen IS NULL OR moneda_origen = ''USD''');
SELECT pg_temp.add_check_nv('repuestos_orden', 'repuestos_orden_tipo_cambio_chk', 'tipo_cambio IS NULL OR tipo_cambio > 0');
SELECT pg_temp.add_check_nv('items_cotizacion', 'items_cotizacion_moneda_origen_chk', 'moneda_origen IS NULL OR moneda_origen = ''USD''');
SELECT pg_temp.add_check_nv('items_cotizacion', 'items_cotizacion_tipo_cambio_chk', 'tipo_cambio IS NULL OR tipo_cambio > 0');

-- ----------------------------------------------------------------------------
-- 4. Documents: the rate used at creation, immutable afterwards by convention
-- ----------------------------------------------------------------------------
ALTER TABLE ventas
  ADD COLUMN IF NOT EXISTS tipo_cambio NUMERIC(14,6),
  ADD COLUMN IF NOT EXISTS tipo_cambio_fuente TEXT;
ALTER TABLE ordenes_servicio
  ADD COLUMN IF NOT EXISTS tipo_cambio NUMERIC(14,6),
  ADD COLUMN IF NOT EXISTS tipo_cambio_fuente TEXT;

SELECT pg_temp.add_check_nv('ventas', 'ventas_tipo_cambio_chk', 'tipo_cambio IS NULL OR tipo_cambio > 0');
SELECT pg_temp.add_check_nv('ordenes_servicio', 'ordenes_servicio_tipo_cambio_chk', 'tipo_cambio IS NULL OR tipo_cambio > 0');

-- ----------------------------------------------------------------------------
-- 5. Payments: currency tendered and change given. monto stays the LOCAL amount applied.
-- ----------------------------------------------------------------------------
ALTER TABLE pagos_venta
  ADD COLUMN IF NOT EXISTS moneda CHAR(3),
  ADD COLUMN IF NOT EXISTS monto_moneda NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS tipo_cambio NUMERIC(14,6),
  ADD COLUMN IF NOT EXISTS vuelto_monto NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS vuelto_moneda CHAR(3);

SELECT pg_temp.add_check_nv('pagos_venta', 'pagos_venta_moneda_chk', 'moneda IS NULL OR moneda = ''USD''');
SELECT pg_temp.add_check_nv('pagos_venta', 'pagos_venta_tipo_cambio_chk', 'tipo_cambio IS NULL OR tipo_cambio > 0');
SELECT pg_temp.add_check_nv('pagos_venta', 'pagos_venta_vuelto_moneda_chk', 'vuelto_moneda IS NULL OR vuelto_moneda = ''USD''');

-- ----------------------------------------------------------------------------
-- 6. Cash session balances per foreign currency (local stays on sesiones_caja)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sesion_caja_saldos (
  id              TEXT PRIMARY KEY DEFAULT generate_cuid(),
  sesion_id       TEXT NOT NULL REFERENCES sesiones_caja(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  moneda          CHAR(3) NOT NULL CHECK (moneda = 'USD'),
  saldo_inicial   NUMERIC(12,2) NOT NULL DEFAULT 0,
  esperado        NUMERIC(12,2),
  conteo_fisico   NUMERIC(12,2),
  diferencia      NUMERIC(12,2),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sesion_id, moneda)
);

CREATE INDEX IF NOT EXISTS sesion_caja_saldos_org_idx ON sesion_caja_saldos(organization_id);

ALTER TABLE sesion_caja_saldos ENABLE ROW LEVEL SECURITY;
-- Own-organization read for authenticated sessions (201 hardening shape, see 300_servicios.sql).
DROP POLICY IF EXISTS sesion_caja_saldos_select ON sesion_caja_saldos;
CREATE POLICY sesion_caja_saldos_select ON sesion_caja_saldos
  FOR SELECT TO authenticated
  USING (organization_id = public.get_current_organization_id());
DROP POLICY IF EXISTS sesion_caja_saldos_all_service ON sesion_caja_saldos;
CREATE POLICY sesion_caja_saldos_all_service ON sesion_caja_saldos
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON public.sesion_caja_saldos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.sesion_caja_saldos TO authenticated;
