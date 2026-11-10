-- ============================================================================
-- 377 - Audit of comisiones_definicion (READ ONLY)
-- ============================================================================
-- Run any time: [1] and [2] must be empty - a row there means slice 1 changed a
-- number on an unpaid document.
--
-- Requires 376 and 377 applied (the views read the payout tables); aborts otherwise.
-- Writes nothing. Run with: node scripts/db-run.mjs supabase/migrations/backfill/377_auditoria_comisiones.sql
-- (db-run prints every SELECT.)
--
--   [1]  ORDEN, unpaid documents: today's screen amount vs the definition's TECNICO rows.
--        Expect 0 rows.
--   [2]  VENTA, unpaid documents: today's screen amount vs the definition's VENDEDOR rows.
--        Expect 0 rows.
--   [2b] Unpaid sales with a commission but no seller. Today they show in the seller
--        tab list without a name and are skipped by its summary; the definition emits
--        no row for them. Informational.
--   [3]  Drift between the legacy flag and the frozen items, per legacy role
--        (VENDEDOR <-> ventas, TECNICO <-> ordenes_servicio): flag true without a
--        non-annulled item, and item without flag. Right after 376/377 it lists every
--        legacy-paid document (no items yet); expect 0 rows once the backfill ran.
--   [4]  Row count of the definition by rol, tipo, devengada, pagado.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.comisiones_pagos_items') IS NULL
     OR to_regclass('public.v_comisiones_devengadas') IS NULL THEN
    RAISE EXCEPTION 'Abort: aplicar 376 y 377 antes de la auditoria';
  END IF;
END $$;

-- [1] ORDEN unpaid documents whose amount differs - expect 0 rows
WITH hoy AS (
  SELECT c.orden_id AS documento_id, c.monto_comision AS monto
    FROM v_comisiones_ordenes c
    JOIN organizations org ON org.id = c.organization_id
   WHERE NOT c.comision_pagada AND c.estado_cobro = 'COBRADO'
     AND (c.estado IN ('REPARADO', 'ENTREGADO')
          OR (c.estado = 'ENTREGADO_SIN_REPARACION' AND org.comision_aplica_sin_reparacion))
), nuevo AS (
  SELECT d.documento_id, SUM(d.monto) AS monto
    FROM v_comisiones_devengadas d
    JOIN ordenes_servicio o ON o.id = d.documento_id AND NOT o.comision_pagada
   WHERE d.documento_tipo = 'ORDEN' AND d.rol = 'TECNICO'
   GROUP BY d.documento_id
)
SELECT '[1] ORDEN' AS seccion, COALESCE(h.documento_id, n.documento_id) AS documento_id, h.monto AS hoy, n.monto AS nuevo
  FROM hoy h FULL JOIN nuevo n ON n.documento_id = h.documento_id
 WHERE COALESCE(h.monto, 0) <> COALESCE(n.monto, 0);

-- [2] VENTA unpaid documents whose amount differs - expect 0 rows
WITH hoy AS (
  SELECT c.venta_id AS documento_id, c.monto_comision AS monto
    FROM v_comisiones_ventas c
   WHERE NOT c.comision_pagada AND c.vendedor_id IS NOT NULL
), nuevo AS (
  SELECT d.documento_id, SUM(d.monto) AS monto
    FROM v_comisiones_devengadas d
    JOIN ventas v ON v.id = d.documento_id AND NOT v.comision_pagada
   WHERE d.documento_tipo = 'VENTA' AND d.rol = 'VENDEDOR'
   GROUP BY d.documento_id
)
SELECT '[2] VENTA' AS seccion, COALESCE(h.documento_id, n.documento_id) AS documento_id, h.monto AS hoy, n.monto AS nuevo
  FROM hoy h FULL JOIN nuevo n ON n.documento_id = h.documento_id
 WHERE COALESCE(h.monto, 0) <> COALESCE(n.monto, 0);

-- [2b] unpaid sales with a commission but no seller (informational)
SELECT '[2b] VENTA sin vendedor' AS seccion, COUNT(*) AS documentos, COALESCE(SUM(c.monto_comision), 0) AS monto
  FROM v_comisiones_ventas c
 WHERE NOT c.comision_pagada AND c.vendedor_id IS NULL AND c.monto_comision <> 0;

-- [3] drift between the legacy flag and the frozen items
SELECT '[3] VENTA flag sin item' AS seccion, v.id AS documento_id
  FROM ventas v
 WHERE v.comision_pagada AND NOT EXISTS (
         SELECT 1 FROM comisiones_pagos_items i
          WHERE i.documento_tipo = 'VENTA' AND i.documento_id = v.id
            AND i.rol = 'VENDEDOR' AND NOT i.anulado)
UNION ALL
SELECT '[3] VENTA item sin flag', v.id
  FROM ventas v
 WHERE NOT v.comision_pagada AND EXISTS (
         SELECT 1 FROM comisiones_pagos_items i
          WHERE i.documento_tipo = 'VENTA' AND i.documento_id = v.id
            AND i.rol = 'VENDEDOR' AND NOT i.anulado)
UNION ALL
SELECT '[3] ORDEN flag sin item', o.id
  FROM ordenes_servicio o
 WHERE o.comision_pagada AND NOT EXISTS (
         SELECT 1 FROM comisiones_pagos_items i
          WHERE i.documento_tipo = 'ORDEN' AND i.documento_id = o.id
            AND i.rol = 'TECNICO' AND NOT i.anulado)
UNION ALL
SELECT '[3] ORDEN item sin flag', o.id
  FROM ordenes_servicio o
 WHERE NOT o.comision_pagada AND EXISTS (
         SELECT 1 FROM comisiones_pagos_items i
          WHERE i.documento_tipo = 'ORDEN' AND i.documento_id = o.id
            AND i.rol = 'TECNICO' AND NOT i.anulado);

-- [4] row count by rol, tipo, devengada, pagado
SELECT '[4] filas' AS seccion, f.rol, f.tipo, f.devengada, f.pagado, COUNT(*) AS filas
  FROM v_comisiones_filas f
 GROUP BY f.rol, f.tipo, f.devengada, f.pagado
 ORDER BY f.rol, f.tipo, f.devengada, f.pagado;
