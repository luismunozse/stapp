-- Rollback de 345_factura_pago_sincroniza_orden.sql
--
-- Restaura recalcular_estado_cobro al cuerpo de 068:100 (total_cobrado solo de
-- cobros_orden), quita los triggers y la funcion auxiliar.
-- Ojo: reintroduce el bug de la 345. Las ordenes que la backfill corrigio
-- conservan su total_cobrado/estado_cobro hasta el proximo recalculo, que las
-- vuelve a dejar en PENDIENTE.

DROP TRIGGER IF EXISTS pagos_parciales_recalcular_cobro ON pagos_parciales;
DROP TRIGGER IF EXISTS facturas_estado_recalcular_cobro ON facturas;
DROP TRIGGER IF EXISTS facturas_delete_recalcular_cobro ON facturas;
DROP FUNCTION IF EXISTS trg_pagos_parciales_recalcular_cobro();
DROP FUNCTION IF EXISTS trg_facturas_recalcular_cobro();

CREATE OR REPLACE FUNCTION recalcular_estado_cobro(p_orden_id TEXT)
RETURNS VOID AS $$
DECLARE
  v_total_cobrado DECIMAL;
  v_costo_final DECIMAL;
  v_descuento DECIMAL;
  v_estado TEXT;
BEGIN
  SELECT COALESCE(SUM(monto), 0) INTO v_total_cobrado
  FROM cobros_orden WHERE orden_id = p_orden_id AND anulado = FALSE;

  SELECT COALESCE(costo_final, 0), COALESCE(descuento_cobro, 0)
  INTO v_costo_final, v_descuento
  FROM ordenes_servicio WHERE id = p_orden_id;

  v_costo_final := v_costo_final - v_descuento;

  IF v_costo_final <= 0 THEN
    v_estado := 'PENDIENTE';
  ELSIF v_total_cobrado >= v_costo_final THEN
    v_estado := 'COBRADO';
  ELSIF v_total_cobrado > 0 THEN
    v_estado := 'PARCIAL';
  ELSE
    v_estado := 'PENDIENTE';
  END IF;

  UPDATE ordenes_servicio
  SET total_cobrado = v_total_cobrado,
      estado_cobro = v_estado
  WHERE id = p_orden_id;
END;
$$ LANGUAGE plpgsql;

-- Se dropea al final: la version restaurada de arriba ya no la usa.
DROP FUNCTION IF EXISTS total_cobrado_orden(TEXT);
