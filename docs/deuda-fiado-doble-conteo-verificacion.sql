-- =============================================================================
-- Deuda de fiado contada dos veces — reporte de impacto (solo lectura)
-- =============================================================================
-- SOLO LECTURA. No modifica una sola fila. Correr en el SQL editor de
-- Supabase Studio ANTES de aplicar la migración 309, para saber a cuántos
-- clientes hay que avisar y por cuánta plata. Precedente: docs/305-pagos-
-- duplicados-dryrun.sql, docs/cc-backfill-fase3-dryrun.sql.
--
-- QUÉ PASÓ
--
-- get_deuda_cliente_sucursal (mig 267) suma deuda_fiado (cuenta_corriente) +
-- deuda_ordenes (ordenes_servicio sin cobrar). Cuando una orden se entrega a
-- fiado, entregar/route.ts:187 carga un CARGO en cuenta_corriente, pero nunca
-- toca estado_cobro — y recalcular_estado_cobro (mig 067) lo deriva solo de
-- cobros_orden. La orden queda PENDIENTE con total_cobrado=0 Y con su CARGO:
-- las dos sumas cuentan la misma plata. Esta RPC es la fuente del recordatorio
-- de pago por WhatsApp (app/api/clientes/[id]/deuda-sucursal/route.ts): a
-- estos clientes se les está pidiendo el doble de lo que deben.
--
-- El RPC hoy en producción (mig 273) ya filtra deuda_ordenes por
-- `o.estado IN ('REPARADO', 'ENTREGADO')` — no cualquier orden PENDIENTE/
-- PARCIAL cuenta, solo las cobrables. Los subqueries `ordenes_hoy` y
-- `ordenes_fix` de abajo modelan exactamente eso, filtro de estado incluido,
-- para que `deuda_reportada_hoy` coincida con lo que el RPC devuelve hoy de
-- verdad y `duplicado` no infle el impacto con órdenes que 273 ya excluye
-- (EN_REPARACION, CANCELADO, ENTREGADO_SIN_COBRO).
--
-- Corre contra TODAS las organizaciones (no hace falta editar nada ni
-- reemplazar ningún parámetro): scripts/db-run.mjs no interpola variables
-- psql, así que un placeholder tipo :'org_id' simplemente no funciona acá.
-- Agrupar por organización, en vez de filtrar una sola, además da la lista
-- completa de a quién avisar en un solo pasada.
--
-- CÓMO LEER LOS RESULTADOS
--
--   (1) El detalle: cada fila es una orden que hoy suma en los dos lados.
--   (2) El impacto por cliente: cuánto baja la deuda reportada con el fix.
--   (3) El resumen por organización: a quién avisar y cuánto.
--   (4) El número para la descripción del PR: total de clientes afectados y
--       plata contada de más, agregado en toda la base.
--
-- Después de aplicar 309, volver a correr (3) y (4): tienen que dar 0 filas /
-- 0 clientes. Eso es el verde en datos reales — el chequeo reproducible con
-- fixtures sintéticas vive en supabase/migrations/verify/309_probes.sql.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- (1) Órdenes cuya deuda ya migró a cuenta corriente y que además siguen
--     sumando por el lado de `deuda_ordenes`. Cada fila es plata duplicada.
-- ---------------------------------------------------------------------------
SELECT
  o.organization_id,
  org.nombre          AS organizacion,
  o.id                AS orden_id,
  o.numero_orden,
  o.cliente_id,
  o.estado,
  o.estado_cobro,
  GREATEST(
    COALESCE(o.costo_final, 0) - COALESCE(o.descuento_cobro, 0) - COALESCE(o.total_cobrado, 0),
    0
  )                   AS pendiente_orden,
  ABS(cc.monto)       AS cargo_cuenta_corriente
FROM ordenes_servicio o
JOIN organizations org
  ON  org.id = o.organization_id
JOIN cuenta_corriente cc
  ON  cc.organization_id = o.organization_id
  AND cc.cliente_id      = o.cliente_id
  AND cc.tipo            = 'CARGO'
  AND cc.referencia_tipo = 'ORDEN'
  AND cc.referencia_id   = o.id
WHERE o.estado_cobro IN ('PENDIENTE', 'PARCIAL')
  AND o.estado IN ('REPARADO', 'ENTREGADO')
ORDER BY org.nombre, o.numero_orden DESC;

-- ---------------------------------------------------------------------------
-- (2) Impacto por cliente: cuánto le baja la deuda reportada al aplicar el
--     fix. `deuda_reportada_hoy` es lo que hoy devuelve get_deuda_cliente_
--     sucursal con p_sucursal_id NULL; `deuda_real` es lo que devolverá
--     después.
-- ---------------------------------------------------------------------------
SELECT
  c.organization_id,
  org.nombre                                  AS organizacion,
  c.id                                        AS cliente_id,
  c.nombre                                    AS cliente,
  fiado.monto + ordenes_hoy.monto             AS deuda_reportada_hoy,
  fiado.monto + ordenes_fix.monto             AS deuda_real,
  ordenes_hoy.monto - ordenes_fix.monto       AS duplicado
FROM clientes c
JOIN organizations org ON org.id = c.organization_id
CROSS JOIN LATERAL (
  SELECT GREATEST(-COALESCE(SUM(cc.monto), 0), 0) AS monto
  FROM cuenta_corriente cc
  WHERE cc.organization_id = c.organization_id
    AND cc.cliente_id = c.id
) fiado
CROSS JOIN LATERAL (
  SELECT COALESCE(SUM(GREATEST(
    COALESCE(o.costo_final, 0) - COALESCE(o.descuento_cobro, 0) - COALESCE(o.total_cobrado, 0), 0
  )), 0) AS monto
  FROM ordenes_servicio o
  WHERE o.organization_id = c.organization_id
    AND o.cliente_id = c.id
    AND o.estado_cobro IN ('PENDIENTE', 'PARCIAL')
    AND o.estado IN ('REPARADO', 'ENTREGADO')
) ordenes_hoy
CROSS JOIN LATERAL (
  SELECT COALESCE(SUM(GREATEST(
    COALESCE(o.costo_final, 0) - COALESCE(o.descuento_cobro, 0) - COALESCE(o.total_cobrado, 0), 0
  )), 0) AS monto
  FROM ordenes_servicio o
  WHERE o.organization_id = c.organization_id
    AND o.cliente_id = c.id
    AND o.estado_cobro IN ('PENDIENTE', 'PARCIAL')
    AND o.estado IN ('REPARADO', 'ENTREGADO')
    AND NOT EXISTS (
      SELECT 1 FROM cuenta_corriente cc2
      WHERE cc2.organization_id = o.organization_id
        AND cc2.cliente_id      = o.cliente_id
        AND cc2.tipo            = 'CARGO'
        AND cc2.referencia_tipo = 'ORDEN'
        AND cc2.referencia_id   = o.id
    )
) ordenes_fix
WHERE ordenes_hoy.monto - ordenes_fix.monto > 0
ORDER BY duplicado DESC;

-- ---------------------------------------------------------------------------
-- (3) Resumen por organización: a quién avisar y cuánto, antes de aplicar.
-- ---------------------------------------------------------------------------
WITH impacto AS (
  SELECT
    c.organization_id,
    org.nombre AS organizacion,
    c.id       AS cliente_id,
    ordenes_hoy.monto - ordenes_fix.monto AS duplicado
  FROM clientes c
  JOIN organizations org ON org.id = c.organization_id
  CROSS JOIN LATERAL (
    SELECT COALESCE(SUM(GREATEST(
      COALESCE(o.costo_final, 0) - COALESCE(o.descuento_cobro, 0) - COALESCE(o.total_cobrado, 0), 0
    )), 0) AS monto
    FROM ordenes_servicio o
    WHERE o.organization_id = c.organization_id
      AND o.cliente_id = c.id
      AND o.estado_cobro IN ('PENDIENTE', 'PARCIAL')
      AND o.estado IN ('REPARADO', 'ENTREGADO')
  ) ordenes_hoy
  CROSS JOIN LATERAL (
    SELECT COALESCE(SUM(GREATEST(
      COALESCE(o.costo_final, 0) - COALESCE(o.descuento_cobro, 0) - COALESCE(o.total_cobrado, 0), 0
    )), 0) AS monto
    FROM ordenes_servicio o
    WHERE o.organization_id = c.organization_id
      AND o.cliente_id = c.id
      AND o.estado_cobro IN ('PENDIENTE', 'PARCIAL')
      AND o.estado IN ('REPARADO', 'ENTREGADO')
      AND NOT EXISTS (
        SELECT 1 FROM cuenta_corriente cc2
        WHERE cc2.organization_id = o.organization_id
          AND cc2.cliente_id      = o.cliente_id
          AND cc2.tipo            = 'CARGO'
          AND cc2.referencia_tipo = 'ORDEN'
          AND cc2.referencia_id   = o.id
      )
  ) ordenes_fix
  WHERE ordenes_hoy.monto - ordenes_fix.monto > 0
)
SELECT
  organizacion,
  COUNT(DISTINCT cliente_id) AS clientes_afectados,
  ROUND(SUM(duplicado), 2)   AS total_duplicado
FROM impacto
GROUP BY organizacion
ORDER BY total_duplicado DESC;

-- ---------------------------------------------------------------------------
-- (4) El número para la descripción del PR: total agregado en toda la base.
-- ---------------------------------------------------------------------------
WITH impacto AS (
  SELECT
    c.id AS cliente_id,
    ordenes_hoy.monto - ordenes_fix.monto AS duplicado
  FROM clientes c
  CROSS JOIN LATERAL (
    SELECT COALESCE(SUM(GREATEST(
      COALESCE(o.costo_final, 0) - COALESCE(o.descuento_cobro, 0) - COALESCE(o.total_cobrado, 0), 0
    )), 0) AS monto
    FROM ordenes_servicio o
    WHERE o.organization_id = c.organization_id
      AND o.cliente_id = c.id
      AND o.estado_cobro IN ('PENDIENTE', 'PARCIAL')
      AND o.estado IN ('REPARADO', 'ENTREGADO')
  ) ordenes_hoy
  CROSS JOIN LATERAL (
    SELECT COALESCE(SUM(GREATEST(
      COALESCE(o.costo_final, 0) - COALESCE(o.descuento_cobro, 0) - COALESCE(o.total_cobrado, 0), 0
    )), 0) AS monto
    FROM ordenes_servicio o
    WHERE o.organization_id = c.organization_id
      AND o.cliente_id = c.id
      AND o.estado_cobro IN ('PENDIENTE', 'PARCIAL')
      AND o.estado IN ('REPARADO', 'ENTREGADO')
      AND NOT EXISTS (
        SELECT 1 FROM cuenta_corriente cc2
        WHERE cc2.organization_id = o.organization_id
          AND cc2.cliente_id      = o.cliente_id
          AND cc2.tipo            = 'CARGO'
          AND cc2.referencia_tipo = 'ORDEN'
          AND cc2.referencia_id   = o.id
      )
  ) ordenes_fix
  WHERE ordenes_hoy.monto - ordenes_fix.monto > 0
)
SELECT
  COUNT(DISTINCT cliente_id) AS clientes_afectados,
  ROUND(SUM(duplicado), 2)   AS total_duplicado
FROM impacto;
