-- ============================================================================
-- 273: la deuda de órdenes cuenta solo estados COBRABLES (REPARADO/ENTREGADO)
-- ============================================================================
-- Bug: tanto el RPC get_deuda_cliente_sucursal (mig 267) como la vista
-- v_clientes_resumen (mig 238) computaban la deuda de órdenes filtrando solo
-- por `estado_cobro IN ('PENDIENTE','PARCIAL')`, SIN mirar el estado de la
-- orden. Como estado_cobro arranca en 'PENDIENTE' al crear la orden (mig 067) y
-- nunca se resetea al cancelar, las órdenes CANCELADAS y las EN PROGRESO (con un
-- costo_final ya cargado) sumaban como deuda cobrable. Efecto visible: el
-- recordatorio de pago por WhatsApp le decía al cliente que debía plata que no
-- debía.
--
-- Fix: contar solo las órdenes en estado realmente cobrable, alineado con la
-- lista "sin cobrar" de la caja (app/api/caja/route.ts): estado IN
-- ('REPARADO','ENTREGADO'). Una orden debe plata cuando fue reparada/entregada
-- y no se cobró; cancelada o en progreso no es deuda exigible.
-- ============================================================================

-- (1) RPC get_deuda_cliente_sucursal — se re-emite con el filtro de estado.
CREATE OR REPLACE FUNCTION get_deuda_cliente_sucursal(
  p_org_id      TEXT,
  p_cliente_id  TEXT,
  p_sucursal_id TEXT DEFAULT NULL
)
RETURNS TABLE (
  deuda_fiado   NUMERIC,
  deuda_ordenes NUMERIC,
  deuda_total   NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    fiado.monto              AS deuda_fiado,
    ordenes.monto             AS deuda_ordenes,
    fiado.monto + ordenes.monto AS deuda_total
  FROM (
    SELECT GREATEST(-COALESCE(SUM(cc.monto), 0), 0) AS monto
    FROM cuenta_corriente cc
    WHERE cc.organization_id = p_org_id
      AND cc.cliente_id = p_cliente_id
      AND (p_sucursal_id IS NULL OR cc.sucursal_id = p_sucursal_id)
  ) fiado,
  (
    SELECT COALESCE(SUM(
      GREATEST(
        COALESCE(o.costo_final, 0) - COALESCE(o.descuento_cobro, 0) - COALESCE(o.total_cobrado, 0),
        0
      )
    ), 0) AS monto
    FROM ordenes_servicio o
    WHERE o.organization_id = p_org_id
      AND o.cliente_id = p_cliente_id
      AND o.estado_cobro IN ('PENDIENTE', 'PARCIAL')
      AND o.estado IN ('REPARADO', 'ENTREGADO')
      AND (p_sucursal_id IS NULL OR o.sucursal_id = p_sucursal_id)
  ) ordenes;
$$;

-- RPC sensible (SECURITY DEFINER): solo service_role puede ejecutarla, igual
-- que en la migración 267.
REVOKE EXECUTE ON FUNCTION get_deuda_cliente_sucursal(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_deuda_cliente_sucursal(TEXT, TEXT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION get_deuda_cliente_sucursal(TEXT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION get_deuda_cliente_sucursal(TEXT, TEXT, TEXT) TO service_role;

-- (2) Vista v_clientes_resumen — deuda_pendiente con el mismo filtro de estado.
CREATE OR REPLACE VIEW v_clientes_resumen AS
SELECT
  c.*,
  COALESCE(agg.ordenes_count, 0)   AS ordenes_count,
  agg.ultima_visita                AS ultima_visita,
  COALESCE(agg.deuda_pendiente, 0) AS deuda_pendiente,
  sec.sectores_texto               AS sectores_texto
FROM clientes c
LEFT JOIN (
  SELECT
    cliente_id,
    COUNT(*)            AS ordenes_count,
    MAX(fecha_ingreso)  AS ultima_visita,
    SUM(
      CASE WHEN estado_cobro IN ('PENDIENTE','PARCIAL')
                AND estado IN ('REPARADO','ENTREGADO')
        THEN GREATEST(
          COALESCE(costo_final, 0)
          - COALESCE(descuento_cobro, 0)
          - COALESCE(total_cobrado, 0), 0)
        ELSE 0 END
    ) AS deuda_pendiente
  FROM ordenes_servicio
  GROUP BY cliente_id
) agg ON agg.cliente_id = c.id
LEFT JOIN (
  SELECT cliente_id, string_agg(nombre, ' ') AS sectores_texto
  FROM sectores_cliente
  WHERE activo = true
  GROUP BY cliente_id
) sec ON sec.cliente_id = c.id;
