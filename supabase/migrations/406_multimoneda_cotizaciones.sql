-- ============================================================================
-- 406 (multimoneda S3): quote rate metadata + recotizaciones. Additive, re-runnable.
-- ============================================================================
-- Prerequisite: 365 (as corrected for S3) and 365b are applied: this file does not create or
-- change any EUR CHECK or organizacion_moneda.moneda_extranjera, those live in 365 now.
--
--   * cotizaciones gains tipo_cambio_fuente / tipo_cambio_en (where and when the rate came from).
--     Both are bare nullable columns: no table rewrite, no scan.
--   * cotizaciones.tipo_cambio (DECIMAL, from 082) is NOT converted to NUMERIC(14,6): ALTER TYPE
--     rewrites the whole table under ACCESS EXCLUSIVE. Range validation stays in the code.
--   * recotizaciones: one row per "Cambiar cotizacion" on an order or a quote (audit trail).
--     documento_id points at ordenes_servicio or cotizaciones depending on documento_tipo, so
--     it has no FK. usuario_id is nulled if the user is deleted (the trail outlives users).
--
-- No BEGIN/COMMIT: scripts/db-run.mjs wraps the file (dry-run by default).
-- LOCKS: ACCESS EXCLUSIVE on cotizaciones until the transaction ends; apply off-peak.
-- lock_timeout bounds the WAIT, not the hold; if it aborts, nothing was applied: re-run it.
--
-- Rollback: rollback/406_rollback.sql. Probes: verify/406_probes.sql.
-- ============================================================================

SET LOCAL lock_timeout = '3s';

-- ----------------------------------------------------------------------------
-- 1. Quotes: rate source and time
-- ----------------------------------------------------------------------------
ALTER TABLE cotizaciones
  ADD COLUMN IF NOT EXISTS tipo_cambio_fuente TEXT,
  ADD COLUMN IF NOT EXISTS tipo_cambio_en TIMESTAMPTZ;

-- ----------------------------------------------------------------------------
-- 2. Re-quote audit trail
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recotizaciones (
  id                   TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  documento_tipo       TEXT NOT NULL CHECK (documento_tipo IN ('ORDEN', 'COTIZACION')),
  documento_id         TEXT NOT NULL,
  modo                 TEXT NOT NULL CHECK (modo IN ('HOY', 'MANUAL')),
  tipo_cambio_anterior NUMERIC(14,6) CHECK (tipo_cambio_anterior IS NULL OR tipo_cambio_anterior > 0),
  tipo_cambio_nuevo    NUMERIC(14,6) NOT NULL CHECK (tipo_cambio_nuevo > 0),
  motivo               TEXT,
  total_anterior       NUMERIC(12,2),
  total_nuevo          NUMERIC(12,2),
  lineas_afectadas     INT NOT NULL DEFAULT 0 CHECK (lineas_afectadas >= 0),
  usuario_id           TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- A manual rate needs a written reason (REQ-6.4); "today" does not. COALESCE matters: with a
  -- NULL motivo `false OR NULL` is NULL, and a CHECK accepts NULL. btrim also strips tab/CR/LF.
  CONSTRAINT recotizaciones_motivo_chk CHECK (modo <> 'MANUAL' OR length(btrim(COALESCE(motivo, ''), E' \t\r\n')) > 0)
);

CREATE INDEX IF NOT EXISTS recotizaciones_documento_idx
  ON recotizaciones (organization_id, documento_tipo, documento_id);

ALTER TABLE recotizaciones ENABLE ROW LEVEL SECURITY;
-- Own-organization read for authenticated sessions (same shape as 365 / 201 hardening).
DROP POLICY IF EXISTS recotizaciones_select ON recotizaciones;
CREATE POLICY recotizaciones_select ON recotizaciones
  FOR SELECT TO authenticated
  USING (organization_id = public.get_current_organization_id());
DROP POLICY IF EXISTS recotizaciones_all_service ON recotizaciones;
CREATE POLICY recotizaciones_all_service ON recotizaciones
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON public.recotizaciones FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.recotizaciones TO authenticated;
