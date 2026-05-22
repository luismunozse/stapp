-- ============================================
-- 182: Snapshot de costo por item de cotización
-- ============================================
-- Problema: items_cotizacion.precio_unitario es precio al cliente (venta).
-- Cost real venía de inventario.precio_compra via lookup en tiempo de reporte.
-- Items manuales (sin inventario_id) NO tenían columna para costo →
-- contaban como costo 0 en reportes financieros → inflaba margen.
--
-- Fix: agregar costo_unitario en items_cotizacion. Para items linkeados,
-- snapshot automático cuando la cotización pasa a ACEPTADA. Para manuales,
-- admin lo carga opcional en UI.
-- ============================================

ALTER TABLE items_cotizacion
  ADD COLUMN IF NOT EXISTS costo_unitario DECIMAL(10,2);

COMMENT ON COLUMN items_cotizacion.costo_unitario IS
  'Costo unitario de compra. Para items linkeados a inventario, se snapshot al ACEPTAR (inventario.precio_compra). Para manuales, admin lo carga opcional. NULL = costo desconocido (no cuenta en reportes financieros).';

-- ============================================
-- Backfill: cotizaciones ACEPTADAS con items linkeados
-- ============================================
UPDATE items_cotizacion ic
SET costo_unitario = i.precio_compra
FROM cotizaciones c, inventario i
WHERE ic.cotizacion_id = c.id
  AND c.estado = 'ACEPTADA'
  AND ic.inventario_id = i.id
  AND ic.costo_unitario IS NULL
  AND i.precio_compra IS NOT NULL;

-- ============================================
-- Trigger: snapshot al pasar a ACEPTADA
-- ============================================
CREATE OR REPLACE FUNCTION snapshot_costo_items_cotizacion()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.estado = 'ACEPTADA' AND (OLD.estado IS DISTINCT FROM 'ACEPTADA') THEN
    UPDATE items_cotizacion ic
    SET costo_unitario = i.precio_compra
    FROM inventario i
    WHERE ic.cotizacion_id = NEW.id
      AND ic.inventario_id = i.id
      AND ic.costo_unitario IS NULL
      AND i.precio_compra IS NOT NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_snapshot_costo_items_cotizacion ON cotizaciones;
CREATE TRIGGER trg_snapshot_costo_items_cotizacion
  AFTER UPDATE OF estado ON cotizaciones
  FOR EACH ROW
  EXECUTE FUNCTION snapshot_costo_items_cotizacion();

COMMENT ON FUNCTION snapshot_costo_items_cotizacion() IS
  'Al aceptar cotización, copia inventario.precio_compra a items_cotizacion.costo_unitario para preservar snapshot histórico aunque cambie precio_compra después.';
