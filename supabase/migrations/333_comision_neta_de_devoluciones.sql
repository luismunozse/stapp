-- Migration 333: la comision del vendedor descuenta lo devuelto.
--
-- v_comisiones_ventas (256) calculaba la comision sobre el neto de la venta
-- sin mirar las devoluciones: si el cliente devolvia todo, el vendedor cobraba
-- comision por una venta que no existio.
--
-- Ahora la base es el neto (sin IVA) menos la parte devuelta, en la misma
-- proporcion (monto_devolucion esta en terminos del total, con IVA):
--
--   base = COALESCE(iva_neto, total) * (1 - devuelto / total)
--
-- Las comisiones YA LIQUIDADAS no se recalculan: el reporte de pagadas tiene
-- que seguir mostrando lo que efectivamente se pago. Una devolucion posterior
-- al pago no se descuenta (no hay libro de ajustes de comisiones todavia).
--
-- Se agrega monto_devuelto al final (CREATE OR REPLACE VIEW solo admite
-- columnas nuevas al final); las demas quedan igual.

CREATE OR REPLACE VIEW v_comisiones_ventas AS
SELECT
  v.id AS venta_id,
  v.organization_id,
  v.vendedor_id,
  v.numero_venta,
  v.cliente_nombre,
  v.estado,
  v.created_at,
  v.total,
  COALESCE(v.porcentaje_comision, 0)::DECIMAL(5,2) AS porcentaje_comision,
  ROUND(
    CASE
      WHEN v.comision_pagada OR COALESCE(v.total, 0) <= 0 OR dev.devuelto = 0
        THEN COALESCE(v.iva_neto, v.total)
      ELSE GREATEST(COALESCE(v.iva_neto, v.total) * (1 - dev.devuelto / v.total), 0)
    END * COALESCE(v.porcentaje_comision, 0) / 100,
    2
  )::DECIMAL(10,2) AS monto_comision,
  v.comision_pagada,
  v.fecha_pago_comision,
  v.comision_pago_notas,
  dev.devuelto::DECIMAL(10,2) AS monto_devuelto
FROM ventas v
CROSS JOIN LATERAL (
  SELECT COALESCE(SUM(d.monto_devolucion), 0) AS devuelto
  FROM devoluciones_venta d
  WHERE d.venta_id = v.id
) dev
WHERE v.estado = 'COMPLETADA';
