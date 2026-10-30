-- ============================================================================
-- Comisiones, slice 2 (reparaciones): the order branch of the commission definition, both roles.
-- ============================================================================
-- Restates v_comisiones_filas and v_comisiones_devengadas from 377. The sale branches are copied
-- verbatim. What changes:
--   * ORIGINAL / ORDEN: one pass per order emits one row per role (TECNICO and RECEPCION), each
--     from the order's own rate snapshot (380). RECEPCION is emitted only when its amount is
--     above 0, so a shop with no reception rate sees no new rows.
--   * The order amount is costo_final - descuento_cobro - non-annulled credit notes, floored
--     at 0. TECNICO's base is that amount minus the parts cost (119) unless the shop picks
--     MONTO_ORDEN; RECEPCION's base is the whole amount unless the shop picks MANO_DE_OBRA.
--   * Accrual follows comisiones_config.orden_devengo (default ENTREGA_Y_COBRO, as 380).
--     Practice orders, cancelled / delivered-unpaid orders and warranty re-entries never
--     commission (re-entries can be switched on). Flag 257 gates ENTREGADO_SIN_REPARACION
--     for both roles. motivo_sin_devengo says why a live row is not accrued.
--   * AJUSTE_DEVOLUCION / ORDEN: one negative row per non-annulled credit note created after the
--     role's ORIGINAL row was paid, capped at the paid base (running sum per paid row).
--   * Three columns are appended at the end: base_tipo, documento_monto, motivo_sin_devengo.
--
-- Closed rows keep working by key (377): RECEPCION rows and the new adjustments inherit it.
--
-- Requires 380 (comisiones_config, ordenes_servicio.porcentaje_comision_recepcion, the index on
-- reclamos_garantia.orden_reparacion_id). Views only; the temp tables below are dropped at commit.
-- The report at the end is aggregate-only (no names, no ids): read it before --apply.
--
-- Access: security_invoker, service_role only (as in 347).
--
-- No BEGIN/COMMIT: scripts/db-run.mjs wraps the file (dry-run by default).
-- Rollback: rollback/381_rollback.sql. Verify: verify/381_probes.sql.
-- ============================================================================

SET LOCAL lock_timeout = '3s';

DO $$
BEGIN
  IF to_regclass('public.comisiones_config') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'ordenes_servicio'
          AND column_name = 'porcentaje_comision_recepcion'
     ) THEN
    RAISE EXCEPTION 'Abort: aplicar 380 antes de 381';
  END IF;
END $$;

-- Order rows as 377 defines them, for the impact report at the end.
CREATE TEMP TABLE _antes_381 ON COMMIT DROP AS
SELECT clave, organization_id, documento_id, beneficiario_id, rol, tipo, monto, pendiente,
       devengada, pagado, fecha_devengo
  FROM v_comisiones_filas
 WHERE documento_tipo = 'ORDEN';

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
    CROSS JOIN LATERAL (
      SELECT COALESCE(SUM(r.cantidad * r.precio_unitario), 0) AS costo
        FROM repuestos_orden r WHERE r.orden_id = o.id
    ) rep
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
             o.estado IN ('ENTREGADO', 'ENTREGADO_SIN_REPARACION') AS entregada,
             o.estado_cobro IS NOT DISTINCT FROM 'COBRADO' AS cobrada,
             (o.es_reingreso OR EXISTS (SELECT 1 FROM reclamos_garantia rg WHERE rg.orden_reparacion_id = o.id)) AS reingreso
    ) e
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN o.es_practica OR o.estado IN ('CANCELADO', 'ENTREGADO_SIN_COBRO')
          OR (e.reingreso AND NOT COALESCE(cfg.reingreso_comisiona, false)) THEN 'NO_COMISIONA'
        WHEN o.estado = 'ENTREGADO_SIN_REPARACION' AND NOT org.comision_aplica_sin_reparacion THEN 'SIN_REPARACION'
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
LEFT JOIN LATERAL (
  SELECT COALESCE(SUM(r.cantidad * r.precio_unitario), 0) AS costo
    FROM repuestos_orden r WHERE r.orden_id = o.id
) rep ON f.documento_tipo = 'ORDEN';

CREATE OR REPLACE VIEW v_comisiones_devengadas WITH (security_invoker = true) AS
SELECT * FROM v_comisiones_filas WHERE devengada;

REVOKE ALL ON public.v_comisiones_filas FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_comisiones_filas TO service_role;
REVOKE ALL ON public.v_comisiones_devengadas FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_comisiones_devengadas TO service_role;

COMMENT ON VIEW v_comisiones_filas IS
  'Every commission row (live or closed by a payout item), one per document + role + kind + adjustment ref. Key: clave. base_tipo, documento_monto and motivo_sin_devengo describe live ORDEN ORIGINAL rows.';
COMMENT ON VIEW v_comisiones_devengadas IS
  'What is owed: the accrued rows of v_comisiones_filas. Every list, total and payment reads this.';

CREATE TEMP TABLE _despues_381 ON COMMIT DROP AS
SELECT clave, organization_id, documento_id, beneficiario_id, rol, tipo, monto, pendiente,
       devengada, pagado, fecha_devengo, motivo_sin_devengo
  FROM v_comisiones_filas
 WHERE documento_tipo = 'ORDEN';

-- ============================================================================
-- Impact report (aggregate only). Read it before --apply.
-- ============================================================================

-- [1] unpaid TECNICO rows whose amount changes
SELECT '[1] TECNICO sin pagar: cambia el monto' AS seccion,
       COUNT(*) AS filas, COUNT(DISTINCT a.organization_id) AS talleres,
       SUM(d.monto - a.monto) AS diferencia,
       COUNT(*) FILTER (WHERE a.devengada AND d.devengada) AS devengadas,
       COALESCE(SUM(d.monto - a.monto) FILTER (WHERE a.devengada AND d.devengada), 0) AS diferencia_devengadas
  FROM _antes_381 a JOIN _despues_381 d USING (clave)
 WHERE a.rol = 'TECNICO' AND a.tipo = 'ORIGINAL' AND NOT a.pagado AND a.monto <> d.monto;

-- [1b] the same rows on orders with no discount and no credit note: must be 0
SELECT '[1b] cambia sin descuento ni nota de credito' AS seccion,
       COUNT(*) AS filas, COUNT(DISTINCT a.organization_id) AS talleres,
       COALESCE(SUM(d.monto - a.monto), 0) AS diferencia
  FROM _antes_381 a
  JOIN _despues_381 d USING (clave)
  JOIN ordenes_servicio o ON o.id = a.documento_id AND o.organization_id = a.organization_id
 WHERE a.rol = 'TECNICO' AND a.tipo = 'ORIGINAL' AND NOT a.pagado AND a.monto <> d.monto
   AND COALESCE(o.descuento_cobro, 0) = 0
   AND NOT EXISTS (SELECT 1 FROM notas_credito nc
                    WHERE nc.orden_id = o.id AND nc.organization_id = o.organization_id AND NOT nc.anulada);

-- [2] unpaid TECNICO rows that stop accruing, by cause
SELECT '[2] TECNICO sin pagar: deja de devengar' AS seccion,
       CASE WHEN o.es_practica THEN 'practica'
            WHEN d.motivo_sin_devengo = 'NO_COMISIONA'
             AND (o.es_reingreso OR EXISTS (SELECT 1 FROM reclamos_garantia rg WHERE rg.orden_reparacion_id = o.id)) THEN 'reingreso'
            WHEN o.estado = 'REPARADO' THEN 'reparado sin entregar'
            ELSE 'otra' END AS causa,
       COUNT(*) AS filas, COUNT(DISTINCT a.organization_id) AS talleres,
       COALESCE(SUM(a.monto), 0) AS monto
  FROM _antes_381 a
  JOIN _despues_381 d USING (clave)
  JOIN ordenes_servicio o ON o.id = a.documento_id AND o.organization_id = a.organization_id
 WHERE a.rol = 'TECNICO' AND a.tipo = 'ORIGINAL' AND NOT a.pagado AND a.devengada AND NOT d.devengada
 GROUP BY 2;

-- [3] unpaid TECNICO rows that start accruing: expected 0
SELECT '[3] TECNICO sin pagar: empieza a devengar' AS seccion,
       COUNT(*) AS filas, COUNT(DISTINCT a.organization_id) AS talleres,
       COALESCE(SUM(d.monto), 0) AS monto
  FROM _antes_381 a JOIN _despues_381 d USING (clave)
 WHERE a.rol = 'TECNICO' AND a.tipo = 'ORIGINAL' AND NOT a.pagado AND NOT a.devengada AND d.devengada;

-- [4] accrued in both, but dated differently
SELECT '[4] TECNICO sin pagar: cambia la fecha de devengo' AS seccion,
       COUNT(*) AS filas, COUNT(DISTINCT a.organization_id) AS talleres,
       COUNT(*) FILTER (WHERE date_trunc('month', a.fecha_devengo) IS DISTINCT FROM date_trunc('month', d.fecha_devengo)) AS cambian_de_mes,
       COALESCE(SUM(d.monto) FILTER (WHERE date_trunc('month', a.fecha_devengo) IS DISTINCT FROM date_trunc('month', d.fecha_devengo)), 0) AS monto_cambia_de_mes
  FROM _antes_381 a JOIN _despues_381 d USING (clave)
 WHERE a.rol = 'TECNICO' AND a.tipo = 'ORIGINAL' AND NOT a.pagado AND a.devengada AND d.devengada
   AND a.fecha_devengo IS DISTINCT FROM d.fecha_devengo;

-- [5] paid rows (any role, any kind) that do not survive unchanged: must be 0
SELECT '[5] filas pagadas que cambian' AS seccion,
       COUNT(*) AS filas, COUNT(DISTINCT a.organization_id) AS talleres
  FROM _antes_381 a LEFT JOIN _despues_381 d USING (clave)
 WHERE a.pagado
   AND (d.clave IS NULL OR NOT d.pagado OR d.monto <> a.monto
        OR d.beneficiario_id IS DISTINCT FROM a.beneficiario_id);

-- [6] new adjustments for credit notes created after a payout
SELECT '[6] ajustes nuevos por nota de credito posterior al pago' AS seccion, d.rol,
       COUNT(*) AS filas, COUNT(DISTINCT d.organization_id) AS talleres,
       COALESCE(SUM(d.monto), 0) AS monto
  FROM _despues_381 d
 WHERE d.tipo = 'AJUSTE_DEVOLUCION'
 GROUP BY d.rol;

-- [7] RECEPCION rows: expected 0 right after apply
SELECT '[7] filas RECEPCION' AS seccion,
       COUNT(*) AS filas, COUNT(DISTINCT d.organization_id) AS talleres,
       COALESCE(SUM(d.monto), 0) AS monto
  FROM _despues_381 d
 WHERE d.rol = 'RECEPCION';

-- [8] what TECNICO is owed on accrued rows, before and after
SELECT '[8] pendiente TECNICO devengado' AS seccion,
       (SELECT COALESCE(SUM(pendiente), 0) FROM _antes_381 WHERE rol = 'TECNICO' AND devengada) AS antes,
       (SELECT COALESCE(SUM(pendiente), 0) FROM _despues_381 WHERE rol = 'TECNICO' AND devengada) AS despues;
