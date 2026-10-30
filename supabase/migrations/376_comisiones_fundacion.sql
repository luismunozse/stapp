-- ============================================================================
-- Comisiones, slice 1 (fundacion): payout tables + sale annulment date. Additive, re-runnable.
-- ============================================================================
-- Spec: docs/superpowers/specs (one commission calculation with frozen payouts).
--
-- What this adds
--   * ventas.fecha_anulacion: the moment a sale became ANULADA (set by trigger, backfilled
--     from updated_at for sales that are already annulled).
--   * comisiones_pagos: one row per payout to a beneficiary.
--   * comisiones_pagos_items: the frozen rows of a payout (one per document + role + kind).
--     `anulado` mirrors the payout's `anulado`; only anular_pago_comisiones writes it.
--     `fecha_devengo` freezes the row's accrual date at payment time.
--   * comisiones_ajustes: manual / rate-change adjustments waiting to be paid.
--
-- No reader until 377: nothing in the app or in any view touches these objects yet, so
-- applying this file changes no number on any screen.
--
-- Access: service_role only (365 shape minus its authenticated read). User FKs are plain
-- REFERENCES users(id) (NO ACTION) so the organization purge cascade still passes and a
-- user with payouts falls back to "baja" on 23503.
--
-- Backfill: the UPDATE runs between DISABLE/ENABLE TRIGGER ventas_updated_at so annulled
-- sales keep their updated_at (the only source of the date). restore_stock_on_cancel and
-- ventas_proteger_anulacion act only on an estado change, so they do nothing here.
--
-- No BEGIN/COMMIT: scripts/db-run.mjs wraps the file (dry-run by default).
-- Rollback: rollback/376_rollback.sql.
-- ============================================================================

SET LOCAL lock_timeout = '3s';

-- ----------------------------------------------------------------------------
-- 1. ventas.fecha_anulacion
-- ----------------------------------------------------------------------------
ALTER TABLE ventas ADD COLUMN IF NOT EXISTS fecha_anulacion TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION set_fecha_anulacion_venta() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.estado = 'ANULADA' THEN NEW.fecha_anulacion := COALESCE(NEW.fecha_anulacion, now()); END IF;
    RETURN NEW;
  END IF;
  IF NEW.estado = 'ANULADA' AND OLD.estado IS DISTINCT FROM 'ANULADA' THEN
    NEW.fecha_anulacion := COALESCE(NEW.fecha_anulacion, now());
  ELSIF NEW.estado IS DISTINCT FROM 'ANULADA' THEN
    NEW.fecha_anulacion := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ventas_fecha_anulacion ON ventas;
CREATE TRIGGER ventas_fecha_anulacion
  BEFORE INSERT OR UPDATE OF estado ON ventas
  FOR EACH ROW EXECUTE FUNCTION set_fecha_anulacion_venta();

ALTER TABLE ventas DISABLE TRIGGER ventas_updated_at;
UPDATE ventas SET fecha_anulacion = updated_at WHERE estado = 'ANULADA' AND fecha_anulacion IS NULL;
ALTER TABLE ventas ENABLE TRIGGER ventas_updated_at;

-- ----------------------------------------------------------------------------
-- 2. comisiones_pagos
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS comisiones_pagos (
  id                TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id   TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  beneficiario_id   TEXT NOT NULL REFERENCES users(id),
  fecha_pago        TIMESTAMPTZ NOT NULL DEFAULT now(),
  pagado_por        TEXT REFERENCES users(id),
  notas             TEXT,
  total             NUMERIC(12,2) NOT NULL,
  anulado           BOOLEAN NOT NULL DEFAULT false,
  anulado_por       TEXT REFERENCES users(id),
  anulado_at        TIMESTAMPTZ,
  motivo_anulacion  TEXT,
  origen            TEXT NOT NULL DEFAULT 'APP' CHECK (origen IN ('APP', 'BACKFILL')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT comisiones_pagos_anulacion_completa CHECK (
    NOT anulado OR (anulado_at IS NOT NULL AND anulado_por IS NOT NULL AND COALESCE(length(btrim(motivo_anulacion)), 0) > 0)
  )
);

CREATE INDEX IF NOT EXISTS comisiones_pagos_org_beneficiario_idx
  ON comisiones_pagos (organization_id, beneficiario_id, fecha_pago DESC);

ALTER TABLE comisiones_pagos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS comisiones_pagos_all_service ON comisiones_pagos;
CREATE POLICY comisiones_pagos_all_service ON comisiones_pagos
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON public.comisiones_pagos FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. comisiones_pagos_items
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS comisiones_pagos_items (
  id               TEXT PRIMARY KEY DEFAULT generate_cuid(),
  pago_id          TEXT NOT NULL REFERENCES comisiones_pagos(id) ON DELETE CASCADE,
  organization_id  TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  documento_tipo   TEXT CHECK (documento_tipo IN ('VENTA', 'ORDEN')),
  documento_id     TEXT,
  rol              TEXT NOT NULL CHECK (rol IN ('VENDEDOR', 'TECNICO', 'RECEPCION')),
  tipo             TEXT NOT NULL CHECK (tipo IN ('ORIGINAL', 'AJUSTE_DEVOLUCION', 'AJUSTE_ANULACION', 'AJUSTE_MANUAL')),
  ajuste_ref       TEXT,
  base             NUMERIC(12,2),
  porcentaje       NUMERIC(5,2),
  monto            NUMERIC(12,2) NOT NULL,
  fecha_devengo    TIMESTAMPTZ,
  anulado          BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT comisiones_pagos_items_documento_par CHECK ((documento_tipo IS NULL) = (documento_id IS NULL))
);

CREATE INDEX IF NOT EXISTS comisiones_pagos_items_documento_idx
  ON comisiones_pagos_items (organization_id, documento_tipo, documento_id, rol);
CREATE INDEX IF NOT EXISTS comisiones_pagos_items_pago_idx
  ON comisiones_pagos_items (pago_id);
CREATE UNIQUE INDEX IF NOT EXISTS comisiones_pagos_items_fila_vigente_uq ON comisiones_pagos_items (organization_id, COALESCE(documento_tipo, '-'), COALESCE(documento_id, '-'), rol, tipo, COALESCE(ajuste_ref, '-')) WHERE NOT anulado;

ALTER TABLE comisiones_pagos_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS comisiones_pagos_items_all_service ON comisiones_pagos_items;
CREATE POLICY comisiones_pagos_items_all_service ON comisiones_pagos_items
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON public.comisiones_pagos_items FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. comisiones_ajustes
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS comisiones_ajustes (
  id               TEXT PRIMARY KEY DEFAULT generate_cuid(),
  organization_id  TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  beneficiario_id  TEXT NOT NULL REFERENCES users(id),
  documento_tipo   TEXT CHECK (documento_tipo IN ('VENTA', 'ORDEN')),
  documento_id     TEXT,
  rol              TEXT NOT NULL CHECK (rol IN ('VENDEDOR', 'TECNICO', 'RECEPCION')),
  monto            NUMERIC(12,2) NOT NULL CHECK (monto <> 0),
  motivo           TEXT NOT NULL CHECK (length(btrim(motivo)) > 0),
  origen           TEXT NOT NULL CHECK (origen IN ('MANUAL', 'CAMBIO_TASA')),
  created_by       TEXT NOT NULL REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT comisiones_ajustes_documento_par CHECK ((documento_tipo IS NULL) = (documento_id IS NULL))
);

CREATE INDEX IF NOT EXISTS comisiones_ajustes_org_beneficiario_idx
  ON comisiones_ajustes (organization_id, beneficiario_id);

ALTER TABLE comisiones_ajustes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS comisiones_ajustes_all_service ON comisiones_ajustes;
CREATE POLICY comisiones_ajustes_all_service ON comisiones_ajustes
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON public.comisiones_ajustes FROM PUBLIC, anon, authenticated;
