-- ============================================================================
-- Comisiones, slice 1 (definicion): the single commission definition. Views only, re-runnable.
-- ============================================================================
-- Adds two views that every screen, total and payment will read:
--   * v_comisiones_filas: one row per (document, role, kind, adjustment ref). Live rows come
--     from today's formulas; a row that a non-annulled payout item closes is replaced by the
--     frozen item (matched by organization + the key expressions of the unique index
--     comisiones_pagos_items_fila_vigente_uq in 376, never by beneficiary). Every join from a
--     payout item to its document also carries organization_id (same result, defence in depth).
--   * v_comisiones_devengadas: the rows filas marks as accrued (what is owed).
--
-- ORIGINAL rows reproduce v_comisiones_ordenes (119) plus the filters of
-- app/api/comisiones/route.ts, and v_comisiones_ventas (333, unpaid branch). Today's
-- behaviour is kept as it is, so no number changes on an unpaid document.
--
-- Requires 376 (comisiones_pagos, comisiones_pagos_items, comisiones_ajustes,
-- ventas.fecha_anulacion). Nothing reads these views until the RPCs and screens land.
--
-- Access: security_invoker, service_role only (as in 347).
--
-- No BEGIN/COMMIT: scripts/db-run.mjs wraps the file (dry-run by default).
-- Rollback: rollback/377_rollback.sql. Verify: verify/377_probes.sql (unpaid parity + adjustment branches).
-- ============================================================================

SET LOCAL lock_timeout = '3s';

DO $$
BEGIN
  IF to_regclass('public.comisiones_pagos_items') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'ventas' AND column_name = 'fecha_anulacion'
     ) THEN
    RAISE EXCEPTION 'Abort: aplicar 376 antes de 377';
  END IF;
END $$;

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
  -- ORIGINAL / ORDEN / TECNICO: 119 + the filters of app/api/comisiones/route.ts:56-57
  SELECT o.organization_id, 'ORDEN'::text AS documento_tipo, o.id AS documento_id,
         o.tecnico_id AS beneficiario_id, 'TECNICO'::text AS rol, 'ORIGINAL'::text AS tipo,
         NULL::text AS ajuste_ref,
         GREATEST(COALESCE(o.costo_final, 0) - rep.costo, 0) AS base,
         COALESCE(o.porcentaje_comision, 0) AS porcentaje,
         ROUND(GREATEST(COALESCE(o.costo_final, 0) - rep.costo, 0) * COALESCE(o.porcentaje_comision, 0) / 100, 2) AS monto,
         o.fecha_completado AS fecha_devengo,
         (o.estado_cobro = 'COBRADO'
           AND (o.estado IN ('REPARADO', 'ENTREGADO')
                OR (o.estado = 'ENTREGADO_SIN_REPARACION' AND org.comision_aplica_sin_reparacion))) AS devengada
    FROM ordenes_servicio o
    JOIN organizations org ON org.id = o.organization_id
    CROSS JOIN LATERAL (
      SELECT COALESCE(SUM(r.cantidad * r.precio_unitario), 0) AS costo
        FROM repuestos_orden r WHERE r.orden_id = o.id
    ) rep
   WHERE o.tecnico_id IS NOT NULL
  UNION ALL
  -- ORIGINAL / VENTA / VENDEDOR: 333, unpaid branch (a paid sale is closed by its item)
  SELECT v.organization_id, 'VENTA', v.id, v.vendedor_id, 'VENDEDOR', 'ORIGINAL', NULL,
         b.base, COALESCE(v.porcentaje_comision, 0),
         ROUND(b.base * COALESCE(v.porcentaje_comision, 0) / 100, 2),
         v.created_at, true
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
         d.created_at, true
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
         COALESCE(v.fecha_anulacion, v.updated_at), true
    FROM pagadas po
    JOIN ventas v ON v.id = po.documento_id AND v.organization_id = po.organization_id AND v.estado = 'ANULADA'
    LEFT JOIN LATERAL (
      SELECT SUM(x.monto) AS monto FROM pagadas x
       WHERE x.organization_id = po.organization_id AND x.documento_tipo = 'VENTA' AND x.documento_id = v.id
         AND x.rol = 'VENDEDOR' AND x.tipo = 'AJUSTE_DEVOLUCION'
    ) dp ON true
   WHERE po.documento_tipo = 'VENTA' AND po.rol = 'VENDEDOR' AND po.tipo = 'ORIGINAL'
  UNION ALL
  -- AJUSTE_MANUAL: stored adjustments (no writer in slice 1)
  SELECT a.organization_id, a.documento_tipo, a.documento_id, a.beneficiario_id, a.rol,
         'AJUSTE_MANUAL', a.id, NULL, NULL, a.monto, a.created_at, true
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
         x.ajuste_ref, x.base, x.porcentaje, x.monto, x.fecha_devengo, true,
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
  rep.costo::numeric(12,2) AS documento_costo_repuestos
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
  'Every commission row (live or closed by a payout item), one per document + role + kind + adjustment ref. Key: clave.';
COMMENT ON VIEW v_comisiones_devengadas IS
  'What is owed: the accrued rows of v_comisiones_filas. Every list, total and payment reads this.';
