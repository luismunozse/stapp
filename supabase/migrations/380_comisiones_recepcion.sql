-- ============================================================================
-- Comisiones, slice 2 (recepcion): reception rates, shop rules and order snapshot. Additive, re-runnable.
-- ============================================================================
-- Spec: docs/superpowers/specs/2026-10-29-comisiones-unificadas-design.md (reception commission and per-shop rules).
--
-- What this adds
--   * comisiones_config: one row per organization with the shop's commission rules
--     (when an order accrues, which base each role uses, the default reception rate and
--     whether warranty re-entries commission). A missing row means "all defaults".
--   * users.porcentaje_comision_recepcion: the person's own reception rate. NULL = use the
--     organization default.
--   * ordenes_servicio.porcentaje_comision_recepcion: the rate frozen on the order when it is
--     created. NULL means legacy (an order received before this migration).
--   * set_porcentaje_comision_recepcion() + trigger BEFORE INSERT: freezes that rate on every
--     insert path (API routes and RPCs alike). recibido_por is never edited, so INSERT only.
--   * reclamos_garantia_orden_reparacion_idx: 381 looks up warranty-claim orders by it.
--
-- Nothing reads these objects until 381: applying this file changes no number on any screen.
--
-- Access: comisiones_config is service_role only (376 shape). The trigger function is
-- SECURITY DEFINER with a pinned search_path so an order insert never fails because the
-- writer's role cannot read comisiones_config; nobody can call it directly.
--
-- No BEGIN/COMMIT: scripts/db-run.mjs wraps the file (dry-run by default).
-- Rollback: rollback/380_rollback.sql. Probes: verify/380_probes.sql.
-- ============================================================================

SET LOCAL lock_timeout = '3s';

-- ----------------------------------------------------------------------------
-- 1. comisiones_config
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS comisiones_config (
  organization_id              TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  orden_devengo                TEXT NOT NULL DEFAULT 'ENTREGA_Y_COBRO' CHECK (orden_devengo IN ('ENTREGA_Y_COBRO', 'ENTREGA', 'COBRO')),
  tecnico_base                 TEXT NOT NULL DEFAULT 'MANO_DE_OBRA' CHECK (tecnico_base IN ('MANO_DE_OBRA', 'MONTO_ORDEN')),
  recepcion_base               TEXT NOT NULL DEFAULT 'MONTO_ORDEN' CHECK (recepcion_base IN ('MONTO_ORDEN', 'MANO_DE_OBRA')),
  recepcion_porcentaje_default NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (recepcion_porcentaje_default BETWEEN 0 AND 100),
  reingreso_comisiona          BOOLEAN NOT NULL DEFAULT false,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE comisiones_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS comisiones_config_all_service ON comisiones_config;
CREATE POLICY comisiones_config_all_service ON comisiones_config
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON public.comisiones_config FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. Reception rates: per person (nullable) and frozen per order (nullable = legacy)
-- ----------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS porcentaje_comision_recepcion NUMERIC(5,2)
  CHECK (porcentaje_comision_recepcion BETWEEN 0 AND 100);

ALTER TABLE ordenes_servicio ADD COLUMN IF NOT EXISTS porcentaje_comision_recepcion NUMERIC(5,2);

-- NOT VALID then VALIDATE: the check does not scan under the ACCESS EXCLUSIVE lock.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ordenes_servicio_porcentaje_recepcion_check') THEN
    ALTER TABLE ordenes_servicio ADD CONSTRAINT ordenes_servicio_porcentaje_recepcion_check
      CHECK (porcentaje_comision_recepcion BETWEEN 0 AND 100) NOT VALID;
  END IF;
END $$;
ALTER TABLE ordenes_servicio VALIDATE CONSTRAINT ordenes_servicio_porcentaje_recepcion_check;

-- ----------------------------------------------------------------------------
-- 3. Snapshot trigger
--    explicit value kept; no receiver, or a receiver outside the order's org = 0;
--    otherwise the person's own rate, else the org default, else 0.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_porcentaje_comision_recepcion() RETURNS TRIGGER AS $$
DECLARE v_propio NUMERIC(5,2);
BEGIN
  IF NEW.porcentaje_comision_recepcion IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.recibido_por IS NULL THEN NEW.porcentaje_comision_recepcion := 0; RETURN NEW; END IF;
  SELECT u.porcentaje_comision_recepcion INTO v_propio
    FROM users u WHERE u.id = NEW.recibido_por AND u.organization_id = NEW.organization_id;
  IF NOT FOUND THEN NEW.porcentaje_comision_recepcion := 0; RETURN NEW; END IF;
  NEW.porcentaje_comision_recepcion := COALESCE(v_propio, (SELECT c.recepcion_porcentaje_default FROM comisiones_config c WHERE c.organization_id = NEW.organization_id), 0);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION set_porcentaje_comision_recepcion() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trigger_ordenes_porcentaje_recepcion ON ordenes_servicio;
CREATE TRIGGER trigger_ordenes_porcentaje_recepcion
  BEFORE INSERT ON ordenes_servicio
  FOR EACH ROW EXECUTE FUNCTION set_porcentaje_comision_recepcion();

-- ----------------------------------------------------------------------------
-- 4. Warranty-claim lookup index (read by 381)
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS reclamos_garantia_orden_reparacion_idx
  ON reclamos_garantia (orden_reparacion_id) WHERE orden_reparacion_id IS NOT NULL;
