-- ============================================
-- 183: trigger snapshot costo items_cotizacion también on INSERT
-- ============================================
-- Mig 182 sólo disparaba on UPDATE OF estado. Cotizaciones creadas
-- directamente en estado ACEPTADA (importación, RPC, scripts) no
-- snapshot. Extender a AFTER INSERT OR UPDATE.
--
-- También agregar trigger en items_cotizacion AFTER INSERT para cubrir:
-- cotización ya ACEPTADA, admin agrega item nuevo después.
-- ============================================

DROP TRIGGER IF EXISTS trg_snapshot_costo_items_cotizacion ON cotizaciones;
CREATE TRIGGER trg_snapshot_costo_items_cotizacion
  AFTER INSERT OR UPDATE OF estado ON cotizaciones
  FOR EACH ROW
  EXECUTE FUNCTION snapshot_costo_items_cotizacion();

-- Trigger en items_cotizacion: si parent ya ACEPTADA, snapshot al insertar item
CREATE OR REPLACE FUNCTION snapshot_costo_item_nuevo()
RETURNS TRIGGER AS $$
DECLARE
  v_estado TEXT;
  v_precio NUMERIC;
BEGIN
  IF NEW.inventario_id IS NULL OR NEW.costo_unitario IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT estado INTO v_estado FROM cotizaciones WHERE id = NEW.cotizacion_id;
  IF v_estado IS NULL OR v_estado <> 'ACEPTADA' THEN
    RETURN NEW;
  END IF;

  SELECT precio_compra INTO v_precio FROM inventario WHERE id = NEW.inventario_id;
  IF v_precio IS NOT NULL THEN
    NEW.costo_unitario := v_precio;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_snapshot_costo_item_nuevo ON items_cotizacion;
CREATE TRIGGER trg_snapshot_costo_item_nuevo
  BEFORE INSERT ON items_cotizacion
  FOR EACH ROW
  EXECUTE FUNCTION snapshot_costo_item_nuevo();

COMMENT ON FUNCTION snapshot_costo_item_nuevo() IS
  'BEFORE INSERT en items_cotizacion: si cotización padre ya es ACEPTADA y el item viene linkeado a inventario sin costo_unitario explícito, snapshot precio_compra automáticamente.';
