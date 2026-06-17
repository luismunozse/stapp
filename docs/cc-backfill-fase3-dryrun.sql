-- DRY-RUN Fase 3: preview del backfill de fiado historico.
-- Read-only. Correr en prod ANTES de aplicar la migracion 236 para validar montos.
-- Reporta, por organizacion y cliente, cuantas ordenes/ventas se cargarian y el total.
WITH docs AS (
  SELECT o.organization_id, o.cliente_id, 'ORDEN'::text AS ref_tipo, o.id AS ref_id,
    (o.costo_final - COALESCE(o.descuento_cobro,0) - COALESCE(o.total_cobrado,0)) AS pendiente
  FROM ordenes_servicio o
  WHERE o.estado IN ('ENTREGADO','ENTREGADO_SIN_REPARACION')
    AND o.cliente_id IS NOT NULL
    AND (o.costo_final - COALESCE(o.descuento_cobro,0) - COALESCE(o.total_cobrado,0)) > 0
    AND NOT EXISTS (
      SELECT 1 FROM cuenta_corriente cc
      WHERE cc.referencia_tipo='ORDEN' AND cc.referencia_id=o.id AND cc.tipo='CARGO')
  UNION ALL
  SELECT v.organization_id, v.cliente_id, 'VENTA'::text, v.id,
    (v.total - COALESCE(v.monto_abonado,0))
  FROM ventas v
  WHERE v.estado = 'COMPLETADA'
    AND v.cliente_id IS NOT NULL
    AND (v.total - COALESCE(v.monto_abonado,0)) > 0
    AND NOT EXISTS (
      SELECT 1 FROM cuenta_corriente cc
      WHERE cc.referencia_tipo='VENTA' AND cc.referencia_id=v.id AND cc.tipo='CARGO')
),
docs_cargo AS (
  SELECT d.*,
    d.pendiente + COALESCE(
      (SELECT SUM(cc.monto) FROM cuenta_corriente cc
       WHERE cc.referencia_tipo = d.ref_tipo AND cc.referencia_id = d.ref_id AND cc.tipo='PAGO'), 0
    ) AS cargo
  FROM docs d
)
SELECT organization_id, cliente_id,
  COUNT(*) FILTER (WHERE ref_tipo='ORDEN') AS ordenes,
  COUNT(*) FILTER (WHERE ref_tipo='VENTA') AS ventas,
  ROUND(SUM(cargo), 2) AS total_a_cargar
FROM docs_cargo
GROUP BY organization_id, cliente_id
ORDER BY total_a_cargar DESC;
