-- ============================================================================
-- 318: get_deuda_cliente_sucursal — end of the fiado double-count
-- ============================================================================
-- BUG (pre-existing, introduced with mig 267): a fiado order was counted twice.
--
--   deuda_fiado   = GREATEST(-SUM(cuenta_corriente.monto), 0)
--   deuda_ordenes = SUM(GREATEST(costo_final - descuento_cobro - total_cobrado, 0))
--                   over ordenes with estado_cobro IN ('PENDIENTE','PARCIAL')
--
-- When an order is delivered with a pending balance, entregar/route.ts:187 calls
-- cargar_deuda_cuenta_corriente and the debt lands in cuenta_corriente as CARGO.
-- But /entregar never touches estado_cobro, and recalcular_estado_cobro
-- (mig 067:75-93) derives it ONLY from cobros_orden. So the order stays
-- PENDIENTE with total_cobrado = 0 AND carries its CARGO: both terms count the
-- same money.
--
-- This RPC feeds app/api/clientes/[id]/deuda-sucursal/route.ts, which its own
-- comment calls "fuente de verdad para el recordatorio de pago por WhatsApp":
-- clients with fiado were being asked for twice what they owe.
--
-- FIX — one rule: once an order's debt has moved to the cuenta corriente, the
-- cuenta corriente is the ONLY source of truth for that order. The order is
-- excluded from deuda_ordenes whether its CARGO was later reverted or not.
-- Reverting a CARGO must clear the debt on both sides; without the
-- "reverted or not" part, a reversal would bounce the debt back into
-- deuda_ordenes and be worthless.
--
-- Degradation: cargar_deuda_cuenta_corriente errors are logged and do NOT abort
-- the delivery (entregar/route.ts:199-202), so orders with a pending balance and
-- no CARGO exist. Those keep counting in deuda_ordenes, which is correct.
--
-- Everything else is byte-identical to mig 273 (which itself narrowed mig 267
-- to only count COBRABLE orders, estado IN ('REPARADO','ENTREGADO')), including
-- the REVOKE/GRANT block: the function is SECURITY DEFINER and ignores RLS, so
-- without it any anon key (shipped in the browser bundle) could read any
-- client's debt in any organization through PostgREST.
--
-- The `o.estado IN ('REPARADO', 'ENTREGADO')` filter below is inherited from
-- 273 and deliberately preserved: without it, orders in EN_REPARACION (not yet
-- collectable), CANCELADO (with a leftover costo_final) or
-- ENTREGADO_SIN_COBRO (delivered without charging, by definition not owed)
-- would count as debt again.
-- ============================================================================

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
    fiado.monto                 AS deuda_fiado,
    ordenes.monto               AS deuda_ordenes,
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
      AND NOT EXISTS (
        SELECT 1
        FROM cuenta_corriente cc2
        WHERE cc2.organization_id = o.organization_id
          AND cc2.cliente_id      = o.cliente_id
          AND cc2.tipo            = 'CARGO'
          AND cc2.referencia_tipo = 'ORDEN'
          AND cc2.referencia_id   = o.id
      )
  ) ordenes;
$$;

REVOKE EXECUTE ON FUNCTION get_deuda_cliente_sucursal(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_deuda_cliente_sucursal(TEXT, TEXT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION get_deuda_cliente_sucursal(TEXT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION get_deuda_cliente_sucursal(TEXT, TEXT, TEXT) TO service_role;

COMMENT ON FUNCTION get_deuda_cliente_sucursal(TEXT, TEXT, TEXT) IS
  'Per-branch combined debt (fiado + unpaid ordenes) for one cliente. '
  'p_sucursal_id NULL = sum across all branches (ADMIN verTodas). '
  'An order whose debt already moved to cuenta corriente (CARGO with '
  'referencia_tipo=ORDEN) is excluded from deuda_ordenes — reverted or not — '
  'so the same money is never counted twice. Supersedes migration 273.';
