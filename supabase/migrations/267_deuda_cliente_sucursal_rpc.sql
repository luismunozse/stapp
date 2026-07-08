-- ============================================================
-- Migration 267: get_deuda_cliente_sucursal RPC
-- ============================================================
-- Per-branch combined debt (fiado + unpaid ordenes) for a single cliente.
-- Needed because neither `clientes.saldo_cuenta` nor `v_clientes_resumen.deuda_pendiente`
-- (mig 225) are branch-scoped — both are cliente-global aggregates. This RPC is the
-- first source of truth for "how much does this client owe AT THIS branch".
--
-- ------------------------------------------------------------------------------
-- Phase 0 audit — cuenta_corriente sign convention (task 0.1)
-- ------------------------------------------------------------------------------
-- Read mig 066, 225 (venta_sin_cobro_cuenta_corriente), 234, 235, 244, 254.
-- Every writer keeps clientes.saldo_cuenta = SUM(cuenta_corriente.monto) as an
-- invariant (v_nuevo_saldo := v_saldo_actual +/- p_monto, then UPDATE clientes SET
-- saldo_cuenta = v_nuevo_saldo). The sign convention on `monto` is:
--   DEPOSITO   (066)      → +monto  (credit in favor)
--   USO        (066)      → -monto  (debt / spending down a credit balance)
--   CARGO      (234)      → -monto  (fiado debt charged to the client)
--   PAGO       (234)      → +monto  (payment that reduces fiado debt)
--   DEVOLUCION (235)      → +monto  (credit issued back to the client)
--   AJUSTE     (235/244/254, restore_stock_on_cancel trigger) → -v_neto, where
--              v_neto = SUM(monto) FILTER (tipo IN ('CARGO','USO','PAGO','DEVOLUCION'))
--              for the cancelled venta. This is a net-zero reversal: it always
--              carries whatever sign exactly cancels out the venta's prior
--              movements, so it PRESERVES the same convention (does not introduce
--              a new sign rule).
-- Conclusion: positive monto = credit (reduces or offsets debt), negative monto =
-- debt. Therefore outstanding fiado debt for a client = GREATEST(-SUM(monto), 0).
-- Sign convention CONFIRMED consistent across all 6 migrations audited.
--
-- ------------------------------------------------------------------------------
-- CRITICAL — sucursal_id propagation gap (discovered during this audit, NOT part
-- of the original design assumptions)
-- ------------------------------------------------------------------------------
-- Mig 238 added `cuenta_corriente.sucursal_id` and threaded `p_sucursal_id` ONLY
-- through `depositar_cuenta_corriente`. The four fiado-related writers —
-- `cargar_deuda_cuenta_corriente` (CARGO, mig 234), `usar_cuenta_corriente` (USO,
-- mig 066), `pagar_fiado_cuenta_corriente` (PAGO, mig 234), and
-- `devolver_cuenta_corriente` (DEVOLUCION, mig 235) — have NEVER been updated to
-- accept or persist `sucursal_id`. Every row they insert has `sucursal_id = NULL`.
-- The one-time backfill in mig 238 only touched rows that existed AT THAT TIME
-- (attributed to the org's principal sucursal); rows inserted by these 4 functions
-- SINCE mig 238 still land with sucursal_id = NULL. This is a pre-existing,
-- previously-documented-but-unresolved gap (see engram: "Caja: COGS contaminaba
-- arqueo" session — "Gap pendiente: cuenta_corriente sin sucursal_id").
--
-- Practical impact on THIS RPC: filtering `cuenta_corriente` by a concrete
-- `p_sucursal_id` (the common case for non-admin operators, who are always
-- branch-scoped per lib/sucursal.ts) excludes essentially ALL post-mig-238
-- CARGO/PAGO/USO/DEVOLUCION rows, because those rows have sucursal_id = NULL.
-- The `deuda_fiado` component will therefore read as understated (often exactly
-- 0) for branch-scoped callers, even when the client genuinely has fiado debt.
-- `deuda_ordenes` is NOT affected (ordenes_servicio.sucursal_id has always been
-- populated at write time — see mig 206/210/218).
--
-- This RPC is implemented per the approved design contract (filter fiado by
-- sucursal_id when provided) because fixing the root cause requires extending
-- 4 functions AND every one of their callers (crear_venta_atomica,
-- registrar_cobros_orden_atomica, registrar_pagos_venta_atomica,
-- registrar_pago_factura_atomica, registrar_devolucion_atomica,
-- anular_factura_atomica, eliminar_factura_atomica, restore_stock_on_cancel
-- trigger) — a materially larger, separate change that does not fit this slice's
-- PR1 scope. Flagged as a CRITICAL follow-up in the apply-progress report.
-- ============================================================

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
      AND (p_sucursal_id IS NULL OR o.sucursal_id = p_sucursal_id)
  ) ordenes;
$$;

COMMENT ON FUNCTION get_deuda_cliente_sucursal(TEXT, TEXT, TEXT) IS
  'Per-branch combined debt (fiado + unpaid ordenes) for one cliente. '
  'p_sucursal_id NULL = sum across all branches (ADMIN verTodas). '
  'fiado = GREATEST(-SUM(cuenta_corriente.monto), 0) filtered by sucursal_id; '
  'ordenes = SUM(GREATEST(costo_final-descuento_cobro-total_cobrado,0)) over '
  'ordenes_servicio where estado_cobro IN (PENDIENTE,PARCIAL), filtered by sucursal_id. '
  'KNOWN GAP: cuenta_corriente.sucursal_id is only populated for DEPOSITO rows '
  '(mig 238); CARGO/USO/PAGO/DEVOLUCION writers do not persist it, so branch-scoped '
  'fiado may read as understated until a follow-up migration closes that gap. '
  'Idempotent CREATE OR REPLACE. Migration 267.';
