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
-- APPLY OFF-PEAK. ADD COLUMN without a DEFAULT is catalog-only (no table rewrite), but each
-- ALTER takes ACCESS EXCLUSIVE on its table until the transaction ends: inventario, ventas,
-- items_venta, pagos_venta and ordenes_servicio are hot tables. lock_timeout bounds the WAIT,
-- not the hold; if it aborts, nothing was applied: re-run it.
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
  tipo_cambio_manual     NUMERIC(14,4) CHECK (tipo_cambio_manual IS NULL OR tipo_cambio_manual > 0),
  -- Last confirmed rate, kept for the fallback chain when the rate service is down.
  tipo_cambio_referencia NUMERIC(14,4) CHECK (tipo_cambio_referencia IS NULL OR tipo_cambio_referencia > 0),
  referencia_en          TIMESTAMPTZ,
  redondeo_conversion    NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (redondeo_conversion >= 0),
  acepta_usd_efectivo    BOOLEAN NOT NULL DEFAULT false,
  vuelto_moneda_default  TEXT NOT NULL DEFAULT 'LOCAL' CHECK (vuelto_moneda_default IN ('LOCAL', 'USD')),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE organizacion_moneda ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organizacion_moneda_all_service ON organizacion_moneda;
CREATE POLICY organizacion_moneda_all_service ON organizacion_moneda
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON public.organizacion_moneda FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS organizacion_moneda_updated_at ON organizacion_moneda;
CREATE TRIGGER organizacion_moneda_updated_at
  BEFORE UPDATE ON organizacion_moneda
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ----------------------------------------------------------------------------
-- 2. Catalog and cash movements: the row's own currency (NULL = local)
-- ----------------------------------------------------------------------------
ALTER TABLE inventario
  ADD COLUMN IF NOT EXISTS moneda CHAR(3) CHECK (moneda IS NULL OR moneda = 'USD');
ALTER TABLE servicios
  ADD COLUMN IF NOT EXISTS moneda CHAR(3) CHECK (moneda IS NULL OR moneda = 'USD');
ALTER TABLE movimientos_caja
  ADD COLUMN IF NOT EXISTS moneda CHAR(3) CHECK (moneda IS NULL OR moneda = 'USD');

-- ----------------------------------------------------------------------------
-- 3. Line tables: origin snapshot (the local-equivalent columns stay as they are)
-- ----------------------------------------------------------------------------
ALTER TABLE items_venta
  ADD COLUMN IF NOT EXISTS moneda_origen CHAR(3) CHECK (moneda_origen IS NULL OR moneda_origen = 'USD'),
  ADD COLUMN IF NOT EXISTS precio_origen NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS tipo_cambio NUMERIC(14,4) CHECK (tipo_cambio IS NULL OR tipo_cambio > 0);
ALTER TABLE servicios_orden
  ADD COLUMN IF NOT EXISTS moneda_origen CHAR(3) CHECK (moneda_origen IS NULL OR moneda_origen = 'USD'),
  ADD COLUMN IF NOT EXISTS precio_origen NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS tipo_cambio NUMERIC(14,4) CHECK (tipo_cambio IS NULL OR tipo_cambio > 0);
ALTER TABLE repuestos_orden
  ADD COLUMN IF NOT EXISTS moneda_origen CHAR(3) CHECK (moneda_origen IS NULL OR moneda_origen = 'USD'),
  ADD COLUMN IF NOT EXISTS precio_origen NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS tipo_cambio NUMERIC(14,4) CHECK (tipo_cambio IS NULL OR tipo_cambio > 0);
-- items_cotizacion.moneda_item already exists (082); quotes reuse it and cotizaciones.tipo_cambio.
ALTER TABLE items_cotizacion
  ADD COLUMN IF NOT EXISTS moneda_origen CHAR(3) CHECK (moneda_origen IS NULL OR moneda_origen = 'USD'),
  ADD COLUMN IF NOT EXISTS precio_origen NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS tipo_cambio NUMERIC(14,4) CHECK (tipo_cambio IS NULL OR tipo_cambio > 0);

-- ----------------------------------------------------------------------------
-- 4. Documents: the rate used at creation, immutable afterwards by convention
-- ----------------------------------------------------------------------------
ALTER TABLE ventas
  ADD COLUMN IF NOT EXISTS tipo_cambio NUMERIC(14,4) CHECK (tipo_cambio IS NULL OR tipo_cambio > 0),
  ADD COLUMN IF NOT EXISTS tipo_cambio_fuente TEXT;
ALTER TABLE ordenes_servicio
  ADD COLUMN IF NOT EXISTS tipo_cambio NUMERIC(14,4) CHECK (tipo_cambio IS NULL OR tipo_cambio > 0),
  ADD COLUMN IF NOT EXISTS tipo_cambio_fuente TEXT;

-- ----------------------------------------------------------------------------
-- 5. Payments: currency tendered and change given. monto stays the LOCAL amount applied.
-- ----------------------------------------------------------------------------
ALTER TABLE pagos_venta
  ADD COLUMN IF NOT EXISTS moneda CHAR(3) CHECK (moneda IS NULL OR moneda = 'USD'),
  ADD COLUMN IF NOT EXISTS monto_moneda NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS tipo_cambio NUMERIC(14,4) CHECK (tipo_cambio IS NULL OR tipo_cambio > 0),
  ADD COLUMN IF NOT EXISTS vuelto_monto NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS vuelto_moneda CHAR(3) CHECK (vuelto_moneda IS NULL OR vuelto_moneda = 'USD');

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
DROP POLICY IF EXISTS sesion_caja_saldos_all_service ON sesion_caja_saldos;
CREATE POLICY sesion_caja_saldos_all_service ON sesion_caja_saldos
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON public.sesion_caja_saldos FROM PUBLIC, anon, authenticated;
