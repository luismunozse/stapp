-- applied manually in Supabase SQL editor
-- Migration 256: vendor commission over NET amount (excluding IVA)
--
-- Decision: vendor commission must NOT include IVA. The IVA collected is a fiscal
-- liability (débito fiscal), not income, so it should not be part of the commission base.
--
-- ventas.iva_neto (mig 229) holds the net amount when the org has IVA active
-- (INCLUIDO/ADITIVO). For EXENTO orgs and legacy rows it is NULL, so we COALESCE to
-- total — for those there is no IVA to strip, so net == total (no behavior change).
--
-- Only the monto_comision expression changes; the column set is identical to mig 122,
-- so CREATE OR REPLACE VIEW is safe.

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
    COALESCE(v.iva_neto, v.total) * COALESCE(v.porcentaje_comision, 0) / 100,
    2
  )::DECIMAL(10,2) AS monto_comision,
  v.comision_pagada,
  v.fecha_pago_comision,
  v.comision_pago_notas
FROM ventas v
WHERE v.estado = 'COMPLETADA';
