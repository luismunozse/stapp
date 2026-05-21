-- Backfill fecha_completado para órdenes terminales pre-trigger.
-- Reportes financieros devengan por fecha_completado; órdenes legacy en
-- estado terminal sin este campo quedaban fuera del cálculo.
-- ordenes_servicio no tiene updated_at; usar fecha_entrega o fecha_ingreso.

UPDATE ordenes_servicio
SET fecha_completado = COALESCE(fecha_entrega, fecha_ingreso)
WHERE fecha_completado IS NULL
  AND estado IN (
    'REPARADO',
    'ENTREGADO',
    'ENTREGADO_SIN_REPARACION',
    'ENTREGADO_SIN_COBRO'
  );
