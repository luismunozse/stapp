-- ============================================
-- 184: Costo financiero en cobros_orden
-- ============================================
-- pagos_venta y pagos_parciales ya tienen costo_financiero_monto/porcentaje.
-- cobros_orden (cobro directo a orden sin factura) sólo tenía recargo_porcentaje
-- y monto_original. Si admin cobra con tarjeta directo, el CF no entraba
-- en reportes financieros.
-- ============================================

ALTER TABLE cobros_orden
  ADD COLUMN IF NOT EXISTS costo_financiero_monto DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS costo_financiero_porcentaje DECIMAL(5,2);

COMMENT ON COLUMN cobros_orden.costo_financiero_monto IS
  'Comisión absoluta que la terminal cobra al comerciante. Cuenta como costo financiero en reportes (devengado al cobrar).';
COMMENT ON COLUMN cobros_orden.costo_financiero_porcentaje IS
  'Porcentaje de comisión (sólo informativo; el monto absoluto manda).';
