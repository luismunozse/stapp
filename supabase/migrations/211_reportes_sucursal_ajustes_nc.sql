-- ============================================================
-- 211: Add sucursal_id to ajustes_inventario and notas_credito
-- ============================================================
-- Additive, nullable, zero-downtime. No NOT NULL constraint added.
--
-- ajustes_inventario: no parent venta/orden link exists in the table
-- (inventario is org-level). Historical rows stay NULL and surface only
-- under verTodas. New rows are stamped by the RPC (migration 213).
--
-- notas_credito: has venta_id XOR orden_id (CHECK enforced in mig 186).
-- Backfill derives sucursal_id from the parent venta or orden.
-- Rows whose parent has NULL sucursal_id also stay NULL (verTodas-only).
-- Backfill is idempotent (WHERE sucursal_id IS NULL guard).
-- ============================================================

-- ── ajustes_inventario ───────────────────────────────────────
ALTER TABLE ajustes_inventario
  ADD COLUMN IF NOT EXISTS sucursal_id TEXT REFERENCES sucursales(id);

CREATE INDEX IF NOT EXISTS ajustes_inventario_sucursal_idx
  ON ajustes_inventario(sucursal_id)
  WHERE sucursal_id IS NOT NULL;

COMMENT ON COLUMN ajustes_inventario.sucursal_id IS
  'Sucursal que originó el ajuste. NULL para registros históricos sin datos de sucursal (pre-Fase2) — incluidos sólo en consultas verTodas. Stampeado por RPC aplicar_ajuste_inventario desde mig 213.';

-- ── notas_credito ────────────────────────────────────────────
ALTER TABLE notas_credito
  ADD COLUMN IF NOT EXISTS sucursal_id TEXT REFERENCES sucursales(id);

-- Backfill from parent venta
UPDATE notas_credito nc
SET sucursal_id = v.sucursal_id
FROM ventas v
WHERE nc.venta_id = v.id
  AND nc.sucursal_id IS NULL
  AND v.sucursal_id IS NOT NULL;

-- Backfill from parent orden_servicio
UPDATE notas_credito nc
SET sucursal_id = o.sucursal_id
FROM ordenes_servicio o
WHERE nc.orden_id = o.id
  AND nc.sucursal_id IS NULL
  AND o.sucursal_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS notas_credito_sucursal_idx
  ON notas_credito(sucursal_id)
  WHERE sucursal_id IS NOT NULL;

COMMENT ON COLUMN notas_credito.sucursal_id IS
  'Sucursal derivada del padre (venta o orden). NULL cuando el padre tampoco tenía sucursal_id (legacy). Nuevas NCs obtienen sucursal_id in-RPC desde mig 214.';
