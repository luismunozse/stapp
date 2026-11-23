-- ============================================================================
-- 422: la comision del tecnico descuenta el costo cargado en el presupuesto
-- ============================================================================
-- Un archivo por vez: node scripts/db-run.mjs supabase/migrations/422_...sql
-- (dry-run por defecto, --apply para confirmar). Sin BEGIN/COMMIT a proposito.
-- Solo vistas y una funcion: el codigo no cambia de contrato, se puede aplicar
-- antes o despues de mergear.
--
-- PROBLEMA (orden 82, 2026-11-23)
-- Con base MANO_DE_OBRA la comision del tecnico es (monto de la orden - costo
-- de repuestos) x %. El costo salia SOLO de repuestos_orden. Un repuesto que el
-- taller cotizo en el presupuesto (items_cotizacion.costo_unitario) y no cargo
-- en la pestana Repuestos no restaba: la orden 82 (pin 35000, costo 7000 + FRP
-- 25000) le daba 15% de 60000 = 9000 en vez de 15% de 53000 = 7950.
--
-- REGLA (la misma que el detalle de la orden, lib/ordenes/detalle-cobro.ts)
--   costo = costo de los items de las cotizaciones vigentes (costo_unitario, o
--           precio_compra del inventario si no tiene)
--         + repuestos_orden a costo, salvo los marcados incluido_en_presupuesto
--           cuando la cotizacion ya trae costos (son la misma pieza: contarlos
--           duplicaria). Si la cotizacion no trae ningun costo, el costo de esos
--           repuestos SI cuenta (es lo habitual: el costo vive en Repuestos).
-- Cotizacion vigente = misma definicion que orden_tiene_cotizacion_vigente (421).
--
-- QUE CAMBIA
-- Solo v_comisiones_filas (y por ella v_comisiones_devengadas): las dos lecturas
-- del costo de repuestos pasan por costo_repuestos_orden. El resto de la vista
-- es texto identico a la 381 (verificado contra prod el 2026-11-23).
-- Las comisiones ya PAGADAS no cambian: su base quedo congelada en
-- comisiones_pagos_items. En prod cambian 3 sin pagar: ordenes 82 (9000 ->
-- 7950), 48 (11250 -> 5000) y 52 (24750 -> 21000).
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION costo_repuestos_orden(p_orden_id TEXT)
RETURNS NUMERIC AS $$
  WITH cot AS (
    SELECT i.cantidad, COALESCE(i.costo_unitario, inv.precio_compra) AS costo
      FROM cotizaciones c
      JOIN items_cotizacion i ON i.cotizacion_id = c.id
      LEFT JOIN inventario inv ON inv.id = i.inventario_id
     WHERE c.orden_id = p_orden_id
       AND c.deleted_at IS NULL
       AND c.reemplazada_por IS NULL
       AND c.estado::text <> 'RECHAZADA'
  ),
  t AS (
    SELECT COALESCE(SUM(cantidad * costo), 0) AS costo,
           COALESCE(BOOL_OR(costo IS NOT NULL), false) AS trae_costos
      FROM cot
  )
  SELECT t.costo + COALESCE((
    SELECT SUM(r.cantidad * r.precio_unitario)
      FROM repuestos_orden r
     WHERE r.orden_id = p_orden_id
       AND NOT (r.incluido_en_presupuesto AND t.trae_costos)
  ), 0)
  FROM t;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION costo_repuestos_orden(TEXT) IS
  'Costo de lo que se uso en una orden: items de cotizaciones vigentes + repuestos, sin contar dos veces la pieza marcada como incluida en el presupuesto. Base de la comision MANO_DE_OBRA. Espejo de calcularDetalleCobro (lib/ordenes/detalle-cobro.ts). Ver migracion 422.';

CREATE OR REPLACE VIEW v_comisiones_filas WITH (security_invoker = true) AS
WITH pagadas AS NOT MATERIALIZED (
  SELECT i.organization_id, i.documento_tipo, i.documento_id, i.rol, i.tipo, i.ajuste_ref,
         i.base, i.porcentaje, i.monto, i.fecha_devengo,
         p.id AS pago_id, p.beneficiario_id, p.fecha_pago
    FROM comisiones_pagos_items i
    JOIN comisiones_pagos p ON p.id = i.pago_id
   WHERE NOT i.anulado
),
vivas AS (
  -- ORIGINAL / ORDEN / TECNICO + RECEPCION: one pass per order, one row per role
  SELECT o.organization_id, 'ORDEN'::text AS documento_tipo, o.id AS documento_id,
         rr.beneficiario_id, rr.rol, 'ORIGINAL'::text AS tipo, NULL::text AS ajuste_ref,
         bb.base, rr.porcentaje, ROUND(bb.base * rr.porcentaje / 100, 2) AS monto,
         COALESCE(CASE e.regla WHEN 'ENTREGA' THEN o.fecha_entrega
                               WHEN 'COBRO'   THEN uc.ultimo_cobro
                               ELSE GREATEST(o.fecha_entrega, uc.ultimo_cobro) END,
                  o.fecha_completado) AS fecha_devengo,
         (mo.motivo IS NULL) AS devengada,
         rr.base_tipo, m.monto_orden AS documento_monto, mo.motivo AS motivo_sin_devengo
    FROM ordenes_servicio o
    JOIN organizations org ON org.id = o.organization_id
    LEFT JOIN comisiones_config cfg ON cfg.organization_id = o.organization_id
    -- 422: incluye el costo cargado en el presupuesto (ver costo_repuestos_orden)
    CROSS JOIN LATERAL (SELECT costo_repuestos_orden(o.id) AS costo) rep
    CROSS JOIN LATERAL (
      SELECT COALESCE(SUM(nc.monto), 0) AS monto FROM notas_credito nc
       WHERE nc.orden_id = o.id AND nc.organization_id = o.organization_id AND NOT nc.anulada
    ) ncs
    CROSS JOIN LATERAL (
      SELECT GREATEST(COALESCE(o.costo_final, 0) - COALESCE(o.descuento_cobro, 0) - ncs.monto, 0) AS monto_orden
    ) m
    CROSS JOIN LATERAL (
      -- Builder's call (spec): an order collected only through invoice payments (345) is dated
      -- by its last pagos_parciales.fecha; the later of both sources wins.
      SELECT GREATEST(
        (SELECT MAX(c.created_at) FROM cobros_orden c
          WHERE c.orden_id = o.id AND c.organization_id = o.organization_id AND NOT c.anulado),
        (SELECT MAX(pp.fecha) FROM pagos_parciales pp JOIN facturas f ON f.id = pp.factura_id
          WHERE f.orden_id = o.id AND f.estado_pago::text <> 'ANULADA')
      ) AS ultimo_cobro
    ) uc
    CROSS JOIN LATERAL (
      SELECT COALESCE(cfg.orden_devengo, 'ENTREGA_Y_COBRO') AS regla,
             COALESCE(o.estado IN ('ENTREGADO', 'ENTREGADO_SIN_REPARACION'), false) AS entregada,
             o.estado_cobro IS NOT DISTINCT FROM 'COBRADO' AS cobrada,
             (o.es_reingreso OR EXISTS (SELECT 1 FROM reclamos_garantia rg WHERE rg.orden_reparacion_id = o.id)) AS reingreso
    ) e
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN o.estado IS NULL OR o.es_practica OR COALESCE(o.estado IN ('CANCELADO', 'ENTREGADO_SIN_COBRO'), false)
          OR (e.reingreso AND NOT COALESCE(cfg.reingreso_comisiona, false)) THEN 'NO_COMISIONA'
        WHEN COALESCE(o.estado = 'ENTREGADO_SIN_REPARACION', false) AND NOT org.comision_aplica_sin_reparacion THEN 'SIN_REPARACION'
        WHEN e.regla = 'ENTREGA_Y_COBRO' AND NOT (e.entregada AND e.cobrada) THEN 'ESPERA_ENTREGA_Y_COBRO'
        WHEN e.regla = 'ENTREGA' AND NOT e.entregada THEN 'ESPERA_ENTREGA'
        WHEN e.regla = 'COBRO' AND NOT e.cobrada THEN 'ESPERA_COBRO'
      END AS motivo
    ) mo
    CROSS JOIN LATERAL (VALUES
      ('TECNICO'::text, o.tecnico_id, COALESCE(o.porcentaje_comision, 0)::numeric, COALESCE(cfg.tecnico_base, 'MANO_DE_OBRA')),
      ('RECEPCION'::text, o.recibido_por, COALESCE(o.porcentaje_comision_recepcion, 0)::numeric, COALESCE(cfg.recepcion_base, 'MONTO_ORDEN'))
    ) AS rr(rol, beneficiario_id, porcentaje, base_tipo)
    CROSS JOIN LATERAL (
      SELECT CASE rr.base_tipo WHEN 'MONTO_ORDEN' THEN m.monto_orden
             ELSE GREATEST(m.monto_orden - rep.costo, 0) END AS base
    ) bb
   WHERE rr.beneficiario_id IS NOT NULL AND (rr.rol = 'TECNICO' OR ROUND(bb.base * rr.porcentaje / 100, 2) > 0)
  UNION ALL
  -- ORIGINAL / VENTA / VENDEDOR: 333, unpaid branch (a paid sale is closed by its item)
  SELECT v.organization_id, 'VENTA', v.id, v.vendedor_id, 'VENDEDOR', 'ORIGINAL', NULL,
         b.base, COALESCE(v.porcentaje_comision, 0),
         ROUND(b.base * COALESCE(v.porcentaje_comision, 0) / 100, 2),
         v.created_at, true, NULL, NULL, NULL
    FROM ventas v
    CROSS JOIN LATERAL (
      SELECT COALESCE(SUM(d.monto_devolucion), 0) AS devuelto
        FROM devoluciones_venta d WHERE d.venta_id = v.id
    ) dev
    CROSS JOIN LATERAL (
      SELECT CASE
               WHEN COALESCE(v.total, 0) <= 0 OR dev.devuelto = 0 THEN COALESCE(v.iva_neto, v.total)
               ELSE GREATEST(COALESCE(v.iva_neto, v.total) * (1 - dev.devuelto / v.total), 0)
             END AS base
    ) b
   WHERE v.estado = 'COMPLETADA' AND v.vendedor_id IS NOT NULL
  UNION ALL
  -- AJUSTE_DEVOLUCION: an effective return created after the sale's ORIGINAL row was paid
  SELECT v.organization_id, 'VENTA', v.id, po.beneficiario_id, 'VENDEDOR', 'AJUSTE_DEVOLUCION', d.id,
         ROUND(COALESCE(v.iva_neto, v.total) * d.monto_devolucion / v.total, 2),
         po.porcentaje,
         -ROUND(COALESCE(v.iva_neto, v.total) * d.monto_devolucion / v.total * po.porcentaje / 100, 2),
         d.created_at, true, NULL, NULL, NULL
    FROM pagadas po
    JOIN ventas v ON v.id = po.documento_id AND v.organization_id = po.organization_id AND v.estado = 'COMPLETADA' AND v.total > 0
    JOIN devoluciones_venta d ON d.venta_id = v.id AND d.organization_id = v.organization_id
     AND d.estado = 'COMPLETADA' AND NOT d.anulada AND d.created_at > po.fecha_pago
   WHERE po.documento_tipo = 'VENTA' AND po.rol = 'VENDEDOR' AND po.tipo = 'ORIGINAL'
  UNION ALL
  -- AJUSTE_ANULACION: an annulled sale whose ORIGINAL row was paid gives back what is still paid on it
  SELECT v.organization_id, 'VENTA', v.id, po.beneficiario_id, 'VENDEDOR', 'AJUSTE_ANULACION', NULL,
         po.base, po.porcentaje,
         -(po.monto + COALESCE(dp.monto, 0)),
         COALESCE(v.fecha_anulacion, v.updated_at), true, NULL, NULL, NULL
    FROM pagadas po
    JOIN ventas v ON v.id = po.documento_id AND v.organization_id = po.organization_id AND v.estado = 'ANULADA'
    LEFT JOIN LATERAL (
      SELECT SUM(x.monto) AS monto FROM pagadas x
       WHERE x.organization_id = po.organization_id AND x.documento_tipo = 'VENTA' AND x.documento_id = v.id
         AND x.rol = 'VENDEDOR' AND x.tipo = 'AJUSTE_DEVOLUCION'
    ) dp ON true
   WHERE po.documento_tipo = 'VENTA' AND po.rol = 'VENDEDOR' AND po.tipo = 'ORIGINAL'
  UNION ALL
  -- AJUSTE_DEVOLUCION / ORDEN: a credit note created after the role's ORIGINAL row was paid.
  -- The running sum per paid row caps the total at the paid base.
  SELECT po.organization_id, 'ORDEN', po.documento_id, po.beneficiario_id, po.rol, 'AJUSTE_DEVOLUCION', n.id,
         n.reduccion, COALESCE(po.porcentaje, 0),
         -ROUND(n.reduccion * COALESCE(po.porcentaje, 0) / 100, 2),
         n.created_at, true, NULL, NULL, NULL
    FROM pagadas po
    CROSS JOIN LATERAL (
      SELECT x.id, x.created_at,
             LEAST(COALESCE(po.base, 0), x.acumulado) - LEAST(COALESCE(po.base, 0), x.acumulado - x.monto) AS reduccion
        FROM (SELECT nc.id, nc.created_at, nc.monto,
                     SUM(nc.monto) OVER (ORDER BY nc.created_at, nc.id) AS acumulado
                FROM notas_credito nc
               WHERE nc.orden_id = po.documento_id AND nc.organization_id = po.organization_id
                 AND NOT nc.anulada AND nc.created_at > po.fecha_pago) x
    ) n
   WHERE po.documento_tipo = 'ORDEN' AND po.tipo = 'ORIGINAL' AND po.rol IN ('TECNICO', 'RECEPCION')
     AND ROUND(n.reduccion * COALESCE(po.porcentaje, 0) / 100, 2) <> 0
  UNION ALL
  -- AJUSTE_MANUAL: stored adjustments (no writer in slice 1)
  SELECT a.organization_id, a.documento_tipo, a.documento_id, a.beneficiario_id, a.rol,
         'AJUSTE_MANUAL', a.id, NULL, NULL, a.monto, a.created_at, true, NULL, NULL, NULL
    FROM comisiones_ajustes a
),
filas AS (
  SELECT l.*, NULL::text AS pago_id, NULL::timestamptz AS fecha_pago, false AS pagado
    FROM vivas l
   WHERE NOT EXISTS (
     SELECT 1 FROM pagadas x
      WHERE x.organization_id = l.organization_id
        AND COALESCE(x.documento_tipo, '-') = COALESCE(l.documento_tipo, '-')
        AND COALESCE(x.documento_id, '-')   = COALESCE(l.documento_id, '-')
        AND x.rol = l.rol AND x.tipo = l.tipo
        AND COALESCE(x.ajuste_ref, '-')     = COALESCE(l.ajuste_ref, '-'))
  UNION ALL
  SELECT x.organization_id, x.documento_tipo, x.documento_id, x.beneficiario_id, x.rol, x.tipo,
         x.ajuste_ref, x.base, x.porcentaje, x.monto, x.fecha_devengo, true, NULL, NULL, NULL,
         x.pago_id, x.fecha_pago, true
    FROM pagadas x
)
SELECT
  COALESCE(f.documento_tipo, '-') || ':' || COALESCE(f.documento_id, '-') || ':' || f.rol || ':'
    || f.tipo || ':' || COALESCE(f.ajuste_ref, '-') AS clave,
  f.organization_id,
  COALESCE(o.sucursal_id, v.sucursal_id) AS sucursal_id,
  f.documento_tipo, f.documento_id, f.beneficiario_id, f.rol, f.tipo, f.ajuste_ref,
  f.base::numeric(12,2) AS base,
  f.porcentaje::numeric(5,2) AS porcentaje,
  f.monto::numeric(12,2) AS monto,
  f.fecha_devengo, f.devengada, f.pago_id, f.fecha_pago, f.pagado,
  (CASE WHEN f.pagado THEN 0 ELSE f.monto END)::numeric(12,2) AS pendiente,
  o.codigo_orden AS documento_codigo,
  COALESCE(o.numero_orden, v.numero_venta) AS documento_numero,
  COALESCE(o.dispositivo, v.cliente_nombre) AS documento_detalle,
  COALESCE(o.estado::text, v.estado::text) AS documento_estado,
  COALESCE(o.costo_final, v.total) AS documento_total,
  rep.costo::numeric(12,2) AS documento_costo_repuestos,
  f.base_tipo, f.documento_monto::numeric(12,2) AS documento_monto, f.motivo_sin_devengo
FROM filas f
LEFT JOIN ordenes_servicio o ON f.documento_tipo = 'ORDEN' AND o.id = f.documento_id AND o.organization_id = f.organization_id
LEFT JOIN ventas v ON f.documento_tipo = 'VENTA' AND v.id = f.documento_id AND v.organization_id = f.organization_id
LEFT JOIN LATERAL (SELECT costo_repuestos_orden(o.id) AS costo) rep ON f.documento_tipo = 'ORDEN';

CREATE OR REPLACE VIEW v_comisiones_devengadas WITH (security_invoker = true) AS
SELECT * FROM v_comisiones_filas WHERE devengada;

REVOKE ALL ON public.v_comisiones_filas FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_comisiones_filas TO service_role;
REVOKE ALL ON public.v_comisiones_devengadas FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_comisiones_devengadas TO service_role;
