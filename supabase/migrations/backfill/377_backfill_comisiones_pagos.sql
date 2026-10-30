-- ============================================================================
-- 377 - Backfill of comisiones_pagos from legacy flags
-- ============================================================================
-- Turns every legacy-paid document (ordenes_servicio / ventas with comision_pagada)
-- into a frozen payout item, so the new definition (v_comisiones_filas) reproduces
-- what was paid. Amounts come from today's views (119 for orders, 333 for sales), so
-- they equal what the screens show. Paid sales annulled later are hidden by 333; they
-- are read from `ventas` with the same expression as 333's paid branch.
--
-- Grouping: one payout (origen = 'BACKFILL', pagado_por NULL) per organization,
-- beneficiary, organization-timezone day of the payment and notes text. A NULL legacy
-- payment date falls back to the migration date (now()).
--
-- Why MAX(fecha_pago_comision): a payout holds several documents paid on the same local
-- day; the legacy data has one timestamp per document. The latest one is the moment the
-- payout was complete, and it never lands before any of its items.
--
-- Re-runnable: a document that already has a non-annulled ORIGINAL item in its legacy
-- role is skipped. Run it again right after the app deploy: documents paid through the
-- old flag between the first run and the deploy are picked up then.
--
-- Requires 376 and 377 applied; aborts otherwise, and aborts when an organization with
-- legacy-paid documents has a zona_horaria that Postgres does not know.
-- Not migrated (listed in [5]): legacy-paid documents without a beneficiary.
--
-- No BEGIN/COMMIT/ROLLBACK: scripts/db-run.mjs wraps the file (dry-run by default,
-- --apply commits). Run with:
--   node scripts/db-run.mjs supabase/migrations/backfill/377_backfill_comisiones_pagos.sql
-- Undo (after --apply): DELETE FROM comisiones_pagos WHERE origen = 'BACKFILL'
-- (items cascade).
--
-- Closing checks (db-run prints every SELECT):
--   [1]  payouts and items inserted by this run.
--   [2]  per (org, beneficiary, role): sum of the frozen ORIGINAL items vs today's paid
--        screen total. Every non-zero difference must be explained by a row in [4].
--   [3]  post-payment return / annulment rows of paid documents, for a human to read.
--   [4]  paid documents outside today's route filters (they explain [2]).
--   [5]  paid documents with no beneficiary (not migrated).
-- ============================================================================

SET LOCAL lock_timeout = '3s';

DO $$
BEGIN
  IF to_regclass('public.comisiones_pagos_items') IS NULL
     OR to_regclass('public.v_comisiones_devengadas') IS NULL THEN
    RAISE EXCEPTION 'Abort: aplicar 376 y 377 antes del backfill';
  END IF;
  IF EXISTS (
    SELECT 1 FROM organizations org
     WHERE org.zona_horaria NOT IN (SELECT name FROM pg_timezone_names)
       AND (EXISTS (SELECT 1 FROM ordenes_servicio o WHERE o.organization_id = org.id AND o.comision_pagada)
            OR EXISTS (SELECT 1 FROM ventas v WHERE v.organization_id = org.id AND v.comision_pagada))
  ) THEN
    RAISE EXCEPTION 'Abort: una organizacion con comisiones pagadas tiene una zona_horaria desconocida';
  END IF;
END $$;

CREATE TEMP TABLE _bf ON COMMIT DROP AS
SELECT c.organization_id, c.tecnico_id AS beneficiario_id, 'ORDEN'::text AS documento_tipo,
       c.orden_id AS documento_id, 'TECNICO'::text AS rol, c.ganancia AS base,
       c.porcentaje_comision AS porcentaje, COALESCE(c.monto_comision, 0) AS monto,
       c.fecha_completado AS fecha_devengo, COALESCE(c.fecha_pago_comision, now()) AS pagado_at,
       NULLIF(btrim(c.comision_pago_notas), '') AS notas
  FROM v_comisiones_ordenes c
 WHERE c.comision_pagada
UNION ALL
SELECT c.organization_id, c.vendedor_id, 'VENTA', c.venta_id, 'VENDEDOR',
       COALESCE(v.iva_neto, v.total), c.porcentaje_comision, COALESCE(c.monto_comision, 0),
       c.created_at, COALESCE(c.fecha_pago_comision, now()), NULLIF(btrim(c.comision_pago_notas), '')
  FROM v_comisiones_ventas c JOIN ventas v ON v.id = c.venta_id
 WHERE c.comision_pagada AND c.vendedor_id IS NOT NULL
UNION ALL
-- Paid sales annulled later: 333 hides them; same expression as its paid branch.
SELECT v.organization_id, v.vendedor_id, 'VENTA', v.id, 'VENDEDOR',
       COALESCE(v.iva_neto, v.total, 0), COALESCE(v.porcentaje_comision, 0),
       COALESCE(ROUND(COALESCE(v.iva_neto, v.total) * COALESCE(v.porcentaje_comision, 0) / 100, 2), 0),
       v.created_at, COALESCE(v.fecha_pago_comision, now()), NULLIF(btrim(v.comision_pago_notas), '')
  FROM ventas v
 WHERE v.comision_pagada AND v.estado = 'ANULADA' AND v.vendedor_id IS NOT NULL;

DELETE FROM _bf b WHERE EXISTS (
  SELECT 1 FROM comisiones_pagos_items i
   WHERE NOT i.anulado AND i.documento_tipo = b.documento_tipo AND i.documento_id = b.documento_id
     AND i.rol = b.rol AND i.tipo = 'ORIGINAL' );

ALTER TABLE _bf ADD COLUMN dia DATE;
UPDATE _bf b SET dia = (b.pagado_at AT TIME ZONE org.zona_horaria)::date
  FROM organizations org WHERE org.id = b.organization_id;

CREATE TEMP TABLE _bf_pagos ON COMMIT DROP AS
SELECT generate_cuid() AS pago_id, g.*
  FROM (SELECT b.organization_id, b.beneficiario_id, b.dia, b.notas,
               MAX(b.pagado_at) AS fecha_pago, SUM(b.monto) AS total
          FROM _bf b GROUP BY b.organization_id, b.beneficiario_id, b.dia, b.notas) g;

INSERT INTO comisiones_pagos (id, organization_id, beneficiario_id, fecha_pago, pagado_por, notas, total, origen)
SELECT pago_id, organization_id, beneficiario_id, fecha_pago, NULL, notas, total, 'BACKFILL' FROM _bf_pagos;

INSERT INTO comisiones_pagos_items (pago_id, organization_id, documento_tipo, documento_id, rol, tipo,
                                    ajuste_ref, base, porcentaje, monto, fecha_devengo)
SELECT p.pago_id, b.organization_id, b.documento_tipo, b.documento_id, b.rol, 'ORIGINAL',
       NULL, b.base, b.porcentaje, b.monto, b.fecha_devengo
  FROM _bf b
  JOIN _bf_pagos p ON p.organization_id = b.organization_id AND p.beneficiario_id = b.beneficiario_id
                  AND p.dia = b.dia AND p.notas IS NOT DISTINCT FROM b.notas;

-- ----------------------------------------------------------------------------
-- Closing checks
-- ----------------------------------------------------------------------------

-- [1] inserted by this run
SELECT '[1] insertado' AS seccion,
       (SELECT COUNT(*) FROM _bf_pagos) AS pagos,
       (SELECT COUNT(*) FROM _bf) AS items,
       (SELECT COALESCE(SUM(total), 0) FROM _bf_pagos) AS total;

-- [2] por beneficiario: frozen items vs today's paid screen total - every non-zero
-- difference must be explained by a row in [4]
WITH hoy AS (
  SELECT c.organization_id, c.tecnico_id AS beneficiario_id, 'TECNICO'::text AS rol,
         SUM(COALESCE(c.monto_comision, 0)) AS monto
    FROM v_comisiones_ordenes c
    JOIN organizations org ON org.id = c.organization_id
   WHERE c.comision_pagada AND c.estado_cobro = 'COBRADO'
     AND (c.estado IN ('REPARADO', 'ENTREGADO')
          OR (c.estado = 'ENTREGADO_SIN_REPARACION' AND org.comision_aplica_sin_reparacion))
   GROUP BY c.organization_id, c.tecnico_id
  UNION ALL
  SELECT c.organization_id, c.vendedor_id, 'VENDEDOR', SUM(COALESCE(c.monto_comision, 0))
    FROM v_comisiones_ventas c
   WHERE c.comision_pagada AND c.vendedor_id IS NOT NULL
   GROUP BY c.organization_id, c.vendedor_id
), nuevo AS (
  SELECT i.organization_id, p.beneficiario_id, i.rol, SUM(i.monto) AS monto
    FROM comisiones_pagos_items i
    JOIN comisiones_pagos p ON p.id = i.pago_id
   WHERE NOT i.anulado AND i.tipo = 'ORIGINAL' AND i.rol IN ('TECNICO', 'VENDEDOR')
   GROUP BY i.organization_id, p.beneficiario_id, i.rol
)
SELECT '[2] por beneficiario' AS seccion,
       COALESCE(h.organization_id, n.organization_id) AS organization_id,
       COALESCE(h.beneficiario_id, n.beneficiario_id) AS beneficiario_id,
       COALESCE(h.rol, n.rol) AS rol,
       h.monto AS hoy, n.monto AS congelado,
       COALESCE(n.monto, 0) - COALESCE(h.monto, 0) AS diferencia
  FROM hoy h
  FULL JOIN nuevo n ON n.organization_id = h.organization_id
                   AND n.beneficiario_id = h.beneficiario_id AND n.rol = h.rol
 ORDER BY 2, 3, 4;

-- [3] filas post-pago: returns / annulments recorded after a document was paid
SELECT '[3] filas post-pago' AS seccion, d.organization_id, d.beneficiario_id, d.rol, d.tipo,
       d.documento_tipo, d.documento_id, d.monto, d.pagado
  FROM v_comisiones_devengadas d
 WHERE d.tipo IN ('AJUSTE_DEVOLUCION', 'AJUSTE_ANULACION')
 ORDER BY d.organization_id, d.beneficiario_id, d.documento_id;

-- [4] pagadas fuera de los filtros de hoy: frozen items today's screens do not total
SELECT '[4] pagadas fuera de los filtros de hoy' AS seccion, i.organization_id, p.beneficiario_id,
       i.rol, i.documento_tipo, i.documento_id, i.monto,
       o.estado::text AS estado, o.estado_cobro::text AS estado_cobro
  FROM comisiones_pagos_items i
  JOIN comisiones_pagos p ON p.id = i.pago_id AND p.origen = 'BACKFILL'
  JOIN ordenes_servicio o ON o.id = i.documento_id
  JOIN organizations org ON org.id = i.organization_id
 WHERE NOT i.anulado AND i.tipo = 'ORIGINAL' AND i.rol = 'TECNICO' AND i.documento_tipo = 'ORDEN'
   AND NOT (o.estado_cobro = 'COBRADO'
            AND (o.estado IN ('REPARADO', 'ENTREGADO')
                 OR (o.estado = 'ENTREGADO_SIN_REPARACION' AND org.comision_aplica_sin_reparacion)))
UNION ALL
SELECT '[4] pagadas fuera de los filtros de hoy', i.organization_id, p.beneficiario_id,
       i.rol, i.documento_tipo, i.documento_id, i.monto,
       v.estado::text, NULL
  FROM comisiones_pagos_items i
  JOIN comisiones_pagos p ON p.id = i.pago_id AND p.origen = 'BACKFILL'
  JOIN ventas v ON v.id = i.documento_id
 WHERE NOT i.anulado AND i.tipo = 'ORIGINAL' AND i.rol = 'VENDEDOR' AND i.documento_tipo = 'VENTA'
   AND v.estado = 'ANULADA';

-- [5] pagadas sin beneficiario: legacy-paid documents that were not migrated
SELECT '[5] pagadas sin beneficiario' AS seccion, o.organization_id, 'ORDEN' AS documento_tipo,
       o.id AS documento_id, o.fecha_pago_comision
  FROM ordenes_servicio o
 WHERE o.comision_pagada AND o.tecnico_id IS NULL
UNION ALL
SELECT '[5] pagadas sin beneficiario', v.organization_id, 'VENTA', v.id, v.fecha_pago_comision
  FROM ventas v
 WHERE v.comision_pagada AND v.vendedor_id IS NULL;
