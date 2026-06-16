-- ========================================
-- 229 — Fiscal config per org: IVA régimen + tasa + redondeo de efectivo
-- ========================================
-- Configurable IVA for the POS. Defaults make this a NO-OP for existing orgs
-- (EXENTO = no IVA shown, redondeo 0 = no rounding), so it's fully opt-in and
-- safe to apply any time. The route reads these via select("*") and defaults
-- to EXENTO when absent, and only writes the venta IVA columns when régimen is
-- not EXENTO (i.e. once an org has configured it) — so there's no deploy-order
-- hazard between this migration and the app code.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS iva_regimen TEXT NOT NULL DEFAULT 'EXENTO'
    CHECK (iva_regimen IN ('EXENTO', 'INCLUIDO', 'ADITIVO')),
  ADD COLUMN IF NOT EXISTS iva_tasa DECIMAL NOT NULL DEFAULT 21,
  ADD COLUMN IF NOT EXISTS redondeo_efectivo INTEGER NOT NULL DEFAULT 0;

-- Snapshot per venta (nullable; set only when régimen != EXENTO / redondeo > 0).
ALTER TABLE ventas
  ADD COLUMN IF NOT EXISTS iva_neto DECIMAL,
  ADD COLUMN IF NOT EXISTS iva_monto DECIMAL,
  ADD COLUMN IF NOT EXISTS iva_tasa DECIMAL,
  ADD COLUMN IF NOT EXISTS iva_regimen TEXT,
  ADD COLUMN IF NOT EXISTS redondeo_monto DECIMAL;
