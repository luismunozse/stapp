-- Rollback of 409 (multimoneda S4): currency of the variant group and converted kit cost.
--
-- Restores inventario_sync_compartidos_grupo() and its trigger exactly as in 355 and
-- calcular_costo_kit(TEXT, TEXT) exactly as in 177 (with its 177 grant), and removes the
-- inheritance / mixed-currency trigger and its function.
-- WHAT IS LOST: nothing stored. inventario.moneda (365) keeps its values; after this, a group's
-- currency is no longer synced, and a kit with foreign-currency components is costed again as a
-- raw sum of precio_compra (mixing currencies).
--
-- Run it only after the code that calls calcular_costo_kit with 5 arguments and
-- guardar_grupo_variantes_moneda is reverted (both are dropped; a 2-argument calcular_costo_kit
-- call and guardar_grupo_variantes keep working).
-- LOCKS: DROP TRIGGER takes ACCESS EXCLUSIVE on inventario (blocks reads and writes) until the
-- transaction ends; CREATE OR REPLACE TRIGGER takes SHARE ROW EXCLUSIVE. Run it off-peak.
-- lock_timeout bounds the wait, not the hold; if it aborts, nothing was applied: re-run it.

SET LOCAL lock_timeout = '3s';

DROP FUNCTION IF EXISTS guardar_grupo_variantes_moneda(TEXT, TEXT, JSONB, JSONB, JSONB, JSONB, TEXT, TEXT);

DROP TRIGGER IF EXISTS inventario_moneda_grupo ON inventario;
DROP FUNCTION IF EXISTS inventario_moneda_grupo();

CREATE OR REPLACE FUNCTION inventario_sync_compartidos_grupo()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_setting('stapp.sync_grupo', true) = 'on' THEN
    RETURN NULL;
  END IF;
  PERFORM set_config('stapp.sync_grupo', 'on', true);
  UPDATE inventario i SET
    descripcion = NEW.descripcion, categoria = NEW.categoria,
    tipo_dispositivo = NEW.tipo_dispositivo, proveedor = NEW.proveedor,
    proveedor_id = NEW.proveedor_id, dias_garantia_default = NEW.dias_garantia_default,
    trackea_lotes = NEW.trackea_lotes, trackea_series = NEW.trackea_series,
    dias_alerta_vencimiento = NEW.dias_alerta_vencimiento
  WHERE i.grupo_id = NEW.grupo_id AND i.organization_id = NEW.organization_id
    AND (i.descripcion, i.categoria, i.tipo_dispositivo, i.proveedor, i.proveedor_id,
         i.dias_garantia_default, i.trackea_lotes, i.trackea_series, i.dias_alerta_vencimiento)
        IS DISTINCT FROM
        (NEW.descripcion, NEW.categoria, NEW.tipo_dispositivo, NEW.proveedor, NEW.proveedor_id,
         NEW.dias_garantia_default, NEW.trackea_lotes, NEW.trackea_series, NEW.dias_alerta_vencimiento);
  PERFORM set_config('stapp.sync_grupo', 'off', true);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER inventario_sync_compartidos_grupo
  AFTER UPDATE OF descripcion, categoria, tipo_dispositivo, proveedor, proveedor_id,
                  dias_garantia_default, trackea_lotes, trackea_series, dias_alerta_vencimiento
  ON inventario
  FOR EACH ROW
  WHEN (NEW.grupo_id IS NOT NULL AND
        (OLD.descripcion, OLD.categoria, OLD.tipo_dispositivo, OLD.proveedor, OLD.proveedor_id,
         OLD.dias_garantia_default, OLD.trackea_lotes, OLD.trackea_series, OLD.dias_alerta_vencimiento)
        IS DISTINCT FROM
        (NEW.descripcion, NEW.categoria, NEW.tipo_dispositivo, NEW.proveedor, NEW.proveedor_id,
         NEW.dias_garantia_default, NEW.trackea_lotes, NEW.trackea_series, NEW.dias_alerta_vencimiento))
  EXECUTE FUNCTION inventario_sync_compartidos_grupo();

DROP FUNCTION IF EXISTS calcular_costo_kit(TEXT, TEXT, TEXT, NUMERIC, NUMERIC);

CREATE OR REPLACE FUNCTION calcular_costo_kit(
  p_kit_id  TEXT,
  p_org_id  TEXT
) RETURNS NUMERIC AS $$
DECLARE
  v_costo NUMERIC;
BEGIN
  SELECT COALESCE(SUM(ki.cantidad * COALESCE(inv.precio_compra, 0)), 0)
    INTO v_costo
  FROM inventario_kit_items ki
  JOIN inventario inv ON inv.id = ki.componente_id
  WHERE ki.kit_id = p_kit_id
    AND ki.organization_id = p_org_id;

  RETURN v_costo;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION calcular_costo_kit(TEXT,TEXT) IS
  'Suma (cantidad * precio_compra) de cada componente directo de un kit. NO explosiona sub-kits.';

GRANT EXECUTE ON FUNCTION calcular_costo_kit(TEXT,TEXT) TO authenticated, service_role;
