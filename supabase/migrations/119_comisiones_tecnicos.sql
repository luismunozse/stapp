-- ========================================
-- Comisiones por técnico
-- ========================================
-- El técnico tiene un % de comisión por defecto (en users).
-- Al asignar un técnico a una orden, se copia ese % al snapshot de la orden.
-- La comisión se calcula sobre la ganancia: costo_final - costo_repuestos.
-- Se "devenga" cuando la orden está ENTREGADA + cobrada; se paga (liquida)
-- marcando comision_pagada = true con fecha_pago_comision.
-- ========================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS porcentaje_comision DECIMAL(5,2) NOT NULL DEFAULT 0
  CHECK (porcentaje_comision >= 0 AND porcentaje_comision <= 100);

ALTER TABLE ordenes_servicio
  ADD COLUMN IF NOT EXISTS porcentaje_comision DECIMAL(5,2)
    CHECK (porcentaje_comision IS NULL OR (porcentaje_comision >= 0 AND porcentaje_comision <= 100)),
  ADD COLUMN IF NOT EXISTS comision_pagada BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS fecha_pago_comision TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS comision_pago_notas TEXT;

CREATE INDEX IF NOT EXISTS ordenes_comision_pagada_idx
  ON ordenes_servicio(organization_id, tecnico_id, comision_pagada, fecha_completado);

-- Vista que expone la comisión calculada por orden.
-- ganancia = costo_final - suma(repuestos_orden)
-- monto_comision = ganancia * porcentaje_comision / 100 (nunca negativo)
CREATE OR REPLACE VIEW v_comisiones_ordenes AS
SELECT
  o.id AS orden_id,
  o.organization_id,
  o.tecnico_id,
  o.codigo_orden,
  o.numero_orden,
  o.dispositivo,
  o.estado,
  o.estado_cobro,
  o.fecha_completado,
  o.costo_final,
  COALESCE((
    SELECT SUM(r.cantidad * r.precio_unitario)
    FROM repuestos_orden r
    WHERE r.orden_id = o.id
  ), 0)::DECIMAL(10,2) AS costo_repuestos,
  GREATEST(
    COALESCE(o.costo_final, 0) - COALESCE((
      SELECT SUM(r.cantidad * r.precio_unitario)
      FROM repuestos_orden r
      WHERE r.orden_id = o.id
    ), 0),
    0
  )::DECIMAL(10,2) AS ganancia,
  COALESCE(o.porcentaje_comision, 0)::DECIMAL(5,2) AS porcentaje_comision,
  ROUND(
    GREATEST(
      COALESCE(o.costo_final, 0) - COALESCE((
        SELECT SUM(r.cantidad * r.precio_unitario)
        FROM repuestos_orden r
        WHERE r.orden_id = o.id
      ), 0),
      0
    ) * COALESCE(o.porcentaje_comision, 0) / 100,
    2
  )::DECIMAL(10,2) AS monto_comision,
  o.comision_pagada,
  o.fecha_pago_comision,
  o.comision_pago_notas
FROM ordenes_servicio o
WHERE o.tecnico_id IS NOT NULL;
